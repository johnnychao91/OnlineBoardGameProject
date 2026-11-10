import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { State, SyncInfo } from 'boardgame.io';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EchoState } from '../games/echo/game';
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
  it('keeps drafts and edits private, handles a live deadline, and replays only revealed words after restart', async () => {
    const now = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    const f = await fixture(), g = await f.room(['甲', '乙', '丙'], [alpha, bravo, charlie]);
    expect((await g.options({ seconds: 0, allowChanges: true, roundLimit: 5 })).status).toBe(200);
    await g.start();
    const [a, b, c] = await g.connect();
    const first = await g.state(), phase = first.G.phaseEpoch;
    expect(first.G.deadline).toBeNull();
    expect((await g.options({ ...first.G.options, seconds: 12 }, b.seat)).status).toBe(403);
    a.move('sealWord', ['舊詞', phase], first._stateID);
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
    const before = await g.state();
    expect((await g.options({ ...before.G.options, seconds: 12, allowChanges: false })).status).toBe(200);
    const timed = await g.state();
    expect(timed.G.deadline).toBeGreaterThan(Date.now() + 11000);
    a.move('sealWord', ['不能覆寫', phase], timed._stateID);
    expect((await a.sync()).state.G.private[a.seat.playerID].word).toBe('雨夜');
    expect((await g.state()).G.deadline).toBe(timed.G.deadline);
    await f.restart();
    const fresh = await g.connect();
    expect(fresh[1].view.state.G.private[b.seat.playerID].draft).toBe('燈火');
    expect(fresh[0].view.state.G.deadline).toBe(timed.G.deadline);
    offset = 13000;
    await vi.waitFor(async () => expect((await g.state()).G.round).toBe(2), pause);
    const second = await g.state();
    expect(second.G).toMatchObject({ status: 'writing', clues: ['雨夜', '燈火'], private: {}, history: [
      { number: 1, words: { [a.seat.playerID]: '雨夜', [b.seat.playerID]: '燈火' }, timedOut: true },
    ] });
    expect(second.G.history[0].words).not.toHaveProperty(c.seat.playerID);
    for (const player of fresh) player.move('sealWord', ['街燈', second.G.phaseEpoch], second._stateID);
    await vi.waitFor(async () => expect((await g.state()).G.result).toBe('same-word'), pause);
    const replay = (await f.request(g.base + '/replay?matchID=' + g.matchID + '&perspective=god', undefined, g.watcher)).body;
    expect(replay.complete).toBe(true);
    expect(replay.frames.every((frame: { G: EchoState }) => Object.keys(frame.G.private).length === 0)).toBe(true);
    expect(JSON.stringify(replay)).not.toMatch(/舊詞|已清除的詞|不能覆寫|echoBrowserHashes|echoRankedSeats/);
    expect(replay.frames.at(-1).G.history).toHaveLength(2);
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
        await vi.waitFor(async () => expect((await g.state()).G.status).toBe('review'), pause);
        const review = await g.state();
        for (const player of clients) player.move('reviewWords', [true, review.G.phaseEpoch], review._stateID);
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
