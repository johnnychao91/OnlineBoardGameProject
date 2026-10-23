import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { turingCardNumber, turingCards, type TuringState } from '../games/turing/game';
import { normalizeTuringOptions } from '../games/turing/rules';
import { turingQuestionPool } from '../games/turing/questions';
import { createApplication } from './app';

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Room extends Seat { roomId: string; matchID: string; inviteUrl: string }
interface Group { host: Room; seats: Seat[]; observer: Observer; clients: Socket[]; matchID: string }
type Snapshot = State<TuringState>;
const origin = 'http://localhost:5173';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const path = (room: Room, action = '') => `/api/rooms/${room.roomId}${action ? `/${action}` : ''}`;
const token = (url: string, name = 'invite') => new URLSearchParams(new URL(url).hash.slice(1)).get(name)!;
const customQuestions = Array.from({ length: 5 }, (_, index) => ({
  prompt: `你遇到第 ${index + 1} 位迷路的機器人，請寫一句讓它安心的話。`, low: '完全不安心', high: '立刻安心下來',
}));
function noServerSecrets(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"(?:secretQuestionQueue|secretDrawIDs|seed|prngstate|credentials|credentialHash|inviteHash|inviteToken)"\s*:/);
}

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-turing-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-turing-test-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false, createRoomKey: '', testRoomKey: 'turing-test-room-only-key', lifecycleSweepMs: 60000 };
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
  const rejectMove = async (group: Group, id: string, type: string, args: unknown[]) => {
    const index = group.seats.findIndex(seat => seat.playerID === id), seat = group.seats[index];
    const before = await state(group.matchID), socket = group.clients[index];
    socket.emit('update', { type: 'MAKE_MOVE', payload: { type, args, playerID: id, credentials: seat.credentials } }, before._stateID, group.matchID, id);
    // An authorized sync is serialized behind the preceding move in this room.
    // It is a deterministic barrier, not a timing-based guess that no write occurred.
    await sync(socket, group, seat);
    expect(await state(group.matchID)).toEqual(before);
  };
  return { request, connect, sync, state, move, rejectMove, views, wireLogs, get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); await running.close(); app = await createApplication(config); running = await app.listen(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function group(f: Fixture, count = 4, testRoom = false): Promise<Group> {
  const created = await f.request('/api/rooms', { gameId: 'turing-test', displayName: '房主', ...(testRoom ? { createKey: 'turing-test-room-only-key' } : {}) });
  expect(created.status).toBe(201);
  const host = created.body as Room, seats: Seat[] = [host];
  for (let i = 1; i < count; i += 1) {
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
async function start(f: Fixture, g: Group, legacy = false) {
  const current = (await f.request(path(g.host), undefined, g.host)).body;
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { ready: true, matchID: current.matchID }, seat)).status).toBe(200);
  const started = await f.request(path(g.host, 'start'), { matchID: current.matchID }, g.host);
  expect(started.status).toBe(200); g.matchID = started.body.matchID;
  if (legacy) {
    // Simulate an already saved pre-voice match; loading it must not silently
    // replace its rules, pending answers, number assignments or question order.
    const saved = await f.state(g.matchID), G = saved.G;
    G.rulesVersion = 1;
    G.options = { deck: G.options.deck, customQuestions: G.options.customQuestions };
    G.private = Object.fromEntries(Object.entries(G.private).map(([id, info]) => [id, { number: info.number }]));
    G.secretQuestionQueue = turingQuestionPool(G.options).filter(question => question.id !== G.question?.id).slice(0, 4);
    G.maxIntegrity = G.integrity = Math.min(g.seats.length, 8);
    delete G.cards; delete G.completedRounds; delete G.secretDrawIDs;
    saved._stateID += 1;
    await f.app.db.setState(g.matchID, saved);
  }
  await connectGroup(f, g);
}
async function ack(f: Fixture, g: Group) {
  const { G } = await f.state(g.matchID);
  for (const seat of g.seats) await f.move(g, seat.playerID, 'acknowledge', [G.epoch]);
}

async function speakAll(f: Fixture, g: Group) {
  const { G } = await f.state(g.matchID);
  for (const [cardID, card] of Object.entries(turingCards(G))) {
    if (!card.spoken) await f.move(g, card.playerID, 'confirmSpoken', [cardID, G.epoch]);
  }
}
async function revealAll(f: Fixture, g: Group, descending = false) {
  const { G } = await f.state(g.matchID);
  const cards = Object.keys(turingCards(G)).sort((a, b) => turingCardNumber(G, a)! - turingCardNumber(G, b)!);
  if (descending) cards.reverse();
  for (const cardID of cards) {
    const current = (await f.state(g.matchID)).G;
    if (current.status === 'finished') break;
    await f.move(g, current.examinerID, 'revealAnswer', [cardID, current.epoch]);
  }
}
async function archive(f: Fixture, g: Group) {
  const held = (await f.request(path(g.host), undefined, g.host)).body;
  expect(held.status).toBe('finished');
  const record = f.app.rooms.rooms.get(g.host.roomId)!;
  await f.app.rooms.save({ ...record, completedDisplay: { matchID: g.matchID, until: Date.now() - 1 } });
  const lobby = (await f.request(path(g.host), undefined, g.host)).body;
  expect(lobby.status).toBe('lobby');
  return lobby;
}

