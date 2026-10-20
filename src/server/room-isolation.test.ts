import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardKind, StationState } from '../games/station/game';
import { createApplication, type AppConfig } from './app';

interface Seat { playerID: string; credentials: string }
interface Room extends Seat { roomId: string; inviteUrl: string }
interface Observer { observerID: string; credentials: string }
interface Group {
  host: Room;
  seats: Seat[];
  observer: Observer;
  clients: Socket[];
}
type Snapshot = State<StationState>;
const origin = 'http://localhost:5173';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const seatHeaders = (seat: Seat) => ({
  Authorization: `Bearer ${seat.credentials}`, 'X-Player-ID': seat.playerID,
});
const observerHeaders = (observer: Observer) => ({
  Authorization: `Bearer ${observer.credentials}`, 'X-Observer-ID': observer.observerID,
});
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name: string) => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
const packet = (seat: Seat, type: string, args: unknown[] = []) => ({
  type: 'MAKE_MOVE', payload: { type, args, playerID: seat.playerID, credentials: seat.credentials },
});
function expectNoSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:seed|prngstate|unusedRoles|credentials|credentialHash|inviteHash|inviteToken|metadata)"\s*:/);
}

/** One real server and data directory, shared by all three groups throughout. */
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-isolation-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-isolation-test-')) {
      throw new Error('Refusing cleanup outside this test temporary directory.');
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const config: AppConfig = {
    dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false, createRoomKey: '',
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
  const request = async (url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(baseURL() + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
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
    messages.set(socket, []);
    socket.on('error', () => {});
    socket.on('sync', (roomID: string, info: SyncInfo) => {
      messages.get(socket)!.push(roomID);
      views.set(socket, info.state as Snapshot);
    });
    socket.on('update', (roomID: string, state: Snapshot) => {
      messages.get(socket)!.push(roomID);
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
  const sync = async (socket: Socket, room: Room, seat: Seat, count: number) => {
    const pending = new Promise<SyncInfo>((ok, reject) => {
      const timeout = setTimeout(() => reject(new Error('Authorized sync timed out')), 3000);
      socket.once('sync', (_roomID: string, info: SyncInfo) => { clearTimeout(timeout); ok(info); });
    });
    socket.emit('sync', room.roomId, seat.playerID, seat.credentials, count);
    return pending;
  };
  const state = async (room: Room) => (await app.db.fetch(room.roomId, { state: true })).state! as Snapshot;
  const move = async (group: Group, seatIndex: number, type: string, args: unknown[] = []) => {
    const socket = group.clients[seatIndex];
    const previousID = views.get(socket)!._stateID;
    socket.emit('update', packet(group.seats[seatIndex], type, args), previousID,
      group.host.roomId, group.seats[seatIndex].playerID);
    await vi.waitFor(() => {
      for (const client of group.clients) expect(views.get(client)!._stateID).toBeGreaterThan(previousID);
    }, { timeout: 4000 });
    return state(group.host);
  };
  return {
    get app() { return app; }, views, messages, request, connect, sync, state, move,
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

async function connectGroup(f: Fixture, group: Group) {
  group.clients = await Promise.all(group.seats.map(() => f.connect()));
  await Promise.all(group.clients.map((client, index) =>
    f.sync(client, group.host, group.seats[index], group.seats.length)));
}
async function movesFromEveryone(f: Fixture, group: Group, move: string, args: unknown[] = []) {
  // Per-room actions stay ordered; the three rooms execute this concurrently.
  for (let index = 0; index < group.seats.length; index++) await f.move(group, index, move, args);
}
function findCard(state: Snapshot, kind: CardKind, excluded: string[] = []) {
  for (const [targetID, cards] of Object.entries(state.G.secret!.cards)) {
    if (targetID === state.G.activePlayer || excluded.includes(targetID)) continue;
    const slot = cards.findIndex((card, index) => card === kind && state.G.publicCards![targetID][index] === null);
    if (slot >= 0) return { targetID, slot };
  }
  throw new Error(`No eligible ${kind} card`);
}
async function select(f: Fixture, group: Group, kind: CardKind, excluded: string[] = []) {
  const before = await f.state(group.host);
  const actor = group.seats.findIndex((seat) => seat.playerID === before.G.activePlayer);
  const chosen = findCard(before, kind, excluded);
  const selected = await f.move(group, actor, 'selectCard', [chosen.targetID, chosen.slot]);
  expect(selected.G.log).toEqual(before.G.log);
  expect(selected.G.publicCards).toEqual(before.G.publicCards);
  expect(selected.G.pendingReveal).toMatchObject({
    actorID: before.G.activePlayer, targetID: chosen.targetID, slot: chosen.slot, round: before.G.round,
  });
  expect(selected.G.pendingReveal).not.toHaveProperty('kind');
  return selected.G.pendingReveal!;
}
async function revealSelected(f: Fixture, group: Group) {
  const before = await f.state(group.host);
  const pending = before.G.pendingReveal!;
  const actor = group.seats.findIndex((seat) => seat.playerID === pending.actorID);
  return f.move(group, actor, 'reveal', [pending.targetID, pending.slot, pending.selectionID]);
}

describe('三組朋友同時遊玩，各房狀態、權限與回放互相隔離', () => {
  it('同一伺服器的 4／5／6 人房可交錯宣稱、預選、翻牌與重連，單局結束不影響其他房', async () => {
    const f = await fixture();
    const groups: Group[] = await Promise.all([4, 5, 6].map(async (count, index) => {
      const created = await f.request('/api/rooms', { gameId: 'space-station', displayName: `第 ${index + 1} 組房主` });
      expect(created.status).toBe(201);
      const host = created.body as unknown as Room;
      const joined = await Promise.all(Array.from({ length: count - 1 }, (_, seatIndex) =>
        f.request(path(host, 'join'), {
          inviteToken: token(host.inviteUrl, 'invite'), displayName: `第 ${index + 1} 組朋友 ${seatIndex}`,
          requestID: randomUUID(),
        })));
      joined.forEach((result) => expect(result.status).toBe(200));
      const seats = [host, ...joined.map((result) => result.body as unknown as Seat)]
        .sort((a, b) => Number(a.playerID) - Number(b.playerID));
      const observer = await f.request(path(host, 'watch'), {
        inviteToken: token(host.inviteUrl, 'invite'), displayName: `第 ${index + 1} 組觀眾`,
      });
      expect(observer.status).toBe(200);
      expect(observer.body.numPlayers).toBe(count);
      return { host, seats, observer: observer.body as unknown as Observer, clients: [] };
    }));
    expect(new Set(groups.map((group) => group.host.roomId)).size).toBe(3);
    expect(new Set(groups.flatMap((group) => group.seats.map((seat) => seat.credentials))).size).toBe(15);
    expect(new Set(groups.map((group) => f.app.server.transport.getMatchQueue(group.host.roomId))).size).toBe(3);
    const lobbyStates = await Promise.all(groups.map((group) => f.state(group.host)));
    expect(new Set(lobbyStates.map((snapshot) => snapshot.plugins.random.data.seed)).size).toBe(3);

    // A valid invitation or credential from another room must fail even when
    // the requested numeric seat exists in both rooms.
    await Promise.all(groups.map(async (group, index) => {
      const foreign = groups[(index + 1) % groups.length];
      expect((await f.request(path(group.host, 'join'), {
        inviteToken: token(foreign.host.inviteUrl, 'invite'), displayName: '跨房玩家',
      })).status).toBe(403);
      expect((await f.request(path(group.host, 'watch'), {
        inviteToken: token(foreign.host.inviteUrl, 'invite'), displayName: '跨房觀眾',
      })).status).toBe(403);
      expect((await f.request(path(group.host), undefined, seatHeaders(foreign.host))).status).toBe(401);
      expect((await f.request(path(group.host, 'ready'), { ready: true }, seatHeaders(foreign.host))).status).toBe(401);
      expect((await f.request(path(group.host), undefined, observerHeaders(foreign.observer))).status).toBe(401);
      expect((await f.state(group.host)).G).toEqual(lobbyStates[index].G);
    }));
    await Promise.all(groups.map(async (group) => {
      const ready = await Promise.all(group.seats.map((seat) =>
        f.request(path(group.host, 'ready'), { ready: true }, seatHeaders(seat))));
      ready.forEach((result) => expect(result.status).toBe(200));
      const started = await f.request(path(group.host, 'start'), {}, seatHeaders(group.host));
      expect(started.status).toBe(200);
      expect(started.body).toMatchObject({
        status: 'briefing', numPlayers: group.seats.length, spectatorCount: 1,
      });
      await connectGroup(f, group);
    }));
    for (const group of groups) {
      const raw = await f.state(group.host);
      for (const [index, client] of group.clients.entries()) {
        const view = f.views.get(client)!;
        expect(view.G.private).toEqual({ [group.seats[index].playerID]: raw.G.private[group.seats[index].playerID] });
        expect(view.G.secret).toBeUndefined();
        expect(Object.values(view.G.publicCards!)).toEqual(group.seats.map(() => Array(5).fill(null)));
        expectNoSecrets(view);
      }
      const foreign = groups.find((entry) => entry !== group)!;
      expect((await f.request(path(group.host, 'view?perspective=god'), undefined, observerHeaders(foreign.observer))).status).toBe(401);
      expect((await f.request(path(group.host, 'view?perspective=god'), undefined, seatHeaders(group.host))).status).toBe(403);
      const blind = await f.request(path(group.host, 'view?perspective=blind'), undefined, observerHeaders(group.observer));
      const god = await f.request(path(group.host, 'view?perspective=god'), undefined, observerHeaders(group.observer));
      expect(blind.status).toBe(200);
      expect(blind.body.G.private).toEqual({});
      expect(blind.body.G.secret).toBeUndefined();
      expect(god.status).toBe(200);
      expect(god.body.G.secret.cards).toEqual(raw.G.secret!.cards);
      expect(god.body.G.private).toEqual(raw.G.private);
      expectNoSecrets(blind.body);
      expectNoSecrets(god.body);
    }

    const [first, second, third] = groups;
    const received = vi.fn();
    first.clients[0].on('sync', received);
    first.clients[0].emit('sync', second.host.roomId, second.host.playerID, second.host.credentials, second.seats.length);
    first.clients[0].emit('update', packet(second.host, 'acknowledge'),
      (await f.state(second.host))._stateID, second.host.roomId, second.host.playerID);
    await new Promise((ok) => setTimeout(ok, 100));
    expect(received).not.toHaveBeenCalled();
    first.clients[0].off('sync', received);
    expect((await f.state(second.host)).G.players['0'].acknowledged).toBe(false);

    await Promise.all(groups.map((group) => movesFromEveryone(f, group, 'acknowledge')));
    const claiming = await Promise.all(groups.map((group) => f.state(group.host)));
    claiming.forEach((snapshot) => expect(snapshot.G.status).toBe('claiming'));
    await f.move(first, 0, 'declareRepairs', [0, claiming[0].G.round]);
    expect((await f.state(first.host)).G.players['0'].claim).toBe(0);
    expect((await f.state(second.host)).G).toEqual(claiming[1].G);
    expect((await f.state(third.host)).G).toEqual(claiming[2].G);
    await Promise.all(groups.map(async (group, index) => {
      for (let seatIndex = index === 0 ? 1 : 0; seatIndex < group.seats.length; seatIndex++) {
        await f.move(group, seatIndex, 'declareRepairs', [index, claiming[index].G.round]);
      }
      const current = await f.state(group.host);
      expect(current.G.status).toBe('playing');
      expect(Object.values(current.G.players).map((player) => player.claim)).toEqual(Array(group.seats.length).fill(index));
    }));

    const firstRaw = await f.state(first.host);
    const hazardHolder = Object.entries(firstRaw.G.secret!.cards).find(([, cards]) => cards.includes('hazard'))![0];
    const untouched = await Promise.all([second, third].map((group) => f.state(group.host)));
    // Leave the hazard in someone else's hand after the first safe cut, so we
    // can end only this game using genuine authorized moves below.
    const firstSelection = await select(f, first, 'stable', [hazardHolder]);
    expect(await f.state(second.host)).toEqual(untouched[0]);
    expect(await f.state(third.host)).toEqual(untouched[1]);
    await Promise.all([second, third].map((group) => select(f, group, 'stable')));
    for (const group of groups) {
      const raw = await f.state(group.host);
      for (const client of group.clients) {
        expect(f.views.get(client)!.G.pendingReveal).toEqual(raw.G.pendingReveal);
        expect(f.views.get(client)!.G.log).toEqual([]);
      }
      const blind = await f.request(path(group.host, 'view?perspective=blind'), undefined, observerHeaders(group.observer));
      expect(blind.body.G.pendingReveal).toEqual(raw.G.pendingReveal);
      expect(blind.body.G.pendingReveal).not.toHaveProperty('kind');
      expect(blind.body.G.secret).toBeUndefined();
    }
    const otherSelections = await Promise.all([second, third].map((group) => f.state(group.host)));
    const firstRevealed = await revealSelected(f, first);
    expect(firstRevealed.G.publicCards![firstSelection.targetID]).toHaveLength(5);
    expect(firstRevealed.G.publicCards![firstSelection.targetID][firstSelection.slot]).toBe('stable');
    expect(firstRevealed.G.players[firstSelection.targetID].cardCount).toBe(4);
    expect(firstRevealed.G.activePlayer).toBe(firstSelection.targetID);
    expect(await f.state(second.host)).toEqual(otherSelections[0]);
    expect(await f.state(third.host)).toEqual(otherSelections[1]);
    await Promise.all([second, third].map((group) => revealSelected(f, group)));
    for (const group of groups) expect((await f.state(group.host)).G.log).toHaveLength(1);

    const unfinished = await Promise.all([second, third].map((group) => f.state(group.host)));
    await select(f, first, 'hazard');
    const finished = await revealSelected(f, first);
    expect(finished.G).toMatchObject({ status: 'finished', winner: 'saboteur', winReason: 'hazard' });
    expect(await f.state(second.host)).toEqual(unfinished[0]);
    expect(await f.state(third.host)).toEqual(unfinished[1]);
    const replay = await f.request(path(first.host, 'replay?perspective=blind'), undefined, seatHeaders(first.host));
    expect(replay.status).toBe(200);
    expect(replay.body.complete).toBe(true);
    const rawReplay = await f.app.db.fetchReplay(first.host.roomId);
    const replayGod = await f.request(path(first.host, 'replay?perspective=god'), undefined, observerHeaders(first.observer));
    expect(replayGod.status).toBe(200);
    expect(replayGod.body.frames.at(-1).G.secret.cards).toEqual(finished.G.secret!.cards);
    expect(replay.body.frames.at(-1).G.log).toEqual(finished.G.log);
    expect(replay.body.frames).toHaveLength(rawReplay.frames.length);
    for (const frame of replay.body.frames) {
      expect(Object.keys(frame.G.players)).toHaveLength(4);
      expect(frame.G.secret).toBeUndefined();
      expect(frame.G.private).toEqual({});
    }
    expectNoSecrets(replay.body);
    expectNoSecrets(replayGod.body);
    for (const group of [second, third]) {
      expect((await f.request(path(group.host, 'replay'), undefined, seatHeaders(group.host))).status).toBe(409);
      expect((await f.request(path(first.host, 'replay'), undefined, seatHeaders(group.host))).status).toBe(401);
    }
    const share = await f.request(path(first.host, 'share'), {
      frameIndex: replay.body.frames.length - 1, perspective: 'blind',
    }, seatHeaders(first.host));
    expect(share.status).toBe(200);
    const shareHeaders = { 'X-Replay-Token': token(share.body.url, 'share') };
    expect((await f.request(`/api/replays/${first.host.roomId}`, undefined, shareHeaders)).status).toBe(200);
    for (const group of [second, third]) {
      expect((await f.request(`/api/replays/${group.host.roomId}`, undefined, shareHeaders)).status).toBe(403);
    }
    const statistics = await f.request('/api/stats');
    expect(statistics.body).toMatchObject({
      completedGames: 1, totalPlayerParticipations: 4,
    });
    expect(statistics.body.byGame.find((game: any) => game.gameId === 'space-station')).toMatchObject({
      gameId: 'space-station', completed: 1, wins: { saboteur: 1 },
      byPlayerCount: [{ numPlayers: 4, completed: 1, wins: { saboteur: 1 } }],
    });
    expectNoSecrets(statistics.body);

    const held = await f.request(path(first.host), undefined, seatHeaders(first.host));
    expect(held.body).toMatchObject({ status: 'finished', matchID: first.host.roomId });
    const completedRoom = f.app.rooms.rooms.get(first.host.roomId)!;
    await f.app.rooms.save({ ...completedRoom,
      completedDisplay: { matchID: first.host.roomId, until: Date.now() - 1 } });
    // Persist the unfinished groups exactly. The finished group rejoins its
    // reusable lobby while the archived game and its share remain unchanged.
    const persistedSelection = await select(f, second, 'stable');
    const persisted = await Promise.all(groups.map((group) => f.state(group.host)));
    for (const group of groups) {
      for (const client of group.clients) expect(new Set(f.messages.get(client))).toEqual(new Set([group.host.roomId]));
    }
    await f.restart();
    await Promise.all(groups.filter((_, index) => persisted[index].G.status !== 'finished')
      .map((group) => connectGroup(f, group)));
    for (const [index, group] of groups.entries()) {
      expect((await f.state(group.host)).G).toEqual(persisted[index].G);
      const room = await f.request(path(group.host), undefined, seatHeaders(group.host));
      expect(room.body.numPlayers).toBe(group.seats.length);
      const observer = await f.request(path(group.host, 'view?perspective=blind'), undefined, observerHeaders(group.observer));
      expect(observer.status).toBe(200);
      if (persisted[index].G.status === 'finished') {
        expect(room.body.status).toBe('lobby');
        expect(room.body.matchID).not.toBe(group.host.roomId);
        expect(room.body.players.every((player: any) => player.ready === false)).toBe(true);
        expect(observer.body.G.status).toBe('lobby');
        expect(observer.body.G.publicCards).toEqual({});
        expect(observer.body.G.private).toEqual({});
        expect(observer.body.G.secret).toBeUndefined();
      } else {
        expect(observer.body.G.publicCards).toEqual(persisted[index].G.publicCards);
      }
      const foreign = groups[(index + 1) % groups.length];
      expect((await f.request(path(group.host), undefined, seatHeaders(foreign.host))).status).toBe(401);
    }
    expect((await f.state(second.host)).G.pendingReveal).toEqual(persistedSelection);
    await revealSelected(f, second);
    expect((await f.state(second.host)).G.log).toHaveLength(2);
    expect((await f.state(first.host)).G).toEqual(persisted[0].G);
    expect((await f.state(third.host)).G).toEqual(persisted[2].G);
    expect((await f.request(`/api/replays/${first.host.roomId}`, undefined, shareHeaders)).body.frames).toEqual(replay.body.frames);
    expect((await f.request('/api/stats')).body).toEqual(statistics.body);
    for (const group of groups) {
      for (const client of group.clients) expect(new Set(f.messages.get(client))).toEqual(new Set([group.host.roomId]));
    }
  }, 30000);

  it('同房全員可用同一版本同時宣稱，延遲的上一輪宣稱不能污染新輪', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = await fixture();
    const created = await f.request('/api/rooms', { gameId: 'space-station', displayName: '房主' });
    expect(created.status).toBe(201);
    const host = created.body as unknown as Room;
    const guests = await Promise.all([1, 2, 3].map((index) => f.request(path(host, 'join'), {
      inviteToken: token(host.inviteUrl, 'invite'), displayName: `朋友 ${index}`,
    })));
    guests.forEach((response) => expect(response.status).toBe(200));
    const observer = await f.request(path(host, 'watch'), {
      inviteToken: token(host.inviteUrl, 'invite'), displayName: '觀眾',
    });
    expect(observer.status).toBe(200);
    const group: Group = {
      host, seats: [host, ...guests.map((response) => response.body as unknown as Seat)]
        .sort((a, b) => Number(a.playerID) - Number(b.playerID)),
      observer: observer.body as unknown as Observer, clients: [],
    };
    const ready = await Promise.all(group.seats.map((seat) =>
      f.request(path(host, 'ready'), { ready: true }, seatHeaders(seat))));
    ready.forEach((response) => expect(response.status).toBe(200));
    expect((await f.request(path(host, 'start'), {}, seatHeaders(host))).status).toBe(200);
    await connectGroup(f, group);
    await movesFromEveryone(f, group, 'acknowledge');

    async function declareTogether(round: number, claims: number[]) {
      const before = await f.state(host);
      expect(before.G).toMatchObject({ status: 'claiming', round });
      // Deliberately reuse exactly the same captured version for every client:
      // a phone must not have to retry just because another friend was faster.
      group.clients.forEach((client, index) => client.emit('update',
        packet(group.seats[index], 'declareRepairs', [claims[index], round]),
        before._stateID, host.roomId, group.seats[index].playerID));
      await vi.waitFor(() => {
        for (const client of group.clients) {
          const snapshot = f.views.get(client)!;
          expect(snapshot._stateID).toBe(before._stateID + group.seats.length);
          expect(snapshot.G.status).toBe('playing');
          expect(group.seats.map((seat) => snapshot.G.players[seat.playerID].claim)).toEqual(claims);
        }
      }, { timeout: 4000 });
      return before._stateID;
    }
    const oldStateID = await declareTogether(1, [0, 1, 2, 3]);
    for (let cut = 0; cut < group.seats.length; cut++) {
      await select(f, group, 'stable');
      await revealSelected(f, group);
    }
    expect((await f.state(host)).G).toMatchObject({ status: 'round-review', round: 1 });
    await movesFromEveryone(f, group, 'acknowledgeRound', [1]);
    expect((await f.state(host)).G).toMatchObject({ status: 'briefing', round: 2 });
    await movesFromEveryone(f, group, 'acknowledge');
    const nextRound = await f.state(host);
    expect(nextRound.G.status).toBe('claiming');
    group.clients.forEach((client, index) => client.emit('update',
      packet(group.seats[index], 'declareRepairs', [index, 1]),
      oldStateID, host.roomId, group.seats[index].playerID));
    // Omitting the round must also fail closed, even with the newest version.
    group.clients[0].emit('update', packet(group.seats[0], 'declareRepairs', [1]),
      nextRound._stateID, host.roomId, group.seats[0].playerID);
    await new Promise((ok) => setTimeout(ok, 120));
    expect(await f.state(host)).toEqual(nextRound);
    expect(Object.values(nextRound.G.players).every((player) => player.claim === null)).toBe(true);
    await declareTogether(2, [4, 3, 2, 1]);
    const accepted = await f.state(host);
    group.clients.forEach((client, index) => client.emit('update',
      packet(group.seats[index], 'declareRepairs', [0, 2]),
      nextRound._stateID, host.roomId, group.seats[index].playerID));
    await new Promise((ok) => setTimeout(ok, 120));
    expect(await f.state(host)).toEqual(accepted);
  }, 15000);
});
