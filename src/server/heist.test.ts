import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotAction } from '../games/bots';
import { heistObserverView, heistPlayerView, type HeistState, type HeistCard, type HeistChoice } from '../games/heist/game';
import { HEIST_ARTIFACTS } from '../games/heist/content';
import type { BanquetOptions } from '../games/banquet/rules';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string }
type Snapshot = State<HeistState>;
const origin = 'http://localhost:5173';
const ioWait = { timeout: 10000, interval: 25 };
const testKey = 'curtain-heist-test-room-key';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
function noServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:secret|deck|recycle|seed|prngstate|credentials|credentialHash|inviteHash|inviteToken)"\s*:/);
}
async function fixture() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-heist-integration-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-heist-integration-')) throw new Error('Unexpected test directory');
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
  const connect = async (namespace = 'curtain-heist') => {
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
  const rejectPacket = async (g: Group, action: unknown) => {
    const before = await state(g.matchID);
    g.clients[0].emit('update', action, before._stateID, g.matchID, g.host.playerID);
    await sync(g.clients[0], g, g.host);
    expect(await state(g.matchID)).toEqual(before);
  };
  const batch = async (g: Group, entries: { id: string; action: BotAction }[]) => {
    const before = await state(g.matchID);
    // Every participant acts from the same pre-submission snapshot. Later
    // packets therefore intentionally carry an old boardgame.io state ID.
    for (const entry of entries) emitMove(g, entry.id, entry.action, before._stateID);
    await Promise.all(entries.map(entry => {
      const index = g.seats.findIndex(seat => seat.playerID === entry.id);
      return sync(g.clients[index], g, g.seats[index]);
    }));
    const after = await state(g.matchID);
    expect(after._stateID).toBe(before._stateID + entries.length);
    await vi.waitFor(() => g.clients.forEach(socket => expect(broadcasts.get(socket)).toBe(after._stateID)), ioWait);
    return after;
  };
  return { request, connect, sync, state, move, batch, rejectMove, forgedMove, rejectPacket, views, wire, get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function group(f: Fixture, count: number, testRoom = false): Promise<Group> {
  // Assemble before choosing a game so a departed middle seat leaves nonconsecutive IDs.
  const created = await f.request('/api/rooms', { displayName: '劫案房主', ...(testRoom ? { createKey: testKey } : {}) });
  expect(created.status).toBe(201);
  const host = created.body as Room, seats: Seat[] = [host];
  for (let index = 1; index <= count; index++) {
    const result = await f.request(path(host, 'join'), { inviteToken: token(host.inviteUrl), displayName: `劫案隊員 ${index}`, requestID: randomUUID() });
    expect(result.status).toBe(200); seats.push(result.body);
  }
  expect((await f.request(path(host, 'leave'), {}, seats[1])).status).toBe(200); seats.splice(1, 1);
  const current = (await f.request(path(host), undefined, host)).body;
  const selected = await f.request(path(host, 'game'), { gameId: 'curtain-heist', matchID: current.matchID }, host);
  expect(selected.status).toBe(200);
  const observed = await f.request(path(host, 'watch'), { inviteToken: token(host.inviteUrl), displayName: '劫案觀戰者', requestID: randomUUID() });
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

async function ready(f: Fixture, g: Group) {
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat)).status).toBe(200);
}
async function start(f: Fixture, g: Group) {
  await ready(f, g);
  const started = await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host);
  expect(started.status, started.body.error).toBe(200); g.matchID = started.body.matchID;
  await connectGroup(f, g);
}
async function acknowledgeAll(f: Fixture, g: Group) {
  const state = await f.state(g.matchID);
  return f.batch(g, g.seats.map(seat => ({ id: seat.playerID, action: { move: 'acknowledge', args: [state.G.phaseEpoch] } })));
}
async function decideAll(f: Fixture, g: Group, choice: HeistChoice) {
  const state = await f.state(g.matchID);
  return f.batch(g, g.seats.filter(seat => state.G.players[seat.playerID].exploring && !state.G.players[seat.playerID].submitted)
    .map(seat => ({ id: seat.playerID, action: { move: 'decide', args: [choice, state.G.phaseEpoch] } })));
}
function assertPlayerViews(f: Fixture, g: Group, state: Snapshot) {
  for (const [index, seat] of g.seats.entries()) {
    const snapshot = f.views.get(g.clients[index])!;
    expect(Object.keys(snapshot.G.private)).toEqual([seat.playerID]);
    expect(snapshot.G.private[seat.playerID]).toEqual(state.G.private[seat.playerID]);
    expect(snapshot.G.path).toEqual(state.G.path); expect(snapshot.G.players).toEqual(state.G.players);
    expect(snapshot.G.finalScores).toEqual(state.G.status === 'finished' ? state.G.finalScores : {});
    expect(snapshot._undo).toEqual([]); expect(snapshot._redo).toEqual([]);
    expect(snapshot.deltalog).toBeUndefined(); expect(snapshot.ctx.numMoves).toBe(0);
    expect(Object.values(snapshot.ctx._activePlayersNumMoves ?? {}).every(count => count === 0)).toBe(true);
    noServerSecrets(snapshot);
    for (const player of Object.values(snapshot.G.players)) expect(player).not.toHaveProperty('banked');
  }
}
async function arrangeFutureCards(f: Fixture, g: Group, hazardLimit = 2) {
  // Reorder only a valid saved future deck. All money, artifacts and decisions
  // below still come from real moves; the exact card multiset is preserved.
  const state = await f.state(g.matchID), deck = [...state.G.secret!.deck], prefix: HeistCard[] = [];
  const take = (matches: (card: HeistCard) => boolean) => {
    const index = deck.findIndex(matches); expect(index).toBeGreaterThanOrEqual(0);
    prefix.push(...deck.splice(index, 1));
  };
  if (!state.G.availableArtifacts.length) take(card => card.kind === 'artifact');
  take(card => card.kind === 'loot' && card.value === 11);
  const hazard = state.G.path.some(card => card.kind === 'hazard' && card.hazard === 'camera') ? 'laser' : 'camera';
  for (let index = 0; index < hazardLimit; index++) take(card => card.kind === 'hazard' && card.hazard === hazard);
  const reordered = [...prefix, ...deck];
  expect(reordered.map(card => JSON.stringify(card)).sort()).toEqual(state.G.secret!.deck.map(card => JSON.stringify(card)).sort());
  state.G.secret!.deck = reordered; state._stateID++;
  await f.app.db.setState(g.matchID, state);
  for (const [index, seat] of g.seats.entries()) await f.sync(g.clients[index], g, seat);
  return hazard;
}

