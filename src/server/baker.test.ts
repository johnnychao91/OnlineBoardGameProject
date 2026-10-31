import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotAction } from '../games/bots';
import { bakerPlayerView, type BakerState } from '../games/baker/game';
import { BAKER_SCENES } from '../games/baker/content';
import { normalizeBakerOptions, type BakerOptions } from '../games/baker/rules';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string }
type Snapshot = State<BakerState>;
const origin = 'http://localhost:5173';
const ioWait = { timeout: 10000, interval: 25 };
const testKey = 'baker-street-test-room-key';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
function noServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:secret|sceneDeck|specialDeck|seed|prngstate|credentials|credentialHash|inviteHash|inviteToken)"\s*:/);
}
async function fixture() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-baker-integration-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-baker-integration-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false, roomCode: '',
    testRoomCode: testKey, lifecycleSweepMs: 60000, botSweepMs: 60000 };
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
  const connect = async (namespace = 'baker-street') => {
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
  const forgedMove = async (g: Group, claimedID: string, credentials: string, action: BotAction) => {
    const before = await state(g.matchID);
    g.clients[0].emit('update', { type: 'MAKE_MOVE', payload: { type: action.move, args: action.args, playerID: claimedID, credentials } }, before._stateID, g.matchID, claimedID);
    await sync(g.clients[0], g, g.seats[0]); expect(await state(g.matchID)).toEqual(before);
  };
  return { request, connect, sync, state, move, rejectMove, forgedMove, views, wire, get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function group(f: Fixture, count: number, testRoom = false): Promise<Group> {
  // Assemble before choosing a game so a departed middle seat leaves nonconsecutive IDs.
  const created = await f.request('/api/rooms', { displayName: '貝克街房主', ...(testRoom ? { roomCode: testKey } : {}) });
  expect(created.status).toBe(201);
  const host = created.body as Room, seats: Seat[] = [host];
  for (let index = 1; index <= (count === 12 ? count - 1 : count); index++) {
    const result = await f.request(path(host, 'join'), { inviteToken: token(host.inviteUrl), displayName: `貝克街隊員 ${index}`, requestID: randomUUID() });
    expect(result.status).toBe(200); seats.push(result.body);
  }
  if (count < 12) { expect((await f.request(path(host, 'leave'), {}, seats[1])).status).toBe(200); seats.splice(1, 1); }
  const current = (await f.request(path(host), undefined, host)).body;
  const selected = await f.request(path(host, 'game'), { gameId: 'baker-street', matchID: current.matchID }, host);
  expect(selected.status).toBe(200);
  const observed = await f.request(path(host, 'watch'), { inviteToken: token(host.inviteUrl), displayName: '貝克街觀戰者', requestID: randomUUID() });
  expect(observed.status).toBe(200);
  return { host, seats, observer: observed.body, clients: [], matchID: selected.body.matchID };
}

async function connectGroup(f: Fixture, g: Group) {
  g.clients = await Promise.all(g.seats.map(() => f.connect()));
  for (let index = 0; index < g.clients.length; index++) {
    const data = await f.sync(g.clients[index], g, g.seats[index]);
    noServerSecrets(data); expect(data.log).toEqual([]);
    expect(data.state.deltalog).toBeUndefined(); expect(data.initialState.deltalog).toBeUndefined();
    expect(Object.keys(data.state.G.private)).toEqual([g.seats[index].playerID]);
  }
}
async function start(f: Fixture, g: Group, options: Partial<BakerOptions>) {
  const updated = await f.request(path(g.host, 'options'), { matchID: g.matchID, options }, g.host);
  expect(updated.status, updated.body.error).toBe(200); g.matchID = updated.body.matchID;
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat)).status).toBe(200);
  const started = await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host);
  expect(started.status, started.body.error).toBe(200); g.matchID = started.body.matchID;
  await connectGroup(f, g);
}
const roleID = (G: BakerState, role: string) => Object.keys(G.private).find(id => G.private[id].role === role)!;

