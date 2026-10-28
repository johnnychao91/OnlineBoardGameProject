import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotAction } from '../games/bots';
import { firewallObserverView, firewallPlayerView, legalFirewallActions, legalFirewallPlacements, type FirewallState } from '../games/firewall/game';
import { createFirewallDeck, createFirewallRoles, FIREWALL_ROLE_IDS, type FirewallActionID, type FirewallCard, type FirewallRole } from '../games/firewall/content';
import { HEIST_ARTIFACTS } from '../games/heist/content';
import type { BanquetOptions } from '../games/banquet/rules';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string }
type Snapshot = State<FirewallState>;
const origin = 'http://localhost:5173';
const ioWait = { timeout: 10000, interval: 25 };
const testKey = 'firewall-breach-test-room-key';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
function noServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:secret|deck|roleDeck|removed|goals|theftQueue|recycle|seed|prngstate|credentials|credentialHash|inviteHash|inviteToken)"\s*:/);
}
async function fixture() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-firewall-integration-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-firewall-integration-')) throw new Error('Unexpected test directory');
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
  const connect = async (namespace = 'firewall-breach') => {
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
    // A sync also persists connection metadata. Queueing one per participant
    // adds N full archive rewrites behind the batch and can time out on a Pi.
    // First prove every real socket move was durably accepted (cross-socket
    // arrival order is not guaranteed), then use one authorized sync barrier.
    await vi.waitFor(async () => {
      expect((await state(g.matchID))._stateID).toBe(before._stateID + entries.length);
    }, ioWait);
    const last = entries.at(-1)!;
    const index = g.seats.findIndex(seat => seat.playerID === last.id);
    const committed = await sync(g.clients[index], g, g.seats[index]);
    const after = await state(g.matchID);
    expect(after._stateID).toBe(before._stateID + entries.length);
    expect(committed.state._stateID).toBe(after._stateID);
    await vi.waitFor(() => g.clients.forEach(socket => expect(broadcasts.get(socket)).toBe(after._stateID)), ioWait);
    return after;
  };
  return { request, connect, sync, state, move, batch, rejectMove, forgedMove, rejectPacket, views, wire, get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function group(f: Fixture, count: number, testRoom = false): Promise<Group> {
  // Assemble before choosing a game so a departed middle seat leaves nonconsecutive IDs.
  const created = await f.request('/api/rooms', { displayName: '防火牆房主', ...(testRoom ? { createKey: testKey } : {}) });
  expect(created.status).toBe(201);
  const host = created.body as Room, seats: Seat[] = [host];
  for (let index = 1; index < count + (count < 12 ? 1 : 0); index++) {
    const result = await f.request(path(host, 'join'), { inviteToken: token(host.inviteUrl), displayName: `防火牆隊員 ${index}`, requestID: randomUUID() });
    expect(result.status).toBe(200); seats.push(result.body);
  }
  if (count < 12) { expect((await f.request(path(host, 'leave'), {}, seats[1])).status).toBe(200); seats.splice(1, 1); }
  const current = (await f.request(path(host), undefined, host)).body;
  const selected = await f.request(path(host, 'game'), { gameId: 'firewall-breach', matchID: current.matchID }, host);
  expect(selected.status).toBe(200);
  const observed = await f.request(path(host, 'watch'), { inviteToken: token(host.inviteUrl), displayName: '防火牆觀戰者', requestID: randomUUID() });
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

function assertPlayerViews(f: Fixture, g: Group, state: Snapshot) {
  for (const [index, seat] of g.seats.entries()) {
    const snapshot = f.views.get(g.clients[index])!;
    expect(Object.keys(snapshot.G.private)).toEqual([seat.playerID]);
    expect(snapshot.G.private[seat.playerID]).toEqual(state.G.private[seat.playerID]);
    expect(snapshot.G).toEqual(firewallPlayerView({ G: state.G, playerID: seat.playerID }));
    expect(snapshot._undo).toEqual([]); expect(snapshot._redo).toEqual([]);
    expect(snapshot.deltalog).toBeUndefined(); expect(snapshot.ctx.numMoves).toBe(0);
    expect(Object.values(snapshot.ctx._activePlayersNumMoves ?? {}).every(count => count === 0)).toBe(true);
    noServerSecrets(snapshot);
    for (const player of Object.values(snapshot.G.players)) expect(player).not.toHaveProperty('gold');
    for (const tile of snapshot.G.board.filter(tile => !tile.revealed)) {
      expect(tile.kind).toBe('goal'); expect(tile.pathID).toBeUndefined(); expect(tile.rotation).toBeUndefined();
      expect(Object.keys(tile).sort()).toEqual(['id', 'kind', 'revealed', 'x', 'y']);
    }
  }
}

async function saveArrangement(f: Fixture, g: Group, state: Snapshot) {
  state._stateID++;
  await f.app.db.setState(g.matchID, state);
  for (const [index, seat] of g.seats.entries()) await f.sync(g.clients[index], g, seat);
}

async function arrangeAction(f: Fixture, g: Group, playerID: string, action: FirewallActionID) {
  return arrangeCard(f, g, playerID, card => card.kind === 'action' && card.action === action);
}
async function arrangeCard(f: Fixture, g: Group, playerID: string, matches: (card: FirewallCard) => boolean) {
  // Swap two existing physical cards. No cards, money or decisions are injected.
  const state = await f.state(g.matchID), hand = state.G.private[playerID].hand;
  const pools = [state.G.secret!.deck, state.G.secret!.removed,
    ...Object.values(state.G.private).map(info => info.hand)];
  const fingerprint = () => pools.flat().map(card => JSON.stringify(card)).sort();
  const before = fingerprint();
  let card = hand.find(matches);
  if (!card) {
    const pool = pools.find(pool => pool.some(matches))!;
    const index = pool.findIndex(matches);
    expect(index).toBeGreaterThanOrEqual(0); expect(hand.length).toBeGreaterThan(0);
    card = pool[index]; [pool[index], hand[0]] = [hand[0], card];
  }
  expect(fingerprint()).toEqual(before);
  await saveArrangement(f, g, state); return card;
}

async function arrangeRoles(f: Fixture, g: Group, desired: Record<string, FirewallRole>, nextRole?: FirewallRole) {
  const state = await f.state(g.matchID), pool = [...state.G.secret!.roleDeck, ...Object.values(state.G.private).map(info => info.role)];
  expect(pool.slice().sort()).toEqual(createFirewallRoles().sort());
  for (const [id, role] of Object.entries(desired)) {
    const index = pool.indexOf(role); expect(index).toBeGreaterThanOrEqual(0);
    state.G.private[id].role = pool.splice(index, 1)[0];
  }
  for (const id of g.seats.map(seat => seat.playerID).filter(id => !Object.hasOwn(desired, id))) state.G.private[id].role = pool.shift()!;
  if (nextRole) { const index = pool.indexOf(nextRole); expect(index).toBeGreaterThanOrEqual(0); pool.unshift(...pool.splice(index, 1)); }
  state.G.secret!.roleDeck = pool;
  expect([...pool, ...Object.values(state.G.private).map(info => info.role)].sort()).toEqual(createFirewallRoles().sort());
  await saveArrangement(f, g, state);
}

async function exhaustRound(f: Fixture, g: Group) {
  let state = await f.state(g.matchID), moves = 0;
  while (state.G.status === 'turn') {
    const id = state.G.activePlayer!, hand = state.G.private[id].hand;
    expect(hand.length).toBeGreaterThan(0); expect(++moves).toBeLessThan(120);
    state = await f.move(g, id, { move: 'discard', args: [hand.slice(0, 3).map(card => card.id), state.G.epoch] });
  }
  return state;
}

describe('Firewall Breach authenticated hidden information, three-round archives and durable turns', () => {
  it('commits a 12-player batch on slow storage with one full sync and all private views', async () => {
    const f = await fixture(), g = await group(f, 12);
    await start(f, g);
    const fetch = f.app.db.fetch.bind(f.app.db);
    const reads = vi.spyOn(f.app.db, 'fetch').mockImplementation(async (matchID, options) => {
      // Full sync loads the archive and initial state. Slow only that read,
      // leaving normal move validation and durable writes at their real speed.
      if (options.initialState) await new Promise(resolve => setTimeout(resolve, 1000));
      return fetch(matchID, options);
    });
    try {
      const before = await f.state(g.matchID);
      const committed = await acknowledgeAll(f, g);
      expect(committed._stateID).toBe(before._stateID + 12);
      expect(committed.G.status).toBe('turn');
      expect(reads.mock.calls.filter(([, options]) => options.initialState)).toHaveLength(1);
      assertPlayerViews(f, g, committed);
    } finally { reads.mockRestore(); }
  }, 30000);

  it('rejects a one-person launch even when the host forges the participant count', async () => {
    const f = await fixture(), g = await group(f, 1);
    await ready(f, g);
    const before = await f.state(g.matchID);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID, numPlayers: 2 }, g.host)).status).toBe(409);
    expect(await f.state(g.matchID)).toEqual(before);
    const lobby = (await f.request(path(g.host), undefined, g.host)).body;
    expect(lobby.status).toBe('lobby'); expect(lobby.numPlayers).toBe(1);
  });

  it('isolates maps, inspections, changed roles and swapped hands across authentication and durable theft turns', async () => {
    const f = await fixture(), g = await group(f, 4), foreign = await group(f, 2);
    await start(f, g); await start(f, foreign);
    const untouched = await f.state(foreign.matchID), [actor, inspector, saboteur, swapper] = g.seats.map(seat => seat.playerID);
    expect((await f.request(path(g.host, 'view?perspective=god'), undefined, g.host)).status).toBe(403);
    expect((await f.request(path(g.host, 'view?perspective=blind'), undefined, foreign.observer)).status).toBe(401);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.seats[1])).status).toBe(403);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.observer)).status).toBe(403);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, foreign.host)).status).toBe(401);
    await acknowledgeAll(f, g);
    for (const role of FIREWALL_ROLE_IDS) {
      await arrangeRoles(f, g, { [actor]: role });
      const roleState = await f.state(g.matchID); assertPlayerViews(f, g, roleState);
      expect(firewallObserverView(roleState.G, 'blind').private).toEqual({});
      expect(firewallObserverView(roleState.G, 'god').private[actor].role).toBe(role);
      const stranger = firewallPlayerView({ G: roleState.G, playerID: inspector });
      expect(stranger.private[actor]).toBeUndefined(); expect(stranger.players[actor].publicRole).toBeNull();
    }
    await arrangeRoles(f, g, { [actor]: 'blue', [inspector]: 'green', [saboteur]: 'saboteur', [swapper]: 'geologist' }, 'boss');
    const mapCard = await arrangeAction(f, g, actor, 'map');
    let state = await f.state(g.matchID);
    const goalID = state.G.board.find(tile => tile.kind === 'goal')!.id;
    const mapAction = { move: 'playAction', args: [mapCard.id, { goalID }, state.G.epoch] };
    for (const credentials of [g.seats[1].credentials, g.observer.credentials, foreign.host.credentials]) await f.forgedMove(g, actor, credentials, mapAction);
    await f.forgedMove(g, '1', g.host.credentials, mapAction);
    await f.rejectMove(g, inspector, mapAction);
    await f.rejectMove(g, actor, { move: 'playAction', args: [mapCard.id, { goalID }, state.G.epoch - 1] });
    await f.rejectMove(g, actor, { move: 'playAction', args: [mapCard.id, { goalID, playerID: inspector }, state.G.epoch] });
    for (const type of ['GAME_EVENT', 'UNDO', 'REDO', 'RESET']) await f.rejectPacket(g, { type, payload: { type: 'endGame', args: [{ winner: 'wealth' }], playerID: actor, credentials: g.host.credentials } });
    const mappedFace = state.G.secret!.goals[goalID];
    state = await f.move(g, actor, mapAction);
    expect(state.G.private[actor].goalMemory).toEqual([expect.objectContaining({ round: 1, goalID, pathID: mappedFace })]);
    expect(state.G.board.find(tile => tile.id === goalID)?.revealed).toBe(false);
    for (const id of [inspector, saboteur, swapper]) expect(state.G.private[id].goalMemory).toEqual([]);
    const otherMap = structuredClone(state.G);
    otherMap.private[actor].goalMemory[0].pathID = mappedFace === 'goal_gold' ? 'goal_stone_ne' : 'goal_gold';
    expect(firewallObserverView(otherMap, 'blind')).toEqual(firewallObserverView(state.G, 'blind'));
    for (const id of [inspector, saboteur, swapper]) expect(firewallPlayerView({ G: otherMap, playerID: id })).toEqual(firewallPlayerView({ G: state.G, playerID: id }));
    assertPlayerViews(f, g, state);
    const savedMap = await f.state(g.matchID); await f.restart(); expect(await f.state(g.matchID)).toEqual(savedMap);
    await connectGroup(f, g); await connectGroup(f, foreign);
    const inspectCard = await arrangeAction(f, g, inspector, 'inspection');
    state = await f.state(g.matchID);
    state = await f.move(g, inspector, { move: 'playAction', args: [inspectCard.id, { playerID: actor }, state.G.epoch] });
    expect(state.G.private[inspector].roleMemory).toEqual([expect.objectContaining({ playerID: actor, role: 'blue' })]);
    for (const id of [actor, saboteur, swapper]) expect(state.G.private[id].roleMemory).toEqual([]);
    const otherInspection = structuredClone(state.G); otherInspection.private[inspector].roleMemory[0].role = 'saboteur';
    expect(firewallObserverView(otherInspection, 'blind')).toEqual(firewallObserverView(state.G, 'blind'));
    for (const id of [actor, saboteur, swapper]) expect(firewallPlayerView({ G: otherInspection, playerID: id })).toEqual(firewallPlayerView({ G: state.G, playerID: id }));
    const changeCard = await arrangeAction(f, g, saboteur, 'change_roles');
    state = await f.state(g.matchID); const priorRoleDeck = state.G.secret!.roleDeck.slice();
    state = await f.move(g, saboteur, { move: 'playAction', args: [changeCard.id, { playerID: actor }, state.G.epoch] });
    expect(state.G.private[actor].role).toBe('boss');
    expect(state.G.secret!.roleDeck).toEqual([...priorRoleDeck.slice(1), 'blue']);
    expect(state.G.private[inspector].roleMemory[0].role).toBe('blue');
    expect(state.G.players[actor].publicRole).toBeNull(); assertPlayerViews(f, g, state);
    const changed = await f.state(g.matchID); await f.restart(); expect(await f.state(g.matchID)).toEqual(changed);
    await connectGroup(f, g); await connectGroup(f, foreign);
    const swapCard = await arrangeAction(f, g, swapper, 'swap_hands');
    state = await f.state(g.matchID);
    const actorHand = state.G.private[actor].hand.slice(), swapperHand = state.G.private[swapper].hand.filter(card => card.id !== swapCard.id);
    const deckBeforeSwap = state.G.deckCount;
    state = await f.move(g, swapper, { move: 'playAction', args: [swapCard.id, { playerID: actor }, state.G.epoch] });
    expect(state.G.private[swapper].hand).toEqual(actorHand);
    expect(state.G.private[actor].hand.slice(0, -1)).toEqual(swapperHand);
    expect(state.G.private[actor].hand).toHaveLength(swapperHand.length + 1); expect(state.G.deckCount).toBe(deckBeforeSwap - 1);
    expect(state.G.private[actor].goalMemory).toEqual(savedMap.G.private[actor].goalMemory); assertPlayerViews(f, g, state);
    for (const id of [actor, inspector]) {
      const theftCard = await arrangeAction(f, g, id, 'theft'); state = await f.state(g.matchID);
      state = await f.move(g, id, { move: 'playAction', args: [theftCard.id, {}, state.G.epoch] });
    }
    const trap = await arrangeAction(f, g, saboteur, 'trapped'); state = await f.state(g.matchID);
    state = await f.move(g, saboteur, { move: 'playAction', args: [trap.id, { playerID: swapper }, state.G.epoch] });
    state = await exhaustRound(f, g);
    expect(state.G.status).toBe('theft'); expect(state.G.activePlayer).toBe(inspector);
    expect(state.G.roundResult?.awards[saboteur]).toBe(5);
    expect(state.G.secret!.theftQueue).toEqual([inspector, actor]);
    const lastActor = state.G.lastActor, theftStart = await f.state(g.matchID);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(theftStart);
    await connectGroup(f, g); await connectGroup(f, foreign);
    state = await f.state(g.matchID);
    const zeroGold = structuredClone(state.G); zeroGold.private[saboteur].gold = 0;
    expect(legalFirewallActions(state.G, inspector)).toEqual(legalFirewallActions(zeroGold, inspector));
    await f.rejectMove(g, actor, { move: 'steal', args: [saboteur, state.G.epoch] });
    await f.rejectMove(g, inspector, { move: 'steal', args: [inspector, state.G.epoch] });
    state = await f.move(g, inspector, { move: 'steal', args: [saboteur, state.G.epoch] });
    expect(state.G.private[inspector].gold).toBe(1); expect(state.G.private[saboteur].gold).toBe(4);
    expect(state.G.activePlayer).toBe(actor); expect(state.G.lastActor).toBe(lastActor);
    const pending = await f.state(g.matchID); await f.restart(); expect(await f.state(g.matchID)).toEqual(pending);
    await connectGroup(f, g); await connectGroup(f, foreign);
    state = await f.move(g, actor, { move: 'steal', args: [saboteur, pending.G.epoch] });
    expect(state.G.status).toBe('review'); expect(state.G.private[actor].gold).toBe(1); expect(state.G.private[saboteur].gold).toBe(3);
    expect(state.G.lastActor).toBe(lastActor); expect(state.G.roundResult?.thefts).toHaveLength(2); assertPlayerViews(f, g, state);
    const blind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
    const god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    expect(blind.body.G.private).toEqual({}); expect(god.body.G.private).toEqual(state.G.private);
    expect(firewallObserverView(god.body.G, 'blind')).toEqual(blind.body.G);
    expect(firewallObserverView(god.body.G, 'god')).toEqual(god.body.G);
    noServerSecrets(blind.body); noServerSecrets(god.body);
    expect(await f.state(foreign.matchID)).toEqual(untouched);
    for (const packets of f.wire.values()) for (const packet of packets) { noServerSecrets(packet); expect((packet as any).log).toEqual([]); }
  }, 120000);

  it('keeps unknown goal faces out of views, placement hints and rejected moves until a real connected placement reveals one', async () => {
    const f = await fixture(), g = await group(f, 2);
    await start(f, g); await acknowledgeAll(f, g);
    await arrangeRoles(f, g, { [g.seats[0].playerID]: 'boss', [g.seats[1].playerID]: 'blue' });
    let state = await f.state(g.matchID);
    const goldID = Object.entries(state.G.secret!.goals).find(([, face]) => face === 'goal_gold')![0];
    [state.G.secret!.goals[goldID], state.G.secret!.goals['goal-middle']] = [state.G.secret!.goals['goal-middle'], state.G.secret!.goals[goldID]];
    await saveArrangement(f, g, state);
    for (let x = 1; x <= 6; x++) {
      state = await f.state(g.matchID); const id = state.G.activePlayer!;
      const card = await arrangeCard(f, g, id, card => card.kind === 'path' && card.pathID === (x <= 3 ? 'base_ew' : 'base_nesw'));
      state = await f.state(g.matchID);
      state = await f.move(g, id, { move: 'placePath', args: [card.id, x, 0, 0, state.G.epoch] });
      expect(state.G.status).toBe('turn'); expect(state.G.board.filter(tile => tile.kind === 'goal').every(tile => !tile.revealed)).toBe(true);
    }
    const id = state.G.activePlayer!;
    const finalCard = await arrangeCard(f, g, id, card => card.kind === 'path' && card.pathID === 'base_nesw');
    state = await f.state(g.matchID);
    const alternative = structuredClone(state.G), goalIDs = Object.keys(alternative.secret!.goals);
    const faces = Object.values(alternative.secret!.goals);
    for (const [index, goalID] of goalIDs.entries()) alternative.secret!.goals[goalID] = faces[(index + 1) % faces.length];
    alternative.secret!.deck.reverse(); alternative.secret!.roleDeck.reverse();
    for (const seat of g.seats) {
      const actualView = firewallPlayerView({ G: state.G, playerID: seat.playerID });
      const alternateView = firewallPlayerView({ G: alternative, playerID: seat.playerID });
      expect(actualView).toEqual(alternateView);
      expect(legalFirewallActions(state.G, seat.playerID)).toEqual(legalFirewallActions(alternative, seat.playerID));
      expect(legalFirewallActions(actualView, seat.playerID)).toEqual(legalFirewallActions(state.G, seat.playerID));
    }
    for (const perspective of ['blind', 'god'] as const) expect(firewallObserverView(state.G, perspective)).toEqual(firewallObserverView(alternative, perspective));
    const placements = legalFirewallPlacements(state.G, id, finalCard.id);
    expect(placements).toContainEqual({ x: 7, y: 0, rotation: 0 });
    expect(placements).toEqual(legalFirewallPlacements(alternative, id, finalCard.id));
    expect(placements).toEqual(legalFirewallPlacements(firewallPlayerView({ G: state.G, playerID: id }), id, finalCard.id));
    await f.rejectMove(g, id, { move: 'placePath', args: [finalCard.id, 8, 0, 0, state.G.epoch] });
    await f.rejectMove(g, id, { move: 'placePath', args: [finalCard.id, 7, 0, 90, state.G.epoch] });
    await f.rejectMove(g, id, { move: 'placePath', args: [finalCard.id, 7, 0, 0, state.G.epoch - 1] });
    const staleEpoch = state.G.epoch;
    state = await f.move(g, id, { move: 'placePath', args: [finalCard.id, 7, 0, 0, state.G.epoch] });
    expect(state.G.board.find(tile => tile.id === 'goal-middle')).toMatchObject({ revealed: true, pathID: 'goal_gold' });
    expect(state.G.status).toBe('review'); expect(state.G.roundResult).toMatchObject({ reason: 'connected', completedBy: id });
    expect(state.G.roundResult?.winningIDs.slice().sort()).toEqual(g.seats.map(seat => seat.playerID).sort());
    await f.rejectMove(g, id, { move: 'placePath', args: [finalCard.id, 7, 0, 0, staleEpoch] });
    assertPlayerViews(f, g, state);
    const god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    noServerSecrets(god.body); expect(god.body.G.private[id].gold).toBeGreaterThan(0);
    expect(firewallObserverView(god.body.G, 'blind').private).toEqual({});
  }, 60000);

  it.each([{ count: 2, testRoom: false }, { count: 12, testRoom: false }, { count: 2, testRoom: true }])(
    'completes three real rounds with $count participants, durable archives and test exclusion $testRoom',
    async ({ count, testRoom }) => {
      const f = await fixture(), g = await group(f, count, testRoom);
      await start(f, g);
      const initial = await f.state(g.matchID), ids = g.seats.map(seat => seat.playerID);
      expect(initial.ctx.numPlayers).toBe(count); expect(initial.G.turnOrder).toEqual(ids);
      expect(Object.keys(initial.G.players)).toEqual(ids); if (count < 12) expect(ids).not.toContain('1');
      expect(initial.G.status).toBe('briefing'); expect(initial.G.targetRounds).toBe(3);
      expect(initial.G.secret!.deck).toHaveLength(108 - 6 * count); expect(initial.G.secret!.removed).toHaveLength(10);
      expect(initial.G.secret!.roleDeck).toHaveLength(15 - count);
      const cards = [...initial.G.secret!.deck, ...initial.G.secret!.removed, ...Object.values(initial.G.private).flatMap(info => info.hand)];
      expect(cards.map(card => card.id).sort()).toEqual(createFirewallDeck().map(card => card.id).sort());
      expect(Object.values(initial.G.private).every(info => info.gold === 0 && info.hand.length === 6)).toBe(true);
      assertPlayerViews(f, g, initial);
      expect((await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host)).status).toBe(409);
      expect((await f.request(path(g.host, `replay?matchID=${g.matchID}`), undefined, g.observer)).status).toBe(409);
      let state = await acknowledgeAll(f, g);
      for (let round = 1; round <= 3; round++) {
        expect(state.G.round).toBe(round); expect(state.G.status).toBe('turn');
        state = await exhaustRound(f, g);
        expect(state.G.status).toBe('review'); expect(state.G.roundResult?.reason).toBe('exhausted');
        expect(state.G.secret!.deck).toEqual([]); expect(Object.values(state.G.private).every(info => info.hand.length === 0)).toBe(true);
        expect(Object.values(state.G.players).every(player => player.publicRole !== null)).toBe(true);
        expect(state.G.finalScores).toEqual({}); assertPlayerViews(f, g, state);
        const lastActor = state.G.lastActor!, nextStarter = ids[(ids.indexOf(lastActor) + 1) % ids.length];
        const reviewEpoch = state.G.phaseEpoch;
        // A partially acknowledged result survives process restart. Its stable
        // phase token remains valid for all participants who have not confirmed.
        if (round === 2) {
          state = await f.move(g, ids[0], { move: 'acknowledge', args: [reviewEpoch] });
          const saved = await f.state(g.matchID); await f.restart(); expect(await f.state(g.matchID)).toEqual(saved);
          await connectGroup(f, g);
          await f.rejectMove(g, ids[0], { move: 'acknowledge', args: [reviewEpoch] });
          state = await f.batch(g, ids.slice(1).map(id => ({ id, action: { move: 'acknowledge', args: [reviewEpoch] } })));
        } else state = await acknowledgeAll(f, g);
        await f.rejectMove(g, ids[0], { move: 'acknowledge', args: [reviewEpoch] });
        if (round < 3) {
          expect(state.G.starter).toBe(nextStarter); expect(state.G.status).toBe('briefing');
          state = await acknowledgeAll(f, g); expect(state.G.activePlayer).toBe(nextStarter);
        }
      }
      const finished = await f.state(g.matchID);
      expect(finished.G.status).toBe('finished'); expect(finished.G.round).toBe(3);
      expect(finished.ctx.gameover).toEqual({ winner: 'wealth', reason: 'three-rounds' });
      expect(finished.G.finalScores).toEqual(Object.fromEntries(ids.map(id => [id, finished.G.private[id].gold])));
      expect(finished.G.winnerIDs.length).toBeGreaterThan(0); assertPlayerViews(f, g, finished);
      const godReplay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer);
      expect(godReplay.status).toBe(200); expect(godReplay.body.complete).toBe(true);
      expect(godReplay.body.room).toMatchObject({ gameName: 'firewall-breach', testRoom });
      expect(godReplay.body.frames.length).toBeGreaterThan(100); noServerSecrets(godReplay.body);
      const shared = await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host);
      expect(shared.status).toBe(200);
      const replayURL = `/api/replays/${g.host.roomId}`, shareHeaders = { 'X-Replay-Token': token(shared.body.url, 'share') };
      const publicReplay = await f.request(replayURL, undefined, undefined, shareHeaders);
      expect(publicReplay.status).toBe(200); expect(publicReplay.body.perspective).toBe('blind'); noServerSecrets(publicReplay.body);
      expect(publicReplay.body.frames).toHaveLength(godReplay.body.frames.length);
      for (const [index, frame] of publicReplay.body.frames.entries()) {
        expect(frame.G.private).toEqual({});
        expect(frame.G).toEqual(firewallObserverView(godReplay.body.frames[index].G, 'blind'));
        expect(frame.G.finalScores).toEqual(frame.G.status === 'finished' ? finished.G.finalScores : {});
        for (const tile of frame.G.board.filter((tile: any) => !tile.revealed)) expect(tile.pathID).toBeUndefined();
      }
      for (const packets of f.wire.values()) for (const packet of packets) { noServerSecrets(packet); expect((packet as any).log).toEqual([]); }
      const statistics = (await f.request('/api/stats')).body;
      const summary = statistics.byGame.find((entry: any) => entry.gameId === 'firewall-breach');
      expect(statistics.completedGames).toBe(testRoom ? 0 : 1);
      expect(statistics.totalPlayerParticipations).toBe(testRoom ? 0 : count);
      expect(summary.completed).toBe(testRoom ? 0 : 1); expect(summary.rankedCompleted).toBe(0);
      expect(summary.wins).toEqual({}); expect(summary.byPlayerCount).toEqual([]);
      expect(summary.competitions).toEqual(testRoom ? [] : [expect.objectContaining({ mode: 'combined', numPlayers: count, runs: 1, totalRounds: 3, averageRounds: 3 })]);
      expect(JSON.stringify(statistics)).not.toMatch(/防火牆房主|防火牆隊員|winnerIDs|credentials|playerID/);
      await f.restart(); expect(await f.state(g.matchID)).toEqual(finished);
      expect((await f.request('/api/stats')).body).toEqual(statistics);
      expect((await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer)).body).toEqual(godReplay.body);
      expect((await f.request(replayURL, undefined, undefined, shareHeaders)).body).toEqual(publicReplay.body);
    }, 120000,
  );
});
