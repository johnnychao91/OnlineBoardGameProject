import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { createMatch } from 'boardgame.io/internal';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotAction } from '../games/bots';
import { StarGame, starObserverView, starPlayerView, legalStarActions, type StarState } from '../games/star/game';
import { STAR_COLORS, STAR_TOKENS, STAR_TIERS, STAR_CARDS, STAR_CARD_LIST, STAR_GUARDIANS, STAR_GUARDIAN_LIST, starEmptyTokens, starEmptyBonuses, starTokenTotal, type StarColor, type StarTokenCounts } from '../games/star/content';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string }
type Snapshot = State<StarState>;
const origin = 'http://localhost:5173';
const ioWait = { timeout: 10000, interval: 25 };
const testKey = 'star-workshop-test-room-key';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
function noServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:secret|deck|decks|unusedGuardians|recycle|seed|prngstate|credentials|credentialHash|inviteHash|inviteToken)"\s*:/);
}
async function fixture() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-star-integration-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-star-integration-')) throw new Error('Unexpected test directory');
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
  const connect = async (namespace = 'star-workshop') => {
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
  const created = await f.request('/api/rooms', { displayName: '星匠房主', ...(testRoom ? { createKey: testKey } : {}) });
  expect(created.status).toBe(201);
  const host = created.body as Room, seats: Seat[] = [host];
  for (let index = 1; index <= count; index++) {
    const result = await f.request(path(host, 'join'), { inviteToken: token(host.inviteUrl), displayName: `星匠同伴 ${index}`, requestID: randomUUID() });
    expect(result.status).toBe(200); seats.push(result.body);
  }
  expect((await f.request(path(host, 'leave'), {}, seats[1])).status).toBe(200); seats.splice(1, 1);
  const current = (await f.request(path(host), undefined, host)).body;
  const selected = await f.request(path(host, 'game'), { gameId: 'star-workshop', matchID: current.matchID }, host);
  expect(selected.status).toBe(200);
  const observed = await f.request(path(host, 'watch'), { inviteToken: token(host.inviteUrl), displayName: '星匠觀戰者', requestID: randomUUID() });
  expect(observed.status).toBe(200);
  return { host, seats, observer: observed.body, clients: [], matchID: selected.body.matchID };
}
async function connectGroup(f: Fixture, g: Group) {
  g.clients = await Promise.all(g.seats.map(() => f.connect()));
  for (const [index, seat] of g.seats.entries()) {
    const data = await f.sync(g.clients[index], g, seat);
    noServerSecrets(data); expect(data.log).toEqual([]);
    expect(data.state.deltalog).toBeUndefined(); expect(data.initialState.deltalog).toBeUndefined();
    expect(Object.keys(data.state.G.private)).toEqual([seat.playerID]);
  }
}
async function ready(f: Fixture, g: Group) {
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat)).status).toBe(200);
}
async function start(f: Fixture, g: Group) {
  await ready(f, g); const started = await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host);
  expect(started.status, started.body.error).toBe(200); g.matchID = started.body.matchID; await connectGroup(f, g);
}
async function acknowledgeAll(f: Fixture, g: Group) {
  const state = await f.state(g.matchID);
  return f.batch(g, g.seats.map(seat => ({ id: seat.playerID, action: { move: 'acknowledge', args: [state.G.phaseEpoch] } })));
}
function assertViews(f: Fixture, g: Group, state: Snapshot) {
  for (const [index, seat] of g.seats.entries()) {
    const actual = f.views.get(g.clients[index])!;
    expect(actual.G).toEqual(starPlayerView({ G: state.G, playerID: seat.playerID }));
    expect(Object.keys(actual.G.private)).toEqual([seat.playerID]);
    expect(actual._undo).toEqual([]); expect(actual._redo).toEqual([]); expect(actual.deltalog).toBeUndefined();
    expect(actual.ctx.numMoves).toBe(0); noServerSecrets(actual);
  }
}
const baseSupply = (count: number) => count === 2 ? 4 : count === 3 ? 5 : 7;
function assertConservation(G: StarState) {
  const ids = [...STAR_TIERS.flatMap(tier => [...G.market[tier].filter((id): id is string => !!id), ...G.secret!.decks[tier]]),
    ...G.turnOrder.flatMap(id => [...G.players[id].purchased, ...G.private[id].reserved.map(card => card.cardID)])];
  expect(ids.slice().sort()).toEqual(STAR_CARD_LIST.map(card => card.id).sort());
  for (const color of STAR_TOKENS) expect(G.bank[color] + G.turnOrder.reduce((sum, id) => sum + G.players[id].tokens[color], 0)).toBe(color === 'gold' ? 5 : baseSupply(G.turnOrder.length));
  expect([...G.guardians, ...G.secret!.unusedGuardians, ...G.turnOrder.flatMap(id => G.players[id].guardians)].sort()).toEqual(STAR_GUARDIAN_LIST.map(guardian => guardian.id).sort());
}
async function saveArrangement(f: Fixture, g: Group, state: Snapshot) {
  assertConservation(state.G); state.G.epoch++; state._stateID++; await f.app.db.setState(g.matchID, state);
  for (const [index, seat] of g.seats.entries()) await f.sync(g.clients[index], g, seat);
  return state;
}
function balanceBank(G: StarState) {
  for (const color of STAR_TOKENS) G.bank[color] = (color === 'gold' ? 5 : baseSupply(G.turnOrder.length)) - G.turnOrder.reduce((sum, id) => sum + G.players[id].tokens[color], 0);
  expect(Object.values(G.bank).every(value => value >= 0)).toBe(true);
}
function chooseAction(G: StarState, id: string): BotAction {
  const own = starPlayerView({ G, playerID: id }), actions = legalStarActions(own, id);
  const simple = actions.find(action => ['acknowledge', 'returnTokens', 'chooseGuardian'].includes(action.move)); if (simple) return simple;
  const buys = actions.filter(action => action.move === 'buyCard');
  if (buys.length) return buys.sort((a, b) => STAR_CARDS[String(b.args[0])].prestige - STAR_CARDS[String(a.args[0])].prestige
    || STAR_COLORS.reduce((sum, color) => sum + STAR_CARDS[String(a.args[0])].cost[color] - STAR_CARDS[String(b.args[0])].cost[color], 0))[0];
  const player = own.players[id], candidates = [...Object.values(own.market).flat().filter((cardID): cardID is string => !!cardID), ...own.private[id].reserved.map(card => card.cardID)];
  const deficit = (cardID: string) => Object.fromEntries(STAR_COLORS.map(color => [color, Math.max(0, STAR_CARDS[cardID].cost[color] - player.bonuses[color] - player.tokens[color])])) as Record<StarColor, number>;
  candidates.sort((a, b) => STAR_COLORS.reduce((sum, color) => sum + deficit(a)[color] - deficit(b)[color], 0) - (STAR_CARDS[a].prestige - STAR_CARDS[b].prestige) * .75);
  const need = candidates.length ? deficit(candidates[0]) : starEmptyBonuses();
  const takes = actions.filter(action => action.move === 'takeTokens');
  if (takes.length) return takes.sort((a, b) => {
    const score = (action: BotAction) => (action.args[0] as StarColor[]).reduce((sum, color) => sum + (need[color] > 0 ? 4 : 0) + 1 / (player.tokens[color] + 1), 0);
    return score(b) - score(a);
  })[0];
  const reserve = actions.find(action => action.move === 'reserveCard'); if (reserve) return reserve;
  throw new Error(`No legal star action for ${id} at ${G.status}`);
}

