import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuringState } from '../games/turing/game';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string }
type Snapshot = State<TuringState>;
const origin = 'http://localhost:5173';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const path = (room: Room, action = '') => `/api/rooms/${room.roomId}${action ? `/${action}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
const customQuestions = Array.from({ length: 5 }, (_, index) => ({
  prompt: `你遇到第 ${index + 1} 位迷路的機器人，請寫一句讓它安心的話。`, low: '完全不安心', high: '立刻安心下來',
}));
function noServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:secretQuestionQueue|seed|prngstate|credentials|credentialHash|inviteHash|inviteToken)"\s*:/);
}

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-turing-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-turing-test-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false, createRoomKey: '', lifecycleSweepMs: 60000 };
  let app = await createApplication(config), running = await app.listen();
  const sockets: Socket[] = [], views = new Map<Socket, Snapshot>(), wireLogs = new Map<Socket, unknown[]>();
  cleanups.push(async () => { sockets.forEach(socket => socket.disconnect()); await running.close(); });
  const request = async (url: string, body?: unknown, member?: Seat | Observer, extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${running.port}${url}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin,
        ...(member ? { Authorization: `Bearer ${member.credentials}`, ...('playerID' in member ? { 'X-Player-ID': member.playerID } : { 'X-Observer-ID': member.observerID }) } : {}),
        ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const connect = async () => {
    const socket = io(`http://127.0.0.1:${running.port}/turing-test`, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { Origin: origin }, autoConnect: false });
    sockets.push(socket); socket.on('error', () => {});
    socket.on('sync', (_id: string, info: SyncInfo) => { views.set(socket, info.state as Snapshot); wireLogs.set(socket, info.log); });
    socket.on('update', (_id: string, state: Snapshot, log: unknown[]) => { views.set(socket, state); wireLogs.set(socket, log); });
    await new Promise<void>((ok, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connect timed out')), 3000);
      socket.once('connect', () => { clearTimeout(timer); ok(); });
      socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
      socket.connect();
    });
    return socket;
  };
  const sync = async (socket: Socket, group: Group, seat: Seat) => {
    const response = new Promise<SyncInfo>((ok, reject) => {
      const timer = setTimeout(() => reject(new Error('Authorized sync timed out')), 3000);
      socket.once('sync', (_id: string, info: SyncInfo) => { clearTimeout(timer); ok(info); });
    });
    socket.emit('sync', group.matchID, seat.playerID, seat.credentials, group.seats.length);
    return response;
  };
  const state = async (matchID: string) => (await app.db.fetch(matchID, { state: true })).state! as Snapshot;
  const move = async (group: Group, id: string, type: string, args: unknown[]) => {
    const index = group.seats.findIndex(seat => seat.playerID === id), seat = group.seats[index];
    const before = await state(group.matchID);
    group.clients[index].emit('update', { type: 'MAKE_MOVE', payload: { type, args, playerID: id, credentials: seat.credentials } }, before._stateID, group.matchID, id);
    await vi.waitFor(async () => expect((await state(group.matchID))._stateID).toBeGreaterThan(before._stateID), { timeout: 4000, interval: 10 });
    const after = await state(group.matchID);
    await vi.waitFor(() => group.clients.forEach(socket => expect(views.get(socket)?._stateID).toBe(after._stateID)), { timeout: 4000, interval: 10 });
    return after;
  };
  return { request, connect, sync, state, move, views, wireLogs, get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function group(f: Fixture): Promise<Group> {
  const created = await f.request('/api/rooms', { gameId: 'turing-test', displayName: '房主' });
  expect(created.status).toBe(201);
  const host = created.body as Room, seats: Seat[] = [host];
  for (let i = 1; i < 4; i += 1) {
    const joined = await f.request(path(host, 'join'), { inviteToken: token(host.inviteUrl), displayName: `參與者 ${i}` });
    expect(joined.status).toBe(200); seats.push(joined.body);
  }
  const observer = await f.request(path(host, 'watch'), { inviteToken: token(host.inviteUrl), displayName: '觀察員' });
  expect(observer.status).toBe(200);
  return { host, seats, observer: observer.body, clients: [], matchID: host.matchID };
}
async function connectGroup(f: Fixture, g: Group) {
  g.clients = await Promise.all(g.seats.map(() => f.connect()));
  const syncs = await Promise.all(g.clients.map((socket, index) => f.sync(socket, g, g.seats[index])));
  for (const info of syncs) {
    noServerSecrets(info); expect(info.log).toEqual([]);
    expect(info.state.deltalog).toBeUndefined(); expect(info.initialState.deltalog).toBeUndefined();
  }
}
async function start(f: Fixture, g: Group) {
  const current = (await f.request(path(g.host), undefined, g.host)).body;
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { ready: true, matchID: current.matchID }, seat)).status).toBe(200);
  const started = await f.request(path(g.host, 'start'), { matchID: current.matchID }, g.host);
  expect(started.status).toBe(200); g.matchID = started.body.matchID;
  await connectGroup(f, g);
}
async function ack(f: Fixture, g: Group) {
  const { G } = await f.state(g.matchID);
  for (const seat of g.seats) await f.move(g, seat.playerID, 'acknowledge', [G.epoch]);
}