describe('Curtain Heist authenticated simultaneous decisions, private banks and five-act archives', () => {
  it('restricts the hazard setting to the lobby host, persists it through restart and only closes on the third matching socket reveal', async () => {
    const f = await fixture(), g = await group(f, 3);
    await ready(f, g);
    const body = { matchID: g.matchID, options: { hazardLimit: 3 } }, before = await f.state(g.matchID);
    for (const member of [g.seats[1], g.observer]) expect((await f.request(path(g.host, 'options'), body, member)).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), { ...body, options: { hazardLimit: '3' } }, g.host)).status).toBe(400);
    expect(await f.state(g.matchID)).toEqual(before);
    const changed = await f.request(path(g.host, 'options'), body, g.host);
    expect(changed.status).toBe(200); expect(changed.body.gameOptions).toEqual({ hazardLimit: 3 });
    expect(changed.body.players.filter((player: any) => player.name).every((player: any) => !player.ready)).toBe(true);
    const previousID = g.matchID; g.matchID = changed.body.matchID;
    expect(g.matchID).not.toBe(previousID);
    expect((await f.request(path(g.host, 'options'), body, g.host)).status).toBe(409);
    await f.restart(); expect((await f.request(path(g.host), undefined, g.observer)).body.gameOptions).toEqual({ hazardLimit: 3 });
    await start(f, g);
    expect((await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { hazardLimit: 2 } }, g.host)).status).toBe(409);
    let state = await acknowledgeAll(f, g);
    const hazard = await arrangeFutureCards(f, g, 3);
    do { state = await decideAll(f, g, 'explore'); } while (state.G.path.filter(card => card.kind === 'hazard' && card.hazard === hazard).length < 2);
    expect(state.G.status).toBe('decision'); expect(state.G.removedHazards[hazard]).toBe(0);
    assertPlayerViews(f, g, state);
    for (const perspective of ['blind', 'god']) {
      const view = await f.request(path(g.host, `view?perspective=${perspective}`), undefined, g.observer);
      expect(view.status).toBe(200); expect(view.body.G.options).toEqual({ hazardLimit: 3 }); noServerSecrets(view.body);
    }
    await f.restart(); expect(await f.state(g.matchID)).toEqual(state); await connectGroup(f, g);
    state = await decideAll(f, g, 'explore');
    expect(state.G.status).toBe('review'); expect(state.G.options).toEqual({ hazardLimit: 3 });
    expect(state.G.roundResult).toMatchObject({ reason: 'hazard', hazard }); expect(state.G.removedHazards[hazard]).toBe(1);
    expect(state.G.secret!.recycle.filter(card => card.kind === 'hazard' && card.hazard === hazard)).toHaveLength(2);
    assertPlayerViews(f, g, state);
  }, 60000);
  it.each([2, 9])('rejects %i actual participants without dropping seats or accepting a forged count', async count => {
    const f = await fixture(), g = await group(f, count);
    await ready(f, g);
    const before = await f.state(g.matchID);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID, numPlayers: 3 }, g.host)).status).toBe(409);
    expect(await f.state(g.matchID)).toEqual(before);
    const lobby = (await f.request(path(g.host), undefined, g.host)).body;
    expect(lobby.status).toBe('lobby'); expect(lobby.numPlayers).toBe(count);
    expect(lobby.players.filter((seat: any) => seat.name && !seat.departed).map((seat: any) => String(seat.id))).toEqual(g.seats.map(seat => seat.playerID));
  });

  it('keeps sealed decisions and positive banks private through pending/review restarts, while exposing carried loot and claimed artifacts', async () => {
    const f = await fixture(), g = await group(f, 3), foreign = await group(f, 3);
    const startBody = { matchID: g.matchID };
    expect((await f.request(path(g.host, 'start'), startBody, g.seats[1])).status).toBe(403);
    expect((await f.request(path(g.host, 'start'), startBody, g.observer)).status).toBe(403);
    expect((await f.request(path(g.host, 'start'), startBody, foreign.host)).status).toBe(401);
    expect((await f.request(path(g.host, 'options'), { ...startBody, options: { rounds: 1 } }, g.host)).status).toBe(400);
    await start(f, g); await start(f, foreign);
    const untouched = await f.state(foreign.matchID), foreignClients = [...foreign.clients];
    const foreignPacketCounts = foreignClients.map(socket => f.wire.get(socket)!.length);
    expect((await f.request(path(g.host, 'view?perspective=god'), undefined, foreign.host)).status).toBe(401);
    expect((await f.request(path(g.host, 'view?perspective=god'), undefined, g.host)).status).toBe(403);
    let state = await acknowledgeAll(f, g);
    expect(state.G.path).toHaveLength(1); expect(state.G.status).toBe('decision');
    const hazard = await arrangeFutureCards(f, g);
    if (!state.G.availableArtifacts.length) state = await decideAll(f, g, 'explore');
    expect(state.G.availableArtifacts).toEqual(['sapphire-eye']);
    state = await decideAll(f, g, 'explore');
    expect(state.G.path.at(-1)).toEqual({ kind: 'loot', value: 11 });
    const tokenBeforeExit = state.G.phaseEpoch, exiter = g.seats[0].playerID;
    const expectedBank = state.G.players[exiter].carried + state.G.leftovers;
    expect(expectedBank).toBeGreaterThan(0);
    const exitAction = { move: 'decide', args: ['exit', tokenBeforeExit] };
    await f.forgedMove(g, exiter, g.seats[1].credentials, exitAction);
    await f.forgedMove(g, exiter, g.observer.credentials, exitAction);
    await f.forgedMove(g, exiter, foreign.host.credentials, exitAction);
    await f.forgedMove(g, '1', g.host.credentials, exitAction);
    await f.rejectMove(g, exiter, { move: 'decide', args: ['unknown', tokenBeforeExit] });
    await f.rejectMove(g, exiter, { move: 'decide', args: ['exit', tokenBeforeExit - 1] });
    await f.rejectMove(g, exiter, { move: 'acknowledge', args: [tokenBeforeExit] });
    for (const type of ['GAME_EVENT', 'UNDO', 'REDO', 'RESET']) {
      await f.rejectPacket(g, { type, payload: { type: 'endGame', args: [{ winner: 'heist' }], playerID: exiter, credentials: g.host.credentials } });
    }
    const beforeSubmission = state;
    state = await f.move(g, exiter, exitAction);
    expect(state.G.phaseEpoch).toBe(tokenBeforeExit); expect(state.G.epoch).toBe(beforeSubmission.G.epoch + 1);
    expect(state.G.path).toEqual(beforeSubmission.G.path); expect(state.G.log).toEqual(beforeSubmission.G.log);
    expect(state.G.lastDecision).toEqual(beforeSubmission.G.lastDecision);
    expect(state.G.private[exiter].choice).toBe('exit'); expect(state.G.players[exiter].exploring).toBe(true);
    assertPlayerViews(f, g, state);
    for (const seat of g.seats.slice(1)) expect(state.G.private[seat.playerID].choice).toBeNull();
    const pendingBlind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
    const pendingGod = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    expect(pendingBlind.body.G.private).toEqual({});
    expect(Object.values(pendingGod.body.G.private).every((entry: any) => entry.choice === null)).toBe(true);
    expect(heistObserverView(pendingGod.body.G, 'blind')).toEqual(pendingBlind.body.G);
    // Changing only this still-sealed choice must not change any other person's
    // entire received game state, including either observer perspective.
    const alternative = structuredClone(state.G); alternative.private[exiter].choice = 'explore';
    expect(heistObserverView(alternative, 'blind')).toEqual(pendingBlind.body.G);
    expect(heistObserverView(alternative, 'god')).toEqual(pendingGod.body.G);
    for (const [index, seat] of g.seats.entries()) if (seat.playerID !== exiter) {
      expect(heistPlayerView({ G: alternative, playerID: seat.playerID })).toEqual(f.views.get(g.clients[index])!.G);
    }
    noServerSecrets(pendingBlind.body); noServerSecrets(pendingGod.body);

    const pending = await f.state(g.matchID);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(pending);
    await connectGroup(f, g); await connectGroup(f, foreign);
    await f.rejectMove(g, exiter, exitAction);
    await f.rejectMove(g, exiter, { move: 'decide', args: ['explore', tokenBeforeExit] });
    state = await decideAll(f, g, 'explore');
    expect(state.G.lastDecision?.choices).toEqual(Object.fromEntries(g.seats.map(seat => [seat.playerID, seat.playerID === exiter ? 'exit' : 'explore'])));
    expect(state.G.path.at(-1)).toEqual({ kind: 'hazard', hazard });
    expect(state.G.private[exiter]).toEqual({ banked: expectedBank, choice: null });
    expect(state.G.players[exiter]).toMatchObject({ carried: 0, exploring: false, artifacts: ['sapphire-eye'] });
    expect(state.G.availableArtifacts).toEqual([]); expect(state.G.leftovers).toBe(0);
    for (const seat of g.seats.slice(1)) expect(state.G.players[seat.playerID].carried).toBe(beforeSubmission.G.players[seat.playerID].carried);
    await f.rejectMove(g, exiter, { move: 'decide', args: ['exit', state.G.phaseEpoch] });
    await f.rejectMove(g, g.seats[1].playerID, { move: 'decide', args: ['exit', tokenBeforeExit] });
    assertPlayerViews(f, g, state);
    const blind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
    const god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    expect(blind.body.G.private).toEqual({}); expect(blind.body.G.players[exiter].artifacts).toEqual(['sapphire-eye']);
    expect(god.body.G.private[exiter]).toEqual({ banked: expectedBank, choice: null });
    expect(heistObserverView(god.body.G, 'blind')).toEqual(blind.body.G);
    expect(heistObserverView(god.body.G, 'god')).toEqual(god.body.G);
    noServerSecrets(blind.body); noServerSecrets(god.body);

    const remainingCarried = Object.fromEntries(g.seats.slice(1).map(seat => [seat.playerID, state.G.players[seat.playerID].carried]));
    state = await decideAll(f, g, 'explore');
    expect(state.G.status).toBe('review'); expect(state.G.roundResult).toMatchObject({ reason: 'hazard', hazard, escaped: [exiter], lost: remainingCarried });
    expect(state.G.removedHazards[hazard]).toBe(1); expect(state.G.private[exiter].banked).toBe(expectedBank);
    expect(state.G.players[exiter].artifacts).toEqual(['sapphire-eye']);
    for (const seat of g.seats) expect(state.G.players[seat.playerID].carried).toBe(0);
    const review = await f.state(g.matchID);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(review);
    await connectGroup(f, g); await connectGroup(f, foreign);
    assertPlayerViews(f, g, review);
    state = await acknowledgeAll(f, g);
    expect(state.G.round).toBe(2); expect(state.G.status).toBe('decision');
    const survivingCards = [...state.G.secret!.deck, ...state.G.secret!.recycle];
    expect(survivingCards.filter(card => card.kind === 'hazard' && card.hazard === hazard)).toHaveLength(2);
    expect(survivingCards.some(card => card.kind === 'artifact' && card.artifact === 'sapphire-eye')).toBe(false);
    expect(state.G.private[exiter].banked).toBe(expectedBank);
    expect(await f.state(foreign.matchID)).toEqual(untouched);
    for (const [index, socket] of foreignClients.entries()) expect(f.wire.get(socket)).toHaveLength(foreignPacketCounts[index]);
    for (const payloads of f.wire.values()) for (const payload of payloads) {
      noServerSecrets(payload); expect((payload as any).log).toEqual([]);
      expect(Object.keys((payload as any).state.G.private)).toHaveLength(1);
    }
  }, 60000);

  it.each([{ count: 3, testRoom: false, hazardLimit: 2 }, { count: 8, testRoom: false, hazardLimit: 2 },
    { count: 3, testRoom: true, hazardLimit: 2 }, { count: 3, testRoom: false, hazardLimit: 3 }])(
    'completes all five acts with $count nonconsecutive seats, hazard limit $hazardLimit, preserving replay/shares and test-room exclusion $testRoom',
    async ({ count, testRoom, hazardLimit }) => {
      const f = await fixture(), g = await group(f, count, testRoom);
      if (hazardLimit === 3) {
        const changed = await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { hazardLimit } }, g.host);
        expect(changed.status).toBe(200); g.matchID = changed.body.matchID;
      }
      await start(f, g);
      const initial = await f.state(g.matchID), participantIDs = g.seats.map(seat => seat.playerID);
      expect(initial.ctx.numPlayers).toBe(count); expect(Object.keys(initial.G.players)).toEqual(participantIDs);
      expect(initial.G.turnOrder).toEqual(participantIDs); expect(participantIDs).not.toContain('1');
      expect(initial.G.targetRounds).toBe(5); expect(initial.G.status).toBe('briefing');
      expect(initial.G.secret!.deck).toHaveLength(30); expect(initial.G.secret!.deck.some(card => card.kind === 'artifact')).toBe(false);
      expect((await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host)).status).toBe(409);
      expect((await f.request(path(g.host, `replay?matchID=${g.matchID}`), undefined, g.observer)).status).toBe(409);
      let state = await acknowledgeAll(f, g);
      for (let round = 1; round <= 5; round++) {
        expect(state.G.round).toBe(round); expect(state.G.status).toBe('decision'); expect(state.G.path).toHaveLength(1);
        const decisionEpoch = state.G.phaseEpoch;
        state = await decideAll(f, g, 'exit');
        expect(state.G.status).toBe('review'); expect(state.G.roundResult?.reason).toBe('all-exited');
        expect(state.G.finalScores).toEqual({});
        await f.rejectMove(g, g.host.playerID, { move: 'decide', args: ['exit', decisionEpoch] });
        assertPlayerViews(f, g, state);
        const reviewEpoch = state.G.phaseEpoch;
        state = await acknowledgeAll(f, g);
        await f.rejectMove(g, g.host.playerID, { move: 'acknowledge', args: [reviewEpoch] });
      }
      const finished = await f.state(g.matchID);
      expect(finished.G.status).toBe('finished'); expect(finished.G.round).toBe(5);
      expect(finished.ctx.gameover).toEqual({ winner: 'heist', reason: 'score' });
      expect(Object.keys(finished.G.finalScores)).toEqual(participantIDs); expect(finished.G.winnerIDs.length).toBeGreaterThan(0);
      for (const seat of g.seats) {
        const artifactValue = finished.G.players[seat.playerID].artifacts.reduce((sum, artifact) => sum + HEIST_ARTIFACTS[artifact].value, 0);
        expect(finished.G.finalScores[seat.playerID]).toEqual({ banked: finished.G.private[seat.playerID].banked, artifactValue,
          artifactCount: finished.G.players[seat.playerID].artifacts.length, total: finished.G.private[seat.playerID].banked + artifactValue });
      }
      expect(finished.G.log.filter(entry => entry.type === 'round-start').map(entry => entry.artifact)).toEqual(['sapphire-eye', 'moon-watch', 'ruby-mask', 'glass-crown', 'prism-heart']);
      assertPlayerViews(f, g, finished);
      const godReplay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer);
      expect(godReplay.status).toBe(200); expect(godReplay.body.complete).toBe(true);
      expect(godReplay.body.room).toMatchObject({ gameName: 'curtain-heist', testRoom });
      expect(godReplay.body.frames.length).toBeGreaterThan(count * 10);
      noServerSecrets(godReplay.body);
      for (const frame of godReplay.body.frames) {
        expect(Object.values(frame.G.private).every((entry: any) => entry.choice === null)).toBe(true);
        expect(frame.G.options).toEqual({ hazardLimit });
      }
      const shared = await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host);
      expect(shared.status).toBe(200);
      const publicReplay = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': token(shared.body.url, 'share') });
      expect(publicReplay.status).toBe(200); expect(publicReplay.body.perspective).toBe('blind'); noServerSecrets(publicReplay.body);
      expect(publicReplay.body.frames).toHaveLength(godReplay.body.frames.length);
      for (const [index, frame] of publicReplay.body.frames.entries()) {
        expect(frame.G.private).toEqual({});
        expect(frame.G).toEqual(heistObserverView(godReplay.body.frames[index].G, 'blind'));
        expect(frame.G.finalScores).toEqual(frame.G.status === 'finished' ? finished.G.finalScores : {});
      }
      expect(publicReplay.body.frames.at(-1).G.finalScores).toEqual(finished.G.finalScores);
      for (const payloads of f.wire.values()) for (const payload of payloads) { noServerSecrets(payload); expect((payload as any).log).toEqual([]); }
      const statistics = (await f.request('/api/stats')).body;
      const summary = statistics.byGame.find((entry: any) => entry.gameId === 'curtain-heist');
      expect(statistics.completedGames).toBe(testRoom ? 0 : 1);
      expect(statistics.totalPlayerParticipations).toBe(testRoom ? 0 : count);
      expect(summary.completed).toBe(testRoom ? 0 : 1);
      expect(summary.rankedCompleted).toBe(0); expect(summary.wins).toEqual({}); expect(summary.byPlayerCount).toEqual([]);
      expect(summary.competitions).toEqual(testRoom ? [] : [expect.objectContaining({ mode: hazardLimit === 3 ? 'five-acts-hazard-3' : 'five-acts', numPlayers: count, runs: 1, totalRounds: 5, averageRounds: 5 })]);
      expect(JSON.stringify(statistics)).not.toMatch(/winnerIDs|credentials|playerID/);
      if (!testRoom) {
        expect(summary.competitions[0].highScores.map((entry: any) => entry.total)).toEqual(Object.values(finished.G.finalScores).map((entry: any) => entry.total).sort((a, b) => b - a));
        expect(summary.competitions[0].highScores.every((entry: any) => /劫案房主|劫案隊員/.test(entry.name))).toBe(true);
      }
      await f.restart(); expect(await f.state(g.matchID)).toEqual(finished);
      expect((await f.request('/api/stats')).body).toEqual(statistics);
      const restored = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer);
      expect(restored.body).toEqual(godReplay.body);
      const restoredPublic = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': token(shared.body.url, 'share') });
      expect(restoredPublic.body).toEqual(publicReplay.body);
    }, 60000,
  );
});
