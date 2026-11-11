import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceEchoClock, type EchoState } from '../games/echo/game';
import { ECHO_ROUND_LIMIT, normalizeEchoOptions, normalizeNewEchoOptions } from '../games/echo/rules';
import { createApplication } from './app';
import { collectStatistics } from './statistics';

const origin = 'http://127.0.0.1:5173';
const testRoomCode = 'echo-integration-test-only';
const alpha = 'a'.repeat(64), bravo = 'b'.repeat(64), charlie = 'c'.repeat(64);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  try { for (const clean of cleanups.splice(0).reverse()) await clean(); }
  finally { vi.restoreAllMocks(); }
});

interface Seat { playerID: string; credentials: string }
interface Observer { observerID: string; credentials: string }
interface Host extends Seat { roomId: string; matchID: string; inviteUrl: string }
const pause = { timeout: 10000, interval: 25 };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'boardgame-echo-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('boardgame-echo-test-')) throw new Error('Unexpected test directory');
    await rm(dir, { recursive: true, force: true });
  });
  const config = { dataDir: dir, publicOrigin: origin, host: '127.0.0.1', port: 0, production: false, clockSweepMs: 30, testRoomCode };
  let app = await createApplication(config), server = await app.listen();
  const sockets = new Set<Socket>();
  cleanups.push(async () => { sockets.forEach(socket => socket.disconnect()); await server.close(); });
  const url = () => 'http://127.0.0.1:' + server.port;
  async function request(path: string, payload?: object, member?: Seat | Observer) {
    const response = await fetch(url() + path, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(member ? {
        Authorization: 'Bearer ' + member.credentials,
        ...('playerID' in member ? { 'X-Player-ID': member.playerID } : { 'X-Observer-ID': member.observerID }),
      } : {}) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() as any };
  }
  async function room(names: string[], tokens: string[], test = false) {
    const created = await request('/api/rooms', { gameId: 'cup-echo', displayName: names[0], ...(test ? { roomCode: testRoomCode } : {}) });
    expect(created.status).toBe(201);
    const host: Host = created.body;
    const base = '/api/rooms/' + host.roomId;
    const inviteToken = new URLSearchParams(new URL(host.inviteUrl).hash.slice(1)).get('invite')!;
    const seats: Seat[] = [host];
    for (const name of names.slice(1)) {
      const joined = await request(base + '/join', { inviteToken, displayName: name });
      expect(joined.status).toBe(200);
      seats.push(joined.body);
    }
    const watching = await request(base + '/watch', { inviteToken, displayName: '觀戰者' });
    expect(watching.status).toBe(200);
    let matchID = host.matchID;
    const options = async (value: object, member: Seat | Observer = host) => {
      const response = await request(base + '/options', { matchID, options: value }, member);
      if (response.status === 200) matchID = response.body.matchID;
      return response;
    };
    async function start() {
      for (const [index, seat] of seats.entries()) {
        expect((await request(base + '/ready', { ready: true, matchID, echoBrowserToken: tokens[index] }, seat)).status).toBe(200);
      }
      expect((await request(base + '/start', { matchID }, host)).status).toBe(200);
    }
    async function state() { return (await app.db.fetch(matchID, { state: true })).state! as State<EchoState>; }
    async function connect() {
      return Promise.all(seats.map(async seat => {
        const socket = io(url() + '/cup-echo', { transports: ['websocket'], autoConnect: false, forceNew: true, reconnection: false, extraHeaders: { Origin: origin } });
        sockets.add(socket);
        const ready = new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        socket.connect();
        await ready;
        const sync = () => new Promise<SyncInfo>(resolve => {
          socket.once('sync', (_matchID, info) => resolve(info));
          socket.emit('sync', matchID, seat.playerID, seat.credentials, seats.length);
        });
        const view = await sync();
        const move = (name: string, args: unknown[], version: number) => socket.emit('update', {
          type: 'MAKE_MOVE', payload: { type: name, args, playerID: seat.playerID, credentials: seat.credentials },
        }, version, matchID, seat.playerID);
        return { seat, view, sync, move };
      }));
    }
    return { host, seats, watcher: watching.body as Observer, base, options, start, state, connect, get matchID() { return matchID; } };
  }
  return { room, request, stats: () => collectStatistics(app.db, app.rooms), get app() { return app; },
    async restart() { sockets.forEach(socket => socket.disconnect()); sockets.clear(); await server.close(); app = await createApplication(config); server = await app.listen(); } };
}

