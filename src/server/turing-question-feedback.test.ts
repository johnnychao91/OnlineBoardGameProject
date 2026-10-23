import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TuringState } from '../games/turing/game';
import type { TuringQuestion } from '../games/turing/rules';
import { STANDARD_QUESTIONS } from '../games/turing/questions';
import { createApplication } from './app';
import { TuringQuestionFeedbackStore } from './turing-question-feedback';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function directory() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-feedback-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-feedback-test-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  return dataDir;
}
interface Seat { playerID: string; credentials: string }
interface Member extends Partial<Seat> { observerID?: string; credentials: string }
interface Group { roomId: string; matchID: string; host: Seat; other: Seat; observer: Member; question: TuringQuestion; round: number }
const origin = 'http://localhost:5173';
async function fixture() {
  const dataDir = await directory();
  const config = { dataDir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false, createRoomKey: '',
    testRoomKey: 'feedback-private-test-key', lifecycleSweepMs: 60000 };
  let app = await createApplication(config), running = await app.listen();
  cleanups.push(async () => { await running.close(); });
  async function request(path: string, body: unknown, member?: Member, extra: Record<string, string> = {}) {
    const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin,
        ...(member ? { Authorization: `Bearer ${member.credentials}`,
          ...(member.observerID ? { 'X-Observer-ID': member.observerID } : { 'X-Player-ID': member.playerID! }) } : {}), ...extra },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  }
  async function group(testRoom = false): Promise<Group> {
    const created = await request('/api/rooms', { gameId: 'turing-test', displayName: '評分房主',
      ...(testRoom ? { createKey: config.testRoomKey } : {}) });
    expect(created.status).toBe(201);
    const host = created.body, roomId = host.roomId;
    const inviteToken = new URLSearchParams(new URL(host.inviteUrl).hash.slice(1)).get('invite');
    const other = (await request(`/api/rooms/${roomId}/join`, { inviteToken, displayName: '另一位玩家' })).body;
    const observer = (await request(`/api/rooms/${roomId}/watch`, { inviteToken, displayName: '觀察員' })).body;
    for (const seat of [host, other]) expect((await request(`/api/rooms/${roomId}/ready`, { matchID: host.matchID, ready: true }, seat)).status).toBe(200);
    const started = await request(`/api/rooms/${roomId}/start`, { matchID: host.matchID }, host);
    expect(started.status).toBe(200);
    const state = (await app.db.fetch(started.body.matchID, { state: true })).state!;
    return { roomId, matchID: started.body.matchID, host, other, observer, question: state.G.question, round: state.G.round };
  }
  const feedback = (g: Group, member: Member | undefined = g.host, extra: Record<string, unknown> = {}) =>
    request(`/api/rooms/${g.roomId}/question-feedback`, { matchID: g.matchID, round: g.round, question: g.question, ...extra }, member);
  async function replace(g: Group, changes: Partial<TuringState>) {
    const state = (await app.db.fetch(g.matchID, { state: true })).state!;
    state.G = { ...state.G, ...changes };
    state._stateID += 1;
    await app.db.setState(g.matchID, state);
  }
  return { group, request, feedback, replace, dataDir, get app() { return app; },
    async restart() { await running.close(); app = await createApplication(config); running = await app.listen(); } };
}

