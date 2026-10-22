import { ROOM_CAPACITY } from '../games/catalog';
import { MOON_PRESETS } from '../games/moon/rules';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from './app';

interface Member { playerID?: string; observerID?: string; credentials: string }
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const auth = (member: Member) => ({ Authorization: `Bearer ${member.credentials}`,
  ...(member.observerID ? { 'X-Observer-ID': member.observerID } : { 'X-Player-ID': member.playerID! }) });
const token = (url: string, key = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(key)!;

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-game-switch-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-game-switch-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: 'http://localhost:5173', host: '127.0.0.1', port: 0,
    production: false, createRoomKey: '', lifecycleSweepMs: 60000 };
  let app = await createApplication(config), running = await app.listen();
  const sockets: Socket[] = [];
  cleanups.push(async () => { sockets.forEach(socket => socket.disconnect()); await running.close(); });
  const request = async (path: string, body?: unknown, member?: Member, headers: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
        Origin: config.publicOrigin, ...(member && auth(member)), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  return { request, get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); },
    async connect(game: string, matchID: string, member: Member) {
      const socket = io(`http://127.0.0.1:${running.port}/${game}`, {
        transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { Origin: config.publicOrigin },
      });
      sockets.push(socket); socket.on('error', () => {});
      const received = new Promise<any>((resolveSync, reject) => {
        const timeout = setTimeout(() => reject(new Error('Sync timeout')), 3000);
        socket.once('sync', (_matchID, info) => { clearTimeout(timeout); resolveSync(info); });
      });
      socket.on('connect', () => socket.emit('sync', matchID, member.playerID, member.credentials, 8));
      const sync = await received;
      return { socket, sync };
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const path = (room: any, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
async function group(f: Fixture, count = 4, gameId?: string) {
  const created = await f.request('/api/rooms', { displayName: '房主', ...(gameId && { gameId }) });
  expect(created.status).toBe(201);
  const host = created.body, seats: any[] = [host];
  for (let i = 1; i < count; i++) {
    const admission = { displayName: `隊員${i}`, inviteToken: token(host.inviteUrl), requestID: randomUUID() };
    const joined = await f.request(path(host, 'join'), admission);
    expect(joined.status).toBe(200); seats.push({ ...joined.body, admission });
  }
  const observer = (await f.request(path(host, 'watch'), { displayName: '觀戰朋友', inviteToken: token(host.inviteUrl) })).body;
  return { host, seats, observer };
}
async function select(f: Fixture, host: any, gameId: string) {
  const info = (await f.request(path(host), undefined, host)).body;
  return f.request(path(host, 'game'), { matchID: info.matchID, gameId }, host);
}
async function readyStart(f: Fixture, host: any, seats: Member[]) {
  const info = (await f.request(path(host), undefined, host)).body;
  for (const seat of seats) expect((await f.request(path(host, 'ready'), { ready: true, matchID: info.matchID }, seat)).status).toBe(200);
  return f.request(path(host, 'start'), { matchID: info.matchID }, host);
}

describe('Selecting a game within a persistent shared room', () => {
  it('selects every fixed Moon preset before its players arrive and enforces the exact count only at start', async () => {
    const f = await fixture(), g = await group(f, 6, 'silver-moon');
    const before = f.app.rooms.rooms.get(g.host.roomId)!;
    let current = (await f.request(path(g.host), undefined, g.host)).body;
    expect((await f.request(path(g.host, 'ready'), { ready: true, matchID: current.matchID }, g.host)).status).toBe(200);
    for (const preset of MOON_PRESETS.filter(item => item.count !== null)) {
      const changed = await f.request(path(g.host, 'options'), { matchID: current.matchID, options: { presetId: preset.id } }, g.host);
      expect(changed.status, preset.id).toBe(200);
      current = changed.body;
      expect(current).toMatchObject({ status: 'lobby', gameOptions: { presetId: preset.id }, numPlayers: 6, spectatorCount: 1, roomCapacity: 12 });
      expect(current.players.every((player: any) => !player.ready)).toBe(true);
      expect((await f.request(path(g.host), undefined, g.observer)).status).toBe(200);
    }
    expect(current.gameOptions.presetId).toBe('eight-ragnarok');
    const validOptions = { matchID: current.matchID, options: { presetId: 'eight-ragnarok' } };
    expect((await f.request(path(g.host, 'options'), validOptions, g.observer)).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), { ...validOptions, options: { presetId: 'not-a-preset' } }, g.host)).status).toBe(400);
    expect((await f.request(path(g.host, 'options'), { ...validOptions, options: { presetId: 'eight-ragnarok', sheriff: true } }, g.host)).status).toBe(400);
    expect((await readyStart(f, g.host, g.seats)).status).toBe(409);
    for (let i = 6; i < 8; i++) {
      const joined = await f.request(path(g.host, 'join'), { displayName: `乘客${i}`, inviteToken: token(g.host.inviteUrl), requestID: randomUUID() });
      expect(joined.status).toBe(200); g.seats.push(joined.body);
    }
    const started = await readyStart(f, g.host, g.seats);
    expect(started.status).toBe(200);
    const state = (await f.app.db.fetch(started.body.matchID, { state: true })).state!;
    expect(state.G).toMatchObject({ rulesVersion: 3, status: 'briefing', configuration: { presetId: 'eight-ragnarok', victory: 'city', sheriffAllowed: false } });
    expect(state.G.configuration.roles).toHaveLength(8);
    expect(state.G.configuration.roles).not.toContain('wolf');
    expect(f.app.rooms.rooms.get(g.host.roomId)).toMatchObject({ inviteHash: before.inviteHash, inviteExpiresAt: before.inviteExpiresAt });
    const denied = await f.request(path(g.host, 'options'), { matchID: started.body.matchID, options: { presetId: 'classic' } }, g.host);
    expect(denied.status).toBe(409);
    const snapshot = state.G.configuration;
    await f.restart();
    expect((await f.app.db.fetch(started.body.matchID, { state: true })).state!.G.configuration).toEqual(snapshot);
  }, 30000);

  it('creates an unselected room, blocks readiness and starting, and preserves old explicit game creation', async () => {
    const f = await fixture(), g = await group(f);
    expect(g.host).toMatchObject({ status: 'lobby', gameSelected: false, roomCapacity: ROOM_CAPACITY });
    expect((await f.request(path(g.host, 'ready'), { ready: true, matchID: g.host.matchID }, g.host)).status).toBe(409);
    expect((await f.request(path(g.host, 'start'), { matchID: g.host.matchID }, g.host)).status).toBe(409);
    const selected = await select(f, g.host, 'encrypted-call');
    expect(selected.status).toBe(200);
    expect(selected.body).toMatchObject({ gameName: 'encrypted-call', gameSelected: true, minPlayers: 2, maxPlayers: 4, roomCapacity: ROOM_CAPACITY, numPlayers: 4 });
    expect(selected.body.matchID).not.toBe(g.host.matchID);
    expect((await readyStart(f, g.host, g.seats)).status).toBe(200);
    expect((await group(f, 2, 'encrypted-call')).host.gameSelected).toBe(true);
  });

  it('only allows the current player or observer host to switch in the lobby and rejects stale requests', async () => {
    const f = await fixture(), g = await group(f), other = await group(f);
    const body = { gameId: 'encrypted-call', matchID: g.host.matchID };
    expect((await f.request(path(g.host, 'game'), body)).status).toBe(401);
    expect((await f.request(path(g.host, 'game'), body, other.host)).status).toBe(401);
    for (const member of [g.seats[1], g.observer]) expect((await f.request(path(g.host, 'game'), body, member)).status).toBe(403);
    expect((await f.request(path(g.host, 'game'), { gameId: 'encrypted-call' }, g.host)).status).toBe(409);
    expect((await f.request(path(g.host, 'game'), { ...body, gameId: '__proto__' }, g.host)).status).toBe(400);
    const switchedHost = await f.request(path(g.host, 'switch-role'), { matchID: g.host.matchID, access: 'spectator', requestID: randomUUID() }, g.host);
    expect(switchedHost.status).toBe(200);
    const observerHost = switchedHost.body;
    expect((await f.request(path(g.host, 'game'), body, g.host)).status).toBe(401);
    expect((await select(f, observerHost, 'encrypted-call')).body).toMatchObject({ hostObserverID: observerHost.observerID, hostPlayerID: null });
    expect((await readyStart(f, observerHost, g.seats.slice(1))).status).toBe(200);
    expect((await select(f, observerHost, 'space-station')).status).toBe(409);
  });

  it('keeps eight players when switching to a smaller game and starts high-numbered seats after others spectate', async () => {
    const f = await fixture(), g = await group(f, 8, 'space-station');
    const before = f.app.rooms.rooms.get(g.host.roomId)!;
    const changed = await select(f, g.host, 'encrypted-call');
    expect(changed.body).toMatchObject({ numPlayers: 8, maxPlayers: 4, roomCapacity: ROOM_CAPACITY, spectatorCount: 1 });
    expect((await readyStart(f, g.host, g.seats)).status).toBe(409);
    let host = g.host;
    for (const seat of g.seats.slice(0, 6)) {
      const info = (await f.request(path(host), undefined, host)).body;
      const observer = await f.request(path(host, 'switch-role'), { matchID: info.matchID, access: 'spectator', requestID: randomUUID() }, seat);
      expect(observer.status).toBe(200); if (seat === g.host) host = observer.body;
    }
    const started = await readyStart(f, host, g.seats.slice(6));
    expect(started.status).toBe(200); expect(started.body.numPlayers).toBe(2);
    const state = (await f.app.db.fetch(started.body.matchID, { state: true })).state!;
    expect(Object.keys(state.G.private)).toEqual(['6', '7']);
    expect(state.ctx.playOrder).toEqual(['6', '7']);
    const { socket, sync } = await f.connect('encrypted-call', started.body.matchID, g.seats[7]);
    expect(Object.keys(sync.state.G.private)).toEqual(['7']);
    socket.emit('update', { type: 'MAKE_MOVE', payload: { type: 'readySync', args: [state.G.level, state.G.epoch], playerID: '7', credentials: g.seats[7].credentials } }, state._stateID, started.body.matchID, '7');
    await vi.waitFor(async () => expect((await f.app.db.fetch(started.body.matchID, { state: true })).state!.G.players['7'].acknowledged).toBe(true));
    expect(f.app.rooms.rooms.get(g.host.roomId)).toMatchObject({ inviteHash: before.inviteHash, inviteExpiresAt: before.inviteExpiresAt });
    expect((await f.request(path(host, 'watch'), { inviteToken: token(g.host.inviteUrl), displayName: '原連結仍可觀戰' })).status).toBe(200);
  });

  it('resets readiness, closes the old namespace, serializes switches and keeps other rooms untouched', async () => {
    const f = await fixture(), g = await group(f, 4, 'space-station'), other = await group(f, 2, 'encrypted-call');
    const otherBefore = (await f.request(path(other.host), undefined, other.host)).body;
    for (const seat of g.seats) await f.request(path(g.host, 'ready'), { ready: true, matchID: g.host.matchID }, seat);
    const { socket } = await f.connect('space-station', g.host.matchID, g.host);
    const [first, second] = await Promise.all([
      f.request(path(g.host, 'game'), { matchID: g.host.matchID, gameId: 'encrypted-call' }, g.host),
      f.request(path(g.host, 'game'), { matchID: g.host.matchID, gameId: 'space-station' }, g.host),
    ]);
    expect(first.status).toBe(200); expect(second.status).toBe(409);
    await vi.waitFor(() => expect(socket.connected).toBe(false));
    expect(first.body.players.every((player: any) => !player.ready)).toBe(true);
    for (const seat of g.seats) expect((await f.request(path(g.host), undefined, seat)).status).toBe(200);
    expect((await f.request(path(g.host, 'ready'), { ready: true, matchID: g.host.matchID }, g.seats[1])).status).toBe(409);
    expect((await f.request(path(g.host, 'start'), { matchID: first.body.matchID }, g.host)).status).toBe(409);
    expect((await f.request(path(other.host), undefined, other.host)).body).toEqual(otherBefore);
    const same = await select(f, g.host, 'encrypted-call');
    expect(same.body.matchID).toBe(first.body.matchID);
  });

  it('keeps the old room fully usable if publishing the new room index fails', async () => {
    const f = await fixture(), g = await group(f, 2, 'encrypted-call');
    const before = (await f.request(path(g.host), undefined, g.host)).body;
    vi.spyOn(f.app.rooms, 'save').mockRejectedValueOnce(new Error('test write failure'));
    expect((await select(f, g.host, 'space-station')).status).toBe(500);
    expect((await f.request(path(g.host), undefined, g.host)).body).toEqual(before);
    expect((await readyStart(f, g.host, g.seats)).status).toBe(200);
  });

  it('serializes readiness and start against a game change without carrying old consent into the next game', async () => {
    const f = await fixture(), g = await group(f, 2, 'encrypted-call');
    const oldID = g.host.matchID;
    const [changed, ready] = await Promise.all([
      f.request(path(g.host, 'game'), { matchID: oldID, gameId: 'space-station' }, g.host),
      f.request(path(g.host, 'ready'), { matchID: oldID, ready: true }, g.seats[1]),
    ]);
    expect(changed.status).toBe(200);
    expect([200, 409]).toContain(ready.status);
    const info = (await f.request(path(g.host), undefined, g.host)).body;
    expect(info.players.every((player: any) => !player.ready)).toBe(true);
    const cipher = await select(f, g.host, 'encrypted-call');
    for (const seat of g.seats) await f.request(path(g.host, 'ready'), { matchID: cipher.body.matchID, ready: true }, seat);
    const [switchResult, startResult] = await Promise.all([
      f.request(path(g.host, 'game'), { matchID: cipher.body.matchID, gameId: 'space-station' }, g.host),
      f.request(path(g.host, 'start'), { matchID: cipher.body.matchID }, g.host),
    ]);
    expect([switchResult.status, startResult.status].sort()).toEqual([200, 409]);
    const after = (await f.request(path(g.host), undefined, g.host)).body;
    if (switchResult.status === 200) {
      expect(after).toMatchObject({ gameName: 'space-station', status: 'lobby' });
      expect(after.players.every((player: any) => !player.ready)).toBe(true);
    } else expect(after).toMatchObject({ gameName: 'encrypted-call', status: 'syncing' });
  });

  it('preserves revoked admissions and keeps player credentials after a switch and restart', async () => {
    const f = await fixture(), g = await group(f, 4, 'space-station');
    const info = (await f.request(path(g.host), undefined, g.host)).body;
    const removed = info.players.find((player: any) => String(player.id) === '3');
    expect((await f.request(path(g.host, 'remove'), { playerID: '3', membershipID: removed.membershipID, matchID: info.matchID }, g.host)).status).toBe(200);
    const changed = await select(f, g.host, 'encrypted-call'); expect(changed.status).toBe(200);
    await f.restart();
    expect((await f.request(path(g.host), undefined, g.host)).body).toMatchObject({ gameName: 'encrypted-call', gameSelected: true });
    expect((await f.request(path(g.host), undefined, g.seats[1])).status).toBe(200);
    expect((await f.request(path(g.host), undefined, g.observer)).status).toBe(200);
    expect((await f.request(path(g.host), undefined, g.seats[3])).status).toBe(401);
    expect((await f.request(path(g.host, 'join'), g.seats[3].admission)).body.code).toBe('ADMISSION_REMOVED');
  });

  it('uses each historical game for replays, shares and statistics after switching and restarting', async () => {
    const f = await fixture(), g = await group(f, 4, 'space-station');
    const station = await readyStart(f, g.host, g.seats); expect(station.status).toBe(200);
    const stationID = station.body.matchID;
    let stored = (await f.app.db.fetch(stationID, { state: true })).state!;
    stored.G.status = 'finished'; stored.G.winner = 'engineer'; stored.G.winReason = 'all-repairs'; stored.G.rulesVersion = 2; stored._stateID++;
    await f.app.db.setState(stationID, stored);
    expect((await f.request(path(g.host, 'return'), { matchID: stationID }, g.host)).status).toBe(200);
    // Simulate an existing archive created before gameName was introduced.
    const record = f.app.rooms.rooms.get(g.host.roomId)!;
    await f.app.rooms.save({ ...record, history: record.history!.map(({ gameName: _name, ...entry }) => entry) });
    const oldShare = await f.request(path(g.host, 'share'), { matchID: stationID, perspective: 'blind', frameIndex: 0 }, g.host);
    expect(oldShare.status).toBe(200);
    expect((await select(f, g.host, 'encrypted-call')).status).toBe(200);
    const cipher = await readyStart(f, g.host, g.seats); expect(cipher.status).toBe(200);
    const cipherID = cipher.body.matchID;
    stored = (await f.app.db.fetch(cipherID, { state: true })).state!;
    stored.G.status = 'finished'; stored.G.winner = 'agents'; stored.G.winReason = 'all-levels'; stored._stateID++;
    await f.app.db.setState(cipherID, stored);
    expect((await f.request(path(g.host, 'return'), { matchID: cipherID }, g.host)).status).toBe(200);
    expect((await select(f, g.host, 'space-station')).status).toBe(200);
    await f.restart();
    const info = (await f.request(path(g.host), undefined, g.host)).body;
    expect(info.history.map((entry: any) => entry.gameName)).toEqual(['space-station', 'encrypted-call']);
    const replay = await f.request(path(g.host, `replay?matchID=${stationID}&perspective=god`), undefined, g.host);
    expect(replay.status).toBe(200); expect(replay.body.room.gameName).toBe('space-station');
    expect(replay.body.frames.at(-1).G.repairsRequired).toBe(4);
    const cipherReplay = await f.request(path(g.host, `replay?matchID=${cipherID}&perspective=blind`), undefined, g.host);
    expect(cipherReplay.status).toBe(200); expect(cipherReplay.body.room.gameName).toBe('encrypted-call');
    expect(cipherReplay.body.frames.at(-1).G.cover).toBe(4);
    const shared = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': token(oldShare.body.url, 'share') });
    expect(shared.status).toBe(200); expect(shared.body.room.gameName).toBe('space-station');
    expect((await f.request(path(g.host, 'share'), { matchID: cipherID, perspective: 'blind', frameIndex: 0 }, g.host)).status).toBe(200);
    const stats = (await f.request('/api/stats')).body;
    expect(stats.completedGames).toBe(2);
    expect(stats.byGame.filter((game: any) => game.completed).map((game: any) => game.completed)).toEqual([1, 1]);
  });
});
