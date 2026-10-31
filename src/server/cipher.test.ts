import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CipherState } from '../games/cipher/game';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group {
  host: Room; seats: Seat[]; observer: Observer; clients: Socket[];
  gameId: string; matchID: string;
}
type Snapshot = State<CipherState>;
const origin = 'http://localhost:5173';
const gameId = 'encrypted-call';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const headers = (member: Seat | Observer) => ({
  Authorization: `Bearer ${member.credentials}`,
  ...('playerID' in member ? { 'X-Player-ID': member.playerID } : { 'X-Observer-ID': member.observerID }),
});
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name: string) => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
const packet = (seat: Seat, type: string, args: unknown[] = []) => ({
  type: 'MAKE_MOVE', payload: { type, args, playerID: seat.playerID, credentials: seat.credentials },
});
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
function expectNoSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:seed|prngstate|deck|credentials|credentialHash|inviteHash|inviteToken|metadata)"\s*:/);
}

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-cipher-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-cipher-test-')) {
      throw new Error('Refusing cleanup outside this test temporary directory.');
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = {
    dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0,
    production: false, roomCode: '', lifecycleSweepMs: 60000,
  };
  let app = await createApplication(config);
  let running: Awaited<ReturnType<typeof app.listen>> | undefined = await app.listen();
  const sockets: Socket[] = [];
  const views = new Map<Socket, Snapshot>();
  const messages = new Map<Socket, string[]>();
  cleanups.push(async () => {
    for (const socket of sockets) socket.disconnect();
    await running?.close();
  });
  const baseURL = () => {
    if (!running) throw new Error('Test server is stopped');
    return `http://127.0.0.1:${running.port}`;
  };
  const request = async (url: string, body?: unknown, member?: Seat | Observer, extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(baseURL() + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(member ? headers(member) : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
  };
  const connect = async (namespace = gameId) => {
    const socket = io(`${baseURL()}/${namespace}`, {
      transports: ['websocket'], forceNew: true, reconnection: false,
      extraHeaders: { Origin: origin }, autoConnect: false,
    });
    sockets.push(socket);
    messages.set(socket, []);
    socket.on('error', () => {});
    socket.on('sync', (matchID: string, info: SyncInfo) => {
      messages.get(socket)!.push(matchID);
      views.set(socket, info.state as Snapshot);
    });
    socket.on('update', (matchID: string, state: Snapshot) => {
      messages.get(socket)!.push(matchID);
      views.set(socket, state);
    });
    await new Promise<void>((ok, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connect timed out')), 3000);
      socket.once('connect', () => { clearTimeout(timeout); ok(); });
      socket.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
      socket.connect();
    });
    return socket;
  };
  const sync = async (socket: Socket, group: Group, seat: Seat) => {
    const result = new Promise<SyncInfo>((ok, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Authorized sync timed out: ${group.matchID}/${seat.playerID}`)), 3000);
      socket.once('sync', (_id: string, info: SyncInfo) => { clearTimeout(timeout); ok(info); });
    });
    socket.emit('sync', group.matchID, seat.playerID, seat.credentials, group.seats.length);
    return result;
  };
  const state = async (matchID: string) => (await app.db.fetch(matchID, { state: true })).state! as Snapshot;
  const emitMove = (group: Group, index: number, type: string, args: unknown[], stateID: number) => {
    const seat = group.seats[index];
    group.clients[index].emit('update', packet(seat, type, args), stateID, group.matchID, seat.playerID);
  };
  const move = async (group: Group, index: number, type: string, args: unknown[] = []) => {
    const before = await state(group.matchID);
    emitMove(group, index, type, args, before._stateID);
    await vi.waitFor(async () => expect((await state(group.matchID))._stateID).toBeGreaterThan(before._stateID), { timeout: 4000 });
    return state(group.matchID);
  };
  return {
    get app() { return app; }, request, connect, sync, state, move, emitMove, views, messages,
    async restart() {
      for (const socket of sockets.splice(0)) socket.disconnect();
      const previous = running;
      running = undefined;
      await previous?.close();
      app = await createApplication(config);
      running = await app.listen();
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function group(f: Fixture, count = 2, selectedGame = gameId): Promise<Group> {
  const created = await f.request('/api/rooms', { gameId: selectedGame, displayName: '指揮員' });
  expect(created.status).toBe(201);
  const host = created.body as unknown as Room;
  const seats: Seat[] = [host];
  for (let index = 1; index < count; index++) {
    const joined = await f.request(path(host, 'join'), {
      inviteToken: token(host.inviteUrl, 'invite'), displayName: `幹員 ${index}`, requestID: randomUUID(),
    });
    expect(joined.status).toBe(200);
    seats.push(joined.body as unknown as Seat);
  }
  const observer = await f.request(path(host, 'watch'), {
    inviteToken: token(host.inviteUrl, 'invite'), displayName: '觀戰者', requestID: randomUUID(),
  });
  expect(observer.status).toBe(200);
  return { host, seats, observer: observer.body as unknown as Observer, gameId: selectedGame, clients: [], matchID: host.matchID };
}
async function start(f: Fixture, g: Group) {
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { ready: true }, seat)).status).toBe(200);
  const result = await f.request(path(g.host, 'start'), {}, g.host);
  expect(result.status).toBe(200);
  g.matchID = result.body.matchID;
  g.clients = await Promise.all(g.seats.map(() => f.connect(g.gameId)));
  await Promise.all(g.clients.map((socket, index) => f.sync(socket, g, g.seats[index])));
  return result.body;
}
async function synchronize(f: Fixture, g: Group) {
  const before = await f.state(g.matchID);
  expect(before.G.status).toBe('syncing');
  for (let index = 0; index < g.seats.length; index++) {
    await f.move(g, index, 'readySync', [before.G.level, before.G.epoch]);
  }
  expect((await f.state(g.matchID)).G.status).toBe('playing');
}
function sortedCards(g: Group, state: Snapshot) {
  return g.seats.map((seat, index) => ({ index, playerID: seat.playerID, card: state.G.private[seat.playerID].cards[0] }))
    .filter((entry) => entry.card !== undefined).sort((a, b) => a.card - b.card);
}
async function playLowest(f: Fixture, g: Group) {
  const before = await f.state(g.matchID);
  const lowest = sortedCards(g, before)[0];
  return f.move(g, lowest.index, 'playCard', [lowest.card, before.G.level, before.G.epoch]);
}
/** Set up only the last decision; the authenticated socket still decides the result. */
async function finalDecision(f: Fixture, g: Group, winner: 'agents' | 'intercepted') {
  const before = await f.state(g.matchID);
  before.G.status = 'playing';
  before.G.level = before.G.targetLevel;
  before.G.cover = winner === 'agents' ? 2 : 1;
  before.G.transmitted = [];
  before.G.discarded = [];
  for (const [index, seat] of g.seats.entries()) {
    before.G.private[seat.playerID].cards = [10 + index * 20];
    before.G.players[seat.playerID].cardCount = 1;
  }
  before._stateID++;
  await f.app.db.setState(g.matchID, before);
  if (winner === 'intercepted') {
    const last = sortedCards(g, before).at(-1)!;
    await f.move(g, last.index, 'playCard', [last.card, before.G.level, before.G.epoch]);
  } else {
    for (let index = 0; index < g.seats.length; index++) await playLowest(f, g);
  }
  expect((await f.state(g.matchID)).G).toMatchObject({ status: 'finished', winner });
}

describe('Encrypted call HTTP and socket integration', () => {
  it.each([2, 3, 4])('starts with %i actual participants while spectators do not consume seats', async (count) => {
    const f = await fixture();
    const listing = await f.request('/api/games');
    expect(listing.body.games).toContainEqual({
      id: gameId, name: '加密通話', description: expect.any(String), minPlayers: 2, maxPlayers: 4,
    });
    const g = await group(f, count);
    const result = await start(f, g);
    expect(result).toMatchObject({ gameName: gameId, numPlayers: count, minPlayers: 2, maxPlayers: 4, spectatorCount: 1, status: 'syncing' });
    const raw = await f.state(g.matchID);
    expect(raw.ctx.numPlayers).toBe(count);
    expect(raw.G).toMatchObject({ level: 1, targetLevel: count === 2 ? 12 : count === 3 ? 10 : 8, cover: count, pulses: 1 });
    expect(Object.keys(raw.G.private)).toEqual(g.seats.map((seat) => seat.playerID));
    expect(Object.values(raw.G.private).every((hand) => hand.cards.length === 1)).toBe(true);
    await synchronize(f, g);
    for (let index = 0; index < count; index++) await playLowest(f, g);
    const cleared = await f.state(g.matchID);
    expect(cleared.G.status).toBe('intermission');
    expect(cleared.G.transmitted).toEqual([...cleared.G.transmitted].sort((a, b) => a - b));
    for (let index = 0; index < count; index++) await f.move(g, index, 'acknowledgeLevel', [cleared.G.level, cleared.G.epoch]);
    const next = await f.state(g.matchID);
    expect(next.G).toMatchObject({ status: 'syncing', level: 2 });
    expect(Object.values(next.G.private).every((hand) => hand.cards.length === 2)).toBe(true);
  });

  it('enforces readiness, host authority and 2–4 active players while allowing more waiting seats', async () => {
    const f = await fixture();
    const solo = await group(f, 1);
    expect((await f.request(path(solo.host, 'ready'), { ready: true }, solo.host)).status).toBe(200);
    expect((await f.request(path(solo.host, 'start'), {}, solo.host)).status).toBe(409);
    const full = await group(f, 4);
    const fifth = await f.request(path(full.host, 'join'), {
      inviteToken: token(full.host.inviteUrl, 'invite'), displayName: '第五位',
    });
    expect(fifth.status).toBe(200);
    expect((await f.request(path(full.host, 'start'), {}, full.host)).status).toBe(409);
    expect((await f.request(path(full.host, 'leave'), {}, fifth.body as unknown as Seat)).status).toBe(200);
    expect((await f.request(path(full.host, 'start'), {}, full.seats[1])).status).toBe(403);
    expect((await f.request('/api/rooms', { gameId, displayName: '指揮員', numPlayers: 2 })).status).toBe(400);
    expect((await start(f, full)).numPlayers).toBe(4);
  });

  it('plays with noncontiguous seats after the original host and a middle seat leave', async () => {
    const f = await fixture();
    const g = await group(f, 4);
    const originalHost = g.host;
    expect((await f.request(path(g.host, 'leave'), {}, g.seats[2])).status).toBe(200);
    expect((await f.request(path(g.host, 'leave'), {}, originalHost)).status).toBe(200);
    g.seats = [g.seats[1], g.seats[3]];
    g.host = { ...originalHost, ...g.seats[0] };
    const result = await start(f, g);
    expect(result).toMatchObject({ hostPlayerID: '1', numPlayers: 2 });
    const initial = await f.state(g.matchID);
    expect(initial.ctx.playOrder).toEqual(['1', '3']);
    expect(Object.keys(initial.ctx.activePlayers!)).toEqual(['1', '3']);
    expect(Object.keys(initial.G.players)).toEqual(['1', '3']);
    expect(Object.keys(initial.G.private)).toEqual(['1', '3']);
    await synchronize(f, g);
    await playLowest(f, g);
    expect((await playLowest(f, g)).G.status).toBe('intermission');
    expect((await f.request(path(g.host), undefined, originalHost)).status).toBe(401);
  });

  it('filters live state, initial state and reconnects; only authorized observers can switch perspective', async () => {
    const f = await fixture();
    const g = await group(f, 3);
    await start(f, g);
    await synchronize(f, g);
    await playLowest(f, g);
    const raw = await f.state(g.matchID);
    for (const [index, client] of g.clients.entries()) {
      const info = await f.sync(client, g, g.seats[index]);
      for (const state of [info.state, info.initialState]) {
        expect(Object.keys(state.G.private)).toEqual([g.seats[index].playerID]);
        expect(state._undo).toEqual([]);
        expect(state._redo).toEqual([]);
      }
      expect(info.state.G.private).toEqual({ [g.seats[index].playerID]: raw.G.private[g.seats[index].playerID] });
      expect(info.log?.length).toBeGreaterThan(0);
      for (const entry of info.log || []) {
        if (entry.action.payload.playerID !== g.seats[index].playerID) {
          expect(entry.action.payload.args).toBeNull();
        }
      }
      expectNoSecrets(info);
      for (const seat of g.seats) expect(JSON.stringify(info)).not.toContain(seat.credentials);
    }
    const reconnected = await f.connect();
    expect((await f.sync(reconnected, g, g.seats[1])).state.G.private).toEqual({ [g.seats[1].playerID]: raw.G.private[g.seats[1].playerID] });
    const blind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
    const god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
    expect(blind.status).toBe(200);
    expect(god.status).toBe(200);
    expect(blind.body.G.private).toEqual({});
    expect(god.body.G.private).toEqual(raw.G.private);
    for (const view of [blind, god]) {
      expect(Object.keys(view.body).sort()).toEqual(['G', 'perspective', 'stateID']);
      expectNoSecrets(view.body);
      expect(view.headers.get('cache-control')).toBe('no-store');
    }
    expect((await f.request(path(g.host, 'view?perspective=god'), undefined, g.host)).status).toBe(403);
    expect((await f.request(path(g.host, 'view?perspective=god'))).status).toBe(401);
    expect((await f.request(path(g.host, 'ready'), { ready: true }, g.observer)).status).toBe(401);
    expect((await f.request(path(g.host, 'replay'), undefined, g.observer)).status).toBe(409);
    const intruder = await f.connect();
    intruder.emit('sync', g.matchID, '0', g.observer.credentials, 3);
    intruder.emit('update', packet({ playerID: '0', credentials: g.observer.credentials }, 'playCard', [99, raw.G.level, raw.G.epoch]), raw._stateID, g.matchID, '0');
    await pause(100);
    expect(f.messages.get(intruder)).toEqual([]);
    expect(await f.state(g.matchID)).toEqual(raw);
  });

  it('accepts a valid transmission from an older state version within the same epoch', async () => {
    const f = await fixture();
    const g = await group(f, 3);
    await start(f, g);
    await synchronize(f, g);
    const before = await f.state(g.matchID);
    const [low, middle, high] = sortedCards(g, before);
    await f.move(g, low.index, 'playCard', [low.card, before.G.level, before.G.epoch]);
    // The middle sender has not received the first sender's update yet. Its
    // card/level/epoch is still valid and must not be discarded as a stale view.
    f.emitMove(g, middle.index, 'playCard', [middle.card, before.G.level, before.G.epoch], before._stateID);
    await vi.waitFor(async () => expect((await f.state(g.matchID)).G.transmitted).toEqual([low.card, middle.card]));
    const after = await f.state(g.matchID);
    expect(after._stateID).toBe(before._stateID + 2);
    expect(after.G).toMatchObject({ status: 'playing', cover: 3, epoch: before.G.epoch });
    expect(after.G.private[high.playerID].cards).toEqual([high.card]);
  });

  it('serializes simultaneous transmissions and rejects duplicated cards or commands from an old synchronization', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = await fixture();
    const g = await group(f, 3);
    await start(f, g);
    await synchronize(f, g);
    const before = await f.state(g.matchID);
    const [low, middle, high] = sortedCards(g, before);
    for (const entry of [low, middle]) {
      f.emitMove(g, entry.index, 'playCard', [entry.card, before.G.level, before.G.epoch], before._stateID);
    }
    await vi.waitFor(async () => expect((await f.state(g.matchID)).G.transmitted).toContain(middle.card));
    await pause(100);
    const after = await f.state(g.matchID);
    expect(after.G.private[low.playerID].cards).toEqual([]);
    expect(after.G.private[middle.playerID].cards).toEqual([]);
    expect(after.G.private[high.playerID].cards).toEqual([high.card]);
    // Either arrival order is valid. A lower card arriving after an error cannot
    // silently reappear, and two simultaneous packets cannot overwrite each other.
    if (after.G.status === 'playing') {
      expect(after.G.transmitted).toEqual([low.card, middle.card]);
      expect(after.G.cover).toBe(3);
      expect(after._stateID).toBe(before._stateID + 2);
    } else {
      expect(after.G.status).toBe('syncing');
      expect(after.G.transmitted).toEqual([middle.card]);
      expect(after.G.cover).toBe(2);
      expect(after._stateID).toBe(before._stateID + 1);
    }
    f.emitMove(g, low.index, 'playCard', [low.card, before.G.level, before.G.epoch], before._stateID);
    await pause(80);
    expect(await f.state(g.matchID)).toEqual(after);
    if (after.G.status === 'playing') await f.move(g, high.index, 'requestSync', [after.G.level, after.G.epoch]);
    const syncing = await f.state(g.matchID);
    await synchronize(f, g);
    const resumed = await f.state(g.matchID);
    expect(resumed.G.epoch).not.toBe(before.G.epoch);
    f.emitMove(g, high.index, 'playCard', [high.card, before.G.level, before.G.epoch], resumed._stateID);
    await pause(80);
    expect(await f.state(g.matchID)).toEqual(resumed);
    const valid = await f.move(g, high.index, 'playCard', [high.card, syncing.G.level, resumed.G.epoch]);
    expect(valid.G.status).toBe('intermission');
  });

  it.each(['agents', 'intercepted'] as const)('archives a %s result, reuses the room and preserves scoped replay shares across restart', async (winner) => {
    const f = await fixture();
    const g = await group(f);
    await start(f, g);
    await synchronize(f, g);
    await finalDecision(f, g, winner);
    const completedID = g.matchID;
    const completed = await f.state(completedID);
    const lobby = await f.request(path(g.host), undefined, g.host);
    expect(lobby.body).toMatchObject({ status: 'lobby', numPlayers: 2, spectatorCount: 1, hostPlayerID: g.host.playerID });
    expect(lobby.body.matchID).not.toBe(completedID);
    expect(lobby.body.players.every((player: any) => !player.ready)).toBe(true);
    expect(lobby.body.history).toEqual([expect.objectContaining({ matchID: completedID, ending: 'completed', winner, numPlayers: 2 })]);
    expect((await f.state(lobby.body.matchID)).G.private).toEqual({});
    const replay = await f.request(path(g.host, `replay?matchID=${completedID}&perspective=blind`), undefined, g.observer);
    expect(replay.status).toBe(200);
    expect(replay.body.complete).toBe(true);
    expect(replay.body.frames.at(-1).G.winner).toBe(winner);
    expect(replay.body.frames.every((frame: any) => Object.keys(frame.G.private).length === 0)).toBe(true);
    const god = await f.request(path(g.host, `replay?matchID=${completedID}&perspective=god`), undefined, g.host);
    expect(god.status).toBe(200);
    expect(Object.keys(god.body.frames[0].G.private)).toHaveLength(2);
    const share = await f.request(path(g.host, 'share'), {
      matchID: completedID, frameIndex: replay.body.frames.length - 1, perspective: 'blind',
    }, g.observer);
    expect(share.status).toBe(200);
    const shareHeaders = { 'X-Replay-Token': token(share.body.url, 'share') };
    const sharedPath = `/api/replays/${g.host.roomId}`;
    const shared = await f.request(`${sharedPath}?perspective=god&frameIndex=0`, undefined, undefined, shareHeaders);
    expect(shared.status).toBe(200);
    expect(shared.body).toMatchObject({ perspective: 'blind', frameIndex: replay.body.frames.length - 1 });
    expect(shared.body.frames).toEqual(replay.body.frames);
    expect(shared.body.room).toMatchObject({ gameName: gameId, matchID: completedID, history: [], hostPlayerID: null, spectatorCount: 0 });
    expectNoSecrets(shared.body);
    expect((await f.request(path(g.host), undefined, { ...g.host, credentials: shareHeaders['X-Replay-Token'] })).status).toBe(401);
    const stats = await f.request('/api/stats');
    expect(stats.body).toMatchObject({ completedGames: 1, totalPlayerParticipations: 2 });
    expect(stats.body.byGame.find((entry: any) => entry.gameId === gameId)).toMatchObject({
      completed: 1, wins: { [winner]: 1 }, byPlayerCount: [{ numPlayers: 2, completed: 1, wins: { [winner]: 1 } }],
    });
    await start(f, g);
    const newMatch = await f.state(g.matchID);
    expect((await f.request(sharedPath, undefined, undefined, shareHeaders)).body).toEqual(shared.body);
    await f.app.db.setState(completedID, { ...completed, _stateID: completed._stateID + 1 });
    expect(await f.state(completedID)).toEqual(completed);
    expect(await f.state(g.matchID)).toEqual(newMatch);
    await f.restart();
    expect((await f.request(sharedPath, undefined, undefined, shareHeaders)).body).toEqual(shared.body);
    expect((await f.request('/api/stats')).body).toEqual(stats.body);
    expect((await f.request(path(g.host), undefined, g.host)).body.matchID).toBe(g.matchID);
  }, 20000);

  it('keeps two encrypted-call groups and an existing station game isolated on the same server', async () => {
    const f = await fixture();
    const [first, second, station] = await Promise.all([group(f, 2), group(f, 3), group(f, 4, 'space-station')]);
    await Promise.all([first, second, station].map((g) => start(f, g)));
    await Promise.all([first, second].map((g) => synchronize(f, g)));
    const untouched = await Promise.all([second, station].map((g) => f.state(g.matchID)));
    expect((await f.request(path(first.host), undefined, second.host)).status).toBe(401);
    expect((await f.request(path(first.host, 'view?perspective=god'), undefined, station.observer)).status).toBe(401);
    expect((await f.request(path(first.host, 'join'), {
      inviteToken: token(station.host.inviteUrl, 'invite'), displayName: '跨遊戲',
    })).status).toBe(403);
    const wrongNamespace = await f.connect('space-station');
    wrongNamespace.emit('sync', first.matchID, first.host.playerID, first.host.credentials, 2);
    await pause(80);
    expect(f.messages.get(wrongNamespace)).toEqual([]);
    await finalDecision(f, first, 'intercepted');
    expect(await f.state(second.matchID)).toEqual(untouched[0]);
    expect(await f.state(station.matchID)).toEqual(untouched[1]);
    expect((await f.request(path(first.host), undefined, first.host)).body.status).toBe('lobby');
    expect((await f.request(path(second.host, 'replay'), undefined, second.host)).status).toBe(409);
    expect((await f.request(path(station.host, 'replay'), undefined, station.host)).status).toBe(409);
    const stats = (await f.request('/api/stats')).body;
    expect(stats.byGame.find((entry: any) => entry.gameId === gameId).completed).toBe(1);
    expect(stats.byGame.find((entry: any) => entry.gameId === 'space-station').completed).toBe(0);
    await playLowest(f, second);
    expect(await f.state(station.matchID)).toEqual(untouched[1]);
    for (const g of [first, second, station]) {
      for (const client of g.clients) expect(f.messages.get(client)!.every((matchID) => matchID === g.matchID)).toBe(true);
    }
  }, 20000);
});