describe('Private persisted Turing question ratings', () => {
  it('migrates overall ratings without reclassifying them and independently persists all three aspects under concurrent writes', async () => {
    const dataDir = await directory(), store = new TuringQuestionFeedbackStore(dataDir);
    const context = { roomId: 'example-room', matchID: 'example-match', playerID: '0', testRoom: false, question: { ...STANDARD_QUESTIONS[0] } };
    await store.feedback(context, 'down');
    const [filename] = await readdir(join(dataDir, 'question-feedback'));
    const file = join(dataDir, 'question-feedback', filename);
    const legacy = JSON.parse(await readFile(file, 'utf8'));
    delete legacy.ratings; legacy.version = 1;
    await writeFile(file, JSON.stringify(legacy));
    const empty = { up: 0, down: 0, vote: null };
    expect(await store.ratings(context)).toEqual({ scope: 'builtin', ratings: { topic: empty, low: empty, high: empty } });
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1); // Reading never rewrites an old export.
    await Promise.all([
      store.ratings(context, 'topic', 'up'), store.ratings(context, 'low', 'down'), store.ratings(context, 'high', 'up'),
      store.ratings(context, 'low', 'down'), store.ratings({ ...context, roomId: 'another-room', matchID: 'another-match' }, 'topic', 'down'),
    ]);
    const restored = new TuringQuestionFeedbackStore(dataDir);
    expect(await restored.ratings(context)).toEqual({ scope: 'builtin', ratings: {
      topic: { up: 1, down: 1, vote: 'up' }, low: { up: 0, down: 1, vote: 'down' }, high: { up: 1, down: 0, vote: 'up' },
    } });
    await restored.ratings(context, 'low', 'up');
    expect((await restored.ratings(context, 'low', null)).ratings).toEqual({
      topic: { up: 1, down: 1, vote: 'up' }, low: empty, high: { up: 1, down: 0, vote: 'up' },
    });
    expect(await restored.feedback(context)).toEqual({ scope: 'builtin', up: 0, down: 1, vote: 'down' });
    await restored.feedback(context, 'up');
    expect((await restored.ratings(context)).ratings.high.up).toBe(1);
    expect((await restored.ratings({ ...context, question: { ...context.question, high: '另一版本的高端點' } })).ratings.topic).toEqual(empty);
    const test = { ...context, testRoom: true };
    expect((await restored.ratings(test, 'low', 'down')).scope).toBe('test');
    expect((await restored.ratings({ ...test, matchID: 'different-match' })).ratings.low).toEqual(empty);
    const custom = { ...context, question: { ...context.question, id: 'custom-0001' } };
    expect((await restored.ratings(custom, 'high', 'down')).scope).toBe('match');
    expect((await restored.ratings({ ...custom, matchID: 'different-match' })).ratings.high).toEqual(empty);
    const record = await readFile(file, 'utf8');
    expect(record).not.toMatch(/example-room|example-match|another-room|another-match|playerID|credentials/);
    expect(JSON.parse(record).version).toBe(2);
  });

  it('accepts independent aspect ratings only through the authenticated current-question route', async () => {
    const f = await fixture(), g = await f.group();
    const body = { feedbackVersion: 2, aspect: 'low', vote: 'down' };
    expect((await f.feedback(g, g.observer, body)).status).toBe(401);
    for (const invalid of [
      { feedbackVersion: 1 }, { feedbackVersion: '2' }, { aspect: 'topic', vote: 'up' },
      { feedbackVersion: 2, vote: 'up' }, { ...body, aspect: 'overall' }, { ...body, aspect: null },
    ]) expect((await f.feedback(g, g.host, invalid)).status).toBe(400);
    const before = (await f.app.db.fetch(g.matchID, { state: true })).state;
    expect((await f.feedback(g, g.host, body)).body.ratings.low).toEqual({ up: 0, down: 1, vote: 'down' });
    expect((await f.feedback(g, g.other, { ...body, aspect: 'topic', vote: 'up' })).body.ratings.topic.up).toBe(1);
    expect((await f.feedback(g, g.host, { ...body, round: g.round + 1 })).status).toBe(409);
    expect((await f.feedback(g, g.host, { ...body, question: { ...g.question, high: '過期的高端點' } })).status).toBe(409);
    await f.restart();
    expect((await f.feedback(g, g.host, { feedbackVersion: 2 })).body).toEqual({ scope: 'builtin', ratings: {
      topic: { up: 1, down: 0, vote: null }, low: { up: 0, down: 1, vote: 'down' }, high: { up: 0, down: 0, vote: null },
    } });
    expect((await f.app.db.fetch(g.matchID, { state: true })).state).toEqual(before);
    expect((await f.feedback(g)).body).toEqual({ scope: 'builtin', up: 0, down: 0, vote: null });
    await f.request(`/api/rooms/${g.roomId}/leave`, { matchID: g.matchID }, g.other);
    expect((await f.feedback(g, g.other, body)).status).toBe(401);
  });

  it('serializes cross-room votes, deduplicates retries, switches and withdraws, and persists snapshot versions separately', async () => {
    const dataDir = await directory(), store = new TuringQuestionFeedbackStore(dataDir);
    const question = { ...STANDARD_QUESTIONS[0] };
    const one = { roomId: 'room-a', matchID: 'match-a', playerID: '0', testRoom: false, question };
    const two = { ...one, roomId: 'room-b', matchID: 'match-b' };
    expect(await store.feedback(one)).toEqual({ scope: 'builtin', up: 0, down: 0, vote: null });
    expect(await readdir(dataDir)).toEqual([]);
    await Promise.all([store.feedback(one, 'up'), store.feedback(one, 'up'), store.feedback(two, 'down')]);
    expect(await store.feedback(one)).toEqual({ scope: 'builtin', up: 1, down: 1, vote: 'up' });
    expect(await store.feedback(two, 'up')).toEqual({ scope: 'builtin', up: 2, down: 0, vote: 'up' });
    expect(await store.feedback(one, null)).toEqual({ scope: 'builtin', up: 1, down: 0, vote: null });
    const restored = new TuringQuestionFeedbackStore(dataDir);
    expect((await restored.feedback(two)).vote).toBe('up');
    expect(await restored.feedback({ ...two, question: { ...question, low: '更新後的低端點' } })).toEqual({ scope: 'builtin', up: 0, down: 0, vote: null });
    const files = await readdir(join(dataDir, 'question-feedback'));
    expect(files).toHaveLength(1);
    const record = JSON.parse(await readFile(join(dataDir, 'question-feedback', files[0]), 'utf8'));
    expect(Object.keys(record.votes)).toHaveLength(1);
    expect(Object.keys(record.votes)[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toMatch(/room-a|room-b|match-a|match-b|credentials|playerID|displayName/);
  });

  it('isolates test rooms and custom content from official and other-match ratings', async () => {
    const store = new TuringQuestionFeedbackStore(await directory());
    const context = { roomId: 'one', matchID: 'first', playerID: '0', testRoom: false, question: { ...STANDARD_QUESTIONS[0] } };
    await store.feedback(context, 'up');
    const test = { ...context, testRoom: true };
    expect(await store.feedback(test, 'down')).toEqual({ scope: 'test', up: 0, down: 1, vote: 'down' });
    expect((await store.feedback({ ...test, roomId: 'two', matchID: 'second' })).down).toBe(0);
    expect((await store.feedback(context)).down).toBe(0);
    const custom = { ...context, question: { ...context.question, id: 'custom-0001', category: '自訂' } };
    expect((await store.feedback(custom, 'down')).scope).toBe('match');
    expect((await store.feedback({ ...custom, matchID: 'second' })).down).toBe(0);
    expect((await store.feedback(context)).up).toBe(1);
  });

  it('authenticates before parsing and rejects observers, forged identities, stale questions, foreign matches and invalid requests', async () => {
    const f = await fixture(), g = await f.group(), foreign = await f.group();
    const path = `/api/rooms/${g.roomId}/question-feedback`;
    expect((await f.request(path, { oversized: 'x'.repeat(5000) })).status).toBe(401);
    expect((await f.feedback(g, g.observer, { vote: 'up' })).status).toBe(401);
    expect((await f.feedback(g, foreign.host, { vote: 'up' })).status).toBe(401);
    expect((await f.request(path, { vote: 'up' }, { playerID: g.host.playerID, credentials: g.observer.credentials }, { 'X-Replay-Token': g.host.credentials })).status).toBe(401);
    expect((await f.feedback(g, g.host, { matchID: foreign.matchID, vote: 'up' })).status).toBe(409);
    expect((await f.feedback(g, g.host, { round: g.round + 1, vote: 'up' })).status).toBe(409);
    expect((await f.feedback(g, g.host, { question: { ...g.question, low: '偽造端點' }, vote: 'up' })).status).toBe(409);
    expect((await f.feedback(g, g.host, { vote: 'invalid' })).status).toBe(400);
    expect((await f.feedback(g, g.host, { question: { ...g.question, secret: true } })).status).toBe(400);
    expect((await f.request(path, { oversized: 'x'.repeat(5000) }, g.host)).status).toBe(413);
    expect((await f.request(path, {}, g.host, { Origin: 'https://other.example' })).status).toBe(403);
    expect((await f.feedback(g)).body).toEqual({ scope: 'builtin', up: 0, down: 0, vote: null });
    const active = (await f.app.db.fetch(g.matchID, { state: true })).state!.G;
    await f.replace(g, { players: { [g.host.playerID]: active.players[g.host.playerID] } });
    expect((await f.feedback(g, g.other, { vote: 'up' })).status).toBe(409);
    await f.replace(g, { question: { ...g.question, id: 'custom-0001' } });
    expect((await f.feedback(g, g.host, { vote: 'up' })).status).toBe(409);
    await f.replace(g, { status: 'lobby' });
    expect((await f.feedback(g, g.host, { vote: 'up' })).status).toBe(409);
  });

  it('uses server-owned current snapshots, aggregates concurrent room votes, survives restart and revokes departed players', async () => {
    const f = await fixture(), one = await f.group(), two = await f.group(), test = await f.group(true);
    for (const group of [two, test]) {
      await f.replace(group, { question: one.question }); group.question = { ...one.question };
    }
    const before = (await f.app.db.fetch(one.matchID, { state: true })).state;
    const results = await Promise.all([
      f.feedback(one, one.host, { vote: 'up' }), f.feedback(one, one.other, { vote: 'down' }),
      f.feedback(two, two.host, { vote: 'up' }), f.feedback(test, test.host, { vote: 'down' }),
    ]);
    expect(results.map(result => result.status)).toEqual([200, 200, 200, 200]);
    expect((await f.feedback(one)).body).toEqual({ scope: 'builtin', up: 2, down: 1, vote: 'up' });
    expect((await f.feedback(test)).body).toEqual({ scope: 'test', up: 0, down: 1, vote: 'down' });
    expect((await f.app.db.fetch(one.matchID, { state: true })).state).toEqual(before);
    await f.restart();
    expect((await f.feedback(one)).body).toEqual({ scope: 'builtin', up: 2, down: 1, vote: 'up' });
    expect((await f.feedback(one, one.host, { vote: 'down' })).body).toEqual({ scope: 'builtin', up: 1, down: 2, vote: 'down' });
    expect((await f.feedback(one, one.host, { vote: null })).body).toEqual({ scope: 'builtin', up: 1, down: 1, vote: null });
    const left = await f.request(`/api/rooms/${one.roomId}/leave`, { matchID: one.matchID }, one.other);
    expect(left.status).toBe(200);
    expect((await f.feedback(one, one.other, { vote: 'up' })).status).toBe(401);
    const ended = await f.request(`/api/rooms/${one.roomId}/abort`, { matchID: one.matchID }, one.host);
    expect(ended.status).toBe(200);
    expect((await f.feedback(one, one.host, { vote: 'up' })).status).toBe(409);
  });

  it('rechecks the queued snapshot and membership after a redraw or departure wins the room queue', async () => {
    const f = await fixture(), g = await f.group();
    const queue = f.app.server.transport.getMatchQueue(g.matchID);
    for (const action of ['redraw', 'leave'] as const) {
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      const waiting = queue.add(async () => { entered(); await gate; });
      await started;
      const mutation = action === 'redraw'
        ? queue.add(async () => { await f.replace(g, { question: { ...g.question, low: '已重抽的新題端點' } }); })
        : f.request(`/api/rooms/${g.roomId}/leave`, { matchID: g.matchID }, g.other);
      let rating: ReturnType<typeof f.feedback> | undefined;
      try {
        await vi.waitFor(() => expect(queue.size).toBe(1));
        rating = f.feedback(g, g.other, { vote: 'up' });
        await vi.waitFor(() => expect(queue.size).toBe(2));
      } finally { release(); }
      await waiting; await mutation;
      expect((await rating!).status).toBe(action === 'redraw' ? 409 : 401);
      await queue.onIdle();
      g.question = { ...g.question, low: '已重抽的新題端點' };
    }
    expect((await f.feedback(g)).body).toEqual({ scope: 'builtin', up: 0, down: 0, vote: null });
  });
});
