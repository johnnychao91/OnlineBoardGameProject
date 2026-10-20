import { mkdir, readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Context } from 'koa';
import serve from 'koa-static';
import { Server } from 'boardgame.io/server';
import { createMatch } from 'boardgame.io/internal';
import { gameDefinitions, getGameDefinition, publicGameDefinitions, type GameDefinition } from '../games/registry';
import { GuardedTransport } from './transport';
import { RoomStore, currentMatchID, hostPlayerID, hostObserverID, roomMatchIDs, matchGameID, ROOM_CAPACITY, type RoomRecord, type RoomHistory, type RoleSwitchReceipt } from './rooms';
import { RoomPresence } from './presence';
import { FileStorage } from './storage';
import { collectStatistics } from './statistics';
import { createPreviewPage } from './link-preview';
import { admissionCredential, hashToken, randomToken, RateLimiter, safeEqual, validCredential, validRoomID } from './security';

export interface AppConfig {
  dataDir: string;
  publicOrigin: string;
  host: string;
  port: number;
  production: boolean;
  createRoomKey: string;
  clientDir?: string;
  presenceLeaseMs?: number;
  lifecycleSweepMs?: number;
}
const INVITE_TTL = 24 * 60 * 60 * 1000;
const REPLAY_SHARE_TTL = 7 * 24 * 60 * 60 * 1000;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Waiting room capacity is independent of the selected game's player limit. */
function createWaitingMatch(definition: GameDefinition) {
  return createMatch({
    game: {
      ...definition.game, seed: randomToken(), minPlayers: ROOM_CAPACITY, maxPlayers: ROOM_CAPACITY,
      validateSetupData: () => undefined,
      setup: (context) => {
        // Initialize the game's empty lobby with valid game settings, then add
        // shared waiting seats. Real play is initialized again with its true count.
        const G = definition.game.setup!({ ...context, ctx: { ...context.ctx, numPlayers: definition.maxPlayers } }, undefined);
        const player = Object.values(G.players)[0];
        for (let id = 0; id < ROOM_CAPACITY; id++) G.players[id] ??= { ...(player as object) };
        return G;
      },
    },
    numPlayers: ROOM_CAPACITY, setupData: undefined, unlisted: true,
  });
}
const roleSwitchCredential = (credential: string, roomId: string, matchID: string, requestID: string, access: string) =>
  createHmac('sha256', credential).update(JSON.stringify(['boardgame-role-switch-v1', roomId, matchID, requestID, access])).digest('base64url');
function fail(status: number, message: string, code?: 'ADMISSION_REMOVED'): never {
  throw Object.assign(new Error(message), { status, code });
}
function displayName(value: unknown) {
  if (typeof value !== 'string') fail(400, '請輸入暱稱');
  const name = value.trim();
  if (!name || [...name].length > 24 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) fail(400, '暱稱需為 1～24 個字，不能含控制字元');
  return name;
}
async function jsonBody(ctx: Context): Promise<Record<string, any>> {
  if (!ctx.is('application/json')) fail(415, '請使用 JSON 格式');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of ctx.req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 4096) fail(413, '資料過大');
    chunks.push(part);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'JSON 格式錯誤');
    return body;
  } catch { return fail(400, 'JSON 格式錯誤'); }
}

