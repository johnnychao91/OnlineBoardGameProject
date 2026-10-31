import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FogState } from '../games/fog/game';
import { DEFAULT_FOG_OPTIONS, fogTeamSizes } from '../games/fog/rules';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; gameId: string; matchID: string }
type Snapshot = State<FogState>;
const origin = 'http://localhost:5173';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const path = (room: Room, operation = '') => `/api/rooms/${room.roomId}${operation ? `/${operation}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
function noServerSecrets(data: unknown) {
  expect(JSON.stringify(data)).not.toMatch(/"(?:seed|prngstate|secret|bellDeck|credentials|credentialHash|inviteHash|inviteToken|metadata)"\s*:/);
}

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-fog-integration-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-fog-integration-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false, roomCode: '', lifecycleSweepMs: 60000 };
  let app = await createApplication(config), running = await app.listen();
  const sockets: Socket[] = [];
  const views = new Map<Socket, Snapshot>();
  const messages = new Map<Socket, string[]>();
  cleanups.push(async () => { sockets.forEach((socket) => socket.disconnect()); await running.close(); });
  const baseURL = () => `http://127.0.0.1:${running.port}`;
  const request = async (url: string, body?: unknown, member?: Seat | Observer, extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(baseURL() + url, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: origin,
        ...(member ? { Authorization: `Bearer ${member.credentials}`,
          ...('playerID' in member ? { 'X-Player-ID': member.playerID } : { 'X-Observer-ID': member.observerID }) } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const connect = async (namespace: string) => {
    const socket = io(`${baseURL()}/${namespace}`, { transports: ['websocket'], forceNew: true, reconnection: false,
      extraHeaders: { Origin: origin }, autoConnect: false });
    sockets.push(socket); messages.set(socket, []); socket.on('error', () => {});
    socket.on('sync', (id: string, info: SyncInfo) => { views.set(socket, info.state as Snapshot); messages.get(socket)!.push(id); });
    socket.on('update', (id: string, state: Snapshot) => { views.set(socket, state); messages.get(socket)!.push(id); });
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
      const timeout = setTimeout(() => reject(new Error('Authorized sync timed out')), 3000);
      socket.once('sync', (_id, info: SyncInfo) => { clearTimeout(timeout); ok(info); });
    });
    socket.emit('sync', group.matchID, seat.playerID, seat.credentials, group.seats.length);
    return result;
  };
  const state = async (matchID: string) => (await app.db.fetch(matchID, { state: true })).state! as Snapshot;
  const move = async (group: Group, id: string, type: string, args: unknown[]) => {
    const index = group.seats.findIndex((seat) => seat.playerID === id);
    const seat = group.seats[index];
    const before = await state(group.matchID);
    group.clients[index].emit('update', { type: 'MAKE_MOVE', payload: { type, args, playerID: id, credentials: seat.credentials } },
      before._stateID, group.matchID, id);
    await vi.waitFor(async () => expect((await state(group.matchID))._stateID).toBeGreaterThan(before._stateID), { timeout: 4000, interval: 10 });
    const after = await state(group.matchID);
    await vi.waitFor(() => group.clients.forEach((socket) => expect(views.get(socket)!._stateID).toBe(after._stateID)), { timeout: 4000, interval: 10 });
    return after;
  };
  return { request, connect, sync, state, move, views, messages, get app() { return app; },
    async restart() { sockets.forEach((socket) => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function group(f: Fixture, count = 5, gameId = 'black-fog'): Promise<Group> {
  const response = await f.request('/api/rooms', { gameId, displayName: '房主' });
  expect(response.status).toBe(201);
  const host = response.body as Room, seats: Seat[] = [host];
  for (let i = 1; i < count; i += 1) {
    const joined = await f.request(path(host, 'join'), { inviteToken: token(host.inviteUrl), displayName: `隊員 ${i}`, requestID: randomUUID() });
    expect(joined.status).toBe(200); seats.push(joined.body);
  }
  const watched = await f.request(path(host, 'watch'), { inviteToken: token(host.inviteUrl), displayName: '觀戰朋友' });
  expect(watched.status).toBe(200);
  return { host, seats, observer: watched.body, clients: [], matchID: host.matchID, gameId };
}
async function start(f: Fixture, g: Group) {
  const current = (await f.request(path(g.host), undefined, g.host)).body;
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { ready: true, matchID: current.matchID }, seat)).status).toBe(200);
  const started = await f.request(path(g.host, 'start'), { matchID: current.matchID }, g.host);
  expect(started.status).toBe(200); g.matchID = started.body.matchID;
  g.clients = await Promise.all(g.seats.map(() => f.connect(g.gameId)));
  await Promise.all(g.clients.map((socket, index) => f.sync(socket, g, g.seats[index])));
}
async function ack(f: Fixture, g: Group) {
  const { G } = await f.state(g.matchID);
  for (const seat of g.seats) await f.move(g, seat.playerID, 'acknowledge', [G.epoch]);
}
async function propose(f: Fixture, g: Group, team?: string[]) {
  const { G } = await f.state(g.matchID);
  const selected = team ?? Object.keys(G.players).slice(0, fogTeamSizes(g.seats.length)[G.quest - 1]);
  await f.move(g, G.leaderID!, 'selectTeam', [selected, G.epoch]);
  await f.move(g, G.leaderID!, 'confirmTeam', [G.epoch]);
}
async function votes(f: Fixture, g: Group, approve: boolean) {
  const { G } = await f.state(g.matchID);
  for (const seat of g.seats) await f.move(g, seat.playerID, 'vote', [approve, G.epoch]);
}

describe('Fog authenticated socket, replay and persistent-room integration', () => {
  it('plays three quests and assassination over sockets, protects pending choices, returns and shares both perspectives', async () => {
    const f = await fixture(), g = await group(f);
    await start(f, g);
    for (let i = 0; i < g.clients.length; i += 1) {
      expect(Object.keys(f.views.get(g.clients[i])!.G.private)).toEqual([g.seats[i].playerID]);
      noServerSecrets(await f.sync(g.clients[i], g, g.seats[i]));
    }
    expect((await f.request(path(g.host, 'share'), { matchID: g.matchID, frameIndex: 0, perspective: 'blind' }, g.host)).status).toBe(409);
    await ack(f, g);
    for (let quest = 1; quest <= 3; quest += 1) {
      const { G } = await f.state(g.matchID);
      const team = Object.keys(G.private).filter((id) => G.private[id].faction === 'knights').slice(0, fogTeamSizes(5)[quest - 1]);
      await propose(f, g, team);
      const voting = (await f.state(g.matchID)).G;
      await f.move(g, g.seats[0].playerID, 'vote', [true, voting.epoch]);
      expect(f.views.get(g.clients[0])!.G.private[g.seats[0].playerID].ownVote).toBe(true);
      for (const socket of g.clients.slice(1)) {
        expect(Object.values(f.views.get(socket)!.G.private).every((info) => info.ownVote === null)).toBe(true);
        expect(f.views.get(socket)!.G.lastVote).toBeNull();
        expect(f.views.get(socket)!.G.log.filter((entry) => entry.type === 'vote' && entry.quest === quest)).toHaveLength(0);
      }
      const blind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
      const god = await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer);
      expect(blind.body.G.private).toEqual({}); expect(blind.body.G.lastVote).toBeNull();
      expect(god.body.G.private[g.seats[0].playerID].ownVote).toBe(true);
      noServerSecrets(blind.body); noServerSecrets(god.body);
      for (const seat of g.seats.slice(1)) await f.move(g, seat.playerID, 'vote', [true, voting.epoch]);
      expect((await f.state(g.matchID)).G.lastVote!.approved).toBe(true);
      await ack(f, g);
      const mission = (await f.state(g.matchID)).G;
      await f.move(g, team[0], 'submitQuest', ['success', mission.epoch]);
      const pendingBlind = await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer);
      expect(pendingBlind.body.G.private).toEqual({}); expect(pendingBlind.body.G.questResults).toHaveLength(quest - 1);
      for (const id of team.slice(1)) await f.move(g, id, 'submitQuest', ['success', mission.epoch]);
      const review = (await f.state(g.matchID)).G;
      expect(review.status).toBe('quest-review'); expect(review.winner).toBeNull();
      expect(review.questResults.at(-1)).toMatchObject({ quest, successes: team.length, fails: 0, succeeded: true });
      expect(review.secret!.questCards).toEqual({});
      expect(Object.values(review.private).every((info) => info.ownQuestCard === null)).toBe(true);
      await ack(f, g);
    }
    const assassination = (await f.state(g.matchID)).G;
    expect(assassination.status).toBe('assassination');
    const assassin = Object.keys(assassination.private).find((id) => assassination.private[id].role === 'assassin')!;
    const wrong = Object.keys(assassination.private).find((id) => assassination.private[id].role !== 'merlin' && assassination.private[id].faction === 'knights')!;
    await f.move(g, assassin, 'assassinate', [wrong, assassination.epoch]);
    const finished = (await f.state(g.matchID)).G;
    expect(finished).toMatchObject({ status: 'finished', winner: 'knights', winReason: 'merlin-safe' });
    expect(Object.values(finished.players).every((player) => player.revealedRole && player.revealedFaction)).toBe(true);
    const completedID = g.matchID;
    const held = await f.request(path(g.host), undefined, g.host);
    expect(held.body.status).toBe('finished'); expect(held.body.completedDisplayUntil).toBeGreaterThan(Date.now());
    const room = f.app.rooms.rooms.get(g.host.roomId)!;
    await f.app.rooms.save({ ...room, completedDisplay: { matchID: completedID, until: Date.now() - 1 } });
    const lobby = (await f.request(path(g.host), undefined, g.host)).body;
    expect(lobby).toMatchObject({ roomId: g.host.roomId, status: 'lobby', numPlayers: 5, spectatorCount: 1, hostPlayerID: g.host.playerID });
    expect(lobby.matchID).not.toBe(completedID);
    expect(lobby.players.every((player: any) => !player.ready)).toBe(true);
    expect(lobby.history).toEqual([expect.objectContaining({ matchID: completedID, gameName: 'black-fog', ending: 'completed', winner: 'knights' })]);
    const storedShares: { token: string; payload: any }[] = [];
    for (const perspective of ['blind', 'god'] as const) {
      const replay = await f.request(path(g.host, `replay?matchID=${completedID}&perspective=${perspective}`), undefined, g.observer);
      expect(replay.status).toBe(200); expect(replay.body.complete).toBe(true);
      expect(replay.body.frames.length).toBeGreaterThan(20);
      expect(replay.body.frames.every((frame: any) => Object.keys(frame.G.private).length === (perspective === 'blind' ? 0 : 5))).toBe(true);
      expect(replay.body.frames.at(-1).G.winner).toBe('knights');
      noServerSecrets(replay.body);
      const frameIndex = replay.body.frames.length - 1;
      const share = await f.request(path(g.host, 'share'), { matchID: completedID, frameIndex, perspective }, g.observer);
      expect(share.status).toBe(200);
      const shareToken = token(share.body.url, 'share');
      const shared = await f.request(`/api/replays/${g.host.roomId}?perspective=${perspective === 'blind' ? 'god' : 'blind'}&frameIndex=0`,
        undefined, undefined, { 'X-Replay-Token': shareToken });
      expect(shared.status).toBe(200); expect(shared.body).toMatchObject({ perspective, frameIndex });
      expect(shared.body.frames).toEqual(replay.body.frames);
      expect(shared.body.room).toMatchObject({ gameName: 'black-fog', matchID: completedID, history: [], hostPlayerID: null, spectators: [] });
      expect((await f.request(path(g.host), undefined, { ...g.host, credentials: shareToken })).status).toBe(401);
      noServerSecrets(shared.body); storedShares.push({ token: shareToken, payload: shared.body });
    }
    const stats = (await f.request('/api/stats')).body;
    expect(stats).toMatchObject({ completedGames: 1, totalPlayerParticipations: 5 });
    expect(stats.byGame.find((entry: any) => entry.gameId === 'black-fog')).toMatchObject({ completed: 1, wins: { knights: 1 }, reasons: { 'merlin-safe': 1 },
      byPlayerCount: [{ numPlayers: 5, completed: 1, wins: { knights: 1 } }] });
    await start(f, g); expect(g.matchID).toBe(lobby.matchID);
    await f.restart();
    expect((await f.request('/api/stats')).body).toEqual(stats);
    for (const share of storedShares) {
      expect((await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': share.token })).body).toEqual(share.payload);
    }
  }, 30000);

  it('keeps two simultaneous fog groups and a cipher game isolated, including rejecting cross-room credentials', async () => {
    const f = await fixture();
    const first = await group(f), second = await group(f, 7), cipher = await group(f, 2, 'encrypted-call');
    const changed = await f.request(path(second.host, 'options'), { matchID: second.matchID, options: { ...DEFAULT_FOG_OPTIONS, lancelotMode: 'forecast' } }, second.host);
    expect(changed.status).toBe(200);
    await Promise.all([first, second, cipher].map((g) => start(f, g)));
    const untouchedSecond = (await f.state(second.matchID)).G, untouchedCipher = (await f.state(cipher.matchID)).G;
    expect((await f.request(path(first.host), undefined, second.host)).status).toBe(401);
    expect((await f.request(path(first.host, 'view?perspective=god'), undefined, cipher.observer)).status).toBe(401);
    expect((await f.request(path(first.host, 'join'), { inviteToken: token(second.host.inviteUrl), displayName: '跨房' })).status).toBe(403);
    await ack(f, first);
    for (let attempt = 0; attempt < 5; attempt += 1) { await propose(f, first); await votes(f, first, false); await ack(f, first); }
    expect((await f.state(first.matchID)).G).toMatchObject({ winner: 'apostles', winReason: 'five-rejections' });
    expect((await f.state(second.matchID)).G).toEqual(untouchedSecond);
    expect((await f.state(cipher.matchID)).G).toEqual(untouchedCipher);
    await ack(f, second); await propose(f, second);
    expect((await f.state(first.matchID)).G.winner).toBe('apostles');
    expect((await f.state(cipher.matchID)).G).toEqual(untouchedCipher);
    for (const g of [first, second, cipher]) for (const socket of g.clients) {
      expect(new Set(f.messages.get(socket))).toEqual(new Set([g.matchID]));
    }
    const stats = (await f.request('/api/stats')).body;
    expect(stats.completedGames).toBe(1);
    expect(stats.byGame.find((entry: any) => entry.gameId === 'black-fog')).toMatchObject({ completed: 1, wins: { apostles: 1 } });
  }, 30000);
});
