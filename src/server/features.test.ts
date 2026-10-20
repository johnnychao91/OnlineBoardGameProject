import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createApplication, type AppConfig } from './app';
import { hashToken, randomToken } from './security';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); });

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-features-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-features-test-')) {
      throw new Error('Unexpected test directory');
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const config: AppConfig = {
    dataDir, publicOrigin: 'http://localhost:5173', host: '127.0.0.1',
    port: 0, production: false, createRoomKey: '',
  };
  let app = await createApplication(config);
  let running: Awaited<ReturnType<typeof app.listen>> | undefined = await app.listen();
  cleanups.push(async () => { if (running) await running.close(); });
  const request = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    if (!running) throw new Error('Test server is stopped');
    const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return {
    get app() { return app; }, request,
    async restart() {
      const previous = running;
      running = undefined;
      await previous?.close();
      app = await createApplication(config);
      running = await app.listen();
    },
    async create() {
      const response = await request('/api/rooms', { gameId: 'space-station', displayName: '站長' });
      expect(response.status).toBe(201);
      return response.body;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const seatHeaders = (seat: any) => ({ Authorization: `Bearer ${seat.credentials}`, 'X-Player-ID': seat.playerID });
const observerHeaders = (observer: any) => ({ Authorization: `Bearer ${observer.credentials}`, 'X-Observer-ID': observer.observerID });
const fragmentToken = (url: string, key: string) => new URLSearchParams(new URL(url).hash.slice(1)).get(key)!;
const inviteToken = (host: any) => fragmentToken(host.inviteUrl, 'invite');
const roomPath = (host: any, action = '') => `/api/rooms/${host.roomId}${action ? `/${action}` : ''}`;

async function joinPlayer(f: Fixture, host: any, displayName = '朋友') {
  const response = await f.request(roomPath(host, 'join'), {
    inviteToken: inviteToken(host), displayName, requestID: randomUUID(),
  });
  expect(response.status).toBe(200);
  return response.body;
}
async function watch(f: Fixture, host: any, requestID = randomUUID()) {
  const response = await f.request(roomPath(host, 'watch'), {
    inviteToken: inviteToken(host), displayName: '觀眾', requestID,
  });
  expect(response.status).toBe(200);
  return response.body;
}
async function ready(f: Fixture, host: any, seat: any, value = true) {
  const response = await f.request(roomPath(host, 'ready'), { ready: value }, seatHeaders(seat));
  expect(response.status).toBe(200);
  return response.body;
}
async function populatedRoom(f: Fixture, count: number) {
  const host = await f.create();
  const seats = [host];
  for (let i = 1; i < count; i++) seats.push(await joinPlayer(f, host, `朋友 ${i}`));
  for (const seat of seats) await ready(f, host, seat);
  return { host, seats };
}
async function startedRoom(f: Fixture, count = 4) {
  const room = await populatedRoom(f, count);
  const response = await f.request(roomPath(room.host, 'start'), {}, seatHeaders(room.host));
  expect(response.status).toBe(200);
  expect(response.body.status).toBe('briefing');
  return room;
}
async function finish(f: Fixture, host: any, winner = 'engineer', versionStep = 1) {
  const { state } = await f.app.db.fetch(host.roomId, { state: true });
  state.G.status = 'finished';
  state.G.winner = winner;
  state.G.winReason = winner === 'engineer' ? 'all-repairs' : 'hazard';
  state.G.activePlayer = null;
  for (const [id, player] of Object.entries(state.G.players)) {
    (player as any).revealedRole = state.G.private[id].role;
  }
  state.ctx.gameover = { winner, reason: state.G.winReason };
  state._stateID += versionStep;
  await f.app.db.setState(host.roomId, state);
}
function expectNoServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:seed|random|_random|_seed|plugins|metadata|credentials|credentialHash|inviteHash|inviteToken|initialState|ctx)"\s*:/);
}