export async function createApplication(config: AppConfig) {
  const origin = new URL(config.publicOrigin).origin;
  if (config.publicOrigin !== origin) throw new Error('PUBLIC_ORIGIN 必須是完整 origin，不能含路徑或尾斜線');
  if (config.production && (!origin.startsWith('https://') || config.createRoomKey.length < 16)) throw new Error('正式環境需 HTTPS PUBLIC_ORIGIN 與至少 16 字元 CREATE_ROOM_KEY');
  const origins = config.production ? [origin] : [...new Set([origin, 'http://localhost:5173', 'http://127.0.0.1:5173'])];
  const dataDir = resolve(config.dataDir);
  if (config.clientDir) {
    const difference = relative(resolve(config.clientDir), dataDir);
    if (!difference || (difference !== '..' && !difference.startsWith('..' + sep) && !isAbsolute(difference))) throw new Error('DATA_DIR 必須放在前端公開目錄之外');
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const rooms = new RoomStore(dataDir);
  await rooms.load();
  const db = new FileStorage({ dir: join(dataDir, 'matches') });
  await db.connect();
  const presence = new RoomPresence(config.presenceLeaseMs ?? 60000);
  const transport = new GuardedTransport(rooms, origins, presence);
  db.isMatchActive = (matchID) => {
    const room = rooms.findByMatch(matchID);
    return !!room && currentMatchID(room) === matchID;
  };
  const server = Server({ games: gameDefinitions.map((g) => g.game), db, transport, origins });
  const limiter = new RateLimiter();
  // Trust the one local reverse proxy only when we are bound exclusively to loopback.
  server.app.proxy = config.production && ['127.0.0.1', '::1'].includes(config.host);
  server.app.maxIpsCount = 1;
  const getRoom = (id: string) => {
    if (!validRoomID(id)) return fail(404, '房間不存在');
    return rooms.rooms.get(id) || fail(404, '房間不存在');
  };
  const snapshot = async (room: RoomRecord, matchID = currentMatchID(room)) => {
    const { metadata, state } = await db.fetch(matchID, { metadata: true, state: true });
    if (!metadata || !state) fail(410, '房間資料無法載入，請重新建立房間');
    return { metadata, state };
  };
  const publicRoom = (room: RoomRecord, metadata: any, state: any, matchID = currentMatchID(room), historical = false) => ({
    roomId: room.roomId, matchID, gameName: matchGameID(room, matchID),
    gameSelected: historical || room.gameSelected !== false, roomCapacity: ROOM_CAPACITY,
    hostPlayerID: historical ? null : hostPlayerID(room),
    hostObserverID: historical ? null : hostObserverID(room),
    history: historical ? [] : (room.history || []).map(entry => ({ ...entry, gameName: entry.gameName ?? room.gameId })),
    numPlayers: state.G.status === 'lobby' ? Object.values(metadata.players).filter((p: any) => p.credentials).length : state.ctx.numPlayers,
    minPlayers: getGameDefinition(matchGameID(room, matchID))!.minPlayers, maxPlayers: getGameDefinition(matchGameID(room, matchID))!.maxPlayers,
    status: state.G.status,
    ...(!historical && state.G.status === 'finished' && room.completedDisplay?.matchID === matchID
      ? { completedDisplayUntil: room.completedDisplay.until } : {}),
    players: Object.values(metadata.players).filter((p: any) => state.G.status === 'lobby' ? p.credentials : state.G.players?.[p.id]).map((p: any) => ({
      id: String(p.id), name: p.name || '', isConnected: historical ? false : !!p.isConnected, ready: historical ? false : !!state.G.players?.[p.id]?.ready,
      ...(!historical && p.credentials ? { membershipID: hashToken(`${room.roomId}:${p.credentials}`).slice(0, 16) } : {}),
      ...(!historical ? { departed: !p.credentials } : {}),
    })),
    spectators: historical ? [] : Object.entries(room.spectators || {}).map(([id, spectator]) => ({ id, name: spectator.name })),
    spectatorCount: historical ? 0 : Object.keys(room.spectators || {}).length, godViewAllowed: true,
  });
  const authenticate = (ctx: Context, metadata: any) => {
    if (ctx.get('X-Observer-ID')) fail(401, '觀戰憑證不能用於玩家操作');
    const playerID = ctx.get('X-Player-ID');
    const credential = ctx.get('Authorization').replace(/^Bearer /, '');
    if (!/^\d$/.test(playerID) || !safeEqual(credential, metadata.players[playerID]?.credentials)) fail(401, '此瀏覽器沒有有效的座位憑證');
    return playerID;
  };
  const authenticateViewer = (ctx: Context, room: RoomRecord, metadata: any) => {
    const observerID = ctx.get('X-Observer-ID');
    if (!observerID) return { access: 'player' as const, id: authenticate(ctx, metadata) };
    const credential = ctx.get('Authorization').replace(/^Bearer /, '');
    if (ctx.get('X-Player-ID') || !validRoomID(observerID) || !validCredential(credential)
      || !safeEqual(hashToken(credential), room.spectators?.[observerID]?.credentialHash)) fail(401, '觀戰憑證不正確');
    return { access: 'spectator' as const, id: observerID };
  };
  const isHost = (room: RoomRecord, viewer: { access: 'player' | 'spectator'; id: string }) =>
    viewer.access === 'player' ? hostPlayerID(room) === viewer.id : hostObserverID(room) === viewer.id;
  const authenticateHost = (ctx: Context, room: RoomRecord, metadata: any, message: string) => {
    const viewer = authenticateViewer(ctx, room, metadata);
    if (!isHost(room, viewer)) fail(403, message);
    return viewer;
  };
  const retainedHost = (room: RoomRecord, players: Array<{ id: number; credentials?: string }>,
    spectators = room.spectators) => {
    const observerID = hostObserverID(room);
    if (observerID !== null && Object.prototype.hasOwnProperty.call(spectators ?? {}, observerID)) {
      return { hostPlayerID: null, hostObserverID: observerID };
    }
    const participants = players.filter(player => player.credentials).sort((a, b) => a.id - b.id);
    const previousPlayerID = hostPlayerID(room);
    const playerID = participants.some(player => String(player.id) === previousPlayerID)
      ? previousPlayerID : participants.length ? String(participants[0].id) : null;
    return { hostPlayerID: playerID, hostObserverID: null };
  };
  const perspectiveOf = (value: unknown) => {
    if (value === undefined || value === 'blind') return 'blind' as const;
    if (value === 'god') return 'god' as const;
    return fail(400, '觀看視角不正確');
  };
  const replayPayload = async (room: RoomRecord, perspective: 'blind' | 'god', matchID = currentMatchID(room)) => {
    const replay = await db.fetchReplay(matchID);
    const definition = getGameDefinition(matchGameID(room, matchID))!;
    return { complete: replay.complete, frames: replay.frames.map((frame) => ({
      stateID: frame.stateID, at: frame.at, G: definition.observerView(frame.G, perspective),
    })) };
  };
  const requestedMatch = (room: RoomRecord, value: unknown) => {
    if (value === undefined) return currentMatchID(room);
    if (!validRoomID(value) || !roomMatchIDs(room).includes(value)) fail(404, '找不到這場對局');
    return value;
  };
  const returnToLobby = async (room: RoomRecord, ending: RoomHistory['ending']) => {
    const previousID = currentMatchID(room);
    const { metadata, state } = await snapshot(room);
    const definition = getGameDefinition(room.gameId)!;
    if (definition.isJoinable(state.G)) return room;
    const outcome = definition.getOutcome(state.G);
    if (ending === 'completed' && !outcome) fail(409, '對局尚未結束');
    const displayMs = ending === 'completed' ? definition.completedDisplayMs?.(state.G) ?? 0 : 0;
    if (displayMs > 0) {
      if (room.completedDisplay?.matchID !== previousID) {
        room = { ...room, completedDisplay: { matchID: previousID, until: Date.now() + displayMs } };
        // Publish the deadline once. Polling, explicit returns and process
        // restarts must neither skip nor keep extending the final-card display.
        await rooms.save(room);
      }
      if (Date.now() < room.completedDisplay!.until) return room;
    }
    const matchID = randomToken(12);
    const match = createWaitingMatch(definition);
    if ('setupDataError' in match) fail(500, '無法返回等待室');
    for (const player of Object.values(metadata.players)) {
      if (player.credentials) match.metadata.players[player.id] = { ...player, isConnected: false };
    }
    const nextHost = retainedHost(room, Object.values(match.metadata.players));
    const history: RoomHistory = { matchID: previousID, gameName: room.gameId, endedAt: Date.now(), ending,
      numPlayers: state.ctx.numPlayers, ...(outcome && ending === 'completed' ? { winner: outcome.winner, reason: outcome.reason } : {}) };
    const next: RoomRecord = { ...room, currentMatchID: matchID, ...nextHost, completedDisplay: undefined,
      departedPlayerIDs: [], history: [...(room.history || []), history] };
    // Create first, then atomically publish the new room pointer. A failed index
    // write leaves an unused file, never an overwritten completed game.
    await db.createNextMatch(previousID, matchID, match);
    await rooms.save(next);
    transport.closeMatch(previousID);
    return next;
  };
  const reconcileRoom = async (room: RoomRecord) => {
    const { state } = await snapshot(room);
    const definition = getGameDefinition(room.gameId)!;
    if (definition.getOutcome(state.G)) return returnToLobby(room, 'completed');
    if (!definition.isJoinable(state.G) && !presence.hasAnyone(room.roomId)) return returnToLobby(room, 'empty');
    return room;
  };
  let sweepInFlight: Promise<void> | undefined;
  const sweep = () => sweepInFlight ??= Promise.all([...rooms.rooms.keys()].map((roomId) =>
    transport.getRoomQueue(roomId).add(async () => { await reconcileRoom(getRoom(roomId)); })
  )).then(() => undefined).finally(() => { sweepInFlight = undefined; });
  let statisticsInFlight: ReturnType<typeof collectStatistics> | undefined;

  server.app.use(async (ctx, next) => {
    ctx.set('Referrer-Policy', 'no-referrer');
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('X-Frame-Options', 'DENY');
    ctx.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.production) ctx.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (ctx.path.startsWith('/api')) ctx.set('Cache-Control', 'no-store');
    try {
      const requestOrigin = ctx.get('Origin');
      if (requestOrigin && !origins.includes(requestOrigin)) fail(403, '來源不被允許');
      await next();
    } catch (error) {
      const status = (error as { status?: number }).status;
      ctx.status = status && status >= 400 && status < 500 ? status : 500;
      ctx.body = {
        error: ctx.status === 500 ? '伺服器暫時無法處理，請稍後重試' : (error as Error).message,
        ...(ctx.status === 403 && (error as { code?: string }).code === 'ADMISSION_REMOVED'
          ? { code: 'ADMISSION_REMOVED' } : {}),
      };
      if (ctx.status === 500) console.error('Request failed:', (error as Error).name);
    }
  });
  server.app.use(async (ctx, next) => {
    if (!ctx.path.startsWith('/api/')) return next();
    // Several friends often share one home IP. Keep read-only room polling in a
    // separate budget so spectators cannot exhaust players' action requests.
    const polling = ctx.method === 'GET' && /^\/api\/rooms\/[A-Za-z0-9_-]+(?:\/view)?$/.test(ctx.path);
    if (!limiter.allow(`${polling ? 'poll' : 'api'}:${ctx.ip}`, polling ? 1200 : 240, 60000)) fail(429, '操作太頻繁，請稍後重試');
    if (ctx.method === 'GET' && ctx.path === '/api/health') { ctx.body = { status: 'ok' }; return; }
    if (ctx.method === 'GET' && ctx.path === '/api/games') { ctx.body = { games: publicGameDefinitions() }; return; }
    if (ctx.method === 'GET' && ctx.path === '/api/stats') {
      if (!limiter.allow(`stats:${ctx.ip}`, 30, 60000)) fail(429, '查詢太頻繁');
      // Share concurrent scans, but do not maintain mutable win counters.
      const scan = statisticsInFlight ??= collectStatistics(db, rooms);
      try { ctx.body = await scan; } finally { if (statisticsInFlight === scan) statisticsInFlight = undefined; }
      return;
    }
    const sharedRoute = /^\/api\/replays\/([A-Za-z0-9_-]+)$/.exec(ctx.path);
    if (ctx.method === 'GET' && sharedRoute) {
      const room = getRoom(sharedRoute[1]);
      const token = ctx.get('X-Replay-Token');
      if (!validCredential(token)) fail(403, '回放分享已失效');
      const share = room.replayShares?.find((entry) => entry.expiresAt > Date.now() && safeEqual(entry.tokenHash, hashToken(token)));
      if (!share) fail(403, '回放分享已失效');
      const matchID = share.matchID ?? room.roomId;
      if (!roomMatchIDs(room).includes(matchID)) fail(403, '回放分享已失效');
      const { metadata, state } = await snapshot(room, matchID);
      if (!getGameDefinition(matchGameID(room, matchID))!.getOutcome(state.G)) fail(409, '對局尚未結束');
      ctx.body = { room: publicRoom(room, metadata, state, matchID, true), perspective: share.perspective, frameIndex: share.frameIndex,
        ...await replayPayload(room, share.perspective, matchID) };
      return;
    }
    if (ctx.method === 'POST' && ctx.path === '/api/rooms') {
      if (!limiter.allow(`create:${ctx.ip}`, 12, 600000)) fail(429, '建立房間太頻繁，請稍後重試');
      const body = await jsonBody(ctx);
      if (config.createRoomKey && !safeEqual(body.createKey, config.createRoomKey)) fail(403, '建立房間密鑰不正確');
      const definition = getGameDefinition(body.gameId === undefined ? gameDefinitions[0].id : body.gameId);
      if (!definition) fail(400, '遊戲不正確');
      if (body.numPlayers !== undefined) fail(400, '不需預選人數，開局時依參與者人數決定');
      const name = displayName(body.displayName);
      const roomId = randomToken(12);
      const invite = randomToken();
      const credentials = randomToken();
      // The framework's default seed is timestamp-based. Use independent CSPRNG
      // entropy for each match and keep it only in server storage.
      const match = createWaitingMatch(definition);
      if ('setupDataError' in match) fail(400, '無法使用這組遊戲設定');
      match.metadata.players['0'].name = name;
      match.metadata.players['0'].credentials = credentials;
      const room: RoomRecord = { roomId, currentMatchID: roomId, hostPlayerID: '0', gameId: definition.id, gameSelected: body.gameId !== undefined, numPlayers: ROOM_CAPACITY, inviteHash: hashToken(invite), inviteExpiresAt: Date.now() + INVITE_TTL, createdAt: Date.now() };
      await db.createMatch(roomId, match);
      await rooms.save(room);
      presence.touch(roomId, 'player:0', 'admission');
      ctx.status = 201;
      ctx.body = { ...publicRoom(room, match.metadata, match.initialState), access: 'player', playerID: '0', credentials,
        inviteUrl: `${origin}/join/${roomId}#invite=${invite}`, expiresAt: room.inviteExpiresAt };
      return;
    }
    const route = /^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/(join|watch|invite|ready|remove|start|view|replay|share|revoke-shares|return|abort|leave|heartbeat|switch-role|game))?$/.exec(ctx.path);
    if (!route) fail(404, '找不到此功能');
    const room = getRoom(route[1]);
    const operation = route[2];
    if (ctx.method === 'GET' && !operation) {
      await transport.getRoomQueue(room.roomId).add(async () => {
        const current = getRoom(room.roomId);
        const { metadata } = await snapshot(current);
        authenticateViewer(ctx, current, metadata);
        const latest = await reconcileRoom(current);
        const result = await snapshot(latest);
        ctx.body = publicRoom(latest, result.metadata, result.state);
      });
      return;
    }
    if (ctx.method === 'GET' && (operation === 'view' || operation === 'replay')) {
      const { metadata } = await snapshot(room);
      const viewer = authenticateViewer(ctx, room, metadata);
      const matchID = operation === 'replay' ? requestedMatch(room, ctx.query.matchID) : currentMatchID(room);
      const definition = getGameDefinition(matchGameID(room, matchID))!;
      const selected = await snapshot(room, matchID);
      const state = selected.state;
      const finished = !!definition.getOutcome(state.G);
      const perspective = perspectiveOf(ctx.query.perspective);
      if (operation === 'replay') {
        if (!finished) fail(409, '完整復盤於對局結束後開放');
        ctx.body = { room: publicRoom(room, selected.metadata, state, matchID, true), ...await replayPayload(room, perspective, matchID) };
      } else {
        if (viewer.access !== 'spectator' && !finished) fail(403, '玩家不能取得觀戰視角');
        ctx.body = { G: definition.observerView(state.G, perspective), stateID: state._stateID, perspective };
      }
      return;
    }
    if (ctx.method !== 'POST' || !operation) fail(405, '不支援的請求');
    const body = await jsonBody(ctx);
    // Use the same match queue as moves, so joining and starting cannot race.
    await transport.getRoomQueue(room.roomId).add(async () => {
      const current = getRoom(room.roomId);
      const matchID = currentMatchID(current);
      const { metadata, state } = await snapshot(current);
      const definition = getGameDefinition(current.gameId)!;
      if (['ready', 'remove', 'start', 'return', 'abort'].includes(operation)
        && body.matchID !== undefined && body.matchID !== matchID) fail(409, '對局已更新，請重新確認房間狀態');
      if (operation === 'join' || operation === 'watch') {
        if (!limiter.allow(`join:${ctx.ip}`, 30, 60000)) fail(429, '加入嘗試太頻繁');
        if (typeof body.inviteToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.inviteToken)) fail(403, '邀請已失效，請向房主索取新連結');
        if (body.requestID !== undefined && (typeof body.requestID !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestID))) fail(400, '加入請求識別碼不正確');
        const watching = operation === 'watch';
        const credentials = body.requestID ? admissionCredential(watching ? `${current.roomId}:observer` : current.roomId, body.inviteToken, body.requestID) : randomToken();
        if (!watching && body.requestID && await db.isAdmissionRevoked(matchID, credentials)) {
          fail(403, '這次入座已被房主移出，請重新開啟有效邀請加入', 'ADMISSION_REMOVED');
        }
        if (watching && body.requestID && current.revokedObserverAdmissions?.includes(hashToken(credentials))) fail(403, '這次觀戰憑證已離開，請重新透過邀請加入', 'ADMISSION_REMOVED');
        // A response lost on a mobile connection can be retried without claiming a
        // second seat. Possessing both secrets is equivalent to the issued seat key.
        const previous = !watching && body.requestID && Object.values(metadata.players).find((player) => safeEqual(player.credentials, credentials));
        if (previous) {
          presence.touch(current.roomId, `player:${previous.id}`, 'admission');
          ctx.body = { ...publicRoom(current, metadata, state), access: 'player', playerID: String(previous.id), credentials };
          return;
        }
        const previousObserver = watching && body.requestID && Object.entries(current.spectators || {}).find(([, observer]) => safeEqual(observer.credentialHash, hashToken(credentials)));
        if (previousObserver) {
          presence.touch(current.roomId, `spectator:${previousObserver[0]}`, 'admission');
          ctx.body = { ...publicRoom(current, metadata, state), access: 'spectator', observerID: previousObserver[0], credentials };
          return;
        }
        if (current.inviteExpiresAt <= Date.now() || !safeEqual(hashToken(body.inviteToken), current.inviteHash)) fail(403, '邀請已失效，請向房主索取新連結');
        if (watching) {
          const spectators = { ...current.spectators };
          if (Object.keys(spectators).length >= 128) fail(409, '此房觀戰憑證數量已達上限');
          const observerID = randomToken(12);
          spectators[observerID] = { name: displayName(body.displayName), credentialHash: hashToken(credentials) };
          const updated = { ...current, spectators };
          await rooms.save(updated);
          presence.touch(current.roomId, `spectator:${observerID}`, 'admission');
          ctx.body = { ...publicRoom(updated, metadata, state), access: 'spectator', observerID, credentials };
          return;
        }
        if (!definition.isJoinable(state.G)) fail(409, '遊戲已開始，不能加入新玩家');
        const name = displayName(body.displayName);
        let seat = Object.values(metadata.players).find((player) => !player.credentials);
        // Old waiting rooms may have fewer placeholder slots; extend only before play.
        if (!seat && Object.keys(metadata.players).length < ROOM_CAPACITY) {
          const id = Object.keys(metadata.players).length;
          seat = metadata.players[id] = { id };
        }
        if (!seat) fail(409, '房間已滿');
        seat.name = name;
        seat.credentials = credentials;
        metadata.updatedAt = Date.now();
        await db.setMetadata(matchID, metadata);
        const updated = hostPlayerID(current) === null && hostObserverID(current) === null
          ? { ...current, hostPlayerID: String(seat.id), hostObserverID: null } : current;
        if (updated !== current) await rooms.save(updated);
        presence.touch(current.roomId, `player:${seat.id}`, 'admission');
        ctx.body = { ...publicRoom(updated, metadata, state), access: 'player', playerID: String(seat.id), credentials: seat.credentials };
      } else if (operation === 'switch-role') {
        if (body.access !== 'player' && body.access !== 'spectator') fail(400, '請選擇參加遊戲或觀戰');
        if (typeof body.requestID !== 'string' || !UUID_V4.test(body.requestID)) fail(400, '切換請求識別碼不正確');
        if (!validRoomID(body.matchID)) fail(400, '請提供目前房間的對局識別碼');
        const requestID = body.requestID.toLowerCase();
        const credentials = ctx.get('Authorization').replace(/^Bearer /, '');
        if (!validCredential(credentials)) fail(401, '此瀏覽器沒有有效的房間憑證');
        const observerID = ctx.get('X-Observer-ID');
        const sourceAccess = observerID ? 'spectator' : 'player';
        const sourceID = observerID || ctx.get('X-Player-ID');
        if ((observerID && (ctx.get('X-Player-ID') || !validRoomID(observerID)))
          || (!observerID && !/^\d$/.test(sourceID))) fail(401, '房間憑證不正確');
        const sourceHash = hashToken(credentials);
        const nextCredentials = roleSwitchCredential(credentials, current.roomId, body.matchID, requestID, body.access);
        const targetIsCurrent = (receipt: RoleSwitchReceipt, players = metadata.players, spectators = current.spectators) =>
          receipt.targetAccess === 'player'
            ? safeEqual(receipt.targetCredentialHash, players[Number(receipt.targetID)]?.credentials ? hashToken(players[Number(receipt.targetID)].credentials!) : '')
            : safeEqual(receipt.targetCredentialHash, spectators?.[receipt.targetID]?.credentialHash);
        // An old identity may recover only the exact successful response. It can
        // neither issue a new transition nor resurrect a departed/replaced target.
        const receipt = current.roleSwitchReceipts?.find((entry) =>
          entry.sourceAccess === sourceAccess && entry.sourceID === sourceID
          && entry.sourceMatchID === body.matchID && entry.requestID === requestID
          && entry.targetAccess === body.access && safeEqual(entry.sourceCredentialHash, sourceHash)
          && safeEqual(entry.targetCredentialHash, hashToken(nextCredentials)) && targetIsCurrent(entry));
        if (receipt) {
          presence.touch(current.roomId, `${receipt.targetAccess}:${receipt.targetID}`, 'admission');
          ctx.body = { ...publicRoom(current, metadata, state), access: receipt.targetAccess,
            ...(receipt.targetAccess === 'player' ? { playerID: receipt.targetID } : { observerID: receipt.targetID }),
            credentials: nextCredentials };
          return;
        }
        const viewer = authenticateViewer(ctx, current, metadata);
        if (body.matchID !== matchID) fail(409, '對局已更新，請重新確認房間狀態');
        if (!definition.isJoinable(state.G)) fail(409, '對局進行中不能切換，請等返回等待室');
        if (viewer.access === body.access) fail(409, '目前已是所選身分');
        const spectators = { ...current.spectators };
        const participants = Object.values(metadata.players).filter((player) => player.credentials);
        if (body.access === 'player' && participants.length >= ROOM_CAPACITY) fail(409, '參與席位已滿，請先留在觀戰席');
        if (body.access === 'spectator' && Object.keys(spectators).length >= 128) fail(409, '此房觀戰席數量已達上限');
        const nextID = randomToken(12);
        const match = createWaitingMatch(definition);
        if ('setupDataError' in match) fail(500, '無法切換房間身分');
        // The framework freezes nested G during initialization. Copy before
        // restoring only the unchanged members' waiting-room readiness.
        match.initialState = JSON.parse(JSON.stringify(match.initialState));
        match.metadata.createdAt = metadata.createdAt;
        match.metadata.updatedAt = Date.now();
        match.initialState._stateID = state._stateID + 1;
        for (const player of participants) {
          if (viewer.access === 'player' && String(player.id) === viewer.id) continue;
          match.metadata.players[player.id] = { ...player, isConnected: false };
          match.initialState.G.players[player.id].ready = !!state.G.players[player.id]?.ready;
        }
        let targetID: string;
        if (body.access === 'spectator') {
          targetID = randomToken(12);
          spectators[targetID] = { name: metadata.players[Number(viewer.id)].name!, credentialHash: hashToken(nextCredentials) };
        } else {
          const seat = Object.values(match.metadata.players).find((player) => !player.credentials)!;
          targetID = String(seat.id);
          seat.name = spectators[viewer.id].name;
          seat.credentials = nextCredentials;
          delete spectators[viewer.id];
        }
        // Hosting belongs to the same person across a role switch. Both host
        // pointers publish atomically with the new membership and retry receipt.
        const hostAfterSwitch = isHost(current, viewer)
          ? { ...current, hostPlayerID: body.access === 'player' ? targetID : null,
            hostObserverID: body.access === 'spectator' ? targetID : null }
          : current;
        const nextHost = retainedHost(hostAfterSwitch, Object.values(match.metadata.players), spectators);
        const next: RoomRecord = { ...current, currentMatchID: nextID, ...nextHost,
          departedPlayerIDs: [], spectators,
          revokedObserverAdmissions: viewer.access === 'spectator'
            ? [...new Set([...(current.revokedObserverAdmissions || []), sourceHash])] : current.revokedObserverAdmissions,
          roleSwitchReceipts: [
            ...(current.roleSwitchReceipts || []).filter((entry) => targetIsCurrent(entry, match.metadata.players, spectators)),
            { requestID, sourceMatchID: matchID, sourceAccess: viewer.access, sourceID: viewer.id, sourceCredentialHash: sourceHash,
              targetAccess: body.access, targetID, targetCredentialHash: hashToken(nextCredentials) },
          ],
        };
        // Do not mutate the active membership before publishing the new pointer:
        // a failed room-index write keeps the previous room fully usable.
        await db.createNextMatch(matchID, nextID, match, viewer.access === 'player' ? [credentials] : []);
        await rooms.save(next);
        presence.remove(current.roomId, `${viewer.access}:${viewer.id}`);
        presence.touch(current.roomId, `${body.access}:${targetID}`, 'admission');
        transport.closeMatch(matchID);
        ctx.body = { ...publicRoom(next, match.metadata, match.initialState), access: body.access,
          ...(body.access === 'player' ? { playerID: targetID } : { observerID: targetID }), credentials: nextCredentials };
      } else if (operation === 'game') {
        authenticateHost(ctx, current, metadata, '只有房主可以切換遊戲');
        if (body.matchID !== matchID) fail(409, '對局已更新，請重新確認房間狀態');
        if (!definition.isJoinable(state.G)) fail(409, '對局進行中不能切換遊戲，請先返回等待室');
        const selected = getGameDefinition(body.gameId);
        if (!selected) fail(400, '遊戲不正確');
        if (current.gameSelected !== false && selected.id === current.gameId) {
          ctx.body = publicRoom(current, metadata, state);
          return;
        }
        const nextID = randomToken(12);
        const match = createWaitingMatch(selected);
        if ('setupDataError' in match) fail(500, '無法切換遊戲');
        match.metadata.createdAt = metadata.createdAt;
        match.metadata.updatedAt = Date.now();
        match.initialState._stateID = state._stateID + 1;
        for (const player of Object.values(metadata.players)) {
          if (player.credentials) match.metadata.players[player.id] = { ...player, isConnected: false };
        }
        const next: RoomRecord = { ...current, currentMatchID: nextID, gameId: selected.id,
          gameSelected: true, numPlayers: ROOM_CAPACITY, completedDisplay: undefined, departedPlayerIDs: [],
          // Pin legacy records before changing the room's current game id.
          history: (current.history || []).map(entry => ({ ...entry, gameName: entry.gameName ?? current.gameId })),
        };
        await db.createNextMatch(matchID, nextID, match);
        await rooms.save(next);
        transport.closeMatch(matchID);
        ctx.body = publicRoom(next, match.metadata, match.initialState);
      } else if (operation === 'ready') {
        const playerID = authenticate(ctx, metadata);
        if (current.gameSelected === false) fail(409, '請先由房主選擇遊戲');
        if (!definition.isJoinable(state.G)) fail(409, '遊戲已開始');
        if (typeof body.ready !== 'boolean') fail(400, '準備狀態不正確');
        state.G.players[playerID] ??= { ready: false, acknowledged: false, cardCount: 0 };
        state.G.players[playerID].ready = body.ready;
        state._stateID += 1;
        await db.setState(matchID, state);
        ctx.body = publicRoom(current, metadata, state);
      } else if (operation === 'remove') {
        authenticateHost(ctx, current, metadata, '只有房主可以移出玩家');
        if (!definition.isJoinable(state.G)) fail(409, '遊戲開始後不能移出玩家');
        if (typeof body.playerID !== 'string' || !/^\d$/.test(body.playerID) || body.playerID === hostPlayerID(current)
          || typeof body.membershipID !== 'string' || !/^[a-f0-9]{16}$/.test(body.membershipID)) {
          fail(400, '請選擇房主以外的玩家');
        }
        const target = metadata.players[Number(body.playerID)];
        if (!target?.credentials
          || !safeEqual(body.membershipID, hashToken(`${current.roomId}:${target.credentials}`).slice(0, 16))) {
          fail(409, '這個席位已變更，請確認目前玩家後再操作');
        }
        state.G.players[body.playerID] = { ready: false, acknowledged: false, cardCount: 0 };
        state._stateID += 1;
        await db.removePlayer(matchID, body.playerID, target.credentials, state);
        presence.remove(current.roomId, `player:${body.playerID}`);
        transport.removePlayer(matchID, body.playerID, target.credentials);
        const updated = await snapshot(current);
        ctx.body = publicRoom(current, updated.metadata, updated.state);
      } else if (operation === 'start') {
        authenticateHost(ctx, current, metadata, '只有房主可以開始');
        if (current.gameSelected === false) fail(409, '請先由房主選擇遊戲');
        if (!definition.isJoinable(state.G)) fail(409, '遊戲已開始');
        const participants = Object.values(metadata.players).filter((player) => player.credentials);
        const count = participants.length;
        if (count < definition.minPlayers || count > definition.maxPlayers) fail(409, `需要 ${definition.minPlayers}～${definition.maxPlayers} 位參與者`);
        if (participants.some((p) => !state.G.players[p.id]?.ready)) fail(409, '所有參與者準備後才能開始');
        const match = createMatch({ game: { ...definition.game, seed: randomToken() }, numPlayers: count,
          setupData: definition.startSetupData(participants.map((player) => String(player.id))), unlisted: true });
        if ('setupDataError' in match) fail(400, '無法開始這個遊戲');
        match.metadata.players = Object.fromEntries(participants.map((p) => [String(p.id), p]));
        match.metadata.createdAt = metadata.createdAt;
        // Preserve increasing versions if an older lobby tab still has a socket.
        match.initialState._stateID = state._stateID + 1;
        await db.startMatch(matchID, match);
        ctx.body = publicRoom(current, match.metadata, match.initialState);
      } else if (operation === 'heartbeat') {
        const viewer = authenticateViewer(ctx, current, metadata);
        if (typeof body.sessionID !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.sessionID)) fail(400, '連線識別碼不正確');
        presence.touch(current.roomId, `${viewer.access === 'player' ? 'player' : 'spectator'}:${viewer.id}`, body.sessionID);
        ctx.body = { ok: true };
      } else if (operation === 'return' || operation === 'abort') {
        authenticateHost(ctx, current, metadata, '只有房主可以結束本局');
        if (body.matchID !== matchID) fail(409, '對局已更新，請重新確認房間狀態');
        if (definition.isJoinable(state.G)) fail(409, '目前已在等待室');
        const finished = !!definition.getOutcome(state.G);
        if (operation === 'return' && !finished) fail(409, '對局尚未結束');
        if (operation === 'abort' && finished) fail(409, '對局已結束，請返回等待室');
        const next = await returnToLobby(current, finished ? 'completed' : 'host-ended');
        if (currentMatchID(next) === matchID) fail(409, '請先查看本局最後一張模組，稍後將自動返回等待室');
        const nextState = await snapshot(next);
        ctx.body = publicRoom(next, nextState.metadata, nextState.state);
      } else if (operation === 'leave') {
        const viewer = authenticateViewer(ctx, current, metadata);
        let updated = current;
        if (viewer.access === 'spectator') {
          const spectators = { ...current.spectators };
          const revoked = spectators[viewer.id].credentialHash;
          delete spectators[viewer.id];
          updated = { ...current, spectators,
            revokedObserverAdmissions: [...new Set([...(current.revokedObserverAdmissions || []), revoked])] };
        } else {
          const player = metadata.players[Number(viewer.id)];
          const credentials = player.credentials!;
          await db.revokeAdmission(matchID, credentials);
          // Retain the original name for this game's final table / replay.
          delete player.credentials;
          player.isConnected = false;
          metadata.updatedAt = Date.now();
          await db.setMetadata(matchID, metadata);
          if (definition.isJoinable(state.G)) {
            state.G.players[viewer.id] = { ready: false, acknowledged: false, cardCount: 0 };
            state._stateID += 1;
            await db.setState(matchID, state);
          }
          updated = { ...current,
            departedPlayerIDs: [...new Set([...(current.departedPlayerIDs || []), viewer.id])] };
          transport.removePlayer(matchID, viewer.id, credentials);
        }
        // Only an actual departure transfers ownership. Other observers are
        // not promoted; with no players left the next player admission hosts.
        updated = { ...updated, ...retainedHost(updated, Object.values(metadata.players), updated.spectators) };
        await rooms.save(updated);
        presence.remove(current.roomId, `${viewer.access === 'player' ? 'player' : 'spectator'}:${viewer.id}`);
        const anyoneAdmitted = Object.values(metadata.players).some((entry) => entry.credentials) || Object.keys(updated.spectators || {}).length > 0;
        if (!definition.isJoinable(state.G) && (!anyoneAdmitted || !presence.hasAnyone(current.roomId))) {
          await returnToLobby(updated, definition.getOutcome(state.G) ? 'completed' : 'empty');
        }
        ctx.body = { left: true };
      } else if (operation === 'share') {
        authenticateViewer(ctx, current, metadata);
        const replayMatchID = requestedMatch(current, body.matchID);
        const selected = await snapshot(current, replayMatchID);
        if (!getGameDefinition(matchGameID(current, replayMatchID))!.getOutcome(selected.state.G)) fail(409, '對局結束後才能分享復盤');
        const perspective = perspectiveOf(body.perspective);
        const replay = await db.fetchReplay(replayMatchID);
        if (!replay.complete) fail(409, '這場對局沒有完整回放');
        if (!Number.isSafeInteger(body.frameIndex) || body.frameIndex < 0 || body.frameIndex >= replay.frames.length) fail(400, '回放步驟不正確');
        const shares = (current.replayShares || []).filter((entry) => entry.expiresAt > Date.now());
        if (shares.length >= 64) fail(409, '分享數已達上限，請房主先撤銷舊分享');
        const token = randomToken();
        const expiresAt = Date.now() + REPLAY_SHARE_TTL;
        await rooms.save({ ...current, replayShares: [...shares, { matchID: replayMatchID, tokenHash: hashToken(token), expiresAt, frameIndex: body.frameIndex, perspective }] });
        ctx.body = { url: `${origin}/replay/${current.roomId}#share=${token}`, expiresAt };
      } else if (operation === 'revoke-shares') {
        authenticateHost(ctx, current, metadata, '只有房主可以撤銷分享');
        await rooms.save({ ...current, replayShares: [] });
        ctx.body = { revoked: true };
      } else if (operation === 'invite') {
        authenticateHost(ctx, current, metadata, '只有房主可以重設邀請');
        const invite = randomToken();
        const updated = { ...current, inviteHash: hashToken(invite), inviteExpiresAt: Date.now() + INVITE_TTL };
        await rooms.save(updated);
        ctx.body = { inviteUrl: `${origin}/join/${current.roomId}#invite=${invite}`, expiresAt: updated.inviteExpiresAt };
      } else fail(405, '不支援的請求');
    });
  });
  if (config.clientDir) {
    const directory = resolve(config.clientDir);
    const previewPage = createPreviewPage(await readFile(join(directory, 'index.html'), 'utf8'), origin);
    server.app.use(async (ctx, next) => {
      if (['GET', 'HEAD'].includes(ctx.method) && (ctx.path === '/' || ctx.path === '/index.html' || /^\/(join|room|replay)\/[A-Za-z0-9_-]+$/.test(ctx.path))) {
        ctx.type = 'html'; ctx.set('Cache-Control', 'no-cache');
        ctx.body = previewPage(ctx.path);
      } else await next();
    });
    server.app.use(serve(directory, { hidden: false, index: false, maxage: 0 }));
  }
  // Never mount boardgame.io's default public Lobby routes. All admissions use our API.
  server.app.use((ctx) => { ctx.status = 404; ctx.body = { error: '找不到此頁面' }; });
  return {
    db, rooms, server, config,
    async listen() {
      // v0.50.2's run() cannot bind host; listen explicitly and avoid default Lobby APIs.
      const httpServer = server.app.listen(config.port, config.host);
      await new Promise<void>((ok, reject) => { httpServer.once('listening', ok); httpServer.once('error', reject); });
      const port = (httpServer.address() as AddressInfo).port;
      const timer = setInterval(() => {
        void sweep().catch(() => { console.error('Room lifecycle reconciliation failed'); });
      }, config.lifecycleSweepMs ?? 5000);
      timer.unref();
      return { port, async close() {
        clearInterval(timer);
        if (sweepInFlight) await sweepInFlight;
        await new Promise<void>((done) => (server.app as any)._io.close(() => done()));
        if (httpServer.listening) await new Promise<void>((done) => httpServer.close(() => done()));
        await transport.drain();
      } };
    },
  };
}
