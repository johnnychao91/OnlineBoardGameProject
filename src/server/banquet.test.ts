import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotAction } from '../games/bots';
import { type BanquetState, type BanquetRole } from '../games/banquet/game';
import { BANQUET_PRESETS } from '../games/banquet/content';
import type { BanquetOptions } from '../games/banquet/rules';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string }
type Snapshot = State<BanquetState>;
const origin = 'http://localhost:5173';
const ioWait = { timeout: 10000, interval: 25 };
const testKey = 'hundred-ghosts-test-room-key';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
function noServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:secret|seed|prngstate|credentials|credentialHash|inviteHash|inviteToken|cardID|cardId|backing|swapPerformed)"\s*:/);
}
async function fixture() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-banquet-integration-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-banquet-integration-')) throw new Error('Unexpected test directory');
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
  const connect = async (namespace = 'hundred-ghosts') => {
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
  return { request, connect, sync, state, move, rejectMove, forgedMove, rejectPacket, views, wire, get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function group(f: Fixture, count: number, testRoom = false): Promise<Group> {
  // Assemble before choosing a game so a departed middle seat leaves nonconsecutive IDs.
  const created = await f.request('/api/rooms', { displayName: '夜宴房主', ...(testRoom ? { createKey: testKey } : {}) });
  expect(created.status).toBe(201);
  const host = created.body as Room, seats: Seat[] = [host];
  for (let index = 1; index <= (count === 12 ? count - 1 : count); index++) {
    const result = await f.request(path(host, 'join'), { inviteToken: token(host.inviteUrl), displayName: `夜宴隊員 ${index}`, requestID: randomUUID() });
    expect(result.status).toBe(200); seats.push(result.body);
  }
  if (count < 12) { expect((await f.request(path(host, 'leave'), {}, seats[1])).status).toBe(200); seats.splice(1, 1); }
  const current = (await f.request(path(host), undefined, host)).body;
  const selected = await f.request(path(host, 'game'), { gameId: 'hundred-ghosts', matchID: current.matchID }, host);
  expect(selected.status).toBe(200);
  const observed = await f.request(path(host, 'watch'), { inviteToken: token(host.inviteUrl), displayName: '夜宴觀戰者', requestID: randomUUID() });
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
async function start(f: Fixture, g: Group, options: Partial<BanquetOptions>) {
  const updated = await f.request(path(g.host, 'options'), { matchID: g.matchID, options }, g.host);
  expect(updated.status, updated.body.error).toBe(200); g.matchID = updated.body.matchID;
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat)).status).toBe(200);
  const started = await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host);
  expect(started.status, started.body.error).toBe(200); g.matchID = started.body.matchID;
  await connectGroup(f, g);
}

const smallRoles: BanquetRole[] = ['judge', 'empress', 'king', 'fool', 'widow', 'thief'];
const privateRoles: BanquetRole[] = ['judge', 'empress', 'king', 'fool', 'widow', 'spy', 'princess', 'thief'];
async function acknowledgeAll(f: Fixture, g: Group) {
  for (const seat of g.seats) {
    const state = await f.state(g.matchID);
    await f.move(g, seat.playerID, { move: 'acknowledge', args: [state.G.epoch] });
  }
}
async function openingExchanges(f: Fixture, g: Group) {
  for (let index = 0; index < 4; index++) {
    const state = await f.state(g.matchID), id = state.G.activePlayer!;
    await f.move(g, id, { move: 'exchange', args: [`seat:${(state.G.turnOrder.indexOf(id) + 1) % g.seats.length}`, false, state.G.epoch] });
  }
  expect((await f.state(g.matchID)).G.initialTurnsRemaining).toBe(0);
}
async function uncontested(f: Fixture, g: Group, role: BanquetRole) {
  const before = await f.state(g.matchID);
  let state = await f.move(g, before.G.activePlayer!, { move: 'announce', args: [role, before.G.epoch] });
  while (state.G.claim && state.G.claim.responseIndex < state.G.claim.responderIDs.length) {
    state = await f.move(g, state.G.claim.responderIDs[state.G.claim.responseIndex], { move: 'respondClaim', args: [false, state.G.epoch] });
  }
  return state;
}
function assertPlayerViews(f: Fixture, g: Group, state: Snapshot) {
  for (const [index, seat] of g.seats.entries()) {
    const snapshot = f.views.get(g.clients[index])!;
    expect(Object.keys(snapshot.G.private)).toEqual([seat.playerID]);
    expect(snapshot.G.private[seat.playerID]).toEqual(state.G.private[seat.playerID]);
    expect(snapshot.G.currentMasks).toBeUndefined(); expect(snapshot.G.observerMemory).toBeUndefined();
    expect(snapshot._undo).toEqual([]); expect(snapshot._redo).toEqual([]);
    expect(snapshot.deltalog).toBeUndefined(); noServerSecrets(snapshot);
    if (snapshot.G.pending?.actorID !== seat.playerID) expect(snapshot.G.pending?.choices).toBeUndefined();
  }
}