describe('Dynamic participant counts and authorized start', () => {
  it.each([4, 5, 6, 7, 8])('starts with exactly %i occupied, ready seats and preserves their credentials', async (count) => {
    const f = await fixture();
    const { host, seats } = await populatedRoom(f, count);
    const observer = await watch(f, host);
    const before = await f.app.db.fetch(host.roomId, { state: true, metadata: true });
    expect(before.state.G.private).toEqual({});
    expect(before.state.G.secret).toBeUndefined();
    const started = await f.request(roomPath(host, 'start'), {}, seatHeaders(host));
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ numPlayers: count, minPlayers: 4, maxPlayers: 8, status: 'briefing', spectatorCount: 1 });
    expect(started.body.players).toHaveLength(count);
    const { state, initialState, metadata } = await f.app.db.fetch(host.roomId, { state: true, initialState: true, metadata: true });
    const ids = Array.from({ length: count }, (_, i) => String(i));
    expect(state.ctx.numPlayers).toBe(count);
    expect(state._stateID).toBeGreaterThan(before.state._stateID);
    expect(initialState).toEqual(state);
    expect(Object.keys(state.G.players)).toEqual(ids);
    expect(Object.keys(state.G.private)).toEqual(ids);
    expect(Object.keys(state.G.secret.cards)).toEqual(ids);
    expect(Object.keys(metadata.players)).toEqual(ids);
    expect(metadata.createdAt).toBe(before.metadata.createdAt);
    for (const seat of seats) {
      expect(metadata.players[seat.playerID].credentials).toBe(seat.credentials);
      expect((await f.request(roomPath(host), undefined, seatHeaders(seat))).status).toBe(200);
    }
    expect((await f.request(roomPath(host), undefined, observerHeaders(observer))).body.numPlayers).toBe(count);
    expect((await f.request(roomPath(host, 'join'), { inviteToken: inviteToken(host), displayName: '遲到玩家' })).status).toBe(409);
    expect((await f.request(roomPath(host, 'ready'), { ready: false }, seatHeaders(host))).status).toBe(409);
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).status).toBe(409);
  });

  it('rejects preselected counts, fewer than four players, unready seats, and non-host starts', async () => {
    const f = await fixture();
    expect((await f.request('/api/rooms', { gameId: 'space-station', displayName: '站長', numPlayers: 4 })).status).toBe(400);
    const { host, seats } = await populatedRoom(f, 3);
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).status).toBe(409);
    const fourth = await joinPlayer(f, host);
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).status).toBe(409);
    expect((await f.request(roomPath(host, 'ready'), { ready: 'true' }, seatHeaders(fourth))).status).toBe(400);
    await ready(f, host, fourth);
    await ready(f, host, seats[1], false);
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).status).toBe(409);
    await ready(f, host, seats[1]);
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(seats[1]))).status).toBe(403);
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).status).toBe(200);
  });

  it('caps participants at eight without counting spectators as seats', async () => {
    const f = await fixture();
    const { host } = await populatedRoom(f, 8);
    const observer = await watch(f, host);
    expect(observer).toMatchObject({ access: 'spectator', numPlayers: 8, spectatorCount: 1 });
    expect(observer.playerID).toBeUndefined();
    expect((await f.request(roomPath(host, 'join'), { inviteToken: inviteToken(host), displayName: '第九位' })).status).toBe(409);
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).body.numPlayers).toBe(8);
  });

  it('serializes a join racing with start without dropping or silently admitting a player', async () => {
    const f = await fixture();
    const { host } = await populatedRoom(f, 4);
    const [started, joined] = await Promise.all([
      f.request(roomPath(host, 'start'), {}, seatHeaders(host)),
      f.request(roomPath(host, 'join'), { inviteToken: inviteToken(host), displayName: '同時抵達', requestID: randomUUID() }),
    ]);
    expect([started.status, joined.status].sort()).toEqual([200, 409]);
    if (joined.status === 200) {
      expect(started.body.error).toContain('準備');
      await ready(f, host, joined.body);
      expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).status).toBe(200);
    }
    const expectedCount = joined.status === 200 ? 5 : 4;
    const { state, metadata } = await f.app.db.fetch(host.roomId, { state: true, metadata: true });
    expect(state.G.status).toBe('briefing');
    expect(state.ctx.numPlayers).toBe(expectedCount);
    expect(Object.keys(state.G.players)).toHaveLength(expectedCount);
    expect(Object.values(metadata.players).filter((player) => player.credentials)).toHaveLength(expectedCount);
    const info = await f.request(roomPath(host), undefined, seatHeaders(host));
    expect(info.body.numPlayers).toBe(expectedCount);
  });
});

