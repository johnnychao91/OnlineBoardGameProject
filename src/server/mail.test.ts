import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseBotAction, type BotAction } from '../games/bots';
import type { MailState } from '../games/post/game';
import { mailWinningScore } from '../games/post/rules';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string }
type Snapshot = State<MailState>;
const origin = 'http://localhost:5173';
const ioWait = { timeout: 10000, interval: 25 };
const testKey = 'midnight-post-test-room-key';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
function noServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:secret|deck|reserve|directorDeck|seed|prngstate|credentials|credentialHash|inviteHash|inviteToken)"\s*:/);
}
function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-mail-integration-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-mail-integration-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false, createRoomKey: '',
    testRoomKey: testKey, lifecycleSweepMs: 60000, botSweepMs: 60000 };
  let app = await createApplication(config), running = await app.listen();
  const sockets: Socket[] = [], views = new Map<Socket, Snapshot>(), broadcasts = new Map<Socket, number>();
  const wire = new Map<Socket, unknown[]>();
  cleanups.push(async () => { sockets.forEach(socket => socket.disconnect()); await running.close(); });
  const request = async (url: string, body?: unknown, member?: Seat | Observer, extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${running.port}${url}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: origin,
        ...(member ? { Authorization: `Bearer ${member.credentials}`, ...('playerID' in member
          ? { 'X-Player-ID': member.playerID } : { 'X-Observer-ID': member.observerID }) } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const connect = async (namespace = 'midnight-post') => {
    const socket = io(`http://127.0.0.1:${running.port}/${namespace}`, { transports: ['websocket'], forceNew: true,
      reconnection: false, extraHeaders: { Origin: origin }, autoConnect: false });
    sockets.push(socket); wire.set(socket, []); socket.on('error', () => {});
    socket.on('sync', (_id: string, info: SyncInfo) => { views.set(socket, info.state as Snapshot); wire.get(socket)!.push(info); });
    socket.on('update', (_id: string, state: Snapshot, log: unknown[]) => {
      views.set(socket, state); broadcasts.set(socket, state._stateID); wire.get(socket)!.push({ state, log });
    });
    await new Promise<void>((ok, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connect timed out')), ioWait.timeout);
      socket.once('connect', () => { clearTimeout(timeout); ok(); });
      socket.once('connect_error', error => { clearTimeout(timeout); reject(error); }); socket.connect();
    });
    return socket;
  };
  const sync = async (socket: Socket, g: Group, seat: Seat) => {
    const response = new Promise<SyncInfo>((ok, reject) => {
      const receive = (_id: string, info: SyncInfo) => { clearTimeout(timeout); ok(info); };
      const timeout = setTimeout(() => { socket.off('sync', receive); reject(new Error('Authorized sync timed out')); }, ioWait.timeout);
      socket.once('sync', receive);
    });
    socket.emit('sync', g.matchID, seat.playerID, seat.credentials, g.seats.length);
    return response;
  };
  const state = async (matchID: string) => (await app.db.fetch(matchID, { state: true })).state! as Snapshot;
  const emitMove = (g: Group, id: string, move: BotAction, stateID: number) => {
    const index = g.seats.findIndex(seat => seat.playerID === id), seat = g.seats[index];
    g.clients[index].emit('update', { type: 'MAKE_MOVE', payload: { type: move.move, args: move.args,
      playerID: id, credentials: seat.credentials } }, stateID, g.matchID, id);
  };
  const move = async (g: Group, id: string, action: BotAction) => {
    const before = await state(g.matchID), index = g.seats.findIndex(seat => seat.playerID === id);
    emitMove(g, id, action, before._stateID);
    // A sync on this connection waits behind the move's durable room-queue write.
    const committed = await sync(g.clients[index], g, g.seats[index]);
    expect(committed.state._stateID, `${action.move} by ${id} at ${before.G.status}`).toBe(before._stateID + 1);
    const after = await state(g.matchID);
    expect(after._stateID).toBe(before._stateID + 1);
    await vi.waitFor(() => g.clients.forEach(socket => expect(broadcasts.get(socket)).toBe(after._stateID)), ioWait);
    return after;
  };
  const rejectMove = async (g: Group, id: string, action: BotAction) => {
    const before = await state(g.matchID), index = g.seats.findIndex(seat => seat.playerID === id);
    emitMove(g, id, action, before._stateID);
    await sync(g.clients[index], g, g.seats[index]);
    expect(await state(g.matchID)).toEqual(before);
  };
  return { request, connect, sync, state, move, rejectMove, views, wire, get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function group(f: Fixture, count: number, testRoom = false): Promise<Group> {
  // Assemble before choosing a game so a departed middle seat leaves nonconsecutive IDs.
  const created = await f.request('/api/rooms', { displayName: '午夜房主', ...(testRoom ? { createKey: testKey } : {}) });
  expect(created.status).toBe(201);
  const host = created.body as Room, seats: Seat[] = [host];
  for (let index = 1; index <= count; index++) {
    const result = await f.request(path(host, 'join'), { inviteToken: token(host.inviteUrl), displayName: `午夜隊員 ${index}`, requestID: randomUUID() });
    expect(result.status).toBe(200); seats.push(result.body);
  }
  expect((await f.request(path(host, 'leave'), {}, seats[1])).status).toBe(200); seats.splice(1, 1);
  const current = (await f.request(path(host), undefined, host)).body;
  const selected = await f.request(path(host, 'game'), { gameId: 'midnight-post', matchID: current.matchID }, host);
  expect(selected.status).toBe(200);
  const observed = await f.request(path(host, 'watch'), { inviteToken: token(host.inviteUrl), displayName: '午夜觀戰者', requestID: randomUUID() });
  expect(observed.status).toBe(200);
  return { host, seats, observer: observed.body, clients: [], matchID: selected.body.matchID };
}
async function start(f: Fixture, g: Group, options: Record<string, unknown>, decisive = false) {
  const updated = await f.request(path(g.host, 'options'), { matchID: g.matchID, options }, g.host);
  expect(updated.status, updated.body.error).toBe(200); g.matchID = updated.body.matchID;
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat)).status).toBe(200);
  const started = await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host);
  expect(started.status, started.body.error).toBe(200); g.matchID = started.body.matchID;
  if (decisive) {
    // Model a saved late match. The pure engine/bot suites play complete matches;
    // this boundary test exercises actual sockets, durable writes and outcomes
    // without sending hundreds of duplicate round moves through the rate limit.
    const saved = await f.state(g.matchID);
    if (saved.G.mode === 'black-letter') { saved.G.directorLife = 2; saved.G.courierLife = 2; }
    else for (const player of Object.values(saved.G.players)) player.score = mailWinningScore(g.seats.length) - 1;
    saved._stateID++;
    await f.app.db.setState(g.matchID, saved);
  }
  await connectGroup(f, g);
}
async function connectGroup(f: Fixture, g: Group) {
  g.clients = await Promise.all(g.seats.map(() => f.connect()));
  for (let index = 0; index < g.clients.length; index++) {
    const data = await f.sync(g.clients[index], g, g.seats[index]);
    noServerSecrets(data);
    expect(data.log).toEqual([]);
    expect(data.state.deltalog).toBeUndefined(); expect(data.initialState.deltalog).toBeUndefined();
    expect(Object.keys(data.state.G.private)).toEqual([g.seats[index].playerID]);
  }
}
async function nextAction(f: Fixture, g: Group, random: () => number) {
  const state = await f.state(g.matchID);
  for (const seat of g.seats) {
    const action = chooseBotAction('midnight-post', state, seat.playerID, random);
    if (action) return { id: seat.playerID, action };
  }
  throw new Error(`Midnight game stalled at ${state.G.status}, epoch ${state.G.epoch}`);
}

