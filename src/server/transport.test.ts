import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { State, SyncInfo } from 'boardgame.io';
import type { StationState } from '../games/station/game';
import { createApplication } from './app';

const origin = 'http://localhost:5173';
type App = Awaited<ReturnType<typeof createApplication>>;
interface Seat { playerID: string; credentials: string }
interface Room extends Seat { roomId: string; numPlayers: number; inviteUrl: string }
type StationSnapshot = State<StationState>;
let app: App;
let running: Awaited<ReturnType<App['listen']>>;
let directory: string;
let baseURL: string;
const sockets: Socket[] = [];
const views = new Map<Socket, StationSnapshot>();
const socketErrors = new Map<Socket, unknown[]>();

async function post(path: string, body: unknown, seat?: Seat) {
  const response = await fetch(baseURL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin,
      ...(seat ? { Authorization: `Bearer ${seat.credentials}`, 'X-Player-ID': seat.playerID } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function createRoom(): Promise<Room> {
  const response = await post('/api/rooms', { gameId: 'space-station', displayName: '房主' });
  expect(response.status).toBe(201);
  return response.body as Room;
}

async function fillRoom(room: Room): Promise<Seat[]> {
  const inviteToken = new URLSearchParams(new URL(room.inviteUrl).hash.slice(1)).get('invite');
  const results = await Promise.all([1, 2, 3].map((n) => post(`/api/rooms/${room.roomId}/join`, {
    inviteToken, displayName: `玩家 ${n}`,
  })));
  expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  const seats = [room, ...results.map((r) => r.body as Seat)];
  expect(new Set(seats.map((s) => s.playerID)).size).toBe(4);
  expect(new Set(seats.map((s) => s.credentials)).size).toBe(4);
  return seats.sort((a, b) => Number(a.playerID) - Number(b.playerID));
}

async function connect(pollingWithoutOrigin = false): Promise<Socket> {
  const socket = io(`${baseURL}/space-station`, {
    transports: pollingWithoutOrigin ? ['polling'] : ['websocket'], forceNew: true, reconnection: false,
    extraHeaders: pollingWithoutOrigin ? undefined : { Origin: origin }, autoConnect: false,
  });
  sockets.push(socket);
  socketErrors.set(socket, []);
  socket.on('error', (error: unknown) => socketErrors.get(socket)?.push(error));
  socket.on('update', (_matchID: string, state: StationSnapshot) => views.set(socket, state));
  await new Promise<void>((ok, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket connect timed out')), 3000);
    socket.once('connect', () => { clearTimeout(timeout); ok(); });
    socket.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
    socket.connect();
  });
  return socket;
}

async function sync(socket: Socket, room: Room, seat: Seat): Promise<SyncInfo> {
  const result = new Promise<SyncInfo>((ok, reject) => {
    const timeout = setTimeout(() => reject(new Error('Authorized sync timed out')), 3000);
    socket.once('sync', (_id: string, info: SyncInfo) => {
      clearTimeout(timeout);
      views.set(socket, info.state as StationSnapshot);
      ok(info);
    });
  });
  socket.emit('sync', room.roomId, seat.playerID, seat.credentials, room.numPlayers);
  return result;
}

function movePacket(seat: Seat, move: string, args: unknown[] = []) {
  return { type: 'MAKE_MOVE', payload: { type: move, args, playerID: seat.playerID, credentials: seat.credentials } };
}

async function move(socket: Socket, room: Room, seat: Seat, type: string, args: unknown[] = []) {
  const previousID = views.get(socket)!._stateID;
  socket.emit('update', movePacket(seat, type, args), previousID, room.roomId, seat.playerID);
  try {
    await vi.waitFor(() => expect(views.get(socket)!._stateID).toBeGreaterThan(previousID), { timeout: 4000 });
  } catch {
    const stored = await app.db.fetch(room.roomId, { state: true });
    throw new Error(`${type} by seat ${seat.playerID} did not complete: ${JSON.stringify({
      previousID, currentID: stored.state?._stateID, status: stored.state?.G.status,
      errors: socketErrors.get(socket), ready: stored.state?.G.players,
    })}`);
  }
  return views.get(socket)!;
}

async function fullGame() {
  const room = await createRoom();
  const seats = await fillRoom(room);
  for (const seat of seats) expect((await post(`/api/rooms/${room.roomId}/ready`, { ready: true }, seat)).status).toBe(200);
  expect((await post(`/api/rooms/${room.roomId}/start`, {}, seats[0])).status).toBe(200);
  room.numPlayers = seats.length;
  const clients = await Promise.all(seats.map(() => connect()));
  await Promise.all(clients.map((socket, index) => sync(socket, room, seats[index])));
  return { room, seats, clients };
}

async function moveEach(room: Room, seats: Seat[], clients: Socket[], type: string, args: unknown[] = []) {
  for (let index = 0; index < seats.length; index += 1) {
    const state = await move(clients[index], room, seats[index], type, args);
    await vi.waitFor(() => clients.forEach((socket) => expect(views.get(socket)!._stateID).toBe(state._stateID)));
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'boardgame-transport-'));
  app = await createApplication({
    dataDir: directory, publicOrigin: origin, host: '127.0.0.1', port: 0,
    production: false, createRoomKey: '',
  });
  running = await app.listen();
  baseURL = `http://127.0.0.1:${running.port}`;
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  views.clear();
  socketErrors.clear();
  vi.restoreAllMocks();
  await new Promise((ok) => setTimeout(ok, 30));
});
afterAll(async () => {
  if (running) await running.close();
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('boardgame-transport-')) {
    throw new Error('Refusing cleanup outside this test temporary directory.');
  }
  await rm(target, { recursive: true, force: true });
});