describe('Host removes a waiting-room membership once', () => {
  it('revokes credentials and admission retries across restart, while allowing a fresh admission into the seat', async () => {
    const f = await fixture();
    const host = await f.create();
    const admission = { inviteToken: inviteToken(host), displayName: '朋友', requestID: randomUUID() };
    const guest = (await f.request(roomPath(host, 'join'), admission)).body;
    await ready(f, host, guest);
    const target = guest.players.find((player: any) => player.id === guest.playerID);
    const removal = { playerID: guest.playerID, membershipID: target.membershipID };
    const removed = await f.request(roomPath(host, 'remove'), removal, seatHeaders(host));
    expect(removed.status).toBe(200);
    expect(removed.body.numPlayers).toBe(1);
    expect(removed.body.players.map((player: any) => player.id)).toEqual(['0']);
    expectNoServerSecrets(removed.body);
    expect((await f.app.db.fetch(host.roomId, { state: true })).state.G.players['1'].ready).toBe(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await f.request(roomPath(host), undefined, seatHeaders(guest))).status).toBe(401);
      expect((await f.request(roomPath(host, 'ready'), { ready: true }, seatHeaders(guest))).status).toBe(401);
      expect(await f.request(roomPath(host, 'join'), admission)).toMatchObject({
        status: 403, body: { code: 'ADMISSION_REMOVED', error: expect.any(String) },
      });
      if (attempt === 0) await f.restart();
    }
    const replacement = await joinPlayer(f, host, '朋友');
    expect(replacement.playerID).toBe(guest.playerID);
    expect(replacement.credentials).not.toBe(guest.credentials);
    expect(replacement.players.find((player: any) => player.id === guest.playerID)).toMatchObject({ ready: false });
    expect((await f.request(roomPath(host, 'remove'), removal, seatHeaders(host))).status).toBe(409);
    expect((await f.request(roomPath(host), undefined, seatHeaders(replacement))).status).toBe(200);
    expect((await f.request(roomPath(host, 'join'), admission)).status).toBe(403);
  });

  it('requires the host and the current occupied membership, and refuses changes after start', async () => {
    const f = await fixture();
    const { host, seats } = await populatedRoom(f, 4);
    const observer = await watch(f, host);
    const target = seats[1].players.find((player: any) => player.id === seats[1].playerID);
    const removal = { playerID: target.id, membershipID: target.membershipID };
    expect((await f.request(roomPath(host, 'remove'), removal)).status).toBe(401);
    expect((await f.request(roomPath(host, 'remove'), removal, seatHeaders(seats[2]))).status).toBe(403);
    expect((await f.request(roomPath(host, 'remove'), removal, observerHeaders(observer))).status).toBe(401);
    for (const invalid of [
      { ...removal, playerID: '0' }, { ...removal, playerID: '../1' },
      { ...removal, playerID: 1 }, { playerID: '1' },
    ]) {
      expect((await f.request(roomPath(host, 'remove'), invalid, seatHeaders(host))).status).toBe(400);
    }
    expect((await f.request(roomPath(host, 'remove'), { ...removal, playerID: '7' }, seatHeaders(host))).status).toBe(409);
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).status).toBe(200);
    expect((await f.request(roomPath(host, 'remove'), removal, seatHeaders(host))).status).toBe(409);
    expect((await f.request(roomPath(host), undefined, seatHeaders(seats[1]))).status).toBe(200);
    await finish(f, host);
    expect((await f.request(roomPath(host, 'remove'), removal, seatHeaders(host))).status).toBe(409);
  });

  it('serializes start and removal so a started game retains every participant', async () => {
    const f = await fixture();
    const { host, seats } = await populatedRoom(f, 4);
    const target = seats[1].players.find((player: any) => player.id === seats[1].playerID);
    const [removed, started] = await Promise.all([
      f.request(roomPath(host, 'remove'), { playerID: target.id, membershipID: target.membershipID }, seatHeaders(host)),
      f.request(roomPath(host, 'start'), {}, seatHeaders(host)),
    ]);
    expect([removed.status, started.status].sort()).toEqual([200, 409]);
    const { state, metadata } = await f.app.db.fetch(host.roomId, { state: true, metadata: true });
    if (removed.status === 200) {
      expect(state.G.status).toBe('lobby');
      expect(metadata.players['1'].credentials).toBeUndefined();
      expect(Object.values(metadata.players).filter((player) => player.credentials)).toHaveLength(3);
    } else {
      expect(state.G.status).toBe('briefing');
      expect(metadata.players['1'].credentials).toBe(seats[1].credentials);
      expect(Object.keys(state.G.players)).toHaveLength(4);
    }
  });
});