describe('Star Workshop authenticated economy, private reserves and complete equal-turn archives', () => {
  it.each([1, 5])('rejects %i actual participants without accepting forged counts', async count => {
    const f = await fixture(), g = await group(f, count); await ready(f, g); const before = await f.state(g.matchID);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID, numPlayers: 2 }, g.host)).status).toBe(409);
    expect(await f.state(g.matchID)).toEqual(before);
  });

  it('isolates blind and known reservations, pending token returns and revoked memberships across real sockets and restarts', async () => {
    const f = await fixture(), g = await group(f, 3), foreign = await group(f, 2);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.seats[1])).status).toBe(403);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.observer)).status).toBe(403);
    expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, foreign.host)).status).toBe(401);
    await start(f, g); await start(f, foreign); const untouched = await f.state(foreign.matchID);
    let state = await acknowledgeAll(f, g); const actor = state.G.activePlayer!, blindCard = state.G.secret!.decks[3][0], staleEpoch = state.G.epoch;
    const reserve: BotAction = { move: 'reserveCard', args: [{ kind: 'deck', tier: 3 }, state.G.epoch] };
    for (const credentials of [g.seats[1].credentials, g.observer.credentials, foreign.host.credentials]) await f.forgedMove(g, actor, credentials, reserve);
    await f.rejectMove(g, g.seats[1].playerID, reserve);
    state = await f.move(g, actor, reserve); expect(state.G.private[actor].reserved[0].cardID).toBe(blindCard);
    expect(state.G.players[actor].reserved[0]).toMatchObject({ tier: 3, knownCardID: null }); assertViews(f, g, state);
    for (const id of g.seats.map(seat => seat.playerID).filter(id => id !== actor)) expect(starPlayerView({ G: state.G, playerID: id }).private[actor]).toBeUndefined();
    expect(JSON.stringify(starObserverView(state.G, 'blind'))).not.toContain(blindCard);
    const alternative = structuredClone(state.G); STAR_TIERS.forEach(tier => alternative.secret!.decks[tier].reverse()); alternative.secret!.unusedGuardians.reverse();
    expect(starObserverView(alternative, 'god')).toEqual(starObserverView(state.G, 'god'));
    for (const id of state.G.turnOrder) expect(legalStarActions(starPlayerView({ G: alternative, playerID: id }), id)).toEqual(legalStarActions(starPlayerView({ G: state.G, playerID: id }), id));
    const saved = await f.state(g.matchID); await f.restart(); expect(await f.state(g.matchID)).toEqual(saved); await connectGroup(f, g); await connectGroup(f, foreign);
    await f.rejectMove(g, actor, { move: 'reserveCard', args: [{ kind: 'deck', tier: 3 }, staleEpoch] });
    state = await f.state(g.matchID); const next = state.G.activePlayer!, known = state.G.market[1].find(Boolean)!;
    state = await f.move(g, next, { move: 'reserveCard', args: [{ kind: 'market', cardID: known }, state.G.epoch] });
    expect(state.G.players[next].reserved[0].knownCardID).toBe(known); expect(state.G.private[next].reserved[0].cardID).toBe(known);
    expect(starObserverView(state.G, 'blind').log.some(entry => entry.cardID === known)).toBe(true);
    const owner = state.G.activePlayer!; state.G.players[owner].tokens = { white: 4, blue: 4, green: 2, red: 0, black: 0, gold: 0 }; balanceBank(state.G);
    state = await saveArrangement(f, g, state); state = await f.move(g, owner, { move: 'takeTokens', args: [['white', 'blue', 'green'], state.G.epoch] });
    expect(state.G.status).toBe('return-tokens'); expect(state.G.pending).toMatchObject({ playerID: owner, returnCount: 3 }); expect(starTokenTotal(state.G.players[owner].tokens)).toBe(13);
    const pending = await f.state(g.matchID); await f.restart(); expect(await f.state(g.matchID)).toEqual(pending); await connectGroup(f, g); await connectGroup(f, foreign);
    const giveBack = { ...starEmptyTokens(), white: 1, blue: 1, green: 1 };
    await f.rejectMove(g, actor, { move: 'returnTokens', args: [giveBack, pending.G.epoch] });
    await f.rejectMove(g, owner, { move: 'returnTokens', args: [giveBack, pending.G.epoch - 1] });
    state = await f.move(g, owner, { move: 'returnTokens', args: [giveBack, pending.G.epoch] }); expect(starTokenTotal(state.G.players[owner].tokens)).toBe(10); expect(state.G.pending).toBeNull(); assertViews(f, g, state);
    const blind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer), god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    expect(blind.status).toBe(200); expect(god.status).toBe(200); expect(blind.body.G.private).toEqual({}); expect(god.body.G.private).toEqual(state.G.private);
    expect(starObserverView(god.body.G, 'blind')).toEqual(blind.body.G); noServerSecrets(blind.body); noServerSecrets(god.body);
    expect((await f.request(path(g.host, 'view?perspective=blind'), undefined, foreign.observer)).status).toBe(401);
    for (const event of ['endGame', 'endTurn', 'endPhase', 'setActivePlayers']) await f.rejectPacket(g, { type: 'GAME_EVENT', payload: { type: event, args: event === 'endGame' ? [{ winner: 'prestige' }] : [], playerID: actor, credentials: g.host.credentials } });
    expect(await f.state(foreign.matchID)).toEqual(untouched);
    const departed = g.seats.find(seat => seat.playerID === state.G.activePlayer)!; const beforeLeave = await f.state(g.matchID);
    expect((await f.request(path(g.host, 'leave'), {}, departed)).status).toBe(200);
    const afterLeave = await f.state(g.matchID), index = g.seats.indexOf(departed), move = chooseAction(beforeLeave.G, departed.playerID);
    g.clients[index].emit('update', { type: 'MAKE_MOVE', payload: { type: move.move, args: move.args, playerID: departed.playerID, credentials: departed.credentials } }, beforeLeave._stateID, g.matchID, departed.playerID);
    const survivor = g.seats.find(seat => seat.playerID !== departed.playerID)!; await f.sync(g.clients[g.seats.indexOf(survivor)], g, survivor); expect(await f.state(g.matchID)).toEqual(afterLeave);
    expect((await f.request(path(g.host), undefined, departed)).status).toBe(401);
    for (const packets of f.wire.values()) for (const packet of packets) { noServerSecrets(packet); expect((packet as any).log).toEqual([]); }
  }, 120000);

  it('persists an owner-only guardian choice after voluntary gold payment while leaving exactly one eligible guardian for a later turn', async () => {
    const f = await fixture(), g = await group(f, 2); await start(f, g); let state = await acknowledgeAll(f, g); const owner = state.G.activePlayer!, other = state.G.turnOrder.find(id => id !== owner)!;
    // A conserved legal midgame fixture isolates a rare two-guardian boundary.
    // Scores and bonuses come only from actual zero-prestige purchased cards.
    const target = STAR_CARDS['star-1-white-1'], counts = { ...starEmptyBonuses(), white: 3, blue: 4, black: 4 }, purchased: string[] = [];
    for (const color of STAR_COLORS) purchased.push(...STAR_CARD_LIST.filter(card => card.tier === 1 && card.bonus === color && card.prestige === 0 && card.id !== target.id).slice(0, counts[color]).map(card => card.id));
    state.G.players[owner].purchased = purchased; state.G.players[owner].bonuses = counts; state.G.players[owner].prestige = 0;
    for (const tier of STAR_TIERS) { const cards = STAR_CARD_LIST.filter(card => card.tier === tier && !purchased.includes(card.id) && card.id !== target.id).map(card => card.id); if (tier === 1) cards.unshift(target.id); state.G.market[tier] = cards.splice(0, 4); state.G.secret!.decks[tier] = cards; state.G.deckCounts[tier] = cards.length; }
    state.G.guardians = ['draco', 'orion', 'lyra']; state.G.secret!.unusedGuardians = STAR_GUARDIAN_LIST.filter(guardian => !state.G.guardians.includes(guardian.id)).map(guardian => guardian.id);
    state.G.players[owner].tokens = { ...starEmptyTokens(), green: 1, red: 1, gold: 1 }; balanceBank(state.G); state = await saveArrangement(f, g, state);
    const payment = { ...starEmptyTokens(), red: 1, gold: 1 }, originalGreen = state.G.players[owner].tokens.green;
    state = await f.move(g, owner, { move: 'buyCard', args: [target.id, payment, state.G.epoch] });
    expect(state.G.players[owner].tokens.green).toBe(originalGreen); expect(state.G.players[owner].tokens.gold).toBe(0); expect(state.G.players[owner].purchased).toHaveLength(12);
    expect(state.G.status).toBe('choose-guardian'); expect(state.G.pending?.guardianIDs.slice().sort()).toEqual(['draco', 'orion']); expect(state.G.players[owner].guardians).toEqual([]);
    const pending = await f.state(g.matchID); await f.restart(); expect(await f.state(g.matchID)).toEqual(pending); await connectGroup(f, g);
    await f.rejectMove(g, other, { move: 'chooseGuardian', args: ['draco', pending.G.epoch] }); await f.rejectMove(g, owner, { move: 'chooseGuardian', args: ['lyra', pending.G.epoch] }); await f.rejectMove(g, owner, { move: 'chooseGuardian', args: ['draco', pending.G.epoch - 1] });
    state = await f.move(g, owner, { move: 'chooseGuardian', args: ['draco', pending.G.epoch] }); expect(state.G.players[owner].guardians).toEqual(['draco']); expect(state.G.players[owner].prestige).toBe(3); expect(state.G.guardians).toContain('orion');
    state = await f.move(g, other, chooseAction(state.G, other)); expect(state.G.activePlayer).toBe(owner);
    const take = legalStarActions(starPlayerView({ G: state.G, playerID: owner }), owner).find(action => action.move === 'takeTokens')!;
    state = await f.move(g, owner, take); expect(state.G.players[owner].guardians.slice().sort()).toEqual(['draco', 'orion']); expect(state.G.players[owner].prestige).toBe(6); expect(state.G.guardians).toEqual(['lyra']); assertConservation(state.G); assertViews(f, g, state);
  }, 60000);

  it('reaches a genuinely blocked hand through real moves and only authorizes its forced pass after a restart', async () => {
    const f = await fixture(), g = await group(f, 4); await start(f, g); let state = await acknowledgeAll(f, g);
    await f.rejectMove(g, state.G.activePlayer!, { move: 'forcedPass', args: [state.G.epoch] });
    // Reproduce the audited legal shuffle, then play the entire route to the
    // obstruction. No holdings, purchases, pending states or scores are injected.
    const initial = createMatch({ game: { ...StarGame, seed: 'no-action-1' }, numPlayers: 4, setupData: { startImmediately: true, participantIDs: state.G.turnOrder }, unlisted: true });
    if ('setupDataError' in initial) throw new Error(initial.setupDataError);
    const seeded = initial.initialState.G;
    state.G.market = seeded.market; state.G.deckCounts = seeded.deckCounts; state.G.guardians = seeded.guardians; state.G.secret = seeded.secret;
    state = await saveArrangement(f, g, state);
    const goals: StarTokenCounts[] = [{ white: 7, blue: 3, green: 0, red: 0, black: 0, gold: 0 }, { white: 0, blue: 0, green: 7, red: 3, black: 0, gold: 0 }, { white: 0, blue: 0, green: 0, red: 4, black: 5, gold: 1 }, { white: 0, blue: 4, green: 0, red: 0, black: 2, gold: 4 }];
    let seed = 1; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let steps = 0;
    for (; steps < 250; steps++) {
      const G = state.G, id = G.activePlayer!, index = G.turnOrder.indexOf(id), own = G.players[id], target = goals[index], actions = legalStarActions(starPlayerView({ G, playerID: id }), id);
      if (actions.some(action => action.move === 'forcedPass')) break;
      let chosen: BotAction | undefined;
      if (G.status === 'return-tokens') {
        const returned = starEmptyTokens(), held = { ...own.tokens }; let remaining = G.pending!.returnCount;
        while (remaining-- > 0) { const color = [...STAR_TOKENS].filter(color => held[color] > 0).sort((a, b) => (held[b] - target[b]) - (held[a] - target[a]))[0]; returned[color]++; held[color]--; }
        chosen = { move: 'returnTokens', args: [returned, G.epoch] };
      } else if (G.status === 'choose-guardian') chosen = actions[0];
      else {
        if (own.reserved.length < 3 && (index !== 0 || G.bank.gold === 0)) chosen = actions.find(action => action.move === 'reserveCard' && (action.args[0] as any).kind === 'deck' && (action.args[0] as any).tier === 3) ?? actions.find(action => action.move === 'reserveCard');
        if (!chosen) { const takes = actions.filter(action => action.move === 'takeTokens'); takes.sort((a, b) => { const score = (action: BotAction) => (action.args[0] as StarColor[]).reduce((sum, color) => sum + (target[color] - own.tokens[color]) * 2 + random(), 0); return score(b) - score(a); }); chosen = takes[0]; }
        chosen ??= actions.find(action => action.move === 'buyCard');
      }
      expect(chosen).toBeTruthy(); state = await f.move(g, id, chosen!); assertConservation(state.G);
    }
    expect(steps).toBe(80); expect(state.G.activePlayer).toBe(g.seats[0].playerID); expect(STAR_COLORS.every(color => state.G.bank[color] === 0)).toBe(true);
    expect(state.G.players[g.seats[0].playerID].reserved).toHaveLength(3); expect(legalStarActions(starPlayerView({ G: state.G, playerID: state.G.activePlayer }), state.G.activePlayer!)).toEqual([{ move: 'forcedPass', args: [state.G.epoch] }]);
    const pending = await f.state(g.matchID); await f.restart(); expect(await f.state(g.matchID)).toEqual(pending); await connectGroup(f, g);
    const owner = pending.G.activePlayer!, other = pending.G.turnOrder.find(id => id !== owner)!;
    await f.rejectMove(g, other, { move: 'forcedPass', args: [pending.G.epoch] }); await f.rejectMove(g, owner, { move: 'forcedPass', args: [pending.G.epoch - 1] });
    const inventory = { market: pending.G.market, bank: pending.G.bank, private: pending.G.private, holdings: Object.fromEntries(pending.G.turnOrder.map(id => [id, pending.G.players[id].tokens])) };
    state = await f.move(g, owner, { move: 'forcedPass', args: [pending.G.epoch] });
    expect(state.G.activePlayer).toBe(other); expect(state.G.turnNumber).toBe(pending.G.turnNumber + 1); expect(state.G.forcedPasses).toEqual([owner]);
    expect({ market: state.G.market, bank: state.G.bank, private: state.G.private, holdings: Object.fromEntries(state.G.turnOrder.map(id => [id, state.G.players[id].tokens])) }).toEqual(inventory); assertViews(f, g, state);
  }, 60000);

  it.each([{ count: 2, testRoom: false }, { count: 3, testRoom: false }, { count: 4, testRoom: false }, { count: 2, testRoom: true }])('completes a real $count-person game, equal-turn ending and durable archives with test exclusion $testRoom', async ({ count, testRoom }) => {
    const f = await fixture(), g = await group(f, count, testRoom); await start(f, g); let state = await acknowledgeAll(f, g); const ids = state.G.turnOrder, turns = Object.fromEntries(ids.map(id => [id, 0]));
    expect(ids).toEqual(g.seats.map(seat => seat.playerID)); expect(ids).not.toContain('1'); expect(state.G.guardians).toHaveLength(count + 1); for (const color of STAR_TOKENS) expect(state.G.bank[color]).toBe(color === 'gold' ? 5 : baseSupply(count)); assertConservation(state.G);
    let firstTrigger: string | null = null, steps = 0; const seen = new Set<string>();
    while (state.G.status !== 'finished' && steps++ < 1000) {
      const before = state.G, id = before.activePlayer!, action = chooseAction(before, id); seen.add(action.move);
      state = await f.move(g, id, action); if (before.status === 'turn') turns[id]++;
      if (!firstTrigger && state.G.endTriggeredBy) firstTrigger = state.G.endTriggeredBy;
      assertConservation(state.G); assertViews(f, g, state);
    }
    expect(state.G.status).toBe('finished'); expect(firstTrigger).not.toBeNull(); expect(new Set(Object.values(turns)).size).toBe(1); expect(state.G.round).toBe(turns[ids[0]]); expect(state.ctx.gameover).toEqual({ winner: 'prestige', reason: 'completed-round' });
    expect(seen.has('buyCard')).toBe(true); expect(seen.has('takeTokens')).toBe(true);
    const highest = Math.max(...Object.values(state.G.finalScores)); const highIDs = ids.filter(id => state.G.finalScores[id] === highest), fewest = Math.min(...highIDs.map(id => state.G.players[id].purchased.length));
    expect(state.G.winnerIDs).toEqual(highIDs.filter(id => state.G.players[id].purchased.length === fewest)); expect(highest).toBeGreaterThanOrEqual(15);
    for (const id of ids) expect(state.G.players[id].prestige).toBe(state.G.players[id].purchased.reduce((sum, cardID) => sum + STAR_CARDS[cardID].prestige, 0) + state.G.players[id].guardians.reduce((sum, guardianID) => sum + STAR_GUARDIANS[guardianID].prestige, 0));
    const finished = await f.state(g.matchID), godReplay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer); expect(godReplay.status).toBe(200); expect(godReplay.body.complete).toBe(true); expect(godReplay.body.frames.length).toBeGreaterThan(20); noServerSecrets(godReplay.body);
    const shared = await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host); expect(shared.status).toBe(200);
    const replayURL = `/api/replays/${g.host.roomId}`, headers = { 'X-Replay-Token': token(shared.body.url, 'share') }, publicReplay = await f.request(replayURL, undefined, undefined, headers); expect(publicReplay.status).toBe(200); noServerSecrets(publicReplay.body);
    expect(publicReplay.body.frames).toHaveLength(godReplay.body.frames.length); for (const [index, frame] of publicReplay.body.frames.entries()) { expect(frame.G.private).toEqual({}); expect(frame.G).toEqual(starObserverView(godReplay.body.frames[index].G, 'blind')); }
    const statistics = (await f.request('/api/stats')).body, summary = statistics.byGame.find((entry: any) => entry.gameId === 'star-workshop'); expect(statistics.completedGames).toBe(testRoom ? 0 : 1); expect(summary.completed).toBe(testRoom ? 0 : 1); expect(summary.rankedCompleted).toBe(0); expect(summary.wins).toEqual({}); expect(summary.competitions).toEqual(testRoom ? [] : [expect.objectContaining({ mode: 'base', numPlayers: count, runs: 1, totalRounds: state.G.round, averageRounds: state.G.round })]); expect(JSON.stringify(statistics)).not.toMatch(/星匠房主|星匠同伴|winnerIDs|credentials|playerID/);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(finished); expect((await f.request('/api/stats')).body).toEqual(statistics); expect((await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer)).body).toEqual(godReplay.body); expect((await f.request(replayURL, undefined, undefined, headers)).body).toEqual(publicReplay.body);
  }, 120000);
});
