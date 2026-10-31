import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StationState } from '../games/station/game';
import { createApplication } from './app';
import type { GuardedTransport } from './transport';

type Snapshot = State<StationState>;
interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { room: Room; seats: Seat[]; observer: Observer; clients: Socket[] }
const origin = 'http://localhost:5173';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const headers = (member: Seat | Observer) => ({
  Authorization: `Bearer ${member.credentials}`,
  ...('playerID' in member ? { 'X-Player-ID': member.playerID } : { 'X-Observer-ID': member.observerID }),
});
const path = (group: Group, operation = '') => `/api/rooms/${group.room.roomId}${operation ? `/${operation}` : ''}`;
const packet = (seat: Seat, type: string, args: unknown[]) => ({
  type: 'MAKE_MOVE', payload: { type, args, playerID: seat.playerID, credentials: seat.credentials },
});

async function fixture(lifecycleSweepMs = 60000) {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-round-review-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-round-review-test-')) {
      throw new Error('Refusing cleanup outside the test temporary directory');
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false,
    roomCode: '', lifecycleSweepMs };
  let app = await createApplication(config);
  let running: Awaited<ReturnType<typeof app.listen>> | undefined = await app.listen();
  const sockets: Socket[] = [];
  cleanups.push(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await running?.close();
  });
  const request = async (url: string, body?: unknown, auth?: Seat | Observer) => {
    const response = await fetch(`http://127.0.0.1:${running!.port}${url}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? headers(auth) : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const state = async (group: Group) => (await app.db.fetch(group.room.matchID, { state: true })).state! as Snapshot;
  const connect = async (group: Group) => {
    group.clients = await Promise.all(group.seats.map(async (seat) => {
      const socket = io(`http://127.0.0.1:${running!.port}/space-station`, {
        transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { Origin: origin }, autoConnect: false,
      });
      sockets.push(socket);
      socket.on('error', () => {});
      await new Promise<void>((ok, reject) => {
        const timer = setTimeout(() => reject(new Error('Socket sync timed out')), 4000);
        socket.once('sync', (_id: string, _info: SyncInfo) => { clearTimeout(timer); ok(); });
        socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
        socket.once('connect', () => socket.emit('sync', group.room.matchID, seat.playerID, seat.credentials, group.seats.length));
        socket.connect();
      });
      return socket;
    }));
  };
  const move = async (group: Group, playerID: string, type: string, args: unknown[] = []) => {
    const before = await state(group);
    const index = group.seats.findIndex((seat) => seat.playerID === playerID);
    group.clients[index].emit('update', packet(group.seats[index], type, args), before._stateID, group.room.matchID, playerID);
    await vi.waitFor(async () => expect((await state(group))._stateID).toBeGreaterThan(before._stateID), { timeout: 4000 });
    return state(group);
  };
  const settlePackets = async (group: Group, seats = group.seats) => {
    // An unchanged snapshot cannot prove an invalid packet has been processed.
    // Sync on each sending socket is queued after its preceding move packets.
    await Promise.all(seats.map(seat => new Promise<void>((ok, reject) => {
      const socket = group.clients[group.seats.findIndex(entry => entry.playerID === seat.playerID)];
      const received = (matchID: string) => {
        if (matchID !== group.room.matchID) return;
        clearTimeout(timer); socket.off('sync', received); ok();
      };
      const timer = setTimeout(() => {
        socket.off('sync', received);
        reject(new Error(`Authorized packet barrier timed out for seat ${seat.playerID}`));
      }, 8000);
      socket.on('sync', received);
      socket.emit('sync', group.room.matchID, seat.playerID, seat.credentials, group.seats.length);
    })));
    // A sync reply is sent before its connection metadata write completes.
    await (app.server.transport as GuardedTransport).drain();
  };
  const group = async (count = 4, briefingOnly = false) => {
    const created = await request('/api/rooms', { gameId: 'space-station', displayName: '房主' });
    expect(created.status).toBe(201);
    const room = created.body as unknown as Room;
    const inviteToken = new URLSearchParams(new URL(room.inviteUrl).hash.slice(1)).get('invite');
    const seats: Seat[] = [room];
    for (let index = 1; index < count; index++) {
      const joined = await request(`/api/rooms/${room.roomId}/join`, { inviteToken, displayName: `朋友 ${index}`, requestID: randomUUID() });
      expect(joined.status).toBe(200);
      seats.push(joined.body as unknown as Seat);
    }
    const watching = await request(`/api/rooms/${room.roomId}/watch`, { inviteToken, displayName: '觀眾' });
    expect(watching.status).toBe(200);
    const result: Group = { room, seats, observer: watching.body as unknown as Observer, clients: [] };
    for (const seat of seats) expect((await request(path(result, 'ready'), { ready: true }, seat)).status).toBe(200);
    expect((await request(path(result, 'start'), {}, room)).status).toBe(200);
    await connect(result);
    if (briefingOnly) return result;
    for (const seat of seats) await move(result, seat.playerID, 'acknowledge');
    for (const seat of seats) await move(result, seat.playerID, 'declareRepairs', [0, 1]);
    return result;
  };
  const reveal = async (group: Group, kind: 'stable' | 'hazard') => {
    const before = await state(group);
    const chosen = Object.entries(before.G.secret!.cards).flatMap(([targetID, cards]) =>
      targetID === before.G.activePlayer ? [] : cards.flatMap((card, slot) =>
        card === kind && before.G.publicCards![targetID][slot] === null ? [{ targetID, slot }] : []))[0];
    if (!chosen) throw new Error(`No eligible ${kind} card`);
    const actor = before.G.activePlayer!;
    const selected = await move(group, actor, 'selectCard', [chosen.targetID, chosen.slot]);
    return move(group, actor, 'reveal', [chosen.targetID, chosen.slot, selected.G.pendingReveal!.selectionID]);
  };
  return {
    get app() { return app; }, request, state, group, move, reveal, connect, settlePackets,
    async finish(group: Group) {
      const before = await state(group);
      if (before.G.secret!.cards[before.G.activePlayer!].includes('hazard')) await reveal(group, 'stable');
      const finished = await reveal(group, 'hazard');
      expect(finished.G).toMatchObject({ status: 'finished', winner: 'saboteur', winReason: 'hazard' });
      return finished;
    },
    async restart() {
      sockets.splice(0).forEach((socket) => socket.disconnect());
      const previous = running;
      running = undefined;
      await previous?.close();
      app = await createApplication(config);
      running = await app.listen();
    },
  };
}

