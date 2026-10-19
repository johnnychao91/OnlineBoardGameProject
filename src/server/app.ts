import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Context } from 'koa';
import serve from 'koa-static';
import { Server } from 'boardgame.io/server';
import { createMatch } from 'boardgame.io/internal';
import { gameDefinitions, getGameDefinition, publicGameDefinitions } from '../games/registry';
import { GuardedTransport } from './transport';
import { RoomStore, type RoomRecord } from './rooms';
import { FileStorage } from './storage';
import { collectStatistics } from './statistics';
import { admissionCredential, hashToken, randomToken, RateLimiter, safeEqual, validCredential, validRoomID } from './security';

export interface AppConfig {
  dataDir: string;
  publicOrigin: string;
  host: string;
  port: number;
  production: boolean;
  createRoomKey: string;
  clientDir?: string;
}
const INVITE_TTL = 24 * 60 * 60 * 1000;
const REPLAY_SHARE_TTL = 7 * 24 * 60 * 60 * 1000;
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
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
  const transport = new GuardedTransport(rooms, origins);
  const server = Server({ games: gameDefinitions.map((g) => g.game), db, transport, origins });
  const limiter = new RateLimiter();
  // Trust the one local reverse proxy only when we are bound exclusively to loopback.
  server.app.proxy = config.production && ['127.0.0.1', '::1'].includes(config.host);
  server.app.maxIpsCount = 1;
  const getRoom = (id: string) => {
    if (!validRoomID(id)) return fail(404, '房間不存在');
    return rooms.rooms.get(id) || fail(404, '房間不存在');
  };
  const snapshot = async (room: RoomRecord) => {
    const { metadata, state } = await db.fetch(room.roomId, { metadata: true, state: true });
    if (!metadata || !state) fail(410, '房間資料無法載入，請重新建立房間');
    return { metadata, state };
  };
  const publicRoom = (room: RoomRecord, metadata: any, state: any) => ({
    roomId: room.roomId, matchID: room.roomId, gameName: room.gameId,
    numPlayers: Object.values(metadata.players).filter((p: any) => p.credentials).length,
    minPlayers: getGameDefinition(room.gameId)!.minPlayers, maxPlayers: getGameDefinition(room.gameId)!.maxPlayers,
    status: state.G.status,
    players: Object.values(metadata.players).filter((p: any) => p.credentials).map((p: any) => ({ id: String(p.id), name: p.name || '', isConnected: !!p.isConnected, ready: !!state.G.players?.[p.id]?.ready })),
    spectatorCount: Object.keys(room.spectators || {}).length, godViewAllowed: true,
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
  const perspectiveOf = (value: unknown) => {
    if (value === undefined || value === 'blind') return 'blind' as const;
    if (value === 'god') return 'god' as const;
    return fail(400, '觀看視角不正確');
  };
  const replayPayload = async (room: RoomRecord, perspective: 'blind' | 'god') => {
    const replay = await db.fetchReplay(room.roomId);
    const definition = getGameDefinition(room.gameId)!;
    return { complete: replay.complete, frames: replay.frames.map((frame) => ({
      stateID: frame.stateID, at: frame.at, G: definition.observerView(frame.G, perspective),
    })) };
  };
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
      ctx.body = { error: ctx.status === 500 ? '伺服器暫時無法處理，請稍後重試' : (error as Error).message };
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
      const { metadata, state } = await snapshot(room);
      if (!getGameDefinition(room.gameId)!.getOutcome(state.G)) fail(409, '對局尚未結束');
      ctx.body = { room: publicRoom(room, metadata, state), perspective: share.perspective, frameIndex: share.frameIndex,
        ...await replayPayload(room, share.perspective) };
      return;
    }
    if (ctx.method === 'POST' && ctx.path === '/api/rooms') {
      if (!limiter.allow(`create:${ctx.ip}`, 12, 600000)) fail(429, '建立房間太頻繁，請稍後重試');
      const body = await jsonBody(ctx);
      if (config.createRoomKey && !safeEqual(body.createKey, config.createRoomKey)) fail(403, '建立房間密鑰不正確');
      const definition = getGameDefinition(body.gameId);
      if (!definition) fail(400, '遊戲不正確');
      if (body.numPlayers !== undefined) fail(400, '不需預選人數，開局時依參與者人數決定');
      const name = displayName(body.displayName);
      const roomId = randomToken(12);
      const invite = randomToken();
      const credentials = randomToken();
      // The framework's default seed is timestamp-based. Use independent CSPRNG
      // entropy for each match and keep it only in server storage.
      const match = createMatch({ game: { ...definition.game, seed: randomToken() }, numPlayers: definition.maxPlayers, setupData: undefined, unlisted: true });
      if ('setupDataError' in match) fail(400, '無法使用這組遊戲設定');
      match.metadata.players['0'].name = name;
      match.metadata.players['0'].credentials = credentials;
      const room: RoomRecord = { roomId, gameId: definition.id, numPlayers: definition.maxPlayers, inviteHash: hashToken(invite), inviteExpiresAt: Date.now() + INVITE_TTL, createdAt: Date.now() };
      await db.createMatch(roomId, match);
      await rooms.save(room);
      ctx.status = 201;
      ctx.body = { ...publicRoom(room, match.metadata, match.initialState), access: 'player', playerID: '0', credentials,
        inviteUrl: `${origin}/join/${roomId}#invite=${invite}`, expiresAt: room.inviteExpiresAt };
      return;
    }
    const route = /^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/(join|watch|invite|ready|start|view|replay|share|revoke-shares))?$/.exec(ctx.path);
    if (!route) fail(404, '找不到此功能');
    const room = getRoom(route[1]);
    const operation = route[2];
    if (ctx.method === 'GET' && !operation) {
      const { metadata, state } = await snapshot(room);
      authenticateViewer(ctx, room, metadata);
      ctx.body = publicRoom(room, metadata, state);
      return;
    }
    if (ctx.method === 'GET' && (operation === 'view' || operation === 'replay')) {
      const { metadata, state } = await snapshot(room);
      const viewer = authenticateViewer(ctx, room, metadata);
      const definition = getGameDefinition(room.gameId)!;
      const finished = !!definition.getOutcome(state.G);
      const perspective = perspectiveOf(ctx.query.perspective);
      if (operation === 'replay') {
        if (!finished) fail(409, '完整復盤於對局結束後開放');
        ctx.body = await replayPayload(room, perspective);
      } else {
        if (viewer.access !== 'spectator' && !finished) fail(403, '玩家不能取得觀戰視角');
        ctx.body = { G: definition.observerView(state.G, perspective), stateID: state._stateID, perspective };
      }
      return;
    }
    if (ctx.method !== 'POST' || !operation) fail(405, '不支援的請求');
    const body = await jsonBody(ctx);
    // Use the same match queue as moves, so joining and starting cannot race.
    await transport.getMatchQueue(room.roomId).add(async () => {
      const current = getRoom(room.roomId);
      const { metadata, state } = await snapshot(current);
      const definition = getGameDefinition(current.gameId)!;
      if (operation === 'join' || operation === 'watch') {
        if (!limiter.allow(`join:${ctx.ip}`, 30, 60000)) fail(429, '加入嘗試太頻繁');
        if (typeof body.inviteToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.inviteToken)) fail(403, '邀請已失效，請向房主索取新連結');
        if (body.requestID !== undefined && (typeof body.requestID !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestID))) fail(400, '加入請求識別碼不正確');
        const watching = operation === 'watch';
        const credentials = body.requestID ? admissionCredential(watching ? `${current.roomId}:observer` : current.roomId, body.inviteToken, body.requestID) : randomToken();
        // A response lost on a mobile connection can be retried without claiming a
        // second seat. Possessing both secrets is equivalent to the issued seat key.
        const previous = !watching && body.requestID && Object.values(metadata.players).find((player) => safeEqual(player.credentials, credentials));
        if (previous) {
          ctx.body = { ...publicRoom(current, metadata, state), access: 'player', playerID: String(previous.id), credentials };
          return;
        }
        const previousObserver = watching && body.requestID && Object.entries(current.spectators || {}).find(([, observer]) => safeEqual(observer.credentialHash, hashToken(credentials)));
        if (previousObserver) {
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
          ctx.body = { ...publicRoom(updated, metadata, state), access: 'spectator', observerID, credentials };
          return;
        }
        if (!definition.isJoinable(state.G)) fail(409, '遊戲已開始，不能加入新玩家');
        const name = displayName(body.displayName);
        let seat = Object.values(metadata.players).find((player) => !player.credentials);
        // Old waiting rooms may have fewer placeholder slots; extend only before play.
        if (!seat && Object.keys(metadata.players).length < definition.maxPlayers) {
          const id = Object.keys(metadata.players).length;
          seat = metadata.players[id] = { id };
        }
        if (!seat) fail(409, '房間已滿');
        seat.name = name;
        seat.credentials = credentials;
        metadata.updatedAt = Date.now();
        await db.setMetadata(current.roomId, metadata);
        ctx.body = { ...publicRoom(current, metadata, state), access: 'player', playerID: String(seat.id), credentials: seat.credentials };
      } else if (operation === 'ready') {
        const playerID = authenticate(ctx, metadata);
        if (!definition.isJoinable(state.G)) fail(409, '遊戲已開始');
        if (typeof body.ready !== 'boolean') fail(400, '準備狀態不正確');
        state.G.players[playerID] ??= { ready: false, acknowledged: false, cardCount: 0 };
        state.G.players[playerID].ready = body.ready;
        state._stateID += 1;
        await db.setState(current.roomId, state);
        ctx.body = publicRoom(current, metadata, state);
      } else if (operation === 'start') {
        if (authenticate(ctx, metadata) !== '0') fail(403, '只有房主可以開始');
        if (!definition.isJoinable(state.G)) fail(409, '遊戲已開始');
        const participants = Object.values(metadata.players).filter((player) => player.credentials);
        const count = participants.length;
        if (count < definition.minPlayers || count > definition.maxPlayers) fail(409, `需要 ${definition.minPlayers}～${definition.maxPlayers} 位參與者`);
        if (participants.some((p) => !state.G.players[p.id]?.ready)) fail(409, '所有參與者準備後才能開始');
        const match = createMatch({ game: { ...definition.game, seed: randomToken() }, numPlayers: count, setupData: definition.startSetupData, unlisted: true });
        if ('setupDataError' in match) fail(400, '無法開始這個遊戲');
        match.metadata.players = Object.fromEntries(participants.map((p) => [String(p.id), p]));
        match.metadata.createdAt = metadata.createdAt;
        // Preserve increasing versions if an older lobby tab still has a socket.
        match.initialState._stateID = state._stateID + 1;
        await db.startMatch(current.roomId, match);
        ctx.body = publicRoom(current, match.metadata, match.initialState);
      } else if (operation === 'share') {
        authenticateViewer(ctx, current, metadata);
        if (!definition.getOutcome(state.G)) fail(409, '對局結束後才能分享復盤');
        const perspective = perspectiveOf(body.perspective);
        const replay = await db.fetchReplay(current.roomId);
        if (!replay.complete) fail(409, '這場對局沒有完整回放');
        if (!Number.isSafeInteger(body.frameIndex) || body.frameIndex < 0 || body.frameIndex >= replay.frames.length) fail(400, '回放步驟不正確');
        const shares = (current.replayShares || []).filter((entry) => entry.expiresAt > Date.now());
        if (shares.length >= 64) fail(409, '分享數已達上限，請房主先撤銷舊分享');
        const token = randomToken();
        const expiresAt = Date.now() + REPLAY_SHARE_TTL;
        await rooms.save({ ...current, replayShares: [...shares, { tokenHash: hashToken(token), expiresAt, frameIndex: body.frameIndex, perspective }] });
        ctx.body = { url: `${origin}/replay/${current.roomId}#share=${token}`, expiresAt };
      } else if (operation === 'revoke-shares') {
        if (authenticate(ctx, metadata) !== '0') fail(403, '只有房主可以撤銷分享');
        await rooms.save({ ...current, replayShares: [] });
        ctx.body = { revoked: true };
      } else if (operation === 'invite') {
        if (authenticate(ctx, metadata) !== '0') fail(403, '只有房主可以重設邀請');
        const invite = randomToken();
        const updated = { ...current, inviteHash: hashToken(invite), inviteExpiresAt: Date.now() + INVITE_TTL };
        await rooms.save(updated);
        ctx.body = { inviteUrl: `${origin}/join/${current.roomId}#invite=${invite}`, expiresAt: updated.inviteExpiresAt };
      } else fail(405, '不支援的請求');
    });
  });
  if (config.clientDir) {
    const directory = resolve(config.clientDir);
    server.app.use(serve(directory, { hidden: false, index: false, maxage: 0 }));
    server.app.use(async (ctx, next) => {
      if (ctx.method === 'GET' && (ctx.path === '/' || /^\/(join|room|replay)\/[A-Za-z0-9_-]+$/.test(ctx.path))) {
        ctx.type = 'html'; ctx.set('Cache-Control', 'no-cache');
        ctx.body = await readFile(join(directory, 'index.html'));
      } else await next();
    });
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
      return { port, async close() {
        await new Promise<void>((done) => (server.app as any)._io.close(() => done()));
        if (httpServer.listening) await new Promise<void>((done) => httpServer.close(() => done()));
        await transport.drain();
      } };
    },
  };
}