describe('Independent, read-only spectators', () => {
  it('retries the same observer admission across invite rotation and restart without taking another seat', async () => {
    const f = await fixture();
    const { host } = await startedRoom(f);
    const requestID = randomUUID();
    const observer = await watch(f, host, requestID);
    const again = await watch(f, host, requestID);
    expect(again).toMatchObject({ observerID: observer.observerID, credentials: observer.credentials, numPlayers: 4, spectatorCount: 1 });
    expect(observer.credentials).not.toBe(host.credentials);
    expect(observer.inviteUrl).toBeUndefined();
    const record = f.app.rooms.rooms.get(host.roomId)!;
    expect(record.spectators?.[observer.observerID].credentialHash).toBe(hashToken(observer.credentials));
    expect(JSON.stringify(record)).not.toContain(observer.credentials);
    const rotated = await f.request(roomPath(host, 'invite'), {}, seatHeaders(host));
    expect(rotated.status).toBe(200);
    expect((await f.request(roomPath(host, 'watch'), { inviteToken: inviteToken(host), displayName: '新觀眾', requestID: randomUUID() })).status).toBe(403);
    await f.restart();
    expect((await watch(f, host, requestID)).observerID).toBe(observer.observerID);
    const info = await f.request(roomPath(host), undefined, observerHeaders(observer));
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ numPlayers: 4, spectatorCount: 1 });
    expectNoServerSecrets(info.body);
    expect((await f.request(roomPath(host, 'view?perspective=blind'), undefined, observerHeaders(observer))).status).toBe(200);
  });

  it('uses separate credential domains for player and spectator admissions with the same nonce', async () => {
    const f = await fixture();
    const host = await f.create();
    const body = { inviteToken: inviteToken(host), displayName: '朋友', requestID: randomUUID() };
    const player = (await f.request(roomPath(host, 'join'), body)).body;
    const observer = (await f.request(roomPath(host, 'watch'), body)).body;
    expect(player.access).toBe('player');
    expect(observer.access).toBe('spectator');
    expect(observer.credentials).not.toBe(player.credentials);
    expect((await f.request(roomPath(host), undefined, observerHeaders({ ...observer, credentials: player.credentials }))).status).toBe(401);
    expect((await f.request(roomPath(host), undefined, seatHeaders({ ...player, credentials: observer.credentials }))).status).toBe(401);
  });

  it('enforces the 128 spectator limit while allowing an idempotent admission retry at capacity', async () => {
    const f = await fixture();
    const host = await f.create();
    const room = f.app.rooms.rooms.get(host.roomId)!;
    const spectators = Object.fromEntries(Array.from({ length: 127 }, () => [randomToken(12), { name: '觀眾', credentialHash: hashToken(randomToken()) }]));
    await f.app.rooms.save({ ...room, spectators });
    const requestID = randomUUID();
    const observer = await watch(f, host, requestID);
    expect(observer).toMatchObject({ numPlayers: 1, spectatorCount: 128 });
    expect((await watch(f, host, requestID)).observerID).toBe(observer.observerID);
    expect((await f.request(roomPath(host, 'watch'), { inviteToken: inviteToken(host), displayName: '太多觀眾' })).status).toBe(409);
    expect((await f.request(roomPath(host), undefined, seatHeaders(host))).body.numPlayers).toBe(1);
  });

  it('projects live blind and god views without server data or roles for unoccupied seats', async () => {
    const f = await fixture();
    const { host } = await populatedRoom(f, 4);
    const observer = await watch(f, host);
    for (const perspective of ['blind', 'god']) {
      const lobby = await f.request(roomPath(host, `view?perspective=${perspective}`), undefined, observerHeaders(observer));
      expect(lobby.status).toBe(200);
      expect(lobby.body.G.private).toEqual({});
      expect(lobby.body.G.secret).toBeUndefined();
      expectNoServerSecrets(lobby.body);
    }
    expect((await f.request(roomPath(host, 'start'), {}, seatHeaders(host))).status).toBe(200);
    const raw = await f.app.db.fetch(host.roomId, { state: true, metadata: true });
    const blind = await f.request(roomPath(host, 'view?perspective=blind'), undefined, observerHeaders(observer));
    expect(blind.status).toBe(200);
    expect(blind.body).toMatchObject({ perspective: 'blind', stateID: raw.state._stateID });
    expect(blind.body.G.private).toEqual({});
    expect(blind.body.G.secret).toBeUndefined();
    expect(Object.values(blind.body.G.players).every((player: any) => player.revealedRole === undefined)).toBe(true);
    const god = await f.request(roomPath(host, 'view?perspective=god'), undefined, observerHeaders(observer));
    expect(god.status).toBe(200);
    expect(god.body.G.private).toEqual(raw.state.G.private);
    expect(god.body.G.secret.cards).toEqual(raw.state.G.secret.cards);
    expect(Object.keys(god.body.G.private)).toEqual(['0', '1', '2', '3']);
    expect(Object.keys(god.body.G.secret.cards)).toEqual(['0', '1', '2', '3']);
    for (const view of [blind, god]) {
      expect(Object.keys(view.body).sort()).toEqual(['G', 'perspective', 'stateID']);
      expectNoServerSecrets(view.body);
      expect(JSON.stringify(view.body)).not.toContain(host.credentials);
      expect(JSON.stringify(view.body)).not.toContain(raw.state.plugins.random.data.seed);
      expect(view.headers.get('cache-control')).toBe('no-store');
    }
    expect((await f.request(roomPath(host, 'view?perspective=other'), undefined, observerHeaders(observer))).status).toBe(400);
    expect((await f.request(roomPath(host, 'view?perspective=god'), undefined, seatHeaders(host))).status).toBe(403);
    expect((await f.request(roomPath(host, 'view'), undefined)).status).toBe(401);
  });

  it('rejects observer credentials for every player mutation and mixed viewer credentials', async () => {
    const f = await fixture();
    const host = await f.create();
    const observer = await watch(f, host);
    for (const operation of ['ready', 'start', 'invite', 'revoke-shares']) {
      expect((await f.request(roomPath(host, operation), { ready: true }, observerHeaders(observer))).status).toBe(401);
      expect((await f.request(roomPath(host, operation), { ready: true }, seatHeaders({ playerID: '0', credentials: observer.credentials }))).status).toBe(401);
    }
    expect((await f.request(roomPath(host), undefined, { ...observerHeaders(observer), 'X-Player-ID': '0' })).status).toBe(401);
    const { state } = await f.app.db.fetch(host.roomId, { state: true });
    expect(state.G.status).toBe('lobby');
    expect(state.G.players['0'].ready).toBe(false);
    expect((await f.request(roomPath(host), undefined, observerHeaders(observer))).body.numPlayers).toBe(1);
  });
});