describe('Station final-card review and completed-table retention', () => {
  it.each([4, 8])('accepts all %i simultaneous briefing confirmations from one snapshot but rejects confirmations for an older round', async (count) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = await fixture();
    const group = await f.group(count, true);
    const initial = await f.state(group);
    expect(initial.G).toMatchObject({ rulesVersion: 3, status: 'briefing', round: 1 });
    const broadcast = (snapshot: Snapshot, round: number, seats = group.seats) => {
      for (const seat of seats) {
        const index = group.seats.findIndex((entry) => entry.playerID === seat.playerID);
        group.clients[index].emit('update', packet(seat, 'acknowledgeBriefing', [round]),
          snapshot._stateID, group.room.matchID, seat.playerID);
      }
    };
    broadcast(initial, 2);
    await f.settlePackets(group);
    expect(await f.state(group)).toEqual(initial);
    broadcast(initial, 1);
    await vi.waitFor(async () => {
      const claiming = await f.state(group);
      expect(claiming._stateID).toBe(initial._stateID + count);
      expect(claiming.G.status).toBe('claiming');
      expect(Object.values(claiming.G.players).every((player) => player.acknowledged)).toBe(true);
    }, { timeout: 4000 });
    for (const seat of group.seats) await f.move(group, seat.playerID, 'declareRepairs', [0, 1]);
    for (let index = 0; index < count; index++) await f.reveal(group, 'stable');
    expect((await f.state(group)).G.status).toBe('round-review');
    for (const seat of group.seats) await f.move(group, seat.playerID, 'acknowledgeRound', [1]);
    const second = await f.state(group);
    expect(second.G).toMatchObject({ status: 'briefing', round: 2 });
    broadcast(initial, 1);
    broadcast(second, 1);
    await f.settlePackets(group);
    expect(await f.state(group)).toEqual(second);
    const firstConfirmed = await f.move(group, group.seats[0].playerID, 'acknowledgeBriefing', [2]);
    broadcast(firstConfirmed, 2, [group.seats[0]]);
    await f.settlePackets(group, [group.seats[0]]);
    expect(await f.state(group)).toEqual(firstConfirmed);
    broadcast(firstConfirmed, 2, group.seats.slice(1));
    await vi.waitFor(async () => {
      const claiming = await f.state(group);
      expect(claiming._stateID).toBe(second._stateID + count);
      expect(claiming.G.status).toBe('claiming');
      expect(Object.values(claiming.G.players).every((player) => player.acknowledged)).toBe(true);
    }, { timeout: 4000 });
  }, 25000);

  it('retains the final card for eight seconds across polling and restart while stats and replay are immediately available', async () => {
    const f = await fixture();
    const first = await f.group();
    const other = await f.group();
    const unchanged = await f.state(other);
    const finished = await f.finish(first);
    let now = Date.now();
    const startedAt = now;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const held = await f.request(path(first), undefined, first.room);
    expect(held.body).toMatchObject({ status: 'finished', matchID: first.room.matchID, completedDisplayUntil: startedAt + 8000 });
    expect(held.body.history).toEqual([]);
    expect((await f.request(path(first, 'return'), { matchID: first.room.matchID }, first.room)).status).toBe(409);
    expect((await f.request(path(first, 'abort'), { matchID: first.room.matchID }, first.room)).status).toBe(409);
    expect((await f.request(path(first, 'switch-role'), { access: 'spectator', matchID: first.room.matchID,
      requestID: randomUUID() }, first.room)).status).toBe(409);
    const view = await f.request(path(first, 'view?perspective=blind'), undefined, first.observer);
    expect(view.status).toBe(200);
    expect(view.body.G.publicCards).toEqual(finished.G.publicCards);
    expect(view.body.G.log.at(-1).kind).toBe('hazard');
    expect(view.body.G.secret).toBeUndefined();
    const replay = await f.request(path(first, 'replay'), undefined, first.room);
    expect(replay.status).toBe(200);
    expect(replay.body.frames.at(-1).G.publicCards).toEqual(finished.G.publicCards);
    const shared = await f.request(path(first, 'share'), { frameIndex: replay.body.frames.length - 1, perspective: 'blind' }, first.observer);
    expect(shared.status).toBe(200);
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);
    expect(await f.state(other)).toEqual(unchanged);
    const lateSeat = first.seats[0];
    first.clients[0].emit('update', packet(lateSeat, 'acknowledgeRound', [finished.G.round]),
      finished._stateID, first.room.matchID, lateSeat.playerID);
    await new Promise((done) => setTimeout(done, 50));
    expect(await f.state(first)).toEqual(finished);

    now += 3000;
    await f.restart();
    expect((await f.request(path(first), undefined, first.observer)).body.completedDisplayUntil).toBe(startedAt + 8000);
    now = startedAt + 7999;
    expect((await f.request(path(first), undefined, first.room)).body.status).toBe('finished');
    expect(await f.state(first)).toEqual(finished);
    expect(await f.state(other)).toEqual(unchanged);
    now = startedAt + 8000;
    const lobby = await f.request(path(first), undefined, first.room);
    expect(lobby.body).toMatchObject({ status: 'lobby', numPlayers: 4, spectatorCount: 1 });
    expect(lobby.body.matchID).not.toBe(first.room.matchID);
    expect(lobby.body.completedDisplayUntil).toBeUndefined();
    expect(lobby.body.history).toEqual([expect.objectContaining({ matchID: first.room.matchID, ending: 'completed', winner: 'saboteur' })]);
    expect(f.app.rooms.rooms.get(first.room.roomId)!.completedDisplay).toBeUndefined();
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);
    expect(await f.state(first)).toEqual(finished);
    const historical = await f.request(path(first, `replay?matchID=${first.room.matchID}`), undefined, first.observer);
    expect(historical.status).toBe(200);
    expect(historical.body.room.completedDisplayUntil).toBeUndefined();
    expect(historical.body.frames).toEqual(replay.body.frames);
  }, 20000);

  it('preserves the nonterminal round table and partial acknowledgements across restart without affecting another room', async () => {
    const f = await fixture();
    const first = await f.group();
    const other = await f.group();
    const unchanged = await f.state(other);
    for (let index = 0; index < 4; index++) await f.reveal(first, 'stable');
    const review = await f.state(first);
    expect(review.G).toMatchObject({ rulesVersion: 3, status: 'round-review', round: 1, revealsThisRound: 4 });
    expect(review.G.log).toHaveLength(4);
    expect(Object.values(review.G.publicCards!).flat().filter((kind) => kind !== null)).toEqual(Array(4).fill('stable'));
    const view = await f.request(path(first, 'view?perspective=blind'), undefined, first.observer);
    expect(view.body.G.publicCards).toEqual(review.G.publicCards);
    expect(view.body.G.log).toEqual(review.G.log);
    expect((await f.request(path(first), undefined, first.room)).body.status).toBe('round-review');
    expect((await f.request(path(first, 'return'), { matchID: first.room.matchID }, first.room)).status).toBe(409);
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
    for (const seat of first.seats.slice(0, 3)) await f.move(first, seat.playerID, 'acknowledgeRound', [1]);
    const partial = await f.state(first);
    expect(partial.G.status).toBe('round-review');
    expect(partial.G.publicCards).toEqual(review.G.publicCards);
    await f.restart();
    await f.connect(first);
    expect(await f.state(first)).toEqual(partial);
    expect((await f.request(path(first), undefined, first.observer)).body.status).toBe('round-review');
    await f.move(first, first.seats[3].playerID, 'acknowledgeRound', [1]);
    const next = await f.state(first);
    expect(next.G).toMatchObject({ status: 'briefing', round: 2, revealsThisRound: 0 });
    expect(Object.values(next.G.publicCards!).flat().every((kind) => kind === null)).toBe(true);
    expect(next.G.log).toEqual(review.G.log);
    expect(await f.state(other)).toEqual(unchanged);
  }, 20000);

  it('does not discard a completed result when everyone leaves during the final-card display', async () => {
    const f = await fixture();
    const group = await f.group();
    await f.finish(group);
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (const seat of group.seats) expect((await f.request(path(group, 'leave'), {}, seat)).status).toBe(200);
    expect((await f.request(path(group, 'leave'), {}, group.observer)).status).toBe(200);
    const held = f.app.rooms.rooms.get(group.room.roomId)!;
    expect(held.currentMatchID).toBe(group.room.matchID);
    expect(held.completedDisplay!.until).toBe(now + 8000);
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);
    // A new spectator can use the valid room invitation to see the held table.
    const inviteToken = new URLSearchParams(new URL(group.room.inviteUrl).hash.slice(1)).get('invite');
    const watching = await f.request(path(group, 'watch'), { inviteToken, displayName: '後來的觀眾' });
    expect(watching.status).toBe(200);
    now += 8000;
    const lobby = await f.request(path(group), undefined, watching.body as unknown as Observer);
    expect(lobby.body).toMatchObject({ status: 'lobby', numPlayers: 0, hostPlayerID: null });
    expect(lobby.body.history[0]).toMatchObject({ ending: 'completed', winner: 'saboteur' });
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);
  }, 15000);

  it('keeps immediate completed-room handling for saved version-two matches', async () => {
    const f = await fixture();
    const group = await f.group();
    const finished = await f.finish(group);
    finished.G.rulesVersion = 2;
    finished._stateID += 1;
    await f.app.db.setState(group.room.matchID, finished);
    const lobby = await f.request(path(group), undefined, group.room);
    expect(lobby.body.status).toBe('lobby');
    expect(lobby.body.matchID).not.toBe(group.room.matchID);
    expect(lobby.body.completedDisplayUntil).toBeUndefined();
    expect(lobby.body.history[0]).toMatchObject({ ending: 'completed', winner: 'saboteur' });
  }, 15000);

  it('automatically returns after the persisted deadline even when no browser polls the room', async () => {
    const f = await fixture(25);
    const group = await f.group();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await f.finish(group);
    await vi.waitFor(() => expect(f.app.rooms.rooms.get(group.room.roomId)!.completedDisplay)
      .toEqual({ matchID: group.room.matchID, until: now + 8000 }));
    now += 7999;
    await new Promise((done) => setTimeout(done, 60));
    expect(f.app.rooms.rooms.get(group.room.roomId)!.currentMatchID).toBe(group.room.matchID);
    now += 1;
    await vi.waitFor(() => expect(f.app.rooms.rooms.get(group.room.roomId)!.currentMatchID).not.toBe(group.room.matchID));
    expect(f.app.rooms.rooms.get(group.room.roomId)!.history).toEqual([
      expect.objectContaining({ matchID: group.room.matchID, ending: 'completed', winner: 'saboteur' }),
    ]);
  }, 15000);
});