describe('Turing custom questions, private answers and replay integration', () => {
  it('allows bounded 50-question host settings, authenticates first and retains smaller limits for ordinary actions', async () => {
    const f = await fixture(), g = await group(f);
    const cards = Array.from({ length: 50 }, (_, i) => ({ prompt: `${String(i).padStart(2, '0')}${'題'.repeat(198)}`, low: '低'.repeat(50), high: '高'.repeat(50) }));
    const body = { matchID: g.matchID, options: { deck: 'custom', customQuestions: cards } };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(4096);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(64 * 1024);
    expect((await f.request(path(g.host, 'options'), body, g.seats[1])).status).toBe(403);
    const huge = { ...body, excess: 'x'.repeat(64 * 1024) };
    expect((await f.request(path(g.host, 'options'), huge)).status).toBe(401);
    expect((await f.request(path(g.host, 'options'), huge, g.seats[1])).status).toBe(403);
    expect((await f.request(path(g.host, 'options'), huge, g.host)).status).toBe(413);
    expect((await f.request(path(g.host, 'ready'), { ready: true, excess: 'x'.repeat(4096) }, g.host)).status).toBe(413);
    expect((await f.request(path(g.host, 'ready'), { ready: true }, g.seats[1])).status).toBe(200);
    const changed = await f.request(path(g.host, 'options'), body, g.host);
    expect(changed.status).toBe(200); expect(changed.body.gameOptions).toEqual(body.options);
    expect(changed.body.matchID).not.toBe(g.matchID);
    expect(changed.body.players.every((player: any) => !player.ready)).toBe(true);
    expect((await f.request(path(g.host, 'options'), body, g.host)).status).toBe(409);
    g.matchID = changed.body.matchID;
    const rejected = await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { deck: 'custom', customQuestions: customQuestions.slice(0, 4) } }, g.host);
    expect(rejected.status).toBe(400);
    const intact = (await f.request(path(g.host), undefined, g.host)).body;
    expect(intact.matchID).toBe(g.matchID); expect(intact.gameOptions).toEqual(body.options);
    await start(f, g);
    expect((await f.request(path(g.host, 'options'), { ...body, matchID: g.matchID }, g.host)).status).toBe(409);
  });

  it('plays five custom rounds over sockets, keeps pending answers private through restart, and persists public and god replays', async () => {
    const f = await fixture(), g = await group(f);
    const changed = await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { deck: 'custom', customQuestions } }, g.host);
    expect(changed.status).toBe(200);
    await start(f, g); await ack(f, g);
    const initial = (await f.state(g.matchID)).G, firstAnswerID = Object.keys(initial.private)[0];
    const pendingText = '<img src=x onerror=alert(1)> 還沒公開的回答';
    await f.move(g, firstAnswerID, 'submitAnswer', [pendingText, initial.epoch]);
    for (let i = 0; i < g.seats.length; i += 1) {
      const seat = g.seats[i], view = f.views.get(g.clients[i])!;
      expect(view.G.answers).toEqual({}); expect(view.G.log.some(entry => entry.type === 'answers')).toBe(false);
      expect(f.wireLogs.get(g.clients[i])).toEqual([]);
      expect(view.deltalog).toBeUndefined(); expect(view.ctx.numMoves).toBe(0);
      expect(Object.values(view.ctx._activePlayersNumMoves ?? {}).every(value => value === 0)).toBe(true);
      if (seat.playerID === firstAnswerID) expect(view.G.private[firstAnswerID].answer).toBe(pendingText);
      else expect(JSON.stringify(view)).not.toContain(pendingText);
      noServerSecrets(view);
    }
    const pendingBlind = (await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer)).body;
    const pendingGod = (await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer)).body;
    expect(pendingBlind.G.private).toEqual({}); expect(JSON.stringify(pendingBlind)).not.toContain(pendingText);
    expect(pendingGod.G.private[firstAnswerID].answer).toBe(pendingText);
    noServerSecrets(pendingBlind); noServerSecrets(pendingGod);
    const saved = (await f.state(g.matchID)).G;
    await f.restart(); expect((await f.state(g.matchID)).G).toEqual(saved);
    await connectGroup(f, g);
    const answeredQuestions = new Set<string>();
    for (let round = 1; round <= 5; round += 1) {
      const state = (await f.state(g.matchID)).G;
      expect(state).toMatchObject({ round, status: 'answering' });
      expect(customQuestions).toContainEqual({ prompt: state.question!.prompt, low: state.question!.low, high: state.question!.high });
      answeredQuestions.add(state.question!.id);
      for (const id of Object.keys(state.private)) {
        if (!state.players[id].answered) await f.move(g, id, 'submitAnswer', [`第 ${round} 輪的公開回答 ${id}`, state.epoch]);
      }
      const sorting = (await f.state(g.matchID)).G;
      expect(sorting.status).toBe('sorting');
      const order = Object.keys(sorting.private).sort((a, b) => sorting.private[a].number - sorting.private[b].number);
      for (const id of order) {
        const current = (await f.state(g.matchID)).G;
        await f.move(g, current.examinerID, 'revealAnswer', [id, current.epoch]);
      }
      if (round < 5) { await ack(f, g); await ack(f, g); }
    }
    expect(answeredQuestions.size).toBe(5);
    expect((await f.state(g.matchID)).G).toMatchObject({ status: 'finished', integrity: 4, winner: 'humans', winReason: 'calibrated' });
    const completedID = g.matchID;
    const held = (await f.request(path(g.host), undefined, g.host)).body;
    expect(held.status).toBe('finished'); expect(held.completedDisplayUntil).toBeGreaterThan(Date.now());
    const currentRoom = f.app.rooms.rooms.get(g.host.roomId)!;
    await f.app.rooms.save({ ...currentRoom, completedDisplay: { matchID: completedID, until: Date.now() - 1 } });
    const lobby = (await f.request(path(g.host), undefined, g.host)).body;
    expect(lobby.status).toBe('lobby'); expect(lobby.matchID).not.toBe(completedID);
    const replays: Record<string, any> = {};
    for (const perspective of ['blind', 'god']) {
      const replay = await f.request(path(g.host, `replay?matchID=${completedID}&perspective=${perspective}`), undefined, g.observer);
      expect(replay.status).toBe(200); expect(replay.body.complete).toBe(true); noServerSecrets(replay.body);
      const pending = replay.body.frames.find((frame: any) => frame.G.round === 1 && frame.G.status === 'answering' && frame.G.players[firstAnswerID].answered);
      expect(pending.G.answers).toEqual({});
      if (perspective === 'blind') { expect(pending.G.private).toEqual({}); expect(JSON.stringify(pending)).not.toContain(pendingText); }
      else expect(pending.G.private[firstAnswerID].answer).toBe(pendingText);
      const final = replay.body.frames.at(-1).G;
      expect(Object.keys(final.private)).toHaveLength(3);
      expect(final.log.filter((entry: any) => entry.type === 'round-start').map((entry: any) => entry.question.prompt).sort()).toEqual(customQuestions.map(question => question.prompt).sort());
      replays[perspective] = replay.body;
    }
    const shared = await f.request(path(g.host, 'share'), { matchID: completedID, frameIndex: 0, perspective: 'blind' }, g.host);
    expect(shared.status).toBe(200); const shareToken = token(shared.body.url, 'share');
    const stats = (await f.request('/api/stats')).body;
    expect(stats.byGame.find((entry: any) => entry.gameId === 'turing-test')).toMatchObject({ completed: 1, wins: { humans: 1 }, reasons: { calibrated: 1 } });
    // Updating the next match cannot rewrite historical question text or rules.
    const newerQuestions = customQuestions.map(question => ({ ...question, prompt: `${question.prompt}新版` }));
    expect((await f.request(path(g.host, 'options'), { matchID: lobby.matchID, options: { deck: 'custom', customQuestions: newerQuestions } }, g.host)).status).toBe(200);
    await f.restart();
    for (const perspective of ['blind', 'god']) {
      expect((await f.request(path(g.host, `replay?matchID=${completedID}&perspective=${perspective}`), undefined, g.observer)).body.frames).toEqual(replays[perspective].frames);
    }
    expect((await f.request('/api/stats')).body).toEqual(stats);
    const sharedReplay = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': shareToken });
    expect(sharedReplay.status).toBe(200); expect(sharedReplay.body.perspective).toBe('blind');
    expect(sharedReplay.body.frames).toEqual(replays.blind.frames); noServerSecrets(sharedReplay.body);
  }, 30000);
});