describe('Socket.IO 權限與資料邊界', () => {
  it('同源 polling 沒有 Origin 標頭仍可通過座位認證並操作', async () => {
    const room = await createRoom();
    const socket = await connect(true);
    await sync(socket, room, room);
    const state = await move(socket, room, room, 'setReady', [true]);
    expect(state.G.players['0'].ready).toBe(true);
  });
  it('每局使用獨立高熵種子，而不是可推測的建立時間', async () => {
    const first = await createRoom();
    const second = await createRoom();
    const firstState = (await app.db.fetch(first.roomId, { state: true })).state!;
    const secondState = (await app.db.fetch(second.roomId, { state: true })).state!;
    const firstSeed = firstState.plugins.random.data.seed;
    const secondSeed = secondState.plugins.random.data.seed;
    expect(firstSeed).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondSeed).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(firstSeed).not.toBe(secondSeed);
    expect(firstSeed).not.toBe(first.credentials);
    expect(first.inviteUrl).not.toContain(firstSeed);
  });

  it('拒絕匿名、空座位與錯誤憑證，未知房號不會自動建立對局', async () => {
    const room = await createRoom();
    const socket = await connect();
    const received = vi.fn();
    socket.on('sync', received);
    socket.emit('sync', room.roomId, null, null, 4);
    socket.emit('sync', room.roomId, '1', room.credentials, 4);
    socket.emit('sync', room.roomId, '0', 'x'.repeat(43), 4);
    socket.emit('sync', 'z'.repeat(16), '0', room.credentials, 4);
    socket.emit('update', movePacket(room, 'setReady', [true]), 0, room.roomId, '0');
    await new Promise((ok) => setTimeout(ok, 120));
    expect(received).not.toHaveBeenCalled();
    expect((await app.db.fetch('z'.repeat(16), { state: true })).state).toBeUndefined();
    expect((await app.db.fetch(room.roomId, { state: true })).state!.G.players['0'].ready).toBe(false);
    socket.off('sync', received);
    const info = await sync(socket, room, room);
    expect(info.state.G.status).toBe('lobby');
  });

  it('同步、初始狀態、更新與重連均不洩漏種子、牌序或他人身份', async () => {
    const { room, seats, clients } = await fullGame();
    for (let index = 0; index < clients.length; index += 1) {
      const snapshot = views.get(clients[index])!;
      expect(Object.keys(snapshot.G.private)).toEqual([seats[index].playerID]);
      expect(snapshot.G.private[seats[index].playerID].composition).toBeDefined();
      expect(snapshot.G).not.toHaveProperty('secret');
      expect(JSON.stringify(snapshot)).not.toMatch(/"(?:seed|prngstate|unusedRoles|credentials)"/);
      const info = await sync(clients[index], room, seats[index]);
      expect(Object.keys(info.state.G.private)).toEqual([seats[index].playerID]);
      expect(JSON.stringify(info)).not.toMatch(/"(?:seed|prngstate|unusedRoles|credentials)"/);
      expect(info.initialState.G).not.toHaveProperty('secret');
      expect(info.initialState._undo).toEqual([]);
      expect(info.initialState._redo).toEqual([]);
    }
    const before = structuredClone((await app.db.fetch(room.roomId, { state: true })).state);
    const restored = await connect();
    const info = await sync(restored, room, seats[2]);
    expect(info.state.G.private).toEqual({ '2': before!.G.private['2'] });
    expect((await app.db.fetch(room.roomId, { state: true })).state!.G).toEqual(before!.G);
  });

  it('拒絕偽造框架事件、冒用其他座位與憑證，但接受原座位合法操作', async () => {
    const room = await createRoom();
    const seats = await fillRoom(room);
    const socket = await connect();
    await sync(socket, room, seats[1]);
    const before = structuredClone((await app.db.fetch(room.roomId, { state: true })).state!);
    const base = movePacket(seats[1], 'setReady', [true]);
    const attacks = [
      { ...base, type: 'GAME_EVENT', payload: { ...base.payload, type: 'endGame', args: [{ winner: 'saboteur' }] } },
      { ...base, type: 'UNDO' }, { ...base, type: 'REDO' }, { ...base, type: 'RESET', state: {} },
      { ...base, type: 'PLUGIN' },
      { ...base, payload: { ...base.payload, type: 'constructor' } },
      { ...base, payload: { ...base.payload, playerID: '0' } },
      { ...base, payload: { ...base.payload, credentials: seats[0].credentials } },
      { ...base, payload: { ...base.payload, args: { ready: true } } },
    ];
    for (const action of attacks) socket.emit('update', action, before._stateID, room.roomId, seats[1].playerID);
    socket.emit('update', base, before._stateID, room.roomId, '0');
    socket.emit('update', base, before._stateID, 'z'.repeat(16), seats[1].playerID);
    await new Promise((ok) => setTimeout(ok, 120));
    const after = (await app.db.fetch(room.roomId, { state: true })).state!;
    expect(after.G).toEqual(before.G);
    expect(after._stateID).toBe(before._stateID);
    expect(after.ctx.gameover).toBeUndefined();
    const valid = await move(socket, room, seats[1], 'setReady', [true]);
    expect(valid.G.players['1'].ready).toBe(true);
    expect(valid.G.players['0'].ready).toBe(false);
  });

  it('單一連線綁定一個座位，不能使用另一份合法憑證切換', async () => {
    const room = await createRoom();
    const seats = await fillRoom(room);
    const socket = await connect();
    await sync(socket, room, seats[0]);
    const received = vi.fn();
    socket.on('sync', received);
    socket.emit('sync', room.roomId, seats[1].playerID, seats[1].credentials, 4);
    await new Promise((ok) => setTimeout(ok, 120));
    expect(received).not.toHaveBeenCalled();
    socket.off('sync', received);
    const valid = await move(socket, room, seats[0], 'setReady', [true]);
    expect(valid.G.players['0'].ready).toBe(true);
    expect(valid.G.players['1'].ready).toBe(false);

    const racing = await connect();
    const raceResponses = vi.fn();
    racing.on('sync', raceResponses);
    racing.emit('sync', room.roomId, seats[0].playerID, seats[0].credentials, 4);
    racing.emit('sync', room.roomId, seats[1].playerID, seats[1].credentials, 4);
    await vi.waitFor(() => expect(raceResponses).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await new Promise((ok) => setTimeout(ok, 120));
    expect(raceResponses).toHaveBeenCalledTimes(1);
  });

  it('同版本重複送出的揭牌只生效一次', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { room, seats, clients } = await fullGame();
    await moveEach(room, seats, clients, 'acknowledge');
    expect(views.get(clients[0])!.G.status).toBe('claiming');
    await moveEach(room, seats, clients, 'declareRepairs', [0, 1]);
    const G = (await app.db.fetch(room.roomId, { state: true })).state!.G as StationState;
    const entry = Object.entries(G.secret!.cards).find(([id, cards]) => id !== '0' && cards.includes('stable'))!;
    const selected = await move(clients[0], room, seats[0], 'selectCard', [entry[0], entry[1].indexOf('stable')]);
    const { state } = await app.db.fetch(room.roomId, { state: true });
    const args = [entry[0], entry[1].indexOf('stable'), selected.G.pendingReveal!.selectionID];
    const action = movePacket(seats[0], 'reveal', args);
    clients[0].emit('update', action, state!._stateID, room.roomId, '0');
    clients[0].emit('update', action, state!._stateID, room.roomId, '0');
    await vi.waitFor(() => expect(views.get(clients[0])!.G.log).toHaveLength(1), { timeout: 4000 });
    await new Promise((ok) => setTimeout(ok, 80));
    const after = (await app.db.fetch(room.roomId, { state: true })).state!;
    expect(after.G.log).toHaveLength(1);
    expect(after._stateID).toBe(state!._stateID + 1);
    expect(after.G.activePlayer).toBe(entry[0]);
  });

  it('重新同步不替換仍供 HTTP 與操作共用的房間序列佇列', async () => {
    const room = await createRoom();
    const socket = await connect();
    await sync(socket, room, room);
    const originalQueue = app.server.transport.getMatchQueue(room.roomId);
    await sync(socket, room, room);
    expect(app.server.transport.getMatchQueue(room.roomId)).toBe(originalQueue);
  });

  it('觀戰憑證不能同步玩家狀態、發送操作或繞過 HTTP 開局的人數檢查', async () => {
    const room = await createRoom();
    const observer = (await post(`/api/rooms/${room.roomId}/watch`, {
      inviteToken: new URLSearchParams(new URL(room.inviteUrl).hash.slice(1)).get('invite'), displayName: '觀戰者',
    })).body;
    const socket = await connect();
    const received = vi.fn();
    socket.on('sync', received);
    socket.emit('sync', room.roomId, observer.observerID, observer.credentials, 8);
    socket.emit('sync', room.roomId, '0', observer.credentials, 8);
    socket.emit('update', movePacket({ playerID: '0', credentials: observer.credentials }, 'setReady', [true]), 0, room.roomId, '0');
    await new Promise((ok) => setTimeout(ok, 120));
    expect(received).not.toHaveBeenCalled();
    socket.off('sync', received);
    await sync(socket, room, room);
    socket.emit('update', movePacket(room, 'startGame'), views.get(socket)!._stateID, room.roomId, '0');
    await new Promise((ok) => setTimeout(ok, 100));
    const state = (await app.db.fetch(room.roomId, { state: true })).state!;
    expect(state.G.status).toBe('lobby');
    expect(state.G.players['0'].ready).toBe(false);
  });

  it('HTTP 同時入座與既有連線重新同步不會覆寫座位憑證', async () => {
    const room = await createRoom();
    const host = await connect();
    await sync(host, room, room);
    const [seats] = await Promise.all([fillRoom(room), sync(host, room, room)]);
    const { metadata } = await app.db.fetch(room.roomId, { metadata: true });
    for (const seat of seats) {
      expect(metadata!.players[Number(seat.playerID)].credentials).toBe(seat.credentials);
      const guest = await connect();
      const info = await sync(guest, room, seat);
      expect(info.state.G.status).toBe('lobby');
    }
  });

  it('移出玩家會撤銷連線；保留缺號席位仍能確認、完成一輪並保留正確回放', async () => {
    const room = await createRoom();
    const seats = await fillRoom(room);
    const last = await post(`/api/rooms/${room.roomId}/join`, {
      inviteToken: new URLSearchParams(new URL(room.inviteUrl).hash.slice(1)).get('invite'), displayName: '尾端玩家',
    });
    expect(last.status).toBe(200);
    seats.push(last.body as Seat);
    const oldSocket = await connect();
    await sync(oldSocket, room, seats[1]);
    const oldUpdates = vi.fn();
    oldSocket.on('update', oldUpdates);
    const target = last.body.players.find((player: any) => player.id === '1');
    const removed = await post(`/api/rooms/${room.roomId}/remove`, {
      playerID: '1', membershipID: target.membershipID,
    }, room);
    expect(removed.status).toBe(200);
    await vi.waitFor(() => expect(oldSocket.connected).toBe(false));
    const survivors = seats.filter((seat) => seat.playerID !== '1');
    for (const seat of survivors) expect((await post(`/api/rooms/${room.roomId}/ready`, { ready: true }, seat)).status).toBe(200);
    expect((await post(`/api/rooms/${room.roomId}/start`, {}, room)).status).toBe(200);
    room.numPlayers = 4;
    const clients = await Promise.all(survivors.map(() => connect()));
    await Promise.all(clients.map((socket, index) => sync(socket, room, survivors[index])));
    const initial = (await app.db.fetch(room.roomId, { state: true })).state!;
    expect(initial.ctx.playOrder).toEqual(['0', '2', '3', '4']);
    expect(Object.keys(initial.ctx.activePlayers!)).toEqual(['0', '2', '3', '4']);
    expect(Object.keys(initial.G.players)).toEqual(['0', '2', '3', '4']);
    expect(Object.keys(initial.G.private)).toEqual(['0', '2', '3', '4']);
    const oldReconnect = await connect();
    const oldSynced = vi.fn();
    oldReconnect.on('sync', oldSynced);
    oldReconnect.emit('sync', room.roomId, '1', seats[1].credentials, 4);
    oldReconnect.emit('update', movePacket(seats[1], 'acknowledge'), initial._stateID, room.roomId, '1');
    await moveEach(room, survivors, clients, 'acknowledge');
    await moveEach(room, survivors, clients, 'declareRepairs', [0, 1]);
    // Avoid the hazard without depending on shuffled card order, and force the
    // last noncontiguous seat to act in this round.
    for (let reveal = 0; reveal < 4; reveal++) {
      const current = (await app.db.fetch(room.roomId, { state: true })).state!;
      const actor = survivors.findIndex((seat) => seat.playerID === current.G.activePlayer);
      const entries = Object.entries(current.G.secret.cards) as [string, string[]][];
      const target = reveal === 0 ? entries.find(([id]) => id === '4')!
        : entries.find(([id, cards]) => id !== current.G.activePlayer
          && cards.some((kind, slot) => kind === 'stable' && current.G.publicCards[id][slot] === null))!;
      const slot = target[1].findIndex((kind, slot) => current.G.publicCards[target[0]][slot] === null
        && (reveal === 0 ? kind !== 'hazard' : kind === 'stable'));
      const selected = await move(clients[actor], room, survivors[actor], 'selectCard', [target[0], slot]);
      const revealed = await move(clients[actor], room, survivors[actor], 'reveal', [
        target[0], slot, selected.G.pendingReveal!.selectionID,
      ]);
      await vi.waitFor(() => clients.forEach((socket) => expect(views.get(socket)!._stateID).toBe(revealed._stateID)));
    }
    const after = (await app.db.fetch(room.roomId, { state: true })).state!;
    expect(after.G).toMatchObject({ status: 'briefing', round: 2 });
    expect(after.G.log.some((entry: any) => entry.actorID === '4')).toBe(true);
    expect(after.G.log.every((entry: any) => entry.actorID !== '1' && entry.targetID !== '1')).toBe(true);
    const replay = await app.db.fetchReplay(room.roomId);
    expect(replay.complete).toBe(true);
    expect(replay.frames).toHaveLength(17);
    for (const frame of replay.frames) expect(Object.keys(frame.G.players)).toEqual(['0', '2', '3', '4']);
    expect(oldUpdates).not.toHaveBeenCalled();
    expect(oldSynced).not.toHaveBeenCalled();
  });
});