describe('Baker Street authenticated eras, hidden answers and archived cases', () => {
  it('validates real start counts and Holmes seats, authorizes settings and remembers the selected year', async () => {
    const f = await fixture(), g = await group(f, 4), foreign = await group(f, 4);
    const change = { matchID: g.matchID, options: { era: 'wartime', year: 1942, roleSet: 'all', holmesID: '11' } };
    expect((await f.request(path(g.host, 'options'), change, g.seats[1])).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), change, g.observer)).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), change, foreign.host)).status).toBe(401);
    expect((await f.request(path(g.host, 'options'), { ...change, options: { era: 'modern', year: 2030 } }, g.host)).status).toBe(400);
    const saved = await f.request(path(g.host, 'options'), change, g.host);
    expect(saved.status).toBe(200); g.matchID = saved.body.matchID;
    for (const seat of g.seats) await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host)).status).toBe(409);
    const missingHolmes = await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { ...change.options, roleSet: 'basic' } }, g.host);
    expect(missingHolmes.status).toBe(200); g.matchID = missingHolmes.body.matchID;
    for (const seat of g.seats) await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host)).status).toBe(409);
    const options = normalizeBakerOptions({ era: 'wartime', year: 1942, roleSet: 'basic', cardsPerType: 3, holmesID: g.seats[1].playerID });
    const applied = await f.request(path(g.host, 'options'), { matchID: g.matchID, options }, g.host);
    expect(applied.status).toBe(200); expect(applied.body.players.every((seat: any) => !seat.ready)).toBe(true);
    await f.restart();
    const restored = (await f.request(path(g.host), undefined, g.host)).body;
    expect(restored.gameOptions).toEqual(options); expect(restored.matchID).toBe(applied.body.matchID);
    expect((await f.request(path(foreign.host), undefined, foreign.host)).body.matchID).toBe(foreign.matchID);
  });

  it.each([
    { era: 'industrial', count: 4, testRoom: false, exposeWatson: false },
    { era: 'wartime', count: 6, testRoom: false, exposeWatson: true },
    { era: 'modern', count: 12, testRoom: false, exposeWatson: false },
    { era: 'victorian', count: 6, testRoom: true, exposeWatson: false },
  ] as const)('$era / $count players preserve secrets across restart, settle the case and isolate test-room statistics', async ({ era, count, testRoom, exposeWatson }) => {
    const f = await fixture(), g = await group(f, count, testRoom);
    const foreign = await f.request('/api/rooms', { gameId: 'encrypted-call', displayName: '外房成員' });
    expect(foreign.status).toBe(201);
    const foreignState = (await f.app.db.fetch(foreign.body.matchID, { state: true })).state;
    await start(f, g, { era, holmesID: g.seats[0].playerID, cardsPerType: 5 });
    const initial = await f.state(g.matchID), holmes = initial.G.holmesID!, murderer = roleID(initial.G, 'murderer');
    expect(Object.keys(initial.G.players)).toEqual(g.seats.map(seat => seat.playerID));
    if (count < 12) expect(Object.keys(initial.G.players)).not.toContain('1');
    expect((await f.request(path(g.host, 'view?perspective=god'), undefined, foreign.body)).status).toBe(401);
    expect((await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host)).status).toBe(409);
    for (const seat of g.seats) await f.move(g, seat.playerID, { move: 'acknowledge', args: [initial.G.epoch] });
    const crime = await f.state(g.matchID);
    expect(crime.G.status).toBe('crime');
    const answer = { murdererID: murderer, meansID: crime.G.players[murderer].means[0].id, clueID: crime.G.players[murderer].clues[0].id };
    const choice: BotAction = { move: 'chooseCrime', args: [answer.meansID, answer.clueID, crime.G.epoch] };
    await f.rejectMove(g, holmes, choice);
    await f.forgedMove(g, murderer, g.host.credentials, choice);
    await f.forgedMove(g, murderer, foreign.body.credentials, choice);

    // Resume with the private culprit input still outstanding, using real disk state.
    await f.restart(); expect(await f.state(g.matchID)).toEqual(crime); await connectGroup(f, g);
    const chosen = await f.move(g, murderer, choice); await f.rejectMove(g, murderer, choice);
    expect(chosen.G.secret!.solution).toEqual(answer);
    for (let index = 0; index < g.seats.length; index++) {
      const id = g.seats[index].playerID, view = f.views.get(g.clients[index])!.G, own = view.private[id];
      expect(Object.keys(view.private)).toEqual([id]); noServerSecrets(view);
      expect(own.solution).toEqual(['holmes', 'murderer', 'accomplice'].includes(own.role!) ? answer : null);
      if (own.role === 'watson') expect(own.knownCriminals).toEqual([murderer, roleID(chosen.G, 'accomplice')].sort((a, b) => Number(a) - Number(b)));
      expect(view).toEqual(bakerPlayerView({ G: chosen.G, playerID: id }));
    }
    const blind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
    const god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    expect(blind.status).toBe(200); expect(god.status).toBe(200); expect(blind.body.G.private).toEqual({});
    expect(blind.body.G.solution).toBeNull(); expect(Object.keys(god.body.G.private)).toHaveLength(count);
    noServerSecrets(blind.body); noServerSecrets(god.body);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(chosen); await connectGroup(f, g);

    const location = BAKER_SCENES.find(tile => tile.kind === 'location')!;
    const scene = await f.move(g, holmes, { move: 'chooseLocation', args: [location.id, chosen.G.epoch] });
    await f.rejectMove(g, murderer, { move: 'markScene', args: [scene.G.scenes[0].tile.id, 0, scene.G.epoch] });
    const marked = await f.move(g, holmes, { move: 'markScene', args: [scene.G.scenes[0].tile.id, 0, scene.G.epoch] });
    const investigator = g.seats.find(seat => seat.playerID !== holmes && seat.playerID !== murderer)!;
    const accusation = { move: 'accuse', args: [murderer, answer.meansID, answer.clueID, marked.G.epoch] };
    const solved = await f.move(g, investigator.playerID, accusation);
    await f.rejectMove(g, investigator.playerID, accusation);
    if (count >= 6) {
      expect(solved.G.status).toBe('witness-hunt');
      const target = roleID(solved.G, exposeWatson ? 'watson' : 'accomplice');
      await f.move(g, murderer, { move: 'identifyWitness', args: [target, solved.G.epoch] });
    }
    const finished = await f.state(g.matchID);
    expect(finished.G.status).toBe('finished'); expect(finished.ctx.gameover).toBeTruthy();
    expect(finished.G.winner).toBe(exposeWatson ? 'criminals' : 'police');
    expect((await f.app.db.fetch(foreign.body.matchID, { state: true })).state).toEqual(foreignState);
    for (const socket of g.clients) for (const payload of f.wire.get(socket)!) noServerSecrets(payload);

    const replay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer);
    expect(replay.status).toBe(200); expect(replay.body.room).toMatchObject({ gameName: 'baker-street', testRoom });
    expect(replay.body.frames.length).toBeGreaterThan(4); noServerSecrets(replay.body);
    const shared = await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host);
    expect(shared.status).toBe(200);
    const publicReplay = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': token(shared.body.url, 'share') });
    expect(publicReplay.status).toBe(200); expect(publicReplay.body.perspective).toBe('blind');
    for (const frame of publicReplay.body.frames) { expect(frame.G.private).toEqual({}); noServerSecrets(frame); }
    expect(publicReplay.body.frames.at(-1).G.solution).toEqual(answer);
    const statistics = (await f.request('/api/stats')).body;
    const summary = statistics.byGame.find((entry: any) => entry.gameId === 'baker-street');
    expect(summary.completed).toBe(testRoom ? 0 : 1); expect(summary.rankedCompleted).toBe(testRoom ? 0 : 1);
    expect(summary.wins).toEqual(testRoom ? {} : { [finished.G.winner!]: 1 });
    if (testRoom) expect(statistics.completedGames).toBe(0);
    else expect(summary.byPlayerCount).toEqual([expect.objectContaining({ numPlayers: count, completed: 1 })]);
    await f.restart(); expect((await f.request('/api/stats')).body).toEqual(statistics);
    expect((await f.request(path(g.host, `replay?matchID=${g.matchID}`), undefined, g.observer)).status).toBe(200);
  }, 60000);
});