describe('Completed replay access and scoped sharing', () => {
  it('blocks replay and sharing before completion for both players and spectators', async () => {
    const f = await fixture();
    const { host } = await startedRoom(f);
    const observer = await watch(f, host);
    for (const headers of [seatHeaders(host), observerHeaders(observer)]) {
      expect((await f.request(roomPath(host, 'replay?perspective=god'), undefined, headers)).status).toBe(409);
      expect((await f.request(roomPath(host, 'share'), { frameIndex: 0, perspective: 'god' }, headers)).status).toBe(409);
    }
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  });

  it('returns persisted, filtered replay frames after completion without exposing plugins or credentials', async () => {
    const f = await fixture();
    const { host } = await startedRoom(f);
    const observer = await watch(f, host);
    await finish(f, host);
    await f.restart();
    const blind = await f.request(roomPath(host, 'replay'), undefined, seatHeaders(host));
    const god = await f.request(roomPath(host, 'replay?perspective=god'), undefined, observerHeaders(observer));
    expect(blind.status).toBe(200);
    expect(god.status).toBe(200);
    for (const replay of [blind, god]) {
      expect(replay.body.complete).toBe(true);
      expect(replay.body.frames).toHaveLength(2);
      expect(replay.body.frames.map((frame: any) => frame.G.status)).toEqual(['briefing', 'finished']);
      expect(replay.body.frames[1].stateID).toBe(replay.body.frames[0].stateID + 1);
      for (const frame of replay.body.frames) {
        expect(Object.keys(frame).sort()).toEqual(['G', 'at', 'stateID']);
        expect(frame.at).toEqual(expect.any(Number));
      }
      expectNoServerSecrets(replay.body);
      expect(JSON.stringify(replay.body)).not.toContain(host.credentials);
      expect(JSON.stringify(replay.body)).not.toContain(observer.credentials);
    }
    expect(blind.body.frames.every((frame: any) => Object.keys(frame.G.private).length === 0 && !frame.G.secret)).toBe(true);
    expect(Object.keys(god.body.frames[0].G.private)).toHaveLength(4);
    expect(god.body.frames[0].G.secret.cards).toBeDefined();
    expect((await f.request(roomPath(host, 'view?perspective=god'), undefined, seatHeaders(host))).status).toBe(200);
  });

  it('keeps incomplete histories explicit and refuses to share them', async () => {
    const f = await fixture();
    const { host } = await startedRoom(f);
    await finish(f, host, 'engineer', 2);
    const replay = await f.request(roomPath(host, 'replay'), undefined, seatHeaders(host));
    expect(replay.status).toBe(200);
    expect(replay.body.complete).toBe(false);
    expect((await f.request(roomPath(host, 'share'), { frameIndex: 0, perspective: 'blind' }, seatHeaders(host))).status).toBe(409);
  });

  it('locks a seven-day share to its issued frame and perspective and isolates its token from other credentials', async () => {
    const f = await fixture();
    const { host, seats } = await startedRoom(f);
    const observer = await watch(f, host);
    await finish(f, host);
    const before = Date.now();
    const share = await f.request(roomPath(host, 'share'), { frameIndex: 1, perspective: 'blind' }, seatHeaders(seats[1]));
    expect(share.status).toBe(200);
    const url = new URL(share.body.url);
    const token = fragmentToken(share.body.url, 'share');
    expect(url.origin).toBe('http://localhost:5173');
    expect(url.pathname).toBe(`/replay/${host.roomId}`);
    expect(url.search).toBe('');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(share.body.expiresAt).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    expect(share.body.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(share.body.url).not.toContain(host.credentials);
    expect(share.body.url).not.toContain(observer.credentials);
    const record = f.app.rooms.rooms.get(host.roomId)!;
    expect(record.replayShares?.[0]).toMatchObject({ tokenHash: hashToken(token), frameIndex: 1, perspective: 'blind' });
    expect(JSON.stringify(record)).not.toContain(token);
    const path = `/api/replays/${host.roomId}`;
    for (const value of ['', host.credentials, observer.credentials, inviteToken(host)]) {
      expect((await f.request(path, undefined, value ? { 'X-Replay-Token': value } : {})).status).toBe(403);
    }
    const shared = await f.request(`${path}?perspective=god&frameIndex=0`, undefined, { 'X-Replay-Token': token });
    expect(shared.status).toBe(200);
    expect(shared.body).toMatchObject({ perspective: 'blind', frameIndex: 1, complete: true, room: { roomId: host.roomId, numPlayers: 4 } });
    expect(shared.body.frames).toHaveLength(2);
    expect(shared.body.frames.every((frame: any) => Object.keys(frame.G.private).length === 0 && !frame.G.secret)).toBe(true);
    expectNoServerSecrets(shared.body);
    expect(shared.headers.get('cache-control')).toBe('no-store');
    expect((await f.request(roomPath(host), undefined, seatHeaders({ ...host, credentials: token }))).status).toBe(401);
    expect((await f.request(roomPath(host), undefined, observerHeaders({ ...observer, credentials: token }))).status).toBe(401);
    expect((await f.request(roomPath(host, 'replay'), undefined, { 'X-Replay-Token': token })).status).toBe(401);
    expect((await f.request(roomPath(host, 'share'), { frameIndex: 0 }, { 'X-Replay-Token': token })).status).toBe(401);
    const godShare = await f.request(roomPath(host, 'share'), { frameIndex: 0, perspective: 'god' }, observerHeaders(observer));
    expect(godShare.status).toBe(200);
    const godToken = fragmentToken(godShare.body.url, 'share');
    expect(godToken).not.toBe(token);
    const god = await f.request(`${path}?perspective=blind`, undefined, { 'X-Replay-Token': godToken });
    expect(god.status).toBe(200);
    expect(god.body).toMatchObject({ perspective: 'god', frameIndex: 0 });
    expect(Object.keys(god.body.frames[0].G.private)).toHaveLength(4);
    expectNoServerSecrets(god.body);
    await f.restart();
    expect((await f.request(path, undefined, { 'X-Replay-Token': token })).body.perspective).toBe('blind');
    expect((await f.request(path, undefined, { 'X-Replay-Token': godToken })).body.perspective).toBe('god');
  });

  it('validates share inputs and authorization and applies expiry and host-only revocation', async () => {
    const f = await fixture();
    const { host, seats } = await startedRoom(f);
    const observer = await watch(f, host);
    await finish(f, host);
    for (const body of [
      { frameIndex: -1 }, { frameIndex: 2 }, { frameIndex: 0.5 },
      { frameIndex: '0' }, { perspective: 'blind' }, { frameIndex: 0, perspective: 'other' },
    ]) {
      expect((await f.request(roomPath(host, 'share'), body, seatHeaders(host))).status).toBe(400);
    }
    expect((await f.request(roomPath(host, 'share'), { frameIndex: 0 })).status).toBe(401);
    expect((await f.request(roomPath(host, 'share'), { frameIndex: 0 }, observerHeaders({ ...observer, credentials: randomToken() }))).status).toBe(401);
    const expired = await f.request(roomPath(host, 'share'), { frameIndex: 0 }, seatHeaders(host));
    expect(expired.status).toBe(200);
    const expiredToken = fragmentToken(expired.body.url, 'share');
    const room = f.app.rooms.rooms.get(host.roomId)!;
    await f.app.rooms.save({ ...room, replayShares: room.replayShares!.map((share) => ({ ...share, expiresAt: Date.now() - 1 })) });
    expect((await f.request(`/api/replays/${host.roomId}`, undefined, { 'X-Replay-Token': expiredToken })).status).toBe(403);
    const active = await f.request(roomPath(host, 'share'), { frameIndex: 0, perspective: 'god' }, observerHeaders(observer));
    expect(active.status).toBe(200);
    const activeToken = fragmentToken(active.body.url, 'share');
    expect(f.app.rooms.rooms.get(host.roomId)!.replayShares).toHaveLength(1);
    expect((await f.request(roomPath(host, 'revoke-shares'), {}, seatHeaders(seats[1]))).status).toBe(403);
    expect((await f.request(roomPath(host, 'revoke-shares'), {}, observerHeaders(observer))).status).toBe(401);
    expect((await f.request(`/api/replays/${host.roomId}`, undefined, { 'X-Replay-Token': activeToken })).status).toBe(200);
    const revoked = await f.request(roomPath(host, 'revoke-shares'), {}, seatHeaders(host));
    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ revoked: true });
    await f.restart();
    expect((await f.request(`/api/replays/${host.roomId}`, undefined, { 'X-Replay-Token': activeToken })).status).toBe(403);
    expect((await f.request(roomPath(host, 'replay'), undefined, observerHeaders(observer))).status).toBe(200);
  });
});

