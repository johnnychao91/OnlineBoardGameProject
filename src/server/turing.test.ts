import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTuringSharedTable, turingCardNumber, turingCards, type TuringState } from '../games/turing/game';
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
  const emitMove = (group: Group, id: string, type: string, args: unknown[], stateID: number) => {
    const index = group.seats.findIndex(seat => seat.playerID === id), seat = group.seats[index];
    group.clients[index].emit('update', { type: 'MAKE_MOVE', payload: { type, args, playerID: id, credentials: seat.credentials } }, stateID, group.matchID, id);
  };
  const move = async (group: Group, id: string, type: string, args: unknown[]) => {
    const before = await state(group.matchID);
    const context = `${type} by ${id}; rules v${before.G.rulesVersion}, round ${before.G.round}, ${before.G.status}, epoch ${before.G.epoch}`;
    emitMove(group, id, type, args, before._stateID);
    await vi.waitFor(async () => expect((await state(group.matchID))._stateID, `Persisted move: ${context}`).toBeGreaterThan(before._stateID), { timeout: 4000, interval: 10 });
    const after = await state(group.matchID);
    await vi.waitFor(() => group.clients.forEach((socket, index) => expect(views.get(socket)?._stateID, `Broadcast to ${group.seats[index].playerID}: ${context}`).toBe(after._stateID)), { timeout: 4000, interval: 10 });
    return after;
  };
  const rejectMove = async (group: Group, id: string, type: string, args: unknown[]) => {
    const index = group.seats.findIndex(seat => seat.playerID === id), seat = group.seats[index];
    const before = await state(group.matchID), socket = group.clients[index];
    emitMove(group, id, type, args, before._stateID);
    // An authorized sync is serialized behind the preceding move in this room.
    // It is a deterministic barrier, not a timing-based guess that no write occurred.
    await sync(socket, group, seat);
    expect(await state(group.matchID)).toEqual(before);
  };
  return { request, connect, sync, state, move, emitMove, rejectMove, views, wireLogs, get app() { return app; },
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
async function start(f: Fixture, g: Group, legacy?: 1 | 2 | 3) {
  const current = (await f.request(path(g.host), undefined, g.host)).body;
  for (const seat of g.seats) expect((await f.request(path(g.host, 'ready'), { ready: true, matchID: current.matchID }, seat)).status).toBe(200);
  const started = await f.request(path(g.host, 'start'), { matchID: current.matchID }, g.host);
  expect(started.status).toBe(200); g.matchID = started.body.matchID;
  if (legacy) {
    // Simulate an already saved pre-voice match; loading it must not silently
    // replace its rules, pending answers, number assignments or question order.
    const saved = await f.state(g.matchID), G = saved.G;
    G.rulesVersion = legacy;
    G.status = 'briefing';
    for (const player of Object.values(G.players)) player.answered = false;
    for (const card of Object.values(G.cards ?? {})) card.spoken = false;
    delete G.redrawApprovals;
    if (legacy < 3) { delete G.tableOrder; delete G.orderApprovals; }
    if (legacy === 1) {
      G.options = { deck: G.options.deck, customQuestions: G.options.customQuestions };
      G.private = Object.fromEntries(Object.entries(G.private).map(([id, info]) => [id, { number: info.number }]));
      G.secretQuestionQueue = turingQuestionPool(G.options).filter(question => question.id !== G.question?.id).slice(0, 4);
      G.maxIntegrity = G.integrity = Math.min(g.seats.length, 8);
      delete G.cards; delete G.completedRounds; delete G.secretDrawIDs;
    } else if (legacy === 2) {
      G.examinerID = g.seats[0].playerID;
      G.private = {}; G.cards = {};
      let number = 1;
      for (const seat of g.seats.slice(1)) {
        const cards = ['a', 'b'].map(suffix => ({ id: `${seat.playerID}-${suffix}`, number: number++ }));
        G.private[seat.playerID] = { number: cards[0].number, cards };
        cards.forEach((card, index) => { G.cards![card.id] = { playerID: seat.playerID, slot: index === 0 ? 'A' : 'B', spoken: false }; });
      }
      G.log[0].examinerID = G.examinerID;
    }
    saved._stateID += 1;
    await f.app.db.setState(g.matchID, saved);
  }
  await connectGroup(f, g);
}
async function ack(f: Fixture, g: Group) {
  const { G } = await f.state(g.matchID);
  if (G.rulesVersion >= 4 && G.status === 'sorting') return;
  for (const seat of g.seats) await f.move(g, seat.playerID, 'acknowledge', [G.epoch]);
}

async function speakAll(f: Fixture, g: Group) {
  const { G } = await f.state(g.matchID);
  if (G.rulesVersion >= 4) { expect(G.status).toBe('sorting'); return; }
  for (const [cardID, card] of Object.entries(turingCards(G))) {
    if (!card.spoken) await f.move(g, card.playerID, 'confirmSpoken', [cardID, G.epoch]);
  }
}
async function revealAll(f: Fixture, g: Group, descending = false) {
  const { G } = await f.state(g.matchID);
  const cards = Object.keys(turingCards(G)).sort((a, b) => turingCardNumber(G, a)! - turingCardNumber(G, b)!);
  if (descending) cards.reverse();
  if (isTuringSharedTable(G)) {
    for (const [index, cardID] of cards.entries()) {
      const current = (await f.state(g.matchID)).G;
      await f.move(g, g.seats[index % g.seats.length].playerID, 'placeCard', [cardID, index, current.epoch]);
    }
    const arranged = (await f.state(g.matchID)).G;
    for (const seat of g.seats) await f.move(g, seat.playerID, 'approveOrder', [arranged.epoch]);
    return;
  }
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
  it.each([{ count: 2, version: 2 }, { count: 3, version: 2 }, { count: 2, version: 3 }, { count: 3, version: 3 }, { count: 2, version: 4 }, { count: 3, version: 4 }, { count: 4, version: 4 }])('$count-player v$version voice play authorizes each card, isolates rooms, survives restart and records its mode-specific result', async ({ count, version }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = await fixture(), g = await group(f, count), other = await group(f, 2);
    const mode = count === 3 ? 'endless' : 'standard';
    const settings = { deck: 'custom', customQuestions, mode, lives: 1 };
    expect((await f.request(path(g.host, 'options'), { matchID: g.matchID, options: settings }, g.host)).status).toBe(200);
    await start(f, other); await start(f, g, version < 4 ? version as 2 | 3 : undefined); await ack(f, g);
    const untouched = (await f.state(other.matchID)).G;
    const first = (await f.state(g.matchID)).G, entries = Object.entries(turingCards(first));
    const sharedTable = version >= 3 && count <= 3;
    expect(entries).toHaveLength(sharedTable ? count : (count - 1) * (version === 2 ? 2 : 1));
    expect(first).toMatchObject({ rulesVersion: version, targetRounds: mode === 'endless' ? null : 5, completedRounds: 0 });
    const [cardID, card] = entries[0];
    const otherID = g.seats.find(seat => seat.playerID !== card.playerID)!.playerID;
    await f.rejectMove(g, otherID, 'confirmSpoken', [cardID, first.epoch]);
    await f.rejectMove(g, card.playerID, 'submitAnswer', ['此局不接受文字答案', first.epoch]);
    if (version < 4) {
      await f.rejectMove(g, g.host.playerID, 'revealAnswer', [cardID, first.epoch]);
      if (sharedTable) await f.rejectMove(g, g.host.playerID, 'placeCard', [cardID, 0, first.epoch]);
      await f.move(g, card.playerID, 'confirmSpoken', [cardID, first.epoch]);
      await f.rejectMove(g, card.playerID, 'confirmSpoken', [cardID, first.epoch]);
      await f.rejectMove(g, g.host.playerID, 'revealAnswer', [cardID, first.epoch]);
    } else {
      expect(first.status).toBe('sorting');
      await f.rejectMove(g, card.playerID, 'confirmSpoken', [cardID, first.epoch]);
      await f.rejectMove(g, g.host.playerID, 'acknowledge', [first.epoch]);
    }
    for (let index = 0; index < count; index += 1) {
      const seat = g.seats[index], view = f.views.get(g.clients[index])!;
      expect(Object.keys(view.G.private)).toEqual(!sharedTable && seat.playerID === first.examinerID ? [] : [seat.playerID]);
      expect(view.G.answers).toEqual({}); expect(view.G.log.some(event => event.type === 'answers')).toBe(false);
      expect(f.wireLogs.get(g.clients[index])).toEqual([]); expect(view.deltalog).toBeUndefined();
      expect(view.ctx.numMoves).toBe(0); noServerSecrets(view);
    }
    const pendingBlind = (await f.request(path(g.host, 'view?perspective=blind'), undefined, g.observer)).body;
    const pendingGod = (await f.request(path(g.host, 'view?perspective=god'), undefined, g.observer)).body;
    expect(pendingBlind.G.private).toEqual({});
    if (version < 4) expect(pendingBlind.G.cards[cardID].spoken).toBe(true);
    expect(pendingGod.G.private[card.playerID].cards).toHaveLength(version === 2 ? 2 : 1);
    noServerSecrets(pendingBlind); noServerSecrets(pendingGod);
    const pending = (await f.state(g.matchID)).G;
    await f.restart(); expect((await f.state(g.matchID)).G).toEqual(pending);
    await connectGroup(f, g); await connectGroup(f, other);
    const rounds = mode === 'endless' ? 7 : 5, questionIDs: string[] = [];
    for (let round = 1; round <= rounds; round += 1) {
      const current = (await f.state(g.matchID)).G;
      expect(current).toMatchObject({ round, status: version >= 4 ? 'sorting' : 'answering', completedRounds: round - 1 });
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
      : { status: 'finished', completedRounds: 5, integrity: Math.max(3, count), winner: 'humans', winReason: 'calibrated' });
    const lobby = await archive(f, g);
    expect(lobby.history.at(-1)).toMatchObject(mode === 'endless'
      ? { challenge: { mode: sharedTable ? 'endless-table' : 'endless', completedRounds: 6, startingLives: 1 } } : { winner: 'humans' });
    if (mode === 'standard') expect(lobby.history.at(-1).challenge).toBeUndefined();
    const replays: Record<string, any> = {};
    for (const perspective of ['blind', 'god']) {
      const replay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=${perspective}`), undefined, g.observer);
      expect(replay.status).toBe(200); noServerSecrets(replay.body);
      const frame = replay.body.frames.find((item: any) => item.G.round === 1 && (version >= 4 ? item.G.status === 'sorting' : item.G.cards[cardID]?.spoken));
      expect(frame.G.private).toEqual(perspective === 'blind' ? {} : pending.private);
      if (sharedTable) {
        const agreed = replay.body.frames.find((item: any) => item.G.status === 'sorting' && item.G.orderApprovals?.length);
        expect(agreed.G.revealed).toEqual([]);
        expect(agreed.G.tableOrder).toHaveLength(count);
        if (perspective === 'blind') expect(agreed.G.private).toEqual({});
        expect(replay.body.frames.every((item: any) => item.G.revealed.length === 0 || item.G.revealed.length === count)).toBe(true);
      }
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
      ? { completed: 1, rankedCompleted: 0, wins: {}, reasons: {}, byPlayerCount: [], challenges: [{ mode: sharedTable ? 'endless-table' : 'endless', numPlayers: 3, startingLives: 1, runs: 1, bestCompletedRounds: 6, averageCompletedRounds: 6 }] }
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

  it('serializes competing table edits and approvals, invalidates old consent, and preserves a pending order through restart', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = await fixture(), g = await group(f, 3);
    await start(f, g); await ack(f, g); await speakAll(f, g);
    const ids = g.seats.map(seat => seat.playerID);
    const place = async (cardID: string, index: number, actorID = ids[0]) => {
      const { G } = await f.state(g.matchID);
      return f.move(g, actorID, 'placeCard', [cardID, index, G.epoch]);
    };
    await place(ids[0], 0);
    await f.rejectMove(g, ids[0], 'approveOrder', [(await f.state(g.matchID)).G.epoch]);
    await place(ids[1], 1, ids[2]); await place(ids[2], 2, ids[1]);
    const full = (await f.state(g.matchID)).G;
    await f.move(g, ids[0], 'approveOrder', [full.epoch]);
    await f.move(g, ids[1], 'removeCard', [ids[2], full.epoch]);
    const removed = (await f.state(g.matchID)).G;
    expect(removed.tableOrder).toEqual(ids.slice(0, 2)); expect(removed.orderApprovals).toEqual([]);
    expect(removed.epoch).toBe(full.epoch + 1);
    await f.rejectMove(g, ids[1], 'approveOrder', [full.epoch]);
    await f.rejectMove(g, ids[1], 'approveOrder', [removed.epoch]);
    await place(ids[2], 2);
    const before = await f.state(g.matchID);
    await f.move(g, ids[0], 'approveOrder', [before.G.epoch]);
    const race = async (commands: { id: string; type: string; args: unknown[] }[]) => {
      const initial = await f.state(g.matchID);
      for (const command of commands) f.emitMove(g, command.id, command.type, command.args, initial._stateID);
      await Promise.all(g.clients.map((socket, index) => f.sync(socket, g, g.seats[index])));
      const settled = await f.state(g.matchID);
      await vi.waitFor(() => g.clients.forEach(socket => expect(f.views.get(socket)?._stateID).toBe(settled._stateID)), { timeout: 4000, interval: 10 });
      return { initial, settled };
    };
    const edited = await race([
      { id: ids[0], type: 'placeCard', args: [ids[2], 0, before.G.epoch] },
      { id: ids[1], type: 'placeCard', args: [ids[0], 2, before.G.epoch] },
    ]);
    expect(edited.settled._stateID).toBe(edited.initial._stateID + 1);
    expect([ [ids[2], ids[0], ids[1]], [ids[1], ids[2], ids[0]] ]).toContainEqual(edited.settled.G.tableOrder);
    expect(edited.settled.G.orderApprovals).toEqual([]); expect(edited.settled.G.revealed).toEqual([]);
    expect(edited.settled.G.epoch).toBe(before.G.epoch + 1);
    await f.rejectMove(g, ids[2], 'approveOrder', [before.G.epoch]);
    await f.move(g, ids[0], 'approveOrder', [edited.settled.G.epoch]);
    const pending = (await f.state(g.matchID)).G;
    expect(pending.orderApprovals).toEqual([ids[0]]);
    await f.restart(); expect((await f.state(g.matchID)).G).toEqual(pending); await connectGroup(f, g);
    for (const perspective of ['blind', 'god']) {
      const observed = (await f.request(path(g.host, `view?perspective=${perspective}`), undefined, g.observer)).body.G;
      expect(observed.tableOrder).toEqual(pending.tableOrder); expect(observed.orderApprovals).toEqual([ids[0]]);
      expect(observed.revealed).toEqual([]); expect(observed.log.some((event: any) => event.type === 'reveal')).toBe(false);
      expect(Object.keys(observed.private)).toHaveLength(perspective === 'blind' ? 0 : 3); noServerSecrets(observed);
    }
    await f.move(g, ids[0], 'withdrawApproval', [pending.epoch]);
    const withdrawn = (await f.state(g.matchID)).G;
    expect(withdrawn.orderApprovals).toEqual([]); expect(withdrawn.epoch).toBe(pending.epoch + 1);
    await f.rejectMove(g, ids[0], 'approveOrder', [pending.epoch]);
    expect((await f.state(g.matchID)).G.revealed).toEqual([]);
    await f.move(g, ids[0], 'approveOrder', [withdrawn.epoch]);
    const approved = await race(ids.slice(1).map(id => ({ id, type: 'approveOrder', args: [withdrawn.epoch] })));
    expect(approved.settled._stateID).toBe(approved.initial._stateID + 2);
    expect(approved.settled.G.status).toBe('round-review'); expect(approved.settled.G.completedRounds).toBe(1);
    expect(approved.settled.G.revealed.map(card => card.cardID)).toEqual(pending.tableOrder);
    expect(approved.settled.G.log.filter(event => event.type === 'reveal')).toHaveLength(3);
    await ack(f, g); await ack(f, g); await speakAll(f, g);
    const numbers = (await f.state(g.matchID)).G;
    const ascending = ids.slice().sort((a, b) => turingCardNumber(numbers, a)! - turingCardNumber(numbers, b)!);
    for (const [index, id] of ascending.entries()) await place(id, index);
    const complete = (await f.state(g.matchID)).G;
    await f.move(g, ids[0], 'approveOrder', [complete.epoch]);
    await f.move(g, ids[1], 'approveOrder', [complete.epoch]);
    const finalRace = await race([
      { id: ids[2], type: 'approveOrder', args: [complete.epoch] },
      { id: ids[1], type: 'placeCard', args: [ascending[2], 0, complete.epoch] },
    ]);
    expect(finalRace.settled._stateID).toBe(finalRace.initial._stateID + 1);
    if (finalRace.settled.G.status === 'sorting') {
      expect(finalRace.settled.G.tableOrder).toEqual([ascending[2], ...ascending.slice(0, 2)]);
      expect(finalRace.settled.G.orderApprovals).toEqual([]); expect(finalRace.settled.G.revealed).toEqual([]);
    } else {
      expect(finalRace.settled.G.status).toBe('round-review');
      expect(finalRace.settled.G.revealed.map(card => card.cardID)).toEqual(ascending);
      expect(finalRace.settled.G.completedRounds).toBe(2);
    }
  }, 30000);

  it('persists unanimous redraw proposals, keeps numbers private and unchanged, and isolates stale actions and other rooms', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = await fixture(), g = await group(f, 3), other = await group(f, 2);
    await start(f, g); await start(f, other);
    const ids = g.seats.map(seat => seat.playerID);
    const original = (await f.state(g.matchID)).G, untouched = await f.state(other.matchID);
    expect(original).toMatchObject({ rulesVersion: 4, status: 'sorting', round: 1 });
    for (const [index, id] of ids.entries()) await f.move(g, ids[0], 'placeCard', [id, index, (await f.state(g.matchID)).G.epoch]);
    await f.move(g, ids[0], 'approveOrder', [(await f.state(g.matchID)).G.epoch]);
    const before = (await f.state(g.matchID)).G;
    await f.move(g, ids[0], 'approveRedraw', [before.epoch]);
    const proposed = (await f.state(g.matchID)).G;
    expect(proposed.redrawApprovals).toEqual([ids[0]]);
    expect(proposed.orderApprovals).toEqual([]);
    expect(proposed.epoch).toBeGreaterThan(before.epoch);
    await f.rejectMove(g, ids[1], 'approveOrder', [proposed.epoch]);
    await f.rejectMove(g, ids[1], 'approveRedraw', [before.epoch]);
    await f.move(g, ids[1], 'approveRedraw', [proposed.epoch]);
    const pending = (await f.state(g.matchID)).G;
    await f.restart(); expect((await f.state(g.matchID)).G).toEqual(pending);
    await connectGroup(f, g); await connectGroup(f, other);
    for (const perspective of ['blind', 'god']) {
      const view = (await f.request(path(g.host, `view?perspective=${perspective}`), undefined, g.observer)).body;
      expect(view.G.redrawApprovals).toEqual(ids.slice(0, 2));
      expect(view.G.question).toEqual(original.question);
      expect(view.G.private).toEqual(perspective === 'blind' ? {} : original.private);
      noServerSecrets(view);
    }
    await f.move(g, ids[1], 'withdrawRedraw', [pending.epoch]);
    const withdrawn = (await f.state(g.matchID)).G;
    await f.rejectMove(g, ids[1], 'approveRedraw', [pending.epoch]);
    await f.move(g, ids[2], 'placeCard', [ids[2], 0, withdrawn.epoch]);
    const moved = (await f.state(g.matchID)).G;
    expect(moved.redrawApprovals).toEqual([ids[0]]);
    await f.move(g, ids[1], 'approveRedraw', [moved.epoch]);
    await f.move(g, ids[2], 'approveRedraw', [moved.epoch]);
    const redrawn = (await f.state(g.matchID)).G;
    expect(redrawn.question!.id).not.toBe(original.question!.id);
    expect(redrawn).toMatchObject({ status: 'sorting', round: 1, completedRounds: 0, integrity: original.integrity, private: original.private, tableOrder: [], orderApprovals: [], redrawApprovals: [], revealed: [] });
    expect(redrawn.log.filter(event => event.type === 'question-redraw')).toEqual([expect.objectContaining({ round: 1, question: redrawn.question })]);
    await f.rejectMove(g, ids[1], 'placeCard', [ids[0], 0, moved.epoch]);
    await f.rejectMove(g, ids[2], 'approveRedraw', [moved.epoch]);
    await f.rejectMove(g, ids[0], 'approveOrder', [moved.epoch]);
    expect(await f.state(other.matchID)).toEqual(untouched);
    await revealAll(f, g);
    const review = (await f.state(g.matchID)).G;
    await f.rejectMove(g, ids[0], 'approveRedraw', [review.epoch]);
    for (let round = 2; round <= 5; round += 1) { await ack(f, g); await revealAll(f, g); }
    await archive(f, g);
    const replay = await f.request(path(g.host, `replay?matchID=${g.matchID}&perspective=blind`), undefined, g.observer);
    expect(replay.status).toBe(200);
    expect(replay.body.frames.some((frame: any) => frame.G.question?.id === original.question!.id && frame.G.redrawApprovals?.length === 2)).toBe(true);
    const afterRedraw = replay.body.frames.find((frame: any) => frame.G.question?.id === redrawn.question!.id && frame.G.status === 'sorting');
    expect(afterRedraw.G.question).toEqual(redrawn.question);
    expect(afterRedraw.G.private).toEqual({});
    noServerSecrets(replay.body);
    expect((await f.request('/api/stats')).body.completedGames).toBe(1);
  }, 30000);

  it('keeps ended test-room challenge replays but never adds their score to site statistics', async () => {
    const f = await fixture(), g = await group(f, 2, true);
    expect((await f.request(path(g.host, 'options'), { matchID: g.matchID, options: { mode: 'endless', lives: 1 } }, g.host)).status).toBe(200);
    await start(f, g); await ack(f, g); await speakAll(f, g); await revealAll(f, g, true);
    const lobby = await archive(f, g);
    expect(lobby.history.at(-1).challenge).toEqual({ mode: 'endless-table', completedRounds: 0, startingLives: 1 });
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
    await start(f, g, 1); await ack(f, g);
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