describe('Cup Echo authenticated multiplayer and statistics', () => {
  it('keeps the 60-second default, preserves untimed settings and upgrades previously saved 12-second settings', () => {
    expect(normalizeEchoOptions().seconds).toBe(60);
    expect([12, 0, 15, 30, 60, 120].map(seconds => normalizeEchoOptions({ seconds }).seconds)).toEqual([15, 0, 15, 30, 60, 120]);
    expect(() => normalizeEchoOptions({ seconds: 20 })).toThrow();
  });
  it.each([5, 8, 10, 12, 15, 30, ECHO_ROUND_LIMIT] as const)('ends a stored match exactly at round %i', roundLimit => {
    const options = normalizeEchoOptions({ roundLimit });
    expect(normalizeNewEchoOptions({ roundLimit }).roundLimit).toBe(roundLimit === 8 || roundLimit === 12 ? ECHO_ROUND_LIMIT : roundLimit);
    const G: EchoState = {
      rulesVersion: 1, status: 'writing', round: 1, epoch: 1, phaseEpoch: 1, deadline: 1, options,
      players: { 0: { ready: true, sealed: false, reviewed: false }, 1: { ready: true, sealed: false, reviewed: false } },
      clues: [], history: [], result: null, private: {},
    };
    for (let round = 1; round <= roundLimit; round++) {
      expect(G.round).toBe(round);
      expect(advanceEchoClock(G, G.deadline!)).toBe(true);
    }
    expect(G).toMatchObject({ round: roundLimit, status: 'finished', result: 'round-limit', deadline: null });
    expect(G.history).toHaveLength(roundLimit);
    expect(advanceEchoClock(G, Date.now())).toBe(false);
  });
  it('keeps drafts and edits private, handles a live deadline, and replays only revealed words after restart', async () => {
    const now = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    const f = await fixture(), g = await f.room(['甲', '乙', '丙'], [alpha, bravo, charlie]);
    const configured = await g.options({ seconds: 0, allowChanges: true, allowRepeats: false, roundLimit: 8 });
    expect(configured.status).toBe(200);
    expect(configured.body.gameOptions.roundLimit).toBe(ECHO_ROUND_LIMIT);
    await g.start();
    const [a, b, c] = await g.connect();
    const first = await g.state(), phase = first.G.phaseEpoch;
    expect(first.G.deadline).toBeNull();
    expect(first.G.options.roundLimit).toBe(ECHO_ROUND_LIMIT);
    expect((await g.options({ ...first.G.options, allowRepeats: true })).status).toBe(400);
    expect((await g.options({ ...first.G.options, seconds: 120 })).status).toBe(200);
    expect((await g.state()).G.deadline).toBeGreaterThan(Date.now() + 115000);
    expect((await g.options({ ...first.G.options, seconds: 0 })).status).toBe(200);
    expect((await g.state()).G).toMatchObject({ deadline: null, phaseEpoch: phase });
    expect((await g.options({ ...first.G.options, seconds: 15 }, b.seat)).status).toBe(403);
    const untimed = await g.state();
    a.move('sealWord', ['舊詞', phase], untimed._stateID);
    expect((await a.sync()).state.G.private[a.seat.playerID].word).toBe('舊詞');
    a.move('sealWord', ['雨夜', phase], first._stateID);
    b.move('saveDraft', ['燈火', phase], first._stateID);
    c.move('saveDraft', ['已清除的詞', phase], first._stateID);
    expect((await c.sync()).state.G.private[c.seat.playerID].draft).toBe('已清除的詞');
    c.move('saveDraft', ['', phase], first._stateID);
    await vi.waitFor(async () => expect((await g.state()).G.private).toMatchObject({
      [a.seat.playerID]: { word: '雨夜' }, [b.seat.playerID]: { draft: '燈火' },
    }), pause);
    expect((await c.sync()).state.G.private).toEqual({ [c.seat.playerID]: { draft: '' } });
    const view = (await f.request(g.base + '/view?perspective=god', undefined, g.watcher)).body;
    expect(view.G.private).toEqual({});
    expect(JSON.stringify(view)).not.toMatch(/雨夜|燈火|echoBrowserHashes|echoRankedSeats/);
    const finalReplayPath = g.base + '/replay?matchID=' + g.matchID + '&final=1';
    expect((await f.request(finalReplayPath, undefined, g.watcher)).status).toBe(409);
    const before = await g.state();
    expect((await g.options({ ...before.G.options, seconds: 15, allowChanges: false })).status).toBe(200);
    const timed = await g.state();
    expect(timed.G.deadline).toBeGreaterThan(Date.now() + 12000);
    a.move('sealWord', ['不能覆寫', phase], timed._stateID);
    expect((await a.sync()).state.G.private[a.seat.playerID].word).toBe('雨夜');
    expect((await g.state()).G.deadline).toBe(timed.G.deadline);
    await f.restart();
    const fresh = await g.connect();
    expect(fresh[1].view.state.G.private[b.seat.playerID].draft).toBe('燈火');
    expect(fresh[0].view.state.G.deadline).toBe(timed.G.deadline);
    offset = 16000;
    await vi.waitFor(async () => expect((await g.state()).G.round).toBe(2), pause);
    const second = await g.state();
    expect(second.G).toMatchObject({ status: 'writing', clues: ['雨夜', '燈火'], private: {}, history: [
      { number: 1, words: { [a.seat.playerID]: '雨夜', [b.seat.playerID]: '燈火' }, timedOut: true },
    ] });
    expect(second.G.history[0].words).not.toHaveProperty(c.seat.playerID);
    fresh[0].move('sealWord', ['　燈火　', second.G.phaseEpoch], second._stateID);
    expect((await fresh[0].sync()).state.G.players[a.seat.playerID].sealed).toBe(false);
    fresh[0].move('saveDraft', ['尚未送出的新詞', second.G.phaseEpoch], second._stateID);
    expect((await fresh[0].sync()).state.G.private[a.seat.playerID].draft).toBe('尚未送出的新詞');
    fresh[0].move('saveDraft', ['燈火', second.G.phaseEpoch], second._stateID);
    expect((await fresh[0].sync()).state.G.private[a.seat.playerID].draft).toBe('');
    for (const player of fresh) player.move('sealWord', ['街燈', second.G.phaseEpoch], second._stateID);
    await vi.waitFor(async () => expect((await g.state()).G.result).toBe('same-word'), pause);
    const replay = (await f.request(g.base + '/replay?matchID=' + g.matchID + '&perspective=god', undefined, g.watcher)).body;
    expect(replay.complete).toBe(true);
    expect(replay.frames.every((frame: { G: EchoState }) => Object.keys(frame.G.private).length === 0)).toBe(true);
    expect(JSON.stringify(replay)).not.toMatch(/舊詞|已清除的詞|不能覆寫|尚未送出的新詞|echoBrowserHashes|echoRankedSeats/);
    expect(replay.frames.at(-1).G.history).toHaveLength(2);
    expect((await f.request(finalReplayPath)).status).toBe(401);
    const summary = await f.request(finalReplayPath, undefined, g.watcher);
    expect(summary.status).toBe(200);
    expect(summary.body).toEqual({ room: replay.room, G: replay.frames.at(-1).G });
    const compact = (await f.request(g.base + '/replay?matchID=' + g.matchID + '&compact=1', undefined, g.watcher)).body;
    expect(compact.echoHistory).toEqual(summary.body.G.history);
    expect(compact.frames.every((frame: { G: object }) => !Object.hasOwn(frame.G, 'history'))).toBe(true);
    expect(compact.frames.map(({ echoHistoryLength, G, ...frame }: { echoHistoryLength: number; G: object; stateID: number; at: number }) =>
      ({ ...frame, G: { ...G, history: compact.echoHistory.slice(0, echoHistoryLength) } }))).toEqual(replay.frames);
  }, 30000);

  it('expires a partial meaning vote at the next reveal and settles the last round automatically', async () => {
    const now = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    const f = await fixture(), g = await f.room(['甲', '乙'], [alpha, bravo]);
    expect((await g.options({ seconds: 0, roundLimit: 5 })).status).toBe(200);
    await g.start();
    const [a, b] = await g.connect();
    let previousPhase = 0;
    for (let round = 1; round <= 5; round++) {
      const state = await g.state();
      expect(state.G).toMatchObject({ status: 'writing', round });
      const phase = state.G.phaseEpoch;
      if (round === 2) {
        a.move('reviewWords', [true, phase], state._stateID);
        expect((await a.sync()).state.G.players[a.seat.playerID].reviewed).toBe(true);
      }
      if (round === 3) {
        b.move('reviewWords', [true, previousPhase], state._stateID);
        expect((await b.sync()).state.G.players[b.seat.playerID].reviewed).toBe(false);
        expect((await g.state()).G.players[a.seat.playerID].reviewed).toBe(false);
      }
      for (const [player, name] of [[a, '甲'], [b, '乙']] as const) player.move('sealWord', [name + round, phase], state._stateID);
      await vi.waitFor(async () => expect((await g.state()).G.history).toHaveLength(round), pause);
      previousPhase = phase;
    }
    const last = await g.state();
    expect(last.G).toMatchObject({ status: 'review', round: 5, result: null });
    a.move('reviewWords', [true, last.G.phaseEpoch], last._stateID);
    expect((await a.sync()).state.G.players[a.seat.playerID].reviewed).toBe(true);
    offset = 31000;
    await vi.waitFor(async () => expect((await g.state()).G).toMatchObject({ status: 'finished', round: 5, result: 'round-limit' }), pause);
  }, 30000);

  it('counts one success per anonymous browser across rooms, handles aliases and excludes test rooms', async () => {
    const f = await fixture();
    async function finish(names: string[], tokens: string[], synonyms = false, test = false) {
      const g = await f.room(names, tokens, test);
      await g.start();
      const clients = await g.connect(), start = await g.state();
      for (const [index, player] of clients.entries()) player.move('sealWord', [
        synonyms ? ['鳳梨', '菠蘿'][index] : ['Moon', 'ＭＯＯＮ', 'moon'][index], start.G.phaseEpoch,
      ], start._stateID);
      if (synonyms) {
        await vi.waitFor(async () => expect((await g.state()).G).toMatchObject({
          status: 'writing', round: 2, clues: ['鳳梨', '菠蘿'], history: [{ number: 1 }],
        }), pause);
        const review = await g.state();
        const [first, second] = clients;
        first.move('reviewWords', [true, start.G.phaseEpoch], review._stateID);
        expect((await first.sync()).state.G.players[first.seat.playerID].reviewed).toBe(false);
        first.move('reviewWords', [true, review.G.phaseEpoch], review._stateID);
        first.move('sealWord', ['秘密下一輪', review.G.phaseEpoch], review._stateID);
        expect((await first.sync()).state.G.private[first.seat.playerID]).toMatchObject({ agrees: true, word: '秘密下一輪' });
        expect((await second.sync()).state.G.private).toEqual({});
        second.move('reviewWords', [true, review.G.phaseEpoch], review._stateID);
        await vi.waitFor(async () => expect((await g.state()).G).toMatchObject({
          result: 'same-meaning', round: 1, private: {}, history: [{ number: 1 }],
        }), pause);
      }
      await vi.waitFor(async () => expect((await g.state()).G.result).toBe(synonyms ? 'same-meaning' : 'same-word'), pause);
    }
    await finish(['同名', '同名'], [alpha, bravo], true);
    await finish(['新暱稱', '別席', '第三人'], [alpha, alpha, charlie]);
    await finish(['測試房', '測試房客'], [alpha, bravo], false, true);
    const read = async () => (await f.stats()).byGame.find(game => 'echo' in game && game.gameId === 'cup-echo');
    const summary = await read();
    expect(summary).toMatchObject({ completed: 2, echo: {
      groups: [{ numPlayers: 2, completed: 1, matched: 1, averageRounds: 1 }, { numPlayers: 3, completed: 1, matched: 1, averageRounds: 1 }],
    } });
    if (!summary || !('echo' in summary)) throw new Error('Missing Cup Echo statistics');
    expect(summary.echo.leaders).toHaveLength(3);
    expect(summary.echo.leaders[0]).toEqual({ name: '新暱稱', matches: 2 });
    expect(summary.echo.leaders.slice(1)).toEqual(expect.arrayContaining([{ name: '同名', matches: 1 }, { name: '第三人', matches: 1 }]));
    expect(JSON.stringify(summary)).not.toMatch(/browserHash|credentials|別席|測試房/);
    await f.restart();
    expect(await read()).toEqual(summary);
  }, 30000);
});