describe('Derived completed-game statistics', () => {
  it('counts each completed match once by game, faction, and actual player count across retries and restarts', async () => {
    const f = await fixture();
    expect((await f.request('/api/stats')).body).toMatchObject({ completedGames: 0, totalPlayerParticipations: 0 });
    const four = await startedRoom(f, 4);
    const five = await startedRoom(f, 5);
    await startedRoom(f, 6);
    await f.create();
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
    const observer = await watch(f, four.host);
    await finish(f, four.host);
    const once = await f.request('/api/stats');
    expect(once.status).toBe(200);
    expect(once.body).toMatchObject({ completedGames: 1, totalPlayerParticipations: 4, byGame: [{
      gameId: 'space-station', completed: 1, wins: { engineer: 1 }, reasons: { 'all-repairs': 1 },
      byPlayerCount: [{ numPlayers: 4, completed: 1, wins: { engineer: 1 } }],
    }] });
    expect((await f.request(roomPath(four.host, 'share'), { frameIndex: 0 }, observerHeaders(observer))).status).toBe(200);
    expect((await f.request(roomPath(four.host, 'replay'), undefined, seatHeaders(four.host))).status).toBe(200);
    // Re-saving the exact final version is a transport retry, not another result.
    const { state } = await f.app.db.fetch(four.host.roomId, { state: true });
    await f.app.db.setState(four.host.roomId, state);
    const repeated = await Promise.all(Array.from({ length: 3 }, () => f.request('/api/stats')));
    for (const response of repeated) expect(response.body).toEqual(once.body);
    await finish(f, five.host, 'saboteur');
    const total = await f.request('/api/stats');
    expect(total.body).toMatchObject({ completedGames: 2, totalPlayerParticipations: 9, byGame: [{
      gameId: 'space-station', completed: 2, wins: { engineer: 1, saboteur: 1 },
      reasons: { 'all-repairs': 1, hazard: 1 },
      byPlayerCount: [
        { numPlayers: 4, completed: 1, wins: { engineer: 1 } },
        { numPlayers: 5, completed: 1, wins: { saboteur: 1 } },
      ],
    }] });
    expectNoServerSecrets(total.body);
    expect(JSON.stringify(total.body)).not.toContain(four.host.roomId);
    expect(JSON.stringify(total.body)).not.toContain('站長');
    await f.restart();
    expect((await f.request('/api/stats')).body).toEqual(total.body);
  });
});
