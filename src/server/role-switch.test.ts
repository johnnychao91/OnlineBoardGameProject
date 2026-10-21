import { ROOM_CAPACITY } from '../games/catalog';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication, type AppConfig } from './app';
import { hashToken, randomToken } from './security';

interface Member { credentials: string; playerID?: string; observerID?: string }
interface Room extends Member { roomId: string; matchID: string; inviteUrl: string }
const origin = 'http://localhost:5173';
const games = [
  { id: 'space-station', minimum: 4, maximum: 8 },
  { id: 'encrypted-call', minimum: 2, maximum: 4 },
];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const clean of cleanups.splice(0).reverse()) await clean();
});
const headers = (member: Member) => ({
  Authorization: `Bearer ${member.credentials}`,
  ...(member.playerID !== undefined ? { 'X-Player-ID': member.playerID } : { 'X-Observer-ID': member.observerID! }),
});
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const fragment = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
const switchBody = (matchID: string, access: 'player' | 'spectator') => ({ access, matchID, requestID: randomUUID() });

async function fixture(overrides: Partial<AppConfig> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-role-switch-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-role-switch-test-')) {
      throw new Error('Refusing cleanup outside the test temporary directory.');
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0,
    production: false, createRoomKey: '', lifecycleSweepMs: 60000, ...overrides };
  let app = await createApplication(config);
  let running: Awaited<ReturnType<typeof app.listen>> | undefined = await app.listen();
  const sockets: Socket[] = [];
  cleanups.push(async () => { sockets.forEach(socket => socket.disconnect()); await running?.close(); });
  const request = async (url: string, body?: unknown, member?: Member, extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${running!.port}${url}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(member ? headers(member) : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
  };
  const connect = async (gameId: string) => {
    const socket = io(`http://127.0.0.1:${running!.port}/${gameId}`, {
      transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false,
      extraHeaders: { Origin: origin },
    });
    sockets.push(socket);
    socket.on('error', () => {});
    await new Promise<void>((ok, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket connect timed out')), 3000);
      socket.once('connect', () => { clearTimeout(timeout); ok(); });
      socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
      socket.connect();
    });
    return socket;
  };
  const sync = async (socket: Socket, matchID: string, member: Member) => {
    const received = new Promise<SyncInfo>((ok, reject) => {
      const timeout = setTimeout(() => reject(new Error('Authorized sync timed out')), 3000);
      socket.once('sync', (_id: string, info: SyncInfo) => { clearTimeout(timeout); ok(info); });
    });
    socket.emit('sync', matchID, member.playerID, member.credentials, 4);
    return received;
  };
  return {
    get app() { return app; }, request, connect, sync,
    async restart() {
      sockets.splice(0).forEach(socket => socket.disconnect());
      const previous = running;
      running = undefined;
      await previous?.close();
      app = await createApplication(config);
      running = await app.listen();
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function group(f: Fixture, gameId = 'encrypted-call', count = 2) {
  const created = await f.request('/api/rooms', { gameId, displayName: '房主' });
  expect(created.status).toBe(201);
  const room = created.body as unknown as Room;
  const members: Member[] = [room];
  const admissions: Record<string, { displayName: string; inviteToken: string; requestID: string }> = {};
  for (let index = 1; index < count; index++) {
    const admission = {
      displayName: `玩家 ${index}`, inviteToken: fragment(room.inviteUrl), requestID: randomUUID(),
    };
    const result = await f.request(path(room, 'join'), admission);
    expect(result.status).toBe(200);
    members.push(result.body as Member);
    admissions[result.body.playerID] = admission;
  }
  const watchBody = { displayName: '觀戰朋友', inviteToken: fragment(room.inviteUrl), requestID: randomUUID() };
  const watching = await f.request(path(room, 'watch'), watchBody);
  expect(watching.status).toBe(200);
  return { room, members, observer: watching.body as Member, watchBody, admissions };
}
async function ready(f: Fixture, room: Room, members: Member[]) {
  for (const member of members) expect((await f.request(path(room, 'ready'), { ready: true }, member)).status).toBe(200);
}

describe('Authenticated spectator roster and in-room role switching', () => {
  it.each(games)('preserves the room, names and other members in $id when switching both ways', async game => {
    const f = await fixture();
    const g = await group(f, game.id, game.minimum);
    const other = await group(f, game.id, game.minimum);
    const otherBefore = (await f.request(path(other.room), undefined, other.room)).body;
    await ready(f, g.room, g.members);
    const oldGuest = g.members[1];
    const watch = await f.request(path(g.room, 'switch-role'), switchBody(g.room.matchID, 'spectator'), oldGuest);
    expect(watch.status).toBe(200);
    expect(watch.body).toMatchObject({ roomId: g.room.roomId, access: 'spectator', numPlayers: game.minimum - 1,
      spectatorCount: 2, hostPlayerID: '0', status: 'lobby', history: [] });
    expect(watch.body.matchID).not.toBe(g.room.matchID);
    expect(watch.body.credentials).not.toBe(oldGuest.credentials);
    expect(watch.body.players.every((player: any) => player.ready)).toBe(true);
    expect(watch.body.spectators).toContainEqual({ id: watch.body.observerID, name: '玩家 1' });
    expect((await f.request(path(g.room), undefined, oldGuest)).status).toBe(401);
    expect((await f.request(path(g.room, 'join'), g.admissions[oldGuest.playerID!])).status).toBe(403);
    expect((await f.request(path(g.room, 'view?perspective=god'), undefined, watch.body as Member)).status).toBe(200);
    const play = await f.request(path(g.room, 'switch-role'), switchBody(watch.body.matchID, 'player'), watch.body as Member);
    expect(play.status).toBe(200);
    expect(play.body).toMatchObject({ access: 'player', numPlayers: game.minimum, spectatorCount: 1, history: [] });
    expect(play.body.credentials).not.toBe(watch.body.credentials);
    expect(play.body.players.find((player: any) => player.id === play.body.playerID)).toMatchObject({ name: '玩家 1', ready: false });
    expect(play.body.players.filter((player: any) => player.id !== play.body.playerID).every((player: any) => player.ready)).toBe(true);
    expect((await f.request(path(g.room), undefined, watch.body as Member)).status).toBe(401);
    expect((await f.request(path(g.room, 'join'), g.admissions[oldGuest.playerID!])).status).toBe(403);
    expect((await f.request(path(g.room, 'view?perspective=god'), undefined, play.body as Member)).status).toBe(403);
    expect((await f.request(path(other.room), undefined, other.room)).body).toEqual(otherBefore);
    const latest = (await f.request(path(g.room), undefined, g.room)).body;
    expect(latest.spectators).toEqual([{ id: g.observer.observerID, name: '觀戰朋友' }]);
    expect(JSON.stringify(latest)).not.toMatch(/credentials|credentialHash|inviteHash|roleSwitch/);
    expect((await f.request(path(g.room))).status).toBe(401);
    const after = await f.request(path(g.room, 'join'), {
      displayName: '原連結仍有效', inviteToken: fragment(g.room.inviteUrl), requestID: randomUUID(),
    });
    expect(after.status).toBe(200);
  });

  it.each(games)('keeps the host in charge while observing, starting, ending and rejoining $id', async game => {
    const f = await fixture(); const g = await group(f, game.id, game.minimum + 1);
    await ready(f, g.room, g.members);
    const oldSocket = await f.connect(game.id);
    await f.sync(oldSocket, g.room.matchID, g.room);
    const body = switchBody(g.room.matchID, 'spectator');
    const switched = await f.request(path(g.room, 'switch-role'), body, g.room);
    expect(switched.status).toBe(200);
    const host = switched.body as Member;
    expect(switched.body).toMatchObject({
      hostPlayerID: null, hostObserverID: host.observerID, numPlayers: game.minimum, spectatorCount: 2,
    });
    await vi.waitFor(() => expect(oldSocket.connected).toBe(false));
    expect((await f.request(path(g.room, 'invite'), {}, g.room)).status).toBe(401);
    for (const member of [g.observer, g.members[1]]) {
      for (const operation of ['invite', 'start', 'remove', 'return', 'abort', 'revoke-shares']) {
        expect((await f.request(path(g.room, operation), { matchID: switched.body.matchID }, member)).status).toBe(403);
      }
    }
    const rotated = await f.request(path(g.room, 'invite'), {}, host);
    expect(rotated.status).toBe(200);
    expect((await f.request(path(g.room, 'join'), {
      displayName: '過期邀請', inviteToken: fragment(g.room.inviteUrl), requestID: randomUUID(),
    })).status).toBe(403);
    const removed = switched.body.players.find((player: any) => player.id === g.members[1].playerID);
    expect((await f.request(path(g.room, 'remove'), {
      playerID: removed.id, membershipID: removed.membershipID, matchID: switched.body.matchID,
    }, host)).status).toBe(200);
    expect((await f.request(path(g.room), undefined, g.members[1])).status).toBe(401);
    const joined = await f.request(path(g.room, 'join'), {
      displayName: '替補朋友', inviteToken: fragment(rotated.body.inviteUrl), requestID: randomUUID(),
    });
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ hostPlayerID: null, hostObserverID: host.observerID, numPlayers: game.minimum });
    const players = [...g.members.slice(2), joined.body as Member];
    expect((await f.request(path(g.room, 'ready'), { ready: true }, host)).status).toBe(401);
    await ready(f, g.room, players);
    const started = await f.request(path(g.room, 'start'), { matchID: joined.body.matchID }, host);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ hostPlayerID: null, hostObserverID: host.observerID, numPlayers: game.minimum });
    const abort = await f.request(path(g.room, 'abort'), { matchID: started.body.matchID }, host);
    expect(abort.status).toBe(200);
    expect(abort.body).toMatchObject({ status: 'lobby', hostPlayerID: null, hostObserverID: host.observerID, numPlayers: game.minimum });
    expect(abort.body.history[0].ending).toBe('host-ended');
    await f.restart();
    const retry = await f.request(path(g.room, 'switch-role'), body, g.room);
    expect(retry.status).toBe(200);
    expect(retry.body.credentials).toBe(host.credentials);
    expect(retry.body).toMatchObject({ hostPlayerID: null, hostObserverID: host.observerID, matchID: abort.body.matchID });

    await ready(f, g.room, players);
    const again = await f.request(path(g.room, 'start'), { matchID: abort.body.matchID }, host);
    expect(again.status).toBe(200);
    const { state } = await f.app.db.fetch(again.body.matchID, { state: true });
    state!.G.status = 'finished';
    state!.G.winner = game.id === 'space-station' ? 'engineer' : 'agents';
    state!.G.winReason = game.id === 'space-station' ? 'all-repairs' : 'all-levels';
    state!._stateID++;
    await f.app.db.setState(again.body.matchID, state!);
    // Completion hold timing is tested separately. Preserve this completed game
    // while exercising observer-host authorization of the explicit return.
    const record = f.app.rooms.rooms.get(g.room.roomId)!;
    await f.app.rooms.save({ ...record, completedDisplay: { matchID: again.body.matchID, until: Date.now() - 1 } });
    expect((await f.request(path(g.room, 'return'), { matchID: again.body.matchID }, g.observer)).status).toBe(403);
    const completed = await f.request(path(g.room, 'return'), { matchID: again.body.matchID }, host);
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ status: 'lobby', hostPlayerID: null, hostObserverID: host.observerID });
    expect(completed.body.history.at(-1).ending).toBe('completed');
    const share = await f.request(path(g.room, 'share'), { matchID: again.body.matchID, frameIndex: 0 }, host);
    expect(share.status).toBe(200);
    const shareHeaders = { 'X-Replay-Token': fragment(share.body.url, 'share') };
    const shared = await f.request(`/api/replays/${g.room.roomId}`, undefined, undefined, shareHeaders);
    expect(shared.status).toBe(200);
    expect(shared.body.room).toMatchObject({ hostPlayerID: null, hostObserverID: null, spectators: [], spectatorCount: 0 });
    expect(JSON.stringify(shared.body)).not.toContain(host.observerID);
    expect((await f.request(path(g.room, 'revoke-shares'), {}, players[0])).status).toBe(403);
    expect((await f.request(path(g.room, 'revoke-shares'), {}, host)).status).toBe(200);
    expect((await f.request(`/api/replays/${g.room.roomId}`, undefined, undefined, shareHeaders)).status).toBe(403);
    await f.restart();
    expect((await f.request(path(g.room), undefined, host)).body).toMatchObject({
      hostPlayerID: null, hostObserverID: host.observerID, matchID: completed.body.matchID,
    });
    const returned = await f.request(path(g.room, 'switch-role'), switchBody(completed.body.matchID, 'player'), host);
    expect(returned.status).toBe(200);
    expect(returned.body).toMatchObject({ hostPlayerID: returned.body.playerID, hostObserverID: null, numPlayers: game.minimum + 1 });
    expect((await f.request(path(g.room, 'invite'), {}, returned.body as Member)).status).toBe(200);
    expect((await f.request(path(g.room, 'invite'), {}, host)).status).toBe(401);
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);
  }, 15000);

  it('retains the observer host in an empty lobby and transfers authority only when that host leaves', async () => {
    const f = await fixture(); const g = await group(f);
    const first = await f.request(path(g.room, 'switch-role'), switchBody(g.room.matchID, 'spectator'), g.room);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ hostPlayerID: null, hostObserverID: first.body.observerID });
    expect((await f.request(path(g.room, 'invite'), {}, first.body as Member)).status).toBe(200);
    const last = await f.request(path(g.room, 'switch-role'), switchBody(first.body.matchID, 'spectator'), g.members[1]);
    expect(last.status).toBe(200);
    expect(last.body).toMatchObject({ hostPlayerID: null, hostObserverID: first.body.observerID, numPlayers: 0, spectatorCount: 3, status: 'lobby' });
    const player = await f.request(path(g.room, 'switch-role'), switchBody(last.body.matchID, 'player'), g.observer);
    expect(player.status).toBe(200);
    expect(player.body).toMatchObject({ hostPlayerID: null, hostObserverID: first.body.observerID });
    expect((await f.request(path(g.room, 'invite'), {}, player.body as Member)).status).toBe(403);
    expect((await f.request(path(g.room, 'leave'), {}, first.body as Member)).status).toBe(200);
    const transferred = await f.request(path(g.room), undefined, player.body as Member);
    expect(transferred.body).toMatchObject({ hostPlayerID: player.body.playerID, hostObserverID: null });
    expect((await f.request(path(g.room, 'invite'), {}, player.body as Member)).status).toBe(200);
    expect((await f.request(path(g.room, 'invite'), {}, first.body as Member)).status).toBe(401);
    const observedAgain = await f.request(path(g.room, 'switch-role'), switchBody(transferred.body.matchID, 'spectator'), player.body as Member);
    expect(observedAgain.status).toBe(200);
    expect((await f.request(path(g.room, 'leave'), {}, observedAgain.body as Member)).status).toBe(200);
    const noHost = await f.request(path(g.room), undefined, last.body as Member);
    expect(noHost.body).toMatchObject({ hostPlayerID: null, hostObserverID: null, numPlayers: 0 });
    const nextHost = await f.request(path(g.room, 'switch-role'), switchBody(noHost.body.matchID, 'player'), last.body as Member);
    expect(nextHost.status).toBe(200);
    expect(nextHost.body).toMatchObject({ hostPlayerID: nextHost.body.playerID, hostObserverID: null });
    expect((await f.request(path(g.room, 'invite'), {}, nextHost.body as Member)).status).toBe(200);
  });

  it.each(games)('rejects full player seats in $id without revoking the observer or changing the room', async game => {
    const f = await fixture(); const g = await group(f, game.id, ROOM_CAPACITY);
    const before = (await f.request(path(g.room), undefined, g.room)).body;
    const result = await f.request(path(g.room, 'switch-role'), switchBody(before.matchID, 'player'), g.observer);
    expect(result.status).toBe(409);
    expect((await f.request(path(g.room), undefined, g.observer)).body).toEqual(before);
    expect((await f.request(path(g.room, 'view'), undefined, g.observer)).status).toBe(200);
  });

  it('rejects a full spectator roster without changing player authority', async () => {
    const f = await fixture(); const g = await group(f);
    const record = f.app.rooms.rooms.get(g.room.roomId)!;
    const spectators = { ...record.spectators };
    for (let index = Object.keys(spectators).length; index < 127; index++) {
      spectators[randomToken(12)] = { name: `觀眾 ${index}`, credentialHash: hashToken(randomToken()) };
    }
    await f.app.rooms.save({ ...record, spectators });
    const accepted = await f.request(path(g.room, 'switch-role'), switchBody(g.room.matchID, 'spectator'), g.members[1]);
    expect(accepted.status).toBe(200);
    expect(accepted.body.spectatorCount).toBe(128);
    const before = (await f.request(path(g.room), undefined, g.room)).body;
    expect((await f.request(path(g.room, 'switch-role'), switchBody(before.matchID, 'spectator'), g.room)).status).toBe(409);
    expect((await f.request(path(g.room), undefined, g.room)).body).toEqual(before);
    expect((await f.request(path(g.room, 'invite'), {}, g.room)).status).toBe(200);
  });

  it('checks role, request generation and room credentials before changing memberships', async () => {
    const f = await fixture(); const g = await group(f); const other = await group(f);
    const body = switchBody(g.room.matchID, 'spectator');
    expect((await f.request(path(g.room, 'switch-role'), body)).status).toBe(401);
    expect((await f.request(path(g.room, 'switch-role'), body, other.room)).status).toBe(401);
    for (const invalid of [{ ...body, access: 'god' }, { ...body, matchID: undefined },
      { ...body, requestID: undefined }, { ...body, requestID: 'request' }]) {
      expect((await f.request(path(g.room, 'switch-role'), invalid, g.room)).status).toBe(400);
    }
    expect((await f.request(path(g.room, 'switch-role'), { ...body, matchID: other.room.matchID }, g.room)).status).toBe(409);
    expect((await f.request(path(g.room, 'switch-role'), { ...body, access: 'player' }, g.room)).status).toBe(409);
    expect((await f.request(path(g.room, 'switch-role'), body, g.room, { 'X-Observer-ID': g.observer.observerID! })).status).toBe(401);
    expect((await f.request(path(g.room), undefined, g.room)).body).toMatchObject({ matchID: g.room.matchID, numPlayers: 2, spectatorCount: 1 });
  });

  it('recovers the same switched identity after a lost response and restart, but never resurrects a departed target', async () => {
    const f = await fixture(); const g = await group(f);
    const body = switchBody(g.room.matchID, 'player');
    const results = await Promise.all(Array.from({ length: 3 }, () => f.request(path(g.room, 'switch-role'), body, g.observer)));
    expect(results.map(result => result.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map(result => result.body.credentials)).size).toBe(1);
    const target = results[0].body as Member;
    const changeSomeoneElse = await f.request(path(g.room, 'switch-role'),
      switchBody(results[0].body.matchID, 'spectator'), g.members[1]);
    expect(changeSomeoneElse.status).toBe(200);
    await f.restart();
    const retry = await f.request(path(g.room, 'switch-role'), body, g.observer);
    expect(retry.status).toBe(200);
    expect(retry.body.credentials).toBe(target.credentials);
    expect(retry.body.matchID).toBe(changeSomeoneElse.body.matchID);
    expect((await f.request(path(g.room), undefined, g.observer)).status).toBe(401);
    expect((await f.request(path(g.room, 'watch'), g.watchBody)).status).toBe(403);
    expect((await f.request(path(g.room, 'switch-role'), { ...body, requestID: randomUUID() }, g.observer)).status).toBe(401);
    expect((await f.request(path(g.room, 'switch-role'), { ...body, access: 'spectator' }, g.observer)).status).toBe(401);
    expect((await f.request(path(g.room, 'leave'), {}, target)).status).toBe(200);
    expect((await f.request(path(g.room, 'switch-role'), body, g.observer)).status).toBe(401);
    expect((await f.request(path(g.room), undefined, target)).status).toBe(401);
  });

  it('does not let an earlier browser tab undo a subsequent role switch or reuse a removed seat', async () => {
    const f = await fixture(); const g = await group(f);
    const firstBody = switchBody(g.room.matchID, 'player');
    const first = await f.request(path(g.room, 'switch-role'), firstBody, g.observer);
    expect(first.status).toBe(200);
    const secondBody = switchBody(first.body.matchID, 'spectator');
    const second = await f.request(path(g.room, 'switch-role'), secondBody, first.body as Member);
    expect(second.status).toBe(200);
    expect((await f.request(path(g.room, 'switch-role'), firstBody, g.observer)).status).toBe(401);
    const thirdBody = switchBody(second.body.matchID, 'player');
    const third = await f.request(path(g.room, 'switch-role'), thirdBody, second.body as Member);
    expect(third.status).toBe(200);
    const member = third.body.players.find((player: any) => player.id === third.body.playerID);
    expect((await f.request(path(g.room, 'remove'), { playerID: member.id, membershipID: member.membershipID }, g.room)).status).toBe(200);
    const replacement = await f.request(path(g.room, 'join'), {
      displayName: '替補玩家', inviteToken: fragment(g.room.inviteUrl), requestID: randomUUID(),
    });
    expect(replacement.status).toBe(200);
    expect(replacement.body.playerID).toBe(third.body.playerID);
    expect((await f.request(path(g.room, 'switch-role'), thirdBody, second.body as Member)).status).toBe(401);
    expect((await f.request(path(g.room, 'switch-role'), secondBody, first.body as Member)).status).toBe(401);
    expect((await f.request(path(g.room), undefined, replacement.body as Member)).status).toBe(200);
  });

  it('commits one competing operation per old identity and does not overfill the final player seat', async () => {
    const f = await fixture(); const g = await group(f, 'encrypted-call', 3);
    const otherWatcher = await f.request(path(g.room, 'watch'), { ...g.watchBody, requestID: randomUUID(), displayName: '另一觀眾' });
    const outcomes = await Promise.all([g.observer, otherWatcher.body as Member].map(member =>
      f.request(path(g.room, 'switch-role'), switchBody(g.room.matchID, 'player'), member)));
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual([200, 409]);
    const after = (await f.request(path(g.room), undefined, g.room)).body;
    expect(after).toMatchObject({ numPlayers: 4, spectatorCount: 1 });
    expect(new Set(after.players.map((player: any) => player.id)).size).toBe(4);
    const concurrent = await Promise.all([0, 1].map(() =>
      f.request(path(g.room, 'switch-role'), switchBody(after.matchID, 'spectator'), g.members[1])));
    expect(concurrent.filter(result => result.status === 200)).toHaveLength(1);
    expect(concurrent.filter(result => result.status === 401)).toHaveLength(1);
    expect((await f.request(path(g.room), undefined, g.room)).body).toMatchObject({ numPlayers: 3, spectatorCount: 2 });
  });

  it.each(games)('serializes switching against stale ready/start requests and rejects changes after $id starts', async game => {
    const f = await fixture(); const g = await group(f, game.id, game.minimum);
    await ready(f, g.room, g.members);
    const queue = f.app.server.transport.getMatchQueue(g.room.matchID);
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(ok => { entered = ok; });
    const gate = new Promise<void>(ok => { release = ok; });
    const blocking = queue.add(async () => { entered(); await gate; });
    await started;
    const switching = f.request(path(g.room, 'switch-role'), switchBody(g.room.matchID, 'spectator'), g.members[1]);
    let readyRequest!: ReturnType<Fixture['request']>; let startRequest!: ReturnType<Fixture['request']>;
    try {
      await vi.waitFor(() => expect(queue.size).toBe(1));
      readyRequest = f.request(path(g.room, 'ready'), { matchID: g.room.matchID, ready: true }, g.members[1]);
      await vi.waitFor(() => expect(queue.size).toBe(2));
      startRequest = f.request(path(g.room, 'start'), { matchID: g.room.matchID }, g.room);
      await vi.waitFor(() => expect(queue.size).toBe(3));
    } finally { release(); await blocking; }
    const switched = await switching;
    expect(switched.status).toBe(200);
    expect((await readyRequest).status).toBe(409);
    expect((await startRequest).status).toBe(409);
    const playing = await f.request(path(g.room, 'switch-role'), switchBody(switched.body.matchID, 'player'), switched.body as Member);
    expect(playing.status).toBe(200);
    expect((await f.request(path(g.room, 'start'), { matchID: playing.body.matchID }, g.room)).status).toBe(409);
    expect((await f.request(path(g.room, 'ready'), { matchID: playing.body.matchID, ready: true }, playing.body as Member)).status).toBe(200);
    expect((await f.request(path(g.room, 'start'), { matchID: playing.body.matchID }, g.room)).status).toBe(200);
    const before = (await f.request(path(g.room), undefined, g.room)).body;
    expect((await f.request(path(g.room, 'switch-role'), switchBody(playing.body.matchID, 'spectator'), g.room)).status).toBe(409);
    expect((await f.request(path(g.room, 'switch-role'), switchBody(playing.body.matchID, 'player'), g.observer)).status).toBe(409);
    expect((await f.request(path(g.room), undefined, g.room)).body).toEqual(before);
  }, 12000);

  it('disconnects the old player sockets and rejects stale sync/move packets for either lobby generation', async () => {
    const f = await fixture(); const g = await group(f);
    const tabs = await Promise.all([f.connect('encrypted-call'), f.connect('encrypted-call')]);
    await Promise.all(tabs.map(socket => f.sync(socket, g.room.matchID, g.members[1])));
    const result = await f.request(path(g.room, 'switch-role'), switchBody(g.room.matchID, 'spectator'), g.members[1]);
    expect(result.status).toBe(200);
    await vi.waitFor(() => tabs.forEach(socket => expect(socket.connected).toBe(false)));
    const fresh = await f.connect('encrypted-call'); const received = vi.fn();
    fresh.on('sync', received); fresh.on('update', received);
    fresh.emit('sync', g.room.matchID, g.members[1].playerID, g.members[1].credentials, 2);
    fresh.emit('sync', result.body.matchID, g.members[1].playerID, g.members[1].credentials, 2);
    const before = (await f.app.db.fetch(result.body.matchID, { state: true })).state!;
    fresh.emit('update', { type: 'MAKE_MOVE', payload: { type: 'setReady', args: [true],
      playerID: g.members[1].playerID, credentials: g.members[1].credentials } },
    before._stateID, result.body.matchID, g.members[1].playerID);
    await new Promise(done => setTimeout(done, 100));
    expect(received).not.toHaveBeenCalled();
    expect((await f.app.db.fetch(result.body.matchID, { state: true })).state).toEqual(before);
    expect((await f.request(path(g.room, 'heartbeat'), { sessionID: randomUUID() }, g.members[1])).status).toBe(401);
  });

  it('expires old lobby socket presence after another member switches and everyone disconnects', async () => {
    const f = await fixture({ presenceLeaseMs: 600, lifecycleSweepMs: 25 });
    const g = await group(f);
    const socket = await f.connect('encrypted-call');
    await f.sync(socket, g.room.matchID, g.room);
    const switched = await f.request(path(g.room, 'switch-role'), switchBody(g.room.matchID, 'player'), g.observer);
    expect(switched.status).toBe(200);
    await vi.waitFor(() => expect(socket.connected).toBe(false));
    await ready(f, g.room, [...g.members, switched.body as Member]);
    const started = await f.request(path(g.room, 'start'), { matchID: switched.body.matchID }, g.room);
    expect(started.status).toBe(200);
    await vi.waitFor(() => {
      const record = f.app.rooms.rooms.get(g.room.roomId)!;
      expect(record.history).toContainEqual(expect.objectContaining({ matchID: started.body.matchID, ending: 'empty' }));
      expect(record.currentMatchID).not.toBe(started.body.matchID);
    }, { timeout: 2500, interval: 50 });
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  });

  it.each([
    { targetRole: 'player' as const, isHost: false }, { targetRole: 'spectator' as const, isHost: false },
    { targetRole: 'player' as const, isHost: true }, { targetRole: 'spectator' as const, isHost: true },
  ])('preserves the original credentials and host rights when publishing $targetRole fails (host: $isHost)', async ({ targetRole, isHost }) => {
    const f = await fixture(); const g = await group(f);
    let source: Member = isHost ? g.room : targetRole === 'player' ? g.observer : g.members[1];
    let sourceMatchID = g.room.matchID;
    if (isHost && targetRole === 'player') {
      const switched = await f.request(path(g.room, 'switch-role'), switchBody(sourceMatchID, 'spectator'), source);
      expect(switched.status).toBe(200);
      source = switched.body as Member;
      sourceMatchID = switched.body.matchID;
    }
    const before = (await f.request(path(g.room), undefined, source)).body;
    const storedBefore = await f.app.db.fetch(sourceMatchID, { metadata: true, state: true });
    const body = switchBody(sourceMatchID, targetRole);
    vi.spyOn(f.app.rooms, 'save').mockRejectedValueOnce(new Error('Injected room publication failure'));
    expect((await f.request(path(g.room, 'switch-role'), body, source)).status).toBe(500);
    expect((await f.request(path(g.room), undefined, source)).body).toEqual(before);
    expect(await f.app.db.fetch(sourceMatchID, { metadata: true, state: true })).toEqual(storedBefore);
    if (isHost) expect((await f.request(path(g.room, 'revoke-shares'), {}, source)).status).toBe(200);
    await f.restart();
    expect((await f.request(path(g.room), undefined, source)).body).toEqual(before);
    const retried = await f.request(path(g.room, 'switch-role'), body, source);
    expect(retried.status).toBe(200);
    expect((await f.request(path(g.room), undefined, source)).status).toBe(401);
    expect((await f.request(path(g.room), undefined, retried.body as Member)).status).toBe(200);
    if (isHost) {
      expect(retried.body).toMatchObject(targetRole === 'player'
        ? { hostPlayerID: retried.body.playerID, hostObserverID: null }
        : { hostPlayerID: null, hostObserverID: retried.body.observerID });
      expect((await f.request(path(g.room, 'revoke-shares'), {}, retried.body as Member)).status).toBe(200);
      expect((await f.request(path(g.room, 'revoke-shares'), {}, g.members[1])).status).toBe(403);
    }
  });

  it('shows names to authenticated members but excludes the live spectator roster and switch receipts from shared history', async () => {
    const f = await fixture(); const g = await group(f);
    const info = await f.request(path(g.room), undefined, g.observer);
    expect(info.body.spectators).toEqual([{ id: g.observer.observerID, name: '觀戰朋友' }]);
    expect(info.headers.get('cache-control')).toBe('no-store');
    await ready(f, g.room, g.members);
    expect((await f.request(path(g.room, 'start'), {}, g.room)).status).toBe(200);
    // Gameplay outcomes are covered separately; finish a stored match here to
    // exercise the current-roster versus historical-share projection boundary.
    const { state } = await f.app.db.fetch(g.room.matchID, { state: true });
    state!.G.status = 'finished'; state!.G.winner = 'agents'; state!.G.winReason = 'all-levels';
    state!._stateID++;
    await f.app.db.setState(g.room.matchID, state!);
    const lobby = await f.request(path(g.room), undefined, g.room);
    const changed = await f.request(path(g.room, 'switch-role'), switchBody(lobby.body.matchID, 'spectator'), g.members[1]);
    expect(changed.status).toBe(200);
    const share = await f.request(path(g.room, 'share'), { matchID: g.room.matchID, frameIndex: 0 }, changed.body as Member);
    expect(share.status).toBe(200);
    const replay = await f.request(`/api/replays/${g.room.roomId}`, undefined, undefined,
      { 'X-Replay-Token': fragment(share.body.url, 'share') });
    expect(replay.status).toBe(200);
    expect(replay.body.room).toMatchObject({ spectators: [], spectatorCount: 0, history: [], hostPlayerID: null, hostObserverID: null });
    expect(JSON.stringify(replay.body)).not.toMatch(/觀戰朋友|observerID|credentialHash|roleSwitch|requestID/);
    const privateReplay = await f.request(path(g.room, `replay?matchID=${g.room.matchID}`), undefined, g.room);
    expect(privateReplay.status).toBe(200);
    expect(privateReplay.body.room.spectators).toEqual([]);
  });
});
