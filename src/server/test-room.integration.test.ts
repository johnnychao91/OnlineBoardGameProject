import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication, type AppConfig } from './app';
import { GAME_IDS, gameCatalog } from '../games/catalog';

const NORMAL_KEY = 'ordinary-room-key-for-tests';
const TEST_KEY = 'virtual-room-key-for-tests';
// These checks wait for real sockets and atomic JSON writes, not gameplay time.
// Keep a bounded allowance for slow disks without polling the room queue at 50 Hz.
const eventually = { timeout: 10000, interval: 50 };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
const path = (room: any, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, key = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(key)!;
const noSecrets = (value: unknown) => expect(JSON.stringify(value)).not.toMatch(/"(?:credentials|credentialHash|requestHash|botAdmissions|testRoomKey|createRoomKey|inviteHash|secret|seed)"\s*:/);

async function fixture(overrides: Partial<AppConfig> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-test-room-'));
  cleanup.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-test-room-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config: AppConfig = { dataDir, publicOrigin: 'http://localhost:5173', host: '127.0.0.1', port: 0,
    production: false, createRoomKey: NORMAL_KEY, testRoomKey: TEST_KEY,
    lifecycleSweepMs: 60000, botSweepMs: 100, ...overrides };
  let app = await createApplication(config), running = await app.listen();
  const sockets: Socket[] = [];
  cleanup.push(async () => { sockets.forEach(socket => socket.disconnect()); await running.close(); });
  const request = async (url: string, body?: unknown, member?: any, headers?: Record<string, string>) => {
    const response = await fetch(`http://127.0.0.1:${running.port}${url}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
        ...(member ? { Authorization: `Bearer ${member.credentials}`, ...(member.access === 'spectator'
          ? { 'X-Observer-ID': member.observerID } : { 'X-Player-ID': member.playerID }) } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const create = async (gameId?: string, testRoom = true) => {
    const result = await request('/api/rooms', { gameId, displayName: '房主', createKey: testRoom ? TEST_KEY : NORMAL_KEY });
    expect(result.status).toBe(201); return result.body;
  };
  const add = (host: any, requestID = randomUUID()) => request(path(host, 'bots'), { matchID: host.matchID, requestID }, host);
  const joinMember = async (host: any, access = 'player') => {
    const result = await request(path(host, access === 'player' ? 'join' : 'watch'), {
      inviteToken: token(host.inviteUrl), displayName: access === 'player' ? '朋友' : '觀眾', requestID: randomUUID(),
    });
    expect(result.status).toBe(200); return result.body;
  };
  return { request, create, add, joinMember, get app() { return app; },
    async restart(beforeListen?: (application: Awaited<ReturnType<typeof createApplication>>) => void) {
      sockets.forEach(socket => socket.disconnect()); await running.close();
      app = await createApplication(config);
      beforeListen?.(app);
      running = await app.listen();
    },
    async connect(host: any, member = host) {
      const socket = io(`http://127.0.0.1:${running.port}/${host.gameName}`, {
        transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false, timeout: eventually.timeout,
      });
      sockets.push(socket); socket.on('error', () => {});
      await new Promise<void>((ok, reject) => { socket.once('connect', ok); socket.once('connect_error', reject); socket.connect(); });
      return { socket, sync: () => socket.emit('sync', host.matchID, member.playerID, member.credentials, host.numPlayers) };
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function readyAndStart(f: Fixture, host: any, humans = [host]) {
  for (const member of humans) expect((await f.request(path(host, 'ready'), { ready: true, matchID: host.matchID }, member)).status).toBe(200);
  await vi.waitFor(async () => {
    const current = await f.request(path(host), undefined, host);
    expect(current.status).toBe(200);
    expect(current.body.players.every((player: any) => player.ready)).toBe(true);
  }, eventually);
  // Model the human browser's presence rather than relying on admission/boot grace.
  expect((await f.request(path(host, 'heartbeat'), { sessionID: randomUUID() }, host)).status).toBe(200);
  const started = await f.request(path(host, 'start'), { matchID: host.matchID }, host);
  expect(started.status).toBe(200); return { ...host, ...started.body };
}
async function botGroup(f: Fixture, gameId: typeof GAME_IDS[number]) {
  const host = await f.create(gameId);
  for (let i = 1; i < gameCatalog[gameId].minPlayers; i++) expect((await f.add(host)).status).toBe(200);
  return readyAndStart(f, host);
}
async function finishCipher(f: Fixture, host: any) {
  await (f.app.server.transport as import('./transport').GuardedTransport).getRoomQueue(host.roomId).add(async () => {
    const { state } = await f.app.db.fetch(host.matchID, { state: true });
    state!.G.status = 'finished'; state!.G.winner = 'agents'; state!.G.winReason = 'all-levels';
    state!.ctx.gameover = { winner: 'agents', reason: 'all-levels' }; state!._stateID += 1;
    await f.app.db.setState(host.matchID, state!);
  });
}

describe('Private test-room admission and virtual-player framework', () => {
  it('requires distinct configured keys and never accepts a client-supplied test flag', async () => {
    for (const testRoomKey of ['short', NORMAL_KEY]) await expect(fixture({ testRoomKey })).rejects.toThrow();
    const f = await fixture();
    const test = await f.create('space-station'), normal = await f.create('space-station', false);
    expect(test.testRoom).toBe(true); expect(normal.testRoom).toBe(false);
    const forged = await f.request('/api/rooms', { createKey: NORMAL_KEY, displayName: '普通房', testRoom: true });
    expect(forged.status).toBe(201); expect(forged.body.testRoom).toBe(false);
    expect((await f.request('/api/rooms', { createKey: 'wrong-key', displayName: '拒絕' })).status).toBe(403);
    const disabled = await fixture({ testRoomKey: '' });
    expect((await disabled.request('/api/rooms', { createKey: TEST_KEY, displayName: '停用測試' })).status).toBe(403);
  });

  it('allows real invitees but reserves bot admission for the host, with retry and capacity checks', async () => {
    const f = await fixture(), host = await f.create('encrypted-call'), normal = await f.create('encrypted-call', false);
    const friend = await f.joinMember(host), observer = await f.joinMember(host, 'spectator');
    expect(friend.testRoom).toBe(true); expect(observer.testRoom).toBe(true);
    const body = { matchID: host.matchID, requestID: randomUUID() };
    expect((await f.request(path(host, 'bots'), body)).status).toBe(401);
    expect((await f.request(path(host, 'bots'), body, friend)).status).toBe(403);
    expect((await f.request(path(host, 'bots'), body, observer)).status).toBe(403);
    expect((await f.request(path(host, 'bots'), body, normal)).status).toBe(401);
    expect((await f.add(normal)).status).toBe(403);
    expect((await f.request(path(host, 'bots'), { requestID: randomUUID() }, host)).status).toBe(409);
    expect((await f.request(path(host, 'bots'), { ...body, requestID: 'bad' }, host)).status).toBe(400);
    const results = await Promise.all([f.add(host, body.requestID), f.add(host, body.requestID)]);
    for (const result of results) { expect(result.status).toBe(200); noSecrets(result.body); }
    expect(results[0].body.players.filter((player: any) => player.isBot)).toHaveLength(1);
    expect(results[1].body.players).toHaveLength(3);
    expect((await f.add(host)).status).toBe(200);
    expect((await f.add(host)).status).toBe(409);
    const current = (await f.request(path(host), undefined, host)).body;
    expect(current.players.filter((player: any) => player.isBot).every((player: any) => player.ready)).toBe(true);
    expect(current.spectatorCount).toBe(1);
    await readyAndStart(f, host, [host, friend]);
    expect((await f.add(host)).status).toBe(409);
  });

  it('removes bot membership without resurrecting it through a retry or exposing bot credentials', async () => {
    const f = await fixture(), host = await f.create('space-station'), requestID = randomUUID();
    const added = (await f.add(host, requestID)).body, bot = added.players.find((player: any) => player.isBot);
    const { metadata } = await f.app.db.fetch(host.matchID, { metadata: true });
    const botMember = { playerID: bot.id, credentials: metadata!.players[bot.id].credentials };
    expect((metadata!.players[bot.id].data as any).isBot).toBe(true);
    expect((await f.request(path(host), undefined, botMember)).status).toBe(401);
    expect((await f.request(path(host, 'heartbeat'), { sessionID: randomUUID() }, botMember)).status).toBe(401);
    const connection = await f.connect(host, botMember); let synced = false;
    connection.socket.on('sync', () => { synced = true; }); connection.sync();
    await new Promise(ok => setTimeout(ok, 80)); expect(synced).toBe(false);
    const removed = await f.request(path(host, 'remove'), { matchID: host.matchID, playerID: bot.id, membershipID: bot.membershipID }, host);
    expect(removed.status).toBe(200); expect(removed.body.players).toHaveLength(1);
    expect((await f.add(host, requestID)).status).toBeGreaterThanOrEqual(400);
    const replacement = await f.joinMember(host);
    expect(replacement.playerID).toBe(bot.id);
    expect(replacement.players.find((player: any) => player.id === bot.id).isBot).toBe(false);
    await f.restart();
    expect((await f.add(host, requestID)).status).toBeGreaterThanOrEqual(400);
    expect((await f.request(path(host), undefined, host)).body.players.filter((player: any) => player.isBot)).toHaveLength(0);
  });

  it.each(GAME_IDS)('%s preserves testing and bots through start, abort, switching and restart', async gameId => {
    // Bot admission already marks lobby seats ready. Keep the recurring worker
    // idle until restart so this test always exercises persisted re-readiness.
    const f = await fixture({ botSweepMs: 60000 }), host = await botGroup(f, gameId);
    const count = gameCatalog[gameId].minPlayers;
    expect(host.testRoom).toBe(true); expect(host.numPlayers).toBe(count);
    const aborted = await f.request(path(host, 'abort'), { matchID: host.matchID }, host);
    expect(aborted.status).toBe(200); expect(aborted.body.testRoom).toBe(true);
    expect(aborted.body.history.at(-1)).toMatchObject({ gameName: gameId, ending: 'host-ended' });
    const changed = await f.request(path(host, 'game'), {
      matchID: aborted.body.matchID, gameId: gameId === 'silver-moon' ? 'space-station' : 'silver-moon',
    }, host);
    expect(changed.status).toBe(200); expect(changed.body.testRoom).toBe(true);
    expect(changed.body.players.filter((player: any) => player.isBot)).toHaveLength(count - 1);
    expect(changed.body.players.filter((player: any) => player.isBot).every((player: any) => !player.ready)).toBe(true);
    expect((await f.add(host)).status).toBe(409); // Old generation cannot modify the new lobby.
    f.app.config.botSweepMs = 100;
    let delayedWrite = false;
    await f.restart(application => {
      if (gameId !== 'black-fog') return;
      const persist = application.db.setState.bind(application.db);
      // Install before listen() starts the bot interval, including on slow hosts.
      vi.spyOn(application.db, 'setState').mockImplementation(async (matchID, state, deltalog) => {
        if (!delayedWrite && matchID === changed.body.matchID && state.G.status === 'lobby') {
          delayedWrite = true;
          // Reproduce a slow readiness write exceeding the old three-second wait.
          await new Promise(ok => setTimeout(ok, 3200));
        }
        await persist(matchID, state, deltalog);
      });
    });
    expect((await f.request(path(host, 'heartbeat'), { sessionID: randomUUID() }, host)).status).toBe(200);
    await vi.waitFor(async () => {
      const result = await f.request(path(host), undefined, host);
      expect(result.status).toBe(200);
      const lobby = result.body;
      expect(lobby.testRoom).toBe(true); expect(lobby.matchID).toBe(changed.body.matchID);
      expect(lobby.players.filter((player: any) => player.isBot).every((player: any) => player.ready)).toBe(true);
      expect(lobby.players.find((player: any) => player.id === host.playerID).ready).toBe(false);
    }, eventually);
    if (gameId === 'black-fog') expect(delayedWrite).toBe(true);
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  });

  it('publishes real bot moves through private socket views without changing another room', async () => {
    const f = await fixture(), host = await f.create('space-station');
    for (let i = 0; i < 3; i++) expect((await f.add(host)).status).toBe(200);
    const ordinary = await f.create('space-station', false);
    const untouched = (await f.app.db.fetch(ordinary.matchID, { state: true })).state!;
    const connection = await f.connect(host), updates: any[] = []; let liveUpdates = 0;
    connection.socket.on('sync', (_id, value) => { updates.push(value.state); noSecrets(value.state.G); });
    connection.socket.on('update', (_id, value) => { liveUpdates++; updates.push(value); noSecrets(value.G); });
    connection.sync();
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0), eventually);
    await readyAndStart(f, host);
    await vi.waitFor(async () => {
      const { state } = await f.app.db.fetch(host.matchID, { state: true });
      expect(Object.entries(state!.G.players).filter(([id]) => id !== host.playerID).every(([, player]) => (player as any).acknowledged)).toBe(true);
      expect(state!.G.players[host.playerID].acknowledged).toBe(false);
      expect(state!.G.status).toBe('briefing');
      expect(updates.at(-1)._stateID).toBe(state!._stateID);
    }, eventually);
    expect(liveUpdates).toBeGreaterThan(0);
    for (const value of updates.filter(value => value.G.status !== 'lobby')) expect(Object.keys(value.G.private)).toEqual([host.playerID]);
    expect((await f.app.db.fetch(ordinary.matchID, { state: true })).state).toEqual(untouched);
    expect((await f.request(path(host, 'view?perspective=god'), undefined, ordinary)).status).toBe(401);
    const replay = await f.app.db.fetchReplay(host.matchID);
    expect(replay.complete).toBe(true); expect(replay.frames.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps test replays and shares while excluding current and historical test results from statistics', async () => {
    const f = await fixture(), host = await botGroup(f, 'encrypted-call');
    const normal = await f.create('encrypted-call', false), friend = await f.joinMember(normal);
    await readyAndStart(f, normal, [normal, friend]);
    await finishCipher(f, normal); await finishCipher(f, host);
    const stats = (await f.request('/api/stats')).body;
    expect(stats).toMatchObject({ completedGames: 1, totalPlayerParticipations: 2 });
    const replay = await f.request(path(host, 'replay'), undefined, host);
    expect(replay.status).toBe(200); expect(replay.body.room.testRoom).toBe(true); noSecrets(replay.body);
    const shared = await f.request(path(host, 'share'), { matchID: host.matchID, perspective: 'blind', frameIndex: 0 }, host);
    expect(shared.status).toBe(200);
    const publicReplay = await f.request(`/api/replays/${host.roomId}`, undefined, undefined, { 'X-Replay-Token': token(shared.body.url, 'share') });
    expect(publicReplay.status).toBe(200); expect(publicReplay.body.room.testRoom).toBe(true); noSecrets(publicReplay.body);
    const returned = await f.request(path(host, 'return'), { matchID: host.matchID }, host);
    expect(returned.status).toBe(200); expect(returned.body.testRoom).toBe(true);
    expect(returned.body.history.at(-1).ending).toBe('completed');
    const switched = await f.request(path(host, 'game'), { matchID: returned.body.matchID, gameId: 'space-station' }, host);
    expect(switched.status).toBe(200);
    await f.restart();
    expect((await f.request('/api/stats')).body).toEqual(stats);
    const savedReplay = await f.request(path(host, `replay?matchID=${host.matchID}`), undefined, host);
    expect(savedReplay.status).toBe(200); expect(savedReplay.body.room.testRoom).toBe(true);
    expect(savedReplay.body.room.gameName).toBe('encrypted-call');
  });

  it('never promotes bots to host and ends a game when the last human leaves', async () => {
    const f = await fixture(), host = await f.create('space-station'), friend = await f.joinMember(host);
    expect((await f.add(host)).status).toBe(200); expect((await f.add(host)).status).toBe(200);
    await readyAndStart(f, host, [host, friend]);
    expect((await f.request(path(host, 'leave'), {}, host)).status).toBe(200);
    expect((await f.request(path(host), undefined, friend)).body.hostPlayerID).toBe(friend.playerID);
    expect((await f.request(path(host, 'leave'), {}, friend)).status).toBe(200);
    const stored = f.app.rooms.rooms.get(host.roomId)!;
    expect(stored.currentMatchID).not.toBe(host.matchID); expect(stored.hostPlayerID).toBeNull();
    expect(stored.history?.at(-1)?.ending).toBe('empty');
    const next = await f.joinMember(host);
    expect(next.hostPlayerID).toBe(next.playerID);
    expect(next.players.filter((player: any) => player.isBot)).toHaveLength(2);
  });

  it('does not let bots keep a disconnected test room alive', async () => {
    const f = await fixture({ presenceLeaseMs: 250, lifecycleSweepMs: 20 });
    const host = await botGroup(f, 'space-station');
    await vi.waitFor(() => expect(f.app.rooms.rooms.get(host.roomId)!.history?.at(-1)?.ending).toBe('empty'), eventually);
    const ended = (await f.app.db.fetch(host.matchID, { state: true })).state!;
    await new Promise(ok => setTimeout(ok, 100));
    expect((await f.app.db.fetch(host.matchID, { state: true })).state).toEqual(ended);
  });
});