describe('Hundred Ghosts authenticated masks, private memories and completed banquets', () => {
  it.each([
    { count: 4, options: { scenario: 'custom', customRoles: smallRoles } as BanquetOptions, centerCount: 2 },
    { count: 12, options: { scenario: 'B', customRoles: [] } as BanquetOptions, centerCount: 0 },
  ])('starts $count actual participants with host-only validated options and persistent seating', async ({ count, options, centerCount }) => {
    const f = await fixture(), g = await group(f, count), foreign = await group(f, 4);
    const untouched = await f.state(foreign.matchID);
    const change = { matchID: g.matchID, options };
    expect((await f.request(path(g.host, 'options'), change, g.seats[1])).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), change, g.observer)).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), change, foreign.host)).status).toBe(401);
    expect((await f.request(path(g.host, 'options'), { ...change, options: { scenario: 'unknown' } }, g.host)).status).toBe(400);
    expect((await f.request(path(g.host, 'options'), { ...change, options: { scenario: 'custom', customRoles: ['king', 'king'] } }, g.host)).status).toBe(400);
    expect((await f.request(path(g.host, 'view?perspective=god'), undefined, foreign.host)).status).toBe(401);
    if (count === 4) {
      // A structurally valid custom set is rechecked against the actual seats
      // when starting; an invalid count must not silently drop masks or players.
      const configured = await f.request(path(g.host, 'options'), {
        matchID: g.matchID, options: { scenario: 'custom', customRoles: [...smallRoles, 'trickster'] },
      }, g.host);
      expect(configured.status).toBe(200); g.matchID = configured.body.matchID;
      for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { matchID: g.matchID, ready: true }, seat)).status).toBe(200);
      expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.seats[1])).status).toBe(403);
      expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.observer)).status).toBe(403);
      expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, foreign.host)).status).toBe(401);
      expect((await f.request(path(g.host, 'start'), { matchID: g.matchID }, g.host)).status).toBe(409);
      expect((await f.request(path(g.host), undefined, g.host)).body).toMatchObject({ status: 'lobby', numPlayers: count });
    }
    await start(f, g, options);
    const initial = await f.state(g.matchID), participantIDs = g.seats.map(seat => seat.playerID);
    expect(initial.G.status).toBe('briefing');
    expect(initial.G.turnOrder).toEqual(participantIDs);
    expect(Object.keys(initial.G.players)).toEqual(participantIDs);
    expect(Object.keys(initial.ctx.activePlayers!)).toEqual(participantIDs);
    if (count < 12) expect(participantIDs).not.toContain('1');
    expect(initial.G.options).toEqual(options); expect(initial.G.centerCount).toBe(centerCount);
    expect(initial.G.secret!.masks).toHaveLength(count); expect(initial.G.secret!.center).toHaveLength(centerCount);
    expect(initial.G.inPlayRoles).toEqual(options.scenario === 'custom' ? smallRoles : BANQUET_PRESETS[count].B);
    expect(initial.G.initialLayout).toHaveLength(count + centerCount);
    for (const seat of g.seats) expect(initial.G.private[seat.playerID].memory).toEqual(initial.G.initialLayout);
    expect((await f.request(path(g.host, 'view?perspective=god'), undefined, g.host)).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), { matchID: g.matchID, options }, g.host)).status).toBe(409);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(initial); await connectGroup(f, g);
    expect((await f.request(path(g.host), undefined, g.host)).body.gameOptions).toEqual(options);
    await acknowledgeAll(f, g);
    const playing = await f.state(g.matchID);
    expect(playing.G.status).toBe('playing'); expect(playing.G.initialTurnsRemaining).toBe(4);
    assertPlayerViews(f, g, playing);
    expect(await f.state(foreign.matchID)).toEqual(untouched);
  }, 60000);

  it('protects real and feigned exchanges, rejected actions, private inspection and selective public memory across restart', async () => {
    const f = await fixture(), g = await group(f, 6), foreign = await group(f, 4);
    await start(f, g, { scenario: 'custom', customRoles: privateRoles });
    await start(f, foreign, { scenario: 'custom', customRoles: smallRoles });
    const untouched = await f.state(foreign.matchID), foreignClients = [...foreign.clients];
    const foreignPackets = foreignClients.map(socket => f.wire.get(socket)!.length);
    await acknowledgeAll(f, g);
    let state = await f.state(g.matchID);
    const actor = state.G.activePlayer!, other = g.seats.find(seat => seat.playerID !== actor)!;
    const exchange = { move: 'exchange', args: ['center:0', true, state.G.epoch] };
    await f.rejectMove(g, other.playerID, exchange);
    await f.forgedMove(g, actor, other.credentials, exchange);
    await f.forgedMove(g, actor, g.observer.credentials, exchange);
    await f.forgedMove(g, actor, foreign.host.credentials, exchange);
    await f.forgedMove(g, '1', g.host.credentials, exchange);
    await f.rejectMove(g, actor, { move: 'look', args: [state.G.epoch] });
    await f.rejectMove(g, actor, { move: 'exchange', args: ['center:99', true, state.G.epoch] });
    await f.rejectMove(g, actor, { move: 'exchange', args: ['seat:0', true, state.G.epoch] });
    await f.rejectMove(g, actor, { move: 'exchange', args: ['center:0', 'true', state.G.epoch] });
    for (const type of ['GAME_EVENT', 'UNDO', 'REDO', 'RESET']) {
      await f.rejectPacket(g, { type, payload: { type: 'endGame', args: [{ winner: 'wealth' }], playerID: actor, credentials: g.host.credentials } });
    }
    await f.rejectPacket(g, { type: 'MAKE_MOVE', payload: { type: 'constructor', args: [], playerID: actor, credentials: g.host.credentials } });

    // Real and feigned exchanges expose the same record shape and invalidate both
    // locations' remembered observations, without exposing the private boolean.
    for (const swap of [false, true]) {
      const before = await f.state(g.matchID), id = before.G.activePlayer!, position = before.G.turnOrder.indexOf(id);
      const beforeMasks = [...before.G.secret!.masks], beforeCenter = [...before.G.secret!.center];
      const action = { move: 'exchange', args: ['center:0', swap, before.G.epoch] };
      state = await f.move(g, id, action); await f.rejectMove(g, id, action);
      expect(state.G.secret!.masks[position]).toBe(swap ? beforeCenter[0] : beforeMasks[position]);
      expect(state.G.secret!.center[0]).toBe(swap ? beforeMasks[position] : beforeCenter[0]);
      expect(state.G.log.at(-1)).toEqual({ type: 'exchange', turn: before.G.turnNumber, actorID: id,
        targetIDs: ['center:0'], message: '兩張面具完成秘密交換或假換。' });
      for (const seat of g.seats) {
        const affected = state.G.private[seat.playerID].memory.filter(entry => [`seat:${position}`, 'center:0'].includes(entry.location));
        expect(affected).toHaveLength(2); expect(affected.every(entry => entry.uncertain)).toBe(true);
      }
      assertPlayerViews(f, g, state);
    }
    while (state.G.initialTurnsRemaining) {
      state = await f.move(g, state.G.activePlayer!, { move: 'exchange', args: ['center:1', false, state.G.epoch] });
    }
    // An earlier token cannot be reused for a later decision by the same person.
    const staleEpoch = state.G.epoch;
    state = await f.move(g, state.G.activePlayer!, { move: 'announce', args: ['spy', state.G.epoch] });
    await f.rejectMove(g, state.G.claim!.responderIDs[1], { move: 'respondClaim', args: [false, state.G.epoch] });
    const firstResponder = state.G.claim!.responderIDs[0];
    const response = { move: 'respondClaim', args: [false, state.G.epoch] };
    state = await f.move(g, firstResponder, response); await f.rejectMove(g, firstResponder, response);
    while (state.G.claim && state.G.claim.responseIndex < state.G.claim.responderIDs.length) {
      state = await f.move(g, state.G.claim.responderIDs[state.G.claim.responseIndex], { move: 'respondClaim', args: [false, state.G.epoch] });
    }
    expect(state.G.pending?.kind).toBe('spy-target');
    const spy = state.G.pending!.actorID, victim = state.G.turnOrder.find(id => id !== spy)!;
    await f.rejectMove(g, victim, { move: 'choose', args: [[victim], state.G.epoch] });
    await f.rejectMove(g, spy, { move: 'choose', args: [[spy], state.G.epoch] });
    await f.rejectMove(g, spy, { move: 'choose', args: [[victim], staleEpoch] });
    const blindPending = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
    expect(blindPending.body.G.pending.choices).toBeUndefined(); expect(blindPending.body.G.currentMasks).toBeUndefined();
    const beforeRestart = await f.state(g.matchID);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(beforeRestart);
    await connectGroup(f, g); await connectGroup(f, foreign);
    state = await f.move(g, spy, { move: 'choose', args: [[victim], beforeRestart.G.epoch] });
    expect(state.G.pending?.kind).toBe('swap');
    const spyView = f.views.get(g.clients[g.seats.findIndex(seat => seat.playerID === spy)])!.G;
    expect(spyView.private[spy].memory.slice(-2).map(entry => entry.playerID)).toEqual([spy, victim]);
    expect(spyView.private[spy].memory.slice(-2).every(entry => entry.source === 'spy' && !entry.uncertain)).toBe(true);
    for (const seat of g.seats.filter(seat => seat.playerID !== spy)) expect(state.G.private[seat.playerID].memory).toHaveLength(privateRoles.length);
    expect(state.G.secret!.observerMemory).toHaveLength(privateRoles.length);
    assertPlayerViews(f, g, state);
    const inspection = await f.state(g.matchID);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(inspection);
    await connectGroup(f, g); await connectGroup(f, foreign);
    state = await f.move(g, spy, { move: 'choose', args: [['swap'], inspection.G.epoch] });
    expect(state.G.private[spy].memory.slice(-2).every(entry => entry.source === 'spy' && !entry.uncertain)).toBe(true);

    state = await uncontested(f, g, 'princess');
    expect(state.G.pending?.kind).toBe('princess-target');
    const princess = state.G.pending!.actorID, excluded = state.G.turnOrder.find(id => id !== princess)!;
    const excludedMemory = structuredClone(state.G.private[excluded].memory);
    const mask = state.G.secret!.masks[state.G.turnOrder.indexOf(excluded)];
    state = await f.move(g, princess, { move: 'choose', args: [[excluded], state.G.epoch] });
    expect(state.G.private[excluded].memory).toEqual(excludedMemory);
    for (const seat of g.seats.filter(seat => seat.playerID !== excluded)) {
      expect(state.G.private[seat.playerID].memory.at(-1)).toMatchObject({ source: 'princess', playerID: excluded, role: mask, uncertain: false });
    }
    expect(state.G.log.at(-1)).toMatchObject({ type: 'princess-reveal', targetIDs: [excluded] });
    expect(state.G.log.at(-1)).not.toHaveProperty('revealed'); expect(state.G.log.at(-1)).not.toHaveProperty('role');
    assertPlayerViews(f, g, state);
    const blind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
    const god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    expect(blind.status).toBe(200); expect(god.status).toBe(200);
    expect(blind.body.G.private).toEqual({}); expect(blind.body.G.currentMasks).toBeUndefined();
    expect(blind.body.G.observerMemory.at(-1)).toMatchObject({ source: 'princess', playerID: excluded, role: mask });
    expect(blind.body.G.observerMemory.some((entry: any) => entry.source === 'spy')).toBe(false);
    expect(god.body.G.private).toEqual(state.G.private);
    expect(god.body.G.currentMasks).toEqual({ players: Object.fromEntries(state.G.turnOrder.map((id, index) => [id, state.G.secret!.masks[index]])), center: state.G.secret!.center });
    noServerSecrets(blind.body); noServerSecrets(god.body);
    expect(await f.state(foreign.matchID)).toEqual(untouched);
    // Original foreign sockets received no update from the other room before restart.
    for (const [index, socket] of foreignClients.entries()) {
      expect(f.wire.get(socket)).toHaveLength(foreignPackets[index]);
    }
    for (const payloads of f.wire.values()) for (const payload of payloads) {
      noServerSecrets(payload);
      expect((payload as any).log).toEqual([]);
      expect((payload as any).state.G.currentMasks).toBeUndefined();
    }
  }, 60000);

  it.each([false, true])('finishes a real banquet, archives both perspectives and excludes test room %s from competition totals', async testRoom => {
    const f = await fixture(), g = await group(f, 4, testRoom);
    await start(f, g, { scenario: 'custom', customRoles: smallRoles });
    await acknowledgeAll(f, g); await openingExchanges(f, g);
    expect((await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host)).status).toBe(409);
    expect((await f.request(path(g.host, `replay?matchID=${g.matchID}`), undefined, g.observer)).status).toBe(409);
    let state = await f.state(g.matchID);
    const eventualWinner = state.G.activePlayer!;
    state = await uncontested(f, g, 'widow');
    expect(state.G.players[eventualWinner].coins).toBe(10);
    while (state.G.activePlayer !== eventualWinner) state = await f.move(g, state.G.activePlayer!, { move: 'look', args: [state.G.epoch] });
    const oldEpoch = state.G.epoch;
    await f.rejectMove(g, eventualWinner, { move: 'announce', args: ['empress', oldEpoch - 1] });
    const finished = await uncontested(f, g, 'empress');
    expect(finished.G.status).toBe('finished'); expect(finished.G.winnerIDs).toEqual([eventualWinner]);
    expect(finished.G.players[eventualWinner].coins).toBe(13);
    expect(finished.ctx.gameover).toEqual({ winner: 'wealth', reason: 'thirteen-coins' });
    await f.rejectMove(g, eventualWinner, { move: 'look', args: [finished.G.epoch] });
    assertPlayerViews(f, g, finished);

    const privateReplay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer);
    expect(privateReplay.status).toBe(200); expect(privateReplay.body.complete).toBe(true);
    expect(privateReplay.body.room).toMatchObject({ gameName: 'hundred-ghosts', testRoom });
    expect(privateReplay.body.frames.length).toBeGreaterThan(15); noServerSecrets(privateReplay.body);
    expect(privateReplay.body.frames.at(-1).G.currentMasks.players).toEqual(Object.fromEntries(finished.G.turnOrder.map((id, index) => [id, finished.G.secret!.masks[index]])));
    const shared = await f.request(path(g.host, 'share'), { matchID: g.matchID, perspective: 'blind', frameIndex: 0 }, g.host);
    expect(shared.status).toBe(200);
    const publicReplay = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': token(shared.body.url, 'share') });
    expect(publicReplay.status).toBe(200); expect(publicReplay.body.perspective).toBe('blind'); noServerSecrets(publicReplay.body);
    for (const frame of publicReplay.body.frames) {
      expect(frame.G.private).toEqual({}); expect(frame.G.currentMasks).toBeUndefined();
      expect(frame.G.observerMemory.every((entry: any) => entry.source !== 'look' && entry.source !== 'spy')).toBe(true);
    }
    const statistics = (await f.request('/api/stats')).body;
    const summary = statistics.byGame.find((entry: any) => entry.gameId === 'hundred-ghosts');
    expect(statistics.completedGames).toBe(testRoom ? 0 : 1);
    expect(summary.completed).toBe(testRoom ? 0 : 1);
    expect(summary.rankedCompleted).toBe(0); expect(summary.wins).toEqual({}); expect(summary.byPlayerCount).toEqual([]);
    expect(summary.competitions).toEqual(testRoom ? [] : [expect.objectContaining({ mode: 'custom', numPlayers: 4, runs: 1, totalRounds: 1, averageRounds: 1 })]);
    expect(JSON.stringify(statistics)).not.toMatch(/夜宴房主|夜宴隊員|winnerIDs|credentials|playerID/);
    await f.restart(); expect(await f.state(g.matchID)).toEqual(finished);
    expect((await f.request('/api/stats')).body).toEqual(statistics);
    const restoredReplay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=god`), undefined, g.observer);
    expect(restoredReplay.body).toEqual(privateReplay.body);
    const restoredPublic = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': token(shared.body.url, 'share') });
    expect(restoredPublic.body).toEqual(publicReplay.body);
  }, 60000);
});
