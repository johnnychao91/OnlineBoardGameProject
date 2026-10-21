import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import type { State, SyncInfo } from 'boardgame.io';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from './app';
import type { MoonState } from '../games/moon/game';
import { DEFAULT_MOON_OPTIONS } from '../games/moon/rules';

type Member = { playerID?: string; observerID?: string; credentials: string };
type Group = { host: any; seats: Member[]; observer: Member; matchID: string; gameId: string; sockets: Socket[] };
type Snapshot = State<MoonState>;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
const token = (url: string, key = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(key)!;
const path = (g: Group, route = '') => `/api/rooms/${g.host.roomId}${route ? `/${route}` : ''}`;
const noSecrets = (value: unknown) => expect(JSON.stringify(value)).not.toMatch(/"(?:secret|nightAdvance|attackTieOrder|seed|prngstate|credentials|credentialHash|inviteHash)"\s*:/);

async function fixture() {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-moon-integration-'));
  cleanup.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-moon-integration-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: 'http://localhost:5173', host: '127.0.0.1', port: 0,
    production: false, createRoomKey: '', lifecycleSweepMs: 60000, clockSweepMs: 20 };
  let app = await createApplication(config), running = await app.listen();
  const sockets: Socket[] = [], views = new Map<Socket, Snapshot>();
  const setClock = (next: number) => {
    now = next;
    // Only game time is advanced. Keep Engine.IO's wall-clock heartbeat lease
    // alive while the real networking timers have not elapsed.
    for (const socket of sockets) if (socket.io.engine) (socket.io.engine as any)._pingTimeoutTime = now + 60000;
  };
  cleanup.push(async () => { sockets.forEach(s => s.disconnect()); await running.close(); });
  const request = async (url: string, body?: unknown, member?: Member, headers?: Record<string, string>) => {
    const response = await fetch(`http://127.0.0.1:${running.port}${url}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(member ? { Authorization: `Bearer ${member.credentials}`,
        ...(member.observerID ? { 'X-Observer-ID': member.observerID } : { 'X-Player-ID': member.playerID! }) } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any, clock: response.headers.get('X-Boardgame-Time') };
  };
  const state = async (g: Group) => (await app.db.fetch(g.matchID, { state: true })).state! as Snapshot;
  const connect = async (g: Group, seat: Member) => {
    const socket = io(`http://127.0.0.1:${running.port}/${g.gameId}`, { transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
    sockets.push(socket); socket.on('error', () => {});
    const inspectWire = (value: State, log: unknown) => {
      noSecrets(value);
      if (g.gameId === 'silver-moon') {
        expect(log).toEqual([]); expect(value.ctx.numMoves).toBe(0);
        expect(Object.values(value.ctx._activePlayersNumMoves ?? {}).every(count => count === 0)).toBe(true);
      }
    };
    socket.on('sync', (_id: string, info: SyncInfo) => {
      noSecrets(info); inspectWire(info.state, info.log); inspectWire(info.initialState, []); views.set(socket, info.state as Snapshot);
    });
    socket.on('update', (_id: string, value: Snapshot, log: unknown) => { inspectWire(value, log); views.set(socket, value); });
    await new Promise<void>((ok, reject) => { socket.once('connect', ok); socket.once('connect_error', reject); socket.connect(); });
    socket.emit('sync', g.matchID, seat.playerID, seat.credentials, g.seats.length);
    await vi.waitFor(() => expect(views.has(socket)).toBe(true), { timeout: 3000, interval: 10 });
    return socket;
  };
  const move = async (g: Group, id: string, type: string, args: unknown[], valid = true) => {
    const index = g.seats.findIndex(s => s.playerID === id), before = await state(g);
    g.sockets[index].emit('update', { type: 'MAKE_MOVE', payload: { type, args, playerID: id, credentials: g.seats[index].credentials } }, before._stateID, g.matchID, id);
    if (valid) await vi.waitFor(async () => expect((await state(g))._stateID, `${type} by ${id} during ${before.G.status} epoch ${before.G.epoch}`).toBeGreaterThan(before._stateID), { timeout: 3000, interval: 10 });
    else { await new Promise(ok => setTimeout(ok, 60)); expect((await state(g))._stateID).toBe(before._stateID); }
    return state(g);
  };
  const expire = async (g: Group) => {
    const before = await state(g); expect(before.G.deadline).not.toBeNull(); setClock(before.G.deadline!);
    await vi.waitFor(async () => expect((await state(g))._stateID).toBeGreaterThan(before._stateID), { timeout: 3000, interval: 10 });
    const after = await state(g);
    await vi.waitFor(() => g.sockets.forEach(s => expect(views.get(s)!._stateID).toBe(after._stateID)), { timeout: 3000, interval: 10 });
    return after;
  };
  return { request, state, move, expire, views, get app() { return app; },
    advance(ms: number) { setClock(now + ms); },
    async restart(g: Group) { sockets.forEach(s => s.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); g.sockets = await Promise.all(g.seats.map(s => connect(g, s))); },
    async group(gameId = 'silver-moon', count = 6): Promise<Group> {
      const created = await request('/api/rooms', { gameId, displayName: '列車長' }); expect(created.status).toBe(201);
      const host = created.body, seats: Member[] = [host];
      for (let i = 1; i < count; i++) { const joined = await request(`/api/rooms/${host.roomId}/join`, { inviteToken: token(host.inviteUrl), displayName: `乘客 ${i}`, requestID: randomUUID() }); expect(joined.status).toBe(200); seats.push(joined.body); }
      const observed = await request(`/api/rooms/${host.roomId}/watch`, { inviteToken: token(host.inviteUrl), displayName: '觀戰朋友' }); expect(observed.status).toBe(200);
      return { host, seats, observer: observed.body, matchID: host.matchID, gameId, sockets: [] };
    },
    async start(g: Group, options?: Record<string, unknown>) {
      if (options) { const result = await request(path(g, 'options'), { matchID: g.matchID, options }, g.host); expect(result.status).toBe(200); g.matchID = result.body.matchID; }
      for (const seat of g.seats) expect((await request(path(g, 'ready'), { ready: true }, seat)).status).toBe(200);
      const started = await request(path(g, 'start'), { matchID: g.matchID }, g.host); expect(started.status).toBe(200); g.matchID = started.body.matchID;
      g.sockets = await Promise.all(g.seats.map(s => connect(g, s)));
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function ack(f: Fixture, g: Group) {
  const { G } = await f.state(g);
  for (const id of Object.keys(G.players).filter(id => G.players[id].alive)) await f.move(g, id, 'acknowledge', [G.epoch]);
}
async function quietNight(f: Fixture, g: Group) {
  for (let slot = 0; slot < 4; slot++) {
    const before = await f.state(g); expect(before.G).toMatchObject({ status: 'night', nightStep: slot });
    await f.expire(g);
  }
  expect((await f.state(g)).G.status).toBe('dawn');
}
async function speeches(f: Fixture, g: Group) {
  for (let i = 0; i < 12; i++) {
    const { G } = await f.state(g);
    if (G.status !== 'speaking') break;
    await f.move(g, G.speakerID!, 'finishSpeech', [G.epoch]);
  }
  expect((await f.state(g)).G.status).toBe('voting');
}

describe('Silver Moon shared framework and authoritative timers', () => {
  it.each(['online', 'assisted'] as const)('%s completes a real socket match and preserves sharing, statistics and lobby', async mode => {
    const f = await fixture(), g = await f.group(); await f.start(g, { ...DEFAULT_MOON_OPTIONS, mode });
    for (let i = 0; i < g.sockets.length; i++) expect(Object.keys(f.views.get(g.sockets[i])!.G.private)).toEqual([g.seats[i].playerID]);
    const blind = await f.request(path(g, 'view?perspective=blind'), undefined, g.observer);
    expect(blind.body.G.private).toEqual({}); noSecrets(blind.body.G); expect(Number(blind.clock)).toBe(Date.now());
    const wolves = Object.keys((await f.state(g)).G.private).filter(id => (f.views.get(g.sockets[Number(id)])!.G.private[id].role === 'wolf'));
    await ack(f, g);
    for (const wolf of wolves) {
      await quietNight(f, g); await ack(f, g);
      const first = (await f.state(g)).G;
      const wrong = Object.keys(first.players).find(id => id !== first.speakerID && first.players[id].alive)!;
      await f.move(g, wrong, 'finishSpeech', [first.epoch], false);
      await speeches(f, g);
      const { G } = await f.state(g), living = Object.keys(G.players).filter(id => G.players[id].alive);
      await f.move(g, living[0], 'exileVote', [wolf, G.epoch]);
      expect((await f.request(path(g, 'view?perspective=blind'), undefined, g.observer)).body.G.private).toEqual({});
      const lastWolf = wolf === wolves.at(-1);
      for (const id of (lastWolf ? living.slice(1, -1) : living.slice(1))) await f.move(g, id, 'exileVote', [wolf, G.epoch]);
      if (lastWolf) await f.expire(g);
      if ((await f.state(g)).G.status !== 'finished') await ack(f, g);
    }
    expect((await f.state(g)).G).toMatchObject({ status: 'finished', winner: 'town' });
    expect((await f.state(g)).ctx.gameover).toEqual({ winner: 'town', reason: 'wolves-eliminated' });
    const share = await f.request(path(g, 'share'), { matchID: g.matchID, frameIndex: 0, perspective: 'blind' }, g.host);
    expect(share.status).toBe(200);
    const shared = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': token(share.body.url, 'share') });
    expect(shared.status).toBe(200); expect(shared.body.complete).toBe(true);
    shared.body.frames.forEach((frame: any) => { expect(frame.G.private).toEqual({}); noSecrets(frame.G); });
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);
    await f.request(path(g), undefined, g.host); f.advance(8001);
    const lobby = (await f.request(path(g), undefined, g.host)).body;
    expect(lobby.status).toBe('lobby'); expect(lobby.matchID).not.toBe(g.matchID); expect(lobby.gameOptions.mode).toBe(mode);
    expect(lobby.players).toHaveLength(6); expect(lobby.spectatorCount).toBe(1);
  }, 30000);

  it('elects an optional sheriff, accepts only the current speaker, and preserves deadlines across restart', async () => {
    const f = await fixture(), g = await f.group(); await f.start(g, { ...DEFAULT_MOON_OPTIONS, sheriff: true, speechSeconds: 45 });
    await ack(f, g); await quietNight(f, g); await ack(f, g);
    let G = (await f.state(g)).G; expect(G.status).toBe('sheriff-signup');
    for (const id of ['0', '1']) await f.move(g, id, 'standForSheriff', [true, G.epoch]);
    await f.expire(g);
    for (let i = 0; i < 2; i++) { G = (await f.state(g)).G; await f.move(g, G.speakerID!, 'finishSpeech', [G.epoch]); }
    G = (await f.state(g)).G; expect(G.status).toBe('sheriff-voting');
    await f.move(g, '0', 'sheriffVote', ['0', G.epoch], false);
    for (const id of ['2', '3', '4', '5']) await f.move(g, id, 'sheriffVote', ['0', G.epoch]);
    G = (await f.state(g)).G; expect(G).toMatchObject({ sheriffID: '0', status: 'sheriff-order' });
    await f.move(g, '0', 'chooseOrder', ['3', 'counterclockwise', G.epoch]);
    const before = (await f.state(g)).G; expect(before.speakingOrder).toEqual(['3', '2', '1', '0', '5', '4']);
    await f.restart(g);
    expect((await f.state(g)).G.deadline).toBe(before.deadline);
    const after = await f.expire(g); expect(after.G.speakerID).toBe('2'); expect(after.G.deadline).toBe(Date.now() + 45000);
    await f.move(g, '3', 'finishSpeech', [before.epoch], false);
    expect((await f.request(path(g, 'abort'), { matchID: g.matchID }, g.host)).status).toBe(200);
    const archive = await f.state(g); f.advance(60000); await new Promise(ok => setTimeout(ok, 60));
    expect((await f.state(g))._stateID).toBe(archive._stateID);
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  }, 30000);

  it('advances a unanimous wolf choice after three hidden seconds without affecting other rooms', async () => {
    const f = await fixture(), a = await f.group(), b = await f.group(), c = await f.group('encrypted-call', 2);
    await f.start(a); await f.start(b, { ...DEFAULT_MOON_OPTIONS, mode: 'assisted', nightSeconds: 45 }); await f.start(c);
    await ack(f, a); await ack(f, b);
    const bBefore = await f.state(b), cBefore = await f.state(c);
    await f.expire(a);
    expect((await f.state(b))._stateID).toBe(bBefore._stateID); expect((await f.state(c))._stateID).toBe(cBefore._stateID);
    const { G } = await f.state(a), wolves = Object.keys(G.private).filter(id => G.private[id].role === 'wolf');
    const target = Object.keys(G.private).find(id => G.private[id].role !== 'wolf')!;
    for (const id of wolves) await f.move(a, id, 'wolfVote', [target, G.epoch]);
    expect((await f.state(a)).G).toMatchObject({ status: 'night', nightStep: 1, deadline: G.deadline });
    for (let i = 0; i < a.sockets.length; i++) {
      const view = f.views.get(a.sockets[i])!.G; expect(view.secret).toBeUndefined();
      expect(Object.keys(view.private)).toEqual([a.seats[i].playerID]);
      if (!wolves.includes(a.seats[i].playerID!)) expect(view.private[a.seats[i].playerID!].wolfVotes).toEqual({});
    }
    expect((await f.request(path(a, 'view?perspective=god'), undefined, b.observer)).status).toBe(401);
    const viewed = await f.request(path(a, 'view?perspective=blind'), undefined, a.observer); expect(viewed.body.G.private).toEqual({});
    const god = (await f.request(path(a, 'view?perspective=god'), undefined, a.observer)).body;
    expect(god.G.private[wolves[0]].wolfVotes[wolves[0]]).toBe(target); noSecrets(god);
    const agreed = await f.state(a);
    f.advance(2999); await new Promise(ok => setTimeout(ok, 80));
    expect((await f.state(a))._stateID).toBe(agreed._stateID);
    expect((await f.state(a)).G.deadline).toBe(G.deadline);
    f.advance(1);
    await vi.waitFor(async () => expect((await f.state(a)).G.nightStep).toBe(2), { interval: 10 });
    expect((await f.state(a)).G.deadline).toBe(Date.now() + 30000);
    expect((await f.state(b))._stateID).toBe(bBefore._stateID);
    expect((await f.state(c))._stateID).toBe(cBefore._stateID);
  }, 30000);

  it.each(['online', 'assisted'] as const)('%s cancels changed wolf consensus and preserves a new hidden deadline across restart', async mode => {
    const f = await fixture(), g = await f.group();
    await f.start(g, { ...DEFAULT_MOON_OPTIONS, mode }); await ack(f, g); await f.expire(g);
    const { G } = await f.state(g), wolves = Object.keys(G.private).filter(id => G.private[id].role === 'wolf');
    const targets = Object.keys(G.private).filter(id => G.private[id].role !== 'wolf');
    for (const id of wolves) await f.move(g, id, 'wolfVote', [targets[0], G.epoch]);
    f.advance(2000);
    await f.move(g, wolves[0], 'wolfVote', [targets[1], G.epoch]);
    const changed = await f.state(g);
    f.advance(1001); await new Promise(ok => setTimeout(ok, 80));
    expect((await f.state(g))._stateID).toBe(changed._stateID);
    expect((await f.state(g)).G).toMatchObject({ nightStep: 1, deadline: G.deadline });
    await f.move(g, wolves[1], 'wolfVote', [targets[1], G.epoch]);
    const agreedAt = Date.now();
    f.advance(1000);
    // A duplicate vote is not a new agreement and must not extend the three seconds.
    await f.move(g, wolves[1], 'wolfVote', [targets[1], G.epoch]);
    const beforeRestart = await f.state(g);
    await f.restart(g);
    expect((await f.state(g)).G.secret).toEqual(beforeRestart.G.secret);
    expect((await f.state(g)).G.deadline).toBe(G.deadline);
    g.sockets.forEach(socket => noSecrets(f.views.get(socket)));
    f.advance(1999); await new Promise(ok => setTimeout(ok, 80));
    expect((await f.state(g)).G.nightStep).toBe(1);
    f.advance(1);
    await vi.waitFor(async () => expect((await f.state(g)).G.nightStep).toBe(2), { interval: 10 });
    expect(Date.now()).toBe(agreedAt + 3000);
    expect((await f.state(g)).G.secret!.attackTarget).toBe(targets[1]);
    await f.move(g, wolves[0], 'wolfVote', [targets[0], G.epoch], false);
  }, 30000);

  it('clamps lobby timer settings at the API boundary and uses the saved limits for a new match', async () => {
    const f = await fixture(), g = await f.group();
    const invalid = await f.request(path(g, 'options'), { matchID: g.matchID,
      options: { ...DEFAULT_MOON_OPTIONS, speechSeconds: 5.5 } }, g.host);
    expect(invalid.status).toBe(400);
    await f.start(g, { ...DEFAULT_MOON_OPTIONS, speechSeconds: -20, nightSeconds: 999, voteSeconds: 0 });
    expect((await f.state(g)).G.options).toMatchObject({ speechSeconds: 5, nightSeconds: 120, voteSeconds: 5 });
    await ack(f, g);
    expect((await f.state(g)).G.deadline).toBe(Date.now() + 120000);
  }, 30000);
});
