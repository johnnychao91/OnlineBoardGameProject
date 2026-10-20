import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StationState } from '../games/station/game';
import { createApplication, type AppConfig } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group {
  host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string;
  observerAdmission: { inviteToken: string; displayName: string; requestID: string };
}
type Snapshot = State<StationState>;
const origin = 'http://localhost:5173';
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const headers = (seat: Seat | Observer) => ({
  Authorization: `Bearer ${seat.credentials}`,
  ...('playerID' in seat ? { 'X-Player-ID': seat.playerID } : { 'X-Observer-ID': seat.observerID }),
});
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name: string) => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
const packet = (seat: Seat, type: string, args: unknown[] = []) => ({
  type: 'MAKE_MOVE', payload: { type, args, playerID: seat.playerID, credentials: seat.credentials },
});
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
function expectNoSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:seed|prngstate|unusedRoles|credentials|credentialHash|inviteHash|inviteToken|metadata)"\s*:/);
}

async function fixture(overrides: Partial<AppConfig> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-lifecycle-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-lifecycle-test-')) {
      throw new Error('Refusing cleanup outside this test temporary directory.');
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const config: AppConfig = {
    dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0,
    production: false, createRoomKey: '', ...overrides,
  };
  let app = await createApplication(config);
  let running: Awaited<ReturnType<typeof app.listen>> | undefined = await app.listen();
  const sockets: Socket[] = [];
  const views = new Map<Socket, Snapshot>();
  const events = new Map<Socket, { matchID: string; event: string }[]>();
  cleanups.push(async () => {
    for (const socket of sockets) socket.disconnect();
    await running?.close();
  });
  const baseURL = () => {
    if (!running) throw new Error('Test server is stopped');
    return `http://127.0.0.1:${running.port}`;
  };
  const request = async (url: string, body?: unknown, auth?: Seat | Observer, extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(baseURL() + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? headers(auth) : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const connect = async () => {
    const socket = io(`${baseURL()}/space-station`, {
      transports: ['websocket'], forceNew: true, reconnection: false,
      extraHeaders: { Origin: origin }, autoConnect: false,
    });
    sockets.push(socket);
    events.set(socket, []);
    socket.on('error', () => {});
    socket.on('sync', (matchID: string, info: SyncInfo) => {
      events.get(socket)!.push({ matchID, event: 'sync' });
      views.set(socket, info.state as Snapshot);
    });
    socket.on('update', (matchID: string, state: Snapshot) => {
      events.get(socket)!.push({ matchID, event: 'update' });
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
  const sync = async (socket: Socket, matchID: string, seat: Seat, count = 4) => {
    const result = new Promise<SyncInfo>((ok, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Authorized sync timed out: ${matchID}/${seat.playerID}`)), 3000);
      socket.once('sync', (_id: string, info: SyncInfo) => { clearTimeout(timeout); ok(info); });
    });
    socket.emit('sync', matchID, seat.playerID, seat.credentials, count);
    return result;
  };
  const state = async (matchID: string) => (await app.db.fetch(matchID, { state: true })).state! as Snapshot;
  const move = async (group: Group, index: number, type: string, args: unknown[] = []) => {
    const before = await state(group.matchID);
    const seat = group.seats[index];
    group.clients[index].emit('update', packet(seat, type, args), before._stateID, group.matchID, seat.playerID);
    await vi.waitFor(async () => expect((await state(group.matchID))._stateID).toBeGreaterThan(before._stateID), { timeout: 4000 });
    return state(group.matchID);
  };
  return {
    get app() { return app; }, request, connect, sync, state, move, views, events,
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

async function group(f: Fixture, count = 4): Promise<Group> {
  const created = await f.request('/api/rooms', { gameId: 'space-station', displayName: '站長' });
  expect(created.status).toBe(201);
  const host = created.body as unknown as Room;
  const seats: Seat[] = [host];
  for (let index = 1; index < count; index++) {
    const joined = await f.request(path(host, 'join'), {
      inviteToken: token(host.inviteUrl, 'invite'), displayName: `隊員 ${index}`, requestID: randomUUID(),
    });
    expect(joined.status).toBe(200);
    seats.push(joined.body as unknown as Seat);
  }
  const observerAdmission = {
    inviteToken: token(host.inviteUrl, 'invite'), displayName: '觀眾', requestID: randomUUID(),
  };
  const watching = await f.request(path(host, 'watch'), observerAdmission);
  expect(watching.status).toBe(200);
  return { host, seats, observer: watching.body as unknown as Observer, observerAdmission, clients: [], matchID: host.matchID };
}

async function start(f: Fixture, group: Group) {
  for (const seat of group.seats) {
    expect((await f.request(path(group.host, 'ready'), { ready: true }, seat)).status).toBe(200);
  }
  const started = await f.request(path(group.host, 'start'), {}, group.host);
  expect(started.status).toBe(200);
  group.matchID = started.body.matchID;
  group.clients = await Promise.all(group.seats.map(() => f.connect()));
  await Promise.all(group.clients.map((client, index) => f.sync(client, group.matchID, group.seats[index], group.seats.length)));
  for (let index = 0; index < group.seats.length; index++) await f.move(group, index, 'acknowledge');
  for (let index = 0; index < group.seats.length; index++) await f.move(group, index, 'declareRepairs', [0, 1]);
  expect((await f.state(group.matchID)).G.status).toBe('playing');
}

async function revealKind(f: Fixture, group: Group, kind: 'stable' | 'hazard') {
  const before = await f.state(group.matchID);
  const actorIndex = group.seats.findIndex((seat) => seat.playerID === before.G.activePlayer);
  const target = Object.entries(before.G.secret!.cards).flatMap(([targetID, cards]) =>
    targetID === before.G.activePlayer ? [] : cards.flatMap((card, slot) =>
      card === kind && before.G.publicCards![targetID][slot] === null ? [{ targetID, slot }] : []))[0];
  if (!target) throw new Error(`No eligible ${kind} card`);
  const selected = await f.move(group, actorIndex, 'selectCard', [target.targetID, target.slot]);
  return f.move(group, actorIndex, 'reveal', [target.targetID, target.slot, selected.G.pendingReveal!.selectionID]);
}

async function finish(f: Fixture, group: Group) {
  const before = await f.state(group.matchID);
  // A current operator cannot inspect their own module. Pass the operator to
  // another participant first if the shutdown module is in their own hand.
  if (before.G.secret!.cards[before.G.activePlayer!].includes('hazard')) await revealKind(f, group, 'stable');
  const result = await revealKind(f, group, 'hazard');
  expect(result.G).toMatchObject({ status: 'finished', winner: 'saboteur' });
  const held = await f.request(path(group.host), undefined, group.host);
  expect(held.body).toMatchObject({ status: 'finished', matchID: group.matchID });
  expect(held.body.completedDisplayUntil).toBeGreaterThan(Date.now());
  // This suite exercises the later room lifecycle. The dedicated round-review
  // tests cover the actual display deadline, restart and early-return guard.
  const room = f.app.rooms.rooms.get(group.host.roomId)!;
  await f.app.rooms.save({ ...room, completedDisplay: { matchID: group.matchID, until: Date.now() - 1 } });
  return result;
}

describe('Reusable rooms and match lifecycle', () => {
  it('keeps the invitation, seats and observers while archiving two games independently across a restart', async () => {
    const f = await fixture();
    const g = await group(f);
    await start(f, g);
    const firstID = g.matchID;
    const firstResult = await finish(f, g);
    const lobby = await f.request(path(g.host), undefined, g.host);
    expect(lobby.status).toBe(200);
    expect(lobby.body).toMatchObject({ roomId: g.host.roomId, status: 'lobby', numPlayers: 4, spectatorCount: 1, hostPlayerID: '0' });
    expect(lobby.body.matchID).not.toBe(firstID);
    expect(lobby.body.players.map((player: any) => player.ready)).toEqual([false, false, false, false]);
    expect(lobby.body.history).toHaveLength(1);
    expect(lobby.body.history[0]).toMatchObject({ matchID: firstID, ending: 'completed', numPlayers: 4, winner: 'saboteur' });
    expectNoSecrets(lobby.body);
    const nextLobbyID = lobby.body.matchID;
    expect((await f.state(nextLobbyID)).G.private).toEqual({});
    expect((await f.state(nextLobbyID)).G.secret).toBeUndefined();
    for (const seat of g.seats) {
      expect((await f.request(path(g.host), undefined, seat)).body.matchID).toBe(nextLobbyID);
    }
    expect((await f.request(path(g.host), undefined, g.observer)).body.matchID).toBe(nextLobbyID);
    expect((await f.request(path(g.host, 'start'), {}, g.host)).status).toBe(409);

    const replayPath = path(g.host, `replay?matchID=${firstID}&perspective=blind`);
    const firstReplay = await f.request(replayPath, undefined, g.host);
    expect(firstReplay.status).toBe(200);
    expect(firstReplay.body.frames.at(-1).G.log).toEqual(firstResult.G.log);
    expectNoSecrets(firstReplay.body);
    const shared = await f.request(path(g.host, 'share'), {
      matchID: firstID, frameIndex: firstReplay.body.frames.length - 1, perspective: 'blind',
    }, g.observer);
    expect(shared.status).toBe(200);
    const shareHeaders = { 'X-Replay-Token': token(shared.body.url, 'share') };
    const sharedRoute = `/api/replays/${g.host.roomId}`;
    // A share issued before reusable rooms had no matchID. Its fallback must
    // always remain the original room-ID match, never the newest game.
    const storedRoom = f.app.rooms.rooms.get(g.host.roomId)!;
    await f.app.rooms.save({ ...storedRoom, replayShares: storedRoom.replayShares!.map((entry) => {
      const { matchID: _legacyMatchID, ...legacy } = entry;
      return legacy;
    }) });
    const sharedFirst = await f.request(sharedRoute, undefined, undefined, shareHeaders);
    expect(sharedFirst.status).toBe(200);
    expect(sharedFirst.body.frames).toEqual(firstReplay.body.frames);
    expect(sharedFirst.body.room.players).toHaveLength(4);
    expect(sharedFirst.body.room).toMatchObject({
      matchID: firstID, history: [], hostPlayerID: null, spectatorCount: 0,
    });
    for (const player of sharedFirst.body.room.players) {
      expect(player).toMatchObject({ ready: false, isConnected: false });
      expect(player.membershipID).toBeUndefined();
      expect(player.departed).toBeUndefined();
    }

    await vi.waitFor(() => g.clients.forEach((client) => expect(client.connected).toBe(false)));
    const oldSubscriber = await f.connect();
    oldSubscriber.emit('sync', firstID, g.host.playerID, g.host.credentials, 4);
    await pause(80);
    expect(f.events.get(oldSubscriber)).toEqual([]);
    expect((await f.state(firstID)).G).toEqual(firstResult.G);

    await start(f, g);
    expect(g.matchID).toBe(nextLobbyID);
    const secondInitial = await f.state(g.matchID);
    g.clients[0].emit('update', packet(g.host, 'declareRepairs', [5, 1]),
      firstResult._stateID, firstID, g.host.playerID);
    await pause(80);
    expect(await f.state(g.matchID)).toEqual(secondInitial);
    const sharedDuringSecond = await f.request(sharedRoute, undefined, undefined, shareHeaders);
    expect(sharedDuringSecond.body.frames).toEqual(firstReplay.body.frames);
    expect(sharedDuringSecond.body.room).toEqual(sharedFirst.body.room);
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);

    const secondID = g.matchID;
    await finish(f, g);
    const secondLobby = await f.request(path(g.host), undefined, g.host);
    expect(secondLobby.body.status).toBe('lobby');
    expect(secondLobby.body.matchID).not.toBe(secondID);
    expect(new Set(secondLobby.body.history.map((entry: any) => entry.matchID))).toEqual(new Set([firstID, secondID]));
    const secondReplay = await f.request(path(g.host, `replay?matchID=${secondID}`), undefined, g.host);
    expect(secondReplay.status).toBe(200);
    const secondShare = await f.request(path(g.host, 'share'), {
      matchID: secondID, frameIndex: 0, perspective: 'blind',
    }, g.host);
    expect(secondShare.status).toBe(200);
    const secondShareHeaders = { 'X-Replay-Token': token(secondShare.body.url, 'share') };
    const sharedSecond = await f.request(sharedRoute, undefined, undefined, secondShareHeaders);
    expect(sharedSecond.body.room.matchID).toBe(secondID);
    expect(sharedSecond.body.frames).toEqual(secondReplay.body.frames);
    const stats = await f.request('/api/stats');
    expect(stats.body).toMatchObject({
      completedGames: 2, totalPlayerParticipations: 8,
    });
    expect(stats.body.byGame.find((game: any) => game.gameId === 'space-station')).toMatchObject({
      completed: 2, wins: { saboteur: 2 }, byPlayerCount: [{ numPlayers: 4, completed: 2 }],
    });
    await f.restart();
    expect((await f.request(path(g.host), undefined, g.host)).body.matchID).toBe(secondLobby.body.matchID);
    expect((await f.request('/api/stats')).body).toEqual(stats.body);
    const sharedAfterRestart = await f.request(sharedRoute, undefined, undefined, shareHeaders);
    expect(sharedAfterRestart.body.frames).toEqual(firstReplay.body.frames);
    expect(sharedAfterRestart.body.room).toEqual(sharedFirst.body.room);
    expect((await f.request(sharedRoute, undefined, undefined, secondShareHeaders)).body.frames).toEqual(secondReplay.body.frames);
    expect((await f.request(replayPath, undefined, g.observer)).body.frames).toEqual(firstReplay.body.frames);
    const freshGuest = await f.request(path(g.host, 'join'), {
      inviteToken: token(g.host.inviteUrl, 'invite'), displayName: '下一局加入的朋友', requestID: randomUUID(),
    });
    expect(freshGuest.status).toBe(200);
    expect(freshGuest.body.numPlayers).toBe(5);
    expect((await f.request(replayPath, undefined, freshGuest.body as unknown as Seat)).status).toBe(200);
    expect((await f.request(replayPath)).status).toBe(401);
    const unrelated = await group(f);
    expect([403, 404]).toContain((await f.request(
      path(unrelated.host, `replay?matchID=${firstID}`), undefined, unrelated.host,
    )).status);
    expect((await f.request(`/api/replays/${unrelated.host.roomId}`, undefined, undefined, shareHeaders)).status).toBe(403);
  }, 20000);

  it('allows only the current host to end the expected active game, without counting a win or changing another room', async () => {
    const f = await fixture();
    const [g, other] = await Promise.all([group(f), group(f)]);
    await Promise.all([start(f, g), start(f, other)]);
    const activeID = g.matchID;
    const otherState = await f.state(other.matchID);
    expect((await f.request(path(g.host, 'abort'), { matchID: activeID }, g.seats[1])).status).toBe(403);
    expect((await f.request(path(g.host, 'abort'), { matchID: activeID }, g.observer)).status).toBe(403);
    expect((await f.request(path(g.host, 'abort'), { matchID: activeID }, other.host)).status).toBe(401);
    expect((await f.request(path(g.host, 'abort'), { matchID: other.matchID }, g.host)).status).toBe(409);
    expect((await f.request(path(g.host, 'return'), { matchID: activeID }, g.host)).status).toBe(409);
    const attempts = await Promise.all([
      f.request(path(g.host, 'abort'), { matchID: activeID }, g.host),
      f.request(path(g.host, 'abort'), { matchID: activeID }, g.host),
    ]);
    expect(attempts.some((response) => response.status === 200)).toBe(true);
    expect(attempts.every((response) => [200, 409].includes(response.status))).toBe(true);
    const lobby = await f.request(path(g.host), undefined, g.host);
    expect(lobby.body.status).toBe('lobby');
    expect(lobby.body.matchID).not.toBe(activeID);
    expect(lobby.body.history).toHaveLength(1);
    expect(lobby.body.history[0]).toMatchObject({ matchID: activeID, ending: 'host-ended' });
    expect(lobby.body.history[0].winner).toBeUndefined();
    expect(lobby.body.players.every((player: any) => !player.ready)).toBe(true);
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
    expect((await f.request(path(g.host, `replay?matchID=${activeID}`), undefined, g.host)).status).toBe(409);
    expect((await f.request(path(g.host, 'share'), { matchID: activeID, frameIndex: 0 }, g.host)).status).toBe(409);
    expect(await f.state(other.matchID)).toEqual(otherState);

    await start(f, g);
    const replacementID = g.matchID;
    const replacement = await f.state(replacementID);
    expect((await f.request(path(g.host, 'abort'), { matchID: activeID }, g.host)).status).toBe(409);
    expect(await f.state(replacementID)).toEqual(replacement);
    const foreignReplay = await f.request(path(other.host, `replay?matchID=${activeID}`), undefined, other.host);
    expect([403, 404]).toContain(foreignReplay.status);
    expect(await f.state(other.matchID)).toEqual(otherState);
  }, 20000);

  it('transfers host authority when the host leaves and permanently revokes the departed membership', async () => {
    const f = await fixture();
    const g = await group(f, 5);
    const oldHostTabs = await Promise.all([f.connect(), f.connect()]);
    await Promise.all(oldHostTabs.map((client) => f.sync(client, g.matchID, g.host)));
    const departed = await f.request(path(g.host, 'leave'), {}, g.host);
    expect(departed.status).toBe(200);
    await vi.waitFor(() => oldHostTabs.forEach((client) => expect(client.connected).toBe(false)));
    const nextHost = g.seats[1];
    const lobby = await f.request(path(g.host), undefined, nextHost);
    expect(lobby.body.hostPlayerID).toBe(nextHost.playerID);
    expect(lobby.body.numPlayers).toBe(4);
    expect(lobby.body.players.some((player: any) => player.id === g.host.playerID)).toBe(false);
    for (const operation of ['', 'invite', 'ready', 'leave']) {
      expect((await f.request(path(g.host, operation), operation ? { ready: true } : undefined, g.host)).status).toBe(401);
    }
    expect((await f.request(path(g.host, 'invite'), {}, g.seats[2])).status).toBe(403);
    const rotated = await f.request(path(g.host, 'invite'), {}, nextHost);
    expect(rotated.status).toBe(200);
    const continuing: Group = { ...g, host: { ...g.host, ...nextHost }, seats: g.seats.slice(1) };
    await start(f, continuing);
    expect((await f.state(continuing.matchID)).ctx.playOrder).toEqual(['1', '2', '3', '4']);
    expect(['1', '2', '3', '4']).toContain((await f.state(continuing.matchID)).G.activePlayer);
    expect((await f.request(path(g.host, 'abort'), { matchID: continuing.matchID }, nextHost)).status).toBe(200);
    g.matchID = (await f.request(path(g.host), undefined, nextHost)).body.matchID;
    const rejoinAdmission = {
      inviteToken: token(rotated.body.inviteUrl, 'invite'), displayName: '重新入座的原站長', requestID: randomUUID(),
    };
    const rejoined = await f.request(path(g.host, 'join'), rejoinAdmission);
    expect(rejoined.status).toBe(200);
    expect(rejoined.body.playerID).toBe('0');
    expect(rejoined.body.credentials).not.toBe(g.host.credentials);
    expect(rejoined.body.hostPlayerID).toBe(nextHost.playerID);
    expect((await f.request(path(g.host, 'invite'), {}, rejoined.body as unknown as Seat)).status).toBe(403);
    const unauthorized = await f.connect();
    unauthorized.emit('sync', g.matchID, g.host.playerID, g.host.credentials, 4);
    await pause(80);
    expect(f.events.get(unauthorized)).toEqual([]);
    expect((await f.request(path(g.host, 'leave'), {}, rejoined.body as unknown as Seat)).status).toBe(200);
    expect((await f.request(path(g.host, 'join'), rejoinAdmission)).status).toBe(403);
    await f.restart();
    expect((await f.request(path(g.host, 'join'), rejoinAdmission)).status).toBe(403);
    expect((await f.request(path(g.host), undefined, g.host)).status).toBe(401);
    expect((await f.request(path(g.host), undefined, nextHost)).body.hostPlayerID).toBe(nextHost.playerID);
  }, 10000);

  it('keeps a game alive while any tab is connected and allows reconnection within the disconnect grace', async () => {
    const f = await fixture({ presenceLeaseMs: 350, lifecycleSweepMs: 25 });
    const g = await group(f);
    await start(f, g);
    const activeID = g.matchID;
    const secondTab = await f.connect();
    await f.sync(secondTab, activeID, g.host);
    g.clients.forEach((client) => client.disconnect());
    await pause(750);
    expect((await f.request(path(g.host), undefined, g.host)).body).toMatchObject({ matchID: activeID, status: 'playing' });
    expect((await f.state(activeID)).G.status).toBe('playing');
    secondTab.disconnect();
    await pause(90);
    const refreshedTab = await f.connect();
    await f.sync(refreshedTab, activeID, g.host);
    await pause(450);
    expect((await f.request(path(g.host), undefined, g.host)).body.matchID).toBe(activeID);
    refreshedTab.disconnect();
    await vi.waitFor(async () => {
      const info = await f.request(path(g.host), undefined, g.host);
      expect(info.body.status).toBe('lobby');
      expect(info.body.matchID).not.toBe(activeID);
      expect(info.body.history).toContainEqual(expect.objectContaining({ matchID: activeID, ending: 'empty' }));
    }, { timeout: 3000, interval: 40 });
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  }, 10000);

  it('counts observers as presence and gives every persisted active room a fresh reconnect grace after restart', async () => {
    const f = await fixture({ presenceLeaseMs: 350, lifecycleSweepMs: 25 });
    const g = await group(f);
    await start(f, g);
    const activeID = g.matchID;
    g.clients.forEach((client) => client.disconnect());
    const sessionID = randomUUID();
    for (let beat = 0; beat < 8; beat++) {
      expect((await f.request(path(g.host, 'heartbeat'), { sessionID }, g.observer)).status).toBe(200);
      await pause(80);
    }
    expect((await f.request(path(g.host), undefined, g.observer)).body).toMatchObject({ matchID: activeID, status: 'playing' });
    expect((await f.request(path(g.host, 'heartbeat'), { sessionID: randomUUID() }, {
      observerID: g.observer.observerID, credentials: g.host.credentials,
    })).status).toBe(401);
    await f.restart();
    await pause(100);
    expect((await f.request(path(g.host), undefined, g.observer)).body.matchID).toBe(activeID);
    const connected = await f.connect();
    await f.sync(connected, activeID, g.host);
    await pause(450);
    expect((await f.request(path(g.host), undefined, g.host)).body.matchID).toBe(activeID);
    connected.disconnect();
    await vi.waitFor(async () => {
      const info = await f.request(path(g.host), undefined, g.host);
      expect(info.body.history).toContainEqual(expect.objectContaining({ matchID: activeID, ending: 'empty' }));
      expect(info.body.status).toBe('lobby');
    }, { timeout: 3000, interval: 40 });
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  }, 10000);

  it('revokes explicit player and observer departures, and ends immediately when the final observer leaves', async () => {
    const f = await fixture({ presenceLeaseMs: 30000, lifecycleSweepMs: 25 });
    const g = await group(f);
    await start(f, g);
    const activeID = g.matchID;
    for (const seat of g.seats) {
      expect((await f.request(path(g.host, 'leave'), {}, seat)).status).toBe(200);
      expect((await f.request(path(g.host), undefined, seat)).status).toBe(401);
      expect((await f.request(path(g.host, 'heartbeat'), { sessionID: randomUUID() }, seat)).status).toBe(401);
      const revokedSocket = await f.connect();
      revokedSocket.emit('sync', activeID, seat.playerID, seat.credentials, 4);
      await pause(40);
      expect(f.events.get(revokedSocket)).toEqual([]);
    }
    expect((await f.request(path(g.host), undefined, g.observer)).body).toMatchObject({
      matchID: activeID, status: 'playing', hostPlayerID: null,
    });
    expect((await f.request(path(g.host, 'leave'), {}, g.observer)).status).toBe(200);
    await vi.waitFor(() => {
      const record = f.app.rooms.rooms.get(g.host.roomId)!;
      expect(record.history).toContainEqual(expect.objectContaining({ matchID: activeID, ending: 'empty' }));
      expect(record.currentMatchID).not.toBe(activeID);
    }, { timeout: 2000, interval: 25 });
    expect((await f.request(path(g.host), undefined, g.observer)).status).toBe(401);
    expect((await f.request(path(g.host, 'watch'), g.observerAdmission)).status).toBe(403);
    await f.restart();
    expect((await f.request(path(g.host, 'watch'), g.observerAdmission)).status).toBe(403);
    const replacement = await f.request(path(g.host, 'join'), {
      inviteToken: token(g.host.inviteUrl, 'invite'), displayName: '再次相約', requestID: randomUUID(),
    });
    expect(replacement.status).toBe(200);
    expect(replacement.body).toMatchObject({ numPlayers: 1, status: 'lobby', hostPlayerID: '0' });
    expect(replacement.body.credentials).not.toBe(g.host.credentials);
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  }, 10000);

  it('does not treat a public replay recipient as a live room member during a later game', async () => {
    const f = await fixture({ presenceLeaseMs: 350, lifecycleSweepMs: 25 });
    const g = await group(f);
    await start(f, g);
    const completedID = g.matchID;
    await finish(f, g);
    await f.request(path(g.host), undefined, g.host);
    const replay = await f.request(path(g.host, `replay?matchID=${completedID}`), undefined, g.host);
    expect(replay.status).toBe(200);
    const shared = await f.request(path(g.host, 'share'), {
      matchID: completedID, frameIndex: replay.body.frames.length - 1, perspective: 'blind',
    }, g.host);
    expect(shared.status).toBe(200);
    const shareHeaders = { 'X-Replay-Token': token(shared.body.url, 'share') };
    await start(f, g);
    const activeID = g.matchID;
    g.clients.forEach((client) => client.disconnect());
    for (let visit = 0; visit < 12; visit++) {
      const publicReplay = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, shareHeaders);
      expect(publicReplay.status).toBe(200);
      expect(publicReplay.body.frames).toEqual(replay.body.frames);
      await pause(80);
    }
    const lobby = await f.request(path(g.host), undefined, g.host);
    expect(lobby.body.status).toBe('lobby');
    expect(lobby.body.history).toContainEqual(expect.objectContaining({ matchID: activeID, ending: 'empty' }));
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);
  }, 10000);

  it('rechecks a queued player operation after that membership has left the still-active game', async () => {
    const f = await fixture();
    const g = await group(f);
    await start(f, g);
    const before = await f.state(g.matchID);
    const actorIndex = g.seats.findIndex((seat) => seat.playerID === before.G.activePlayer);
    const actor = g.seats[actorIndex];
    const target = g.seats.find((seat) => seat.playerID !== actor.playerID)!;
    const queue = f.app.server.transport.getMatchQueue(g.matchID);
    let release!: () => void;
    let blocked!: () => void;
    const entered = new Promise<void>((ok) => { blocked = ok; });
    const gate = new Promise<void>((ok) => { release = ok; });
    const waiting = queue.add(async () => { blocked(); await gate; });
    await entered;
    const leaving = f.request(path(g.host, 'leave'), {}, actor);
    try {
      await vi.waitFor(() => expect(queue.size).toBe(1));
      g.clients[actorIndex].emit('update', packet(actor, 'selectCard', [target.playerID, 0]),
        before._stateID, g.matchID, actor.playerID);
      await vi.waitFor(() => expect(queue.size).toBe(2));
    } finally {
      release();
      await waiting;
    }
    expect((await leaving).status).toBe(200);
    await queue.onIdle();
    expect((await f.state(g.matchID)).G.pendingReveal).toBeNull();
    expect((await f.state(g.matchID)).G.log).toEqual(before.G.log);
    expect((await f.request(path(g.host), undefined, g.seats.find((seat) => seat.playerID !== actor.playerID)!)).body.status).toBe('playing');
    expect((await f.request(path(g.host), undefined, actor)).status).toBe(401);
  }, 10000);
});