describe('Midnight Post authenticated modes, private hands and completed-game integration', () => {
  it('validates mode limits through the host settings flow and preserves applied options across restart', async () => {
    const f = await fixture(), g = await group(f, 4), foreign = await group(f, 2);
    const change = { matchID: g.matchID, options: { mode: 'premium', directorID: 'random' } };
    expect((await f.request(path(g.host, 'options'), change, g.seats[1])).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), change, g.observer)).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), change, foreign.host)).status).toBe(401);
    expect((await f.request(path(g.host, 'options'), { ...change, options: { mode: 'unknown' } }, g.host)).status).toBe(400);
    const changed = await f.request(path(g.host, 'options'), change, g.host);
    expect(changed.status).toBe(200); g.matchID = changed.body.matchID;
    for (const seat of g.seats) await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat);
    const refused = await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host);
    expect(refused.status).toBe(409);
    expect((await f.request(path(g.host), undefined, g.host)).body).toMatchObject({ status: 'lobby', numPlayers: 4, gameOptions: change.options });
    expect((await f.request(path(g.host, 'options'), { ...change, matchID: g.matchID, options: { mode: 'black-letter', directorID: '11' } }, g.host)).status).toBe(200);
    const invalidDirector = (await f.request(path(g.host), undefined, g.host)).body;
    for (const seat of g.seats) await f.request(path(g.host, 'ready'), { matchID: invalidDirector.matchID, ready: true }, seat);
    expect((await f.request(path(g.host, 'start'), { matchID: invalidDirector.matchID }, g.host)).status).toBe(409);
    const applied = await f.request(path(g.host, 'options'), { matchID: invalidDirector.matchID,
      options: { mode: 'black-letter', directorID: g.seats[1].playerID } }, g.host);
    expect(applied.status).toBe(200); expect(applied.body.players.every((seat: any) => !seat.ready)).toBe(true);
    await f.restart();
    const restored = (await f.request(path(g.host), undefined, g.host)).body;
    expect(restored.gameOptions).toEqual(applied.body.gameOptions);
    expect(restored.matchID).toBe(applied.body.matchID);
    expect(restored.players.map((seat: any) => seat.id)).toEqual(g.seats.map(seat => seat.playerID));
    expect((await f.request(path(foreign.host), undefined, foreign.host)).body.matchID).toBe(foreign.matchID);
  });

  it.each([
    { mode: 'classic', count: 3, testRoom: false },
    { mode: 'premium', count: 8, testRoom: false },
    { mode: 'black-letter', count: 6, testRoom: false },
    { mode: 'black-letter', count: 2, testRoom: true },
  ] as const)('plays the decisive $mode round with $count nonconsecutive seats (test room $testRoom), resumes choices and protects replays', async ({ mode, count, testRoom }) => {
    const f = await fixture(), g = await group(f, count, testRoom), random = seeded(42);
    const foreign = await f.request('/api/rooms', { gameId: 'encrypted-call', displayName: '另一房間' });
    expect(foreign.status).toBe(201);
    const untouched = (await f.app.db.fetch(foreign.body.matchID, { state: true })).state;
    await start(f, g, { mode, directorID: g.seats.at(-1)!.playerID }, true);
    const initial = await f.state(g.matchID);
    expect(Object.keys(initial.G.players)).toEqual(g.seats.map(seat => seat.playerID));
    expect(Object.keys(initial.G.players)).not.toContain('1');
    expect((await f.request(path(g.host, 'view?perspective=god'), undefined, foreign.body)).status).toBe(401);
    expect((await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host)).status).toBe(409);
    const blind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
    const god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    expect(blind.status).toBe(200); expect(god.status).toBe(200);
    expect(blind.body.G.private).toEqual({});
    expect(Object.keys(god.body.G.private)).toEqual(g.seats.map(seat => seat.playerID));
    noServerSecrets(blind.body); noServerSecrets(god.body);

    let replayed = false, restarted = false, steps = 0;
    while ((await f.state(g.matchID)).G.status !== 'finished' && steps++ < 150) {
      const selected = await nextAction(f, g, random);
      const after = await f.move(g, selected.id, selected.action);
      for (let index = 0; index < g.clients.length; index++) {
        const projected = f.views.get(g.clients[index])!;
        expect(Object.keys(projected.G.private)).toEqual([g.seats[index].playerID]);
        noServerSecrets(projected);
      }
      if (!replayed && selected.action.move === 'playCard') {
        await f.rejectMove(g, selected.id, selected.action); replayed = true;
      }
      // Restart while an effect is awaiting its legal target/guess/choice, rather
      // than only at a round boundary where no private decision is in flight.
      if (!restarted && after.G.pending) {
        const beforeRestart = await f.state(g.matchID);
        const pendingBlind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
        expect(pendingBlind.body.G.pending?.choices).toBeUndefined();
        noServerSecrets(pendingBlind.body);
        await f.restart();
        expect(await f.state(g.matchID)).toEqual(beforeRestart);
        await connectGroup(f, g); restarted = true;
      }
    }
    const finished = await f.state(g.matchID);
    expect(finished.G.status).toBe('finished'); expect(finished.ctx.gameover).toBeTruthy();
    expect(replayed).toBe(true); expect(restarted).toBe(true);
    expect((await f.app.db.fetch(foreign.body.matchID, { state: true })).state).toEqual(untouched);
    for (const client of g.clients) for (const payload of f.wire.get(client)!) noServerSecrets(payload);

    const privateReplay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer);
    expect(privateReplay.status).toBe(200);
    expect(privateReplay.body.room).toMatchObject({ gameName: 'midnight-post', testRoom });
    expect(privateReplay.body.frames.length).toBeGreaterThan(3);
    noServerSecrets(privateReplay.body);
    const shared = await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host);
    expect(shared.status).toBe(200);
    const publicReplay = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, {
      'X-Replay-Token': token(shared.body.url, 'share'),
    });
    expect(publicReplay.status).toBe(200); expect(publicReplay.body.perspective).toBe('blind');
    for (const frame of publicReplay.body.frames) expect(frame.G.private).toEqual({});
    noServerSecrets(publicReplay.body);

    const statistics = (await f.request('/api/stats')).body;
    const summary = statistics.byGame.find((entry: any) => entry.gameId === 'midnight-post');
    expect(summary.completed).toBe(testRoom ? 0 : 1);
    if (testRoom) {
      expect(statistics.completedGames).toBe(0); expect(summary.rankedCompleted).toBe(0);
      expect(summary.wins).toEqual({}); expect(summary.competitions).toEqual([]);
    } else if (mode === 'black-letter') {
      expect(summary.rankedCompleted).toBe(1);
      expect(Object.keys(summary.wins)).toEqual([finished.G.winner]);
      expect(['director', 'couriers']).toContain(finished.G.winner);
      expect(summary.byPlayerCount).toEqual([expect.objectContaining({ numPlayers: count, completed: 1 })]);
      expect(summary.competitions).toEqual([]);
    } else {
      expect(summary.rankedCompleted).toBe(0); expect(summary.wins).toEqual({}); expect(summary.byPlayerCount).toEqual([]);
      expect(summary.competitions).toEqual([expect.objectContaining({ mode, numPlayers: count, runs: 1,
        totalRounds: finished.G.round, averageRounds: finished.G.round })]);
    }
    await f.restart();
    expect((await f.request('/api/stats')).body).toEqual(statistics);
    expect((await f.request(path(g.host, `replay?matchID=${g.matchID}`), undefined, g.observer)).status).toBe(200);
  }, 60000);
});