describe('Turing custom questions, private answers and replay integration', () => {
  it.each([2, 3])('%i-player voice play authorizes each card, isolates rooms, survives restart and records its mode-specific result', async count => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = await fixture(), g = await group(f, count), other = await group(f, 2);
    const mode = count === 2 ? 'standard' : 'endless';
    const settings = { deck: 'custom', customQuestions, mode, lives: 1 };
    expect((await f.request(path(g.host, 'options'), { matchID: g.matchID, options: settings }, g.host)).status).toBe(200);
    await start(f, other); await start(f, g); await ack(f, g);
    const untouched = (await f.state(other.matchID)).G;
    const first = (await f.state(g.matchID)).G, entries = Object.entries(turingCards(first));
    expect(entries).toHaveLength((count - 1) * 2);
    expect(first).toMatchObject({ rulesVersion: 2, targetRounds: mode === 'endless' ? null : 5, completedRounds: 0 });
    const [cardID, card] = entries[0];
    await f.rejectMove(g, first.examinerID, 'confirmSpoken', [cardID, first.epoch]);
    await f.rejectMove(g, first.examinerID, 'revealAnswer', [cardID, first.epoch]);
    await f.rejectMove(g, card.playerID, 'submitAnswer', ['此局不接受文字答案', first.epoch]);
    await f.move(g, card.playerID, 'confirmSpoken', [cardID, first.epoch]);
    await f.rejectMove(g, card.playerID, 'confirmSpoken', [cardID, first.epoch]);
    await f.rejectMove(g, first.examinerID, 'revealAnswer', [cardID, first.epoch]);
    for (let index = 0; index < count; index += 1) {
      const seat = g.seats[index], view = f.views.get(g.clients[index])!;
      expect(Object.keys(view.G.private)).toEqual(seat.playerID === first.examinerID ? [] : [seat.playerID]);
      expect(view.G.answers).toEqual({}); expect(view.G.log.some(event => event.type === 'answers')).toBe(false);
      expect(f.wireLogs.get(g.clients[index])).toEqual([]); expect(view.deltalog).toBeUndefined();
      expect(view.ctx.numMoves).toBe(0); noServerSecrets(view);
    }
    const pendingBlind = (await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer)).body;
    const pendingGod = (await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer)).body;
    expect(pendingBlind.G.private).toEqual({}); expect(pendingBlind.G.cards[cardID].spoken).toBe(true);
    expect(pendingGod.G.private[card.playerID].cards).toHaveLength(2);
    noServerSecrets(pendingBlind); noServerSecrets(pendingGod);
    const pending = (await f.state(g.matchID)).G;
    await f.restart(); expect((await f.state(g.matchID)).G).toEqual(pending);
    await connectGroup(f, g); await connectGroup(f, other);
    const rounds = mode === 'endless' ? 7 : 5, questionIDs: string[] = [];
    for (let round = 1; round <= rounds; round += 1) {
      const current = (await f.state(g.matchID)).G;
      expect(current).toMatchObject({ round, status: 'answering', completedRounds: round - 1 });
      questionIDs.push(current.question!.id);
      await speakAll(f, g);
      const sorting = (await f.state(g.matchID)).G;
      expect(sorting.status).toBe('sorting'); expect(sorting.answers).toEqual({});
      await f.rejectMove(g, Object.keys(sorting.private)[0], 'revealAnswer', [Object.keys(turingCards(sorting))[0], sorting.epoch]);
      await revealAll(f, g, mode === 'endless' && round === rounds);
      expect((await f.state(other.matchID)).G).toEqual(untouched);
      if (round < rounds) { await ack(f, g); await ack(f, g); }
    }
    expect(new Set(questionIDs.slice(0, 5)).size).toBe(5);
    if (mode === 'endless') expect(questionIDs[5]).not.toBe(questionIDs[4]);
    const final = (await f.state(g.matchID)).G;
    expect(final).toMatchObject(mode === 'endless'
      ? { status: 'finished', completedRounds: 6, round: 7, integrity: 0, winner: 'system', winReason: 'endless-exhausted' }
      : { status: 'finished', completedRounds: 5, integrity: 3, winner: 'humans', winReason: 'calibrated' });
    const lobby = await archive(f, g);
    expect(lobby.history.at(-1)).toMatchObject(mode === 'endless'
      ? { challenge: { mode: 'endless', completedRounds: 6, startingLives: 1 } } : { winner: 'humans' });
    if (mode === 'standard') expect(lobby.history.at(-1).challenge).toBeUndefined();
    const replays: Record<string, any> = {};
    for (const perspective of ['blind', 'god']) {
      const replay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=${perspective}`), undefined, g.observer);
      expect(replay.status).toBe(200); noServerSecrets(replay.body);
      const frame = replay.body.frames.find((item: any) => item.G.round === 1 && item.G.cards[cardID]?.spoken);
      expect(frame.G.private).toEqual(perspective === 'blind' ? {} : pending.private);
      expect(replay.body.frames.at(-1).G.completedRounds).toBe(final.completedRounds);
      expect(replay.body.frames.every((item: any) => Object.keys(item.G.answers).length === 0)).toBe(true);
      replays[perspective] = replay.body;
    }
    const shares: Record<string, string> = {};
    for (const perspective of ['blind', 'god']) {
      const shared = await f.request(path(g.host, 'share'), { matchID: g.matchID, frameIndex: 0, perspective }, g.host);
      expect(shared.status).toBe(200); shares[perspective] = token(shared.body.url, 'share');
    }
    const stats = (await f.request('/api/stats')).body;
    const result = stats.byGame.find((entry: any) => entry.gameId === 'turing-test');
    expect(stats).toMatchObject({ completedGames: 1, totalPlayerParticipations: count });
    expect(result).toMatchObject(mode === 'endless'
      ? { completed: 1, rankedCompleted: 0, wins: {}, reasons: {}, byPlayerCount: [], challenges: [{ mode: 'endless', numPlayers: 3, startingLives: 1, runs: 1, bestCompletedRounds: 6, averageCompletedRounds: 6 }] }
      : { completed: 1, rankedCompleted: 1, wins: { humans: 1 }, challenges: [] });
    await f.restart();
    expect((await f.request('/api/stats')).body).toEqual(stats);
    for (const perspective of ['blind', 'god']) {
      const replay = await f.request(`/api/replays/${g.host.roomId}`, undefined, undefined, { 'X-Replay-Token': shares[perspective] });
      expect(replay.status).toBe(200); expect(replay.body.perspective).toBe(perspective);
      expect(replay.body.frames).toEqual(replays[perspective].frames); noServerSecrets(replay.body);
    }
    const restored = (await f.request(path(g.host), undefined, g.host)).body;
    expect(restored.history).toEqual(lobby.history);
  }, 30000);

  it('keeps ended test-room challenge replays but never adds their score to site statistics', async () => {
    const f = await fixture(), g = await group(f, 2, true);
    expect((await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { mode: 'endless', lives: 1 } }, g.host)).status).toBe(200);
    await start(f, g); await ack(f, g); await speakAll(f, g); await revealAll(f, g, true);
    const lobby = await archive(f, g);
    expect(lobby.history.at(-1).challenge).toEqual({ mode: 'endless', completedRounds: 0, startingLives: 1 });
    expect((await f.request(path(g.host, `replay?matchID=${g.matchID}`), undefined, g.observer)).status).toBe(200);
    expect((await f.request('/api/stats')).body).toMatchObject({ completedGames: 0, totalPlayerParticipations: 0 });
    const summary = (await f.request('/api/stats')).body.byGame.find((entry: any) => entry.gameId === 'turing-test');
    expect(summary).toMatchObject({ completed: 0, rankedCompleted: 0, challenges: [] });
  });

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
    expect(changed.status).toBe(200); expect(changed.body.gameOptions).toEqual(normalizeTuringOptions(body.options));
    expect(changed.body.matchID).not.toBe(g.matchID);
    expect(changed.body.players.every((player: any) => !player.ready)).toBe(true);
    expect((await f.request(path(g.host, 'options'), body, g.host)).status).toBe(409);
    g.matchID = changed.body.matchID;
    const rejected = await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { deck: 'custom', customQuestions: customQuestions.slice(0, 4) } }, g.host);
    expect(rejected.status).toBe(400);
    const intact = (await f.request(path(g.host), undefined, g.host)).body;
    expect(intact.matchID).toBe(g.matchID); expect(intact.gameOptions).toEqual(normalizeTuringOptions(body.options));
    await start(f, g);
    expect((await f.request(path(g.host, 'options'), { ...body, matchID: g.matchID }, g.host)).status).toBe(409);
  });

  it('resumes a legacy typed match over sockets, retains its pending answer across restart, and persists legacy replays', async () => {
    const f = await fixture(), g = await group(f);
    const changed = await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { deck: 'custom', customQuestions } }, g.host);
    expect(changed.status).toBe(200);
    await start(f, g, true); await ack(f, g);
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
