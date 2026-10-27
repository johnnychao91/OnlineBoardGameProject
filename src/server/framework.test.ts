import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApplication } from './app';
import { GAME_IDS, ROOM_CAPACITY, gameCatalog } from '../games/catalog';
import { gameDefinitions } from '../games/registry';
import { DEFAULT_FOG_OPTIONS } from '../games/fog/rules';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const token = (host: any) => new URLSearchParams(new URL(host.inviteUrl).hash.slice(1)).get('invite');
const path = (host: any, action = '') => `/api/rooms/${host.roomId}${action ? `/${action}` : ''}`;
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-framework-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-framework-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config = { dataDir, publicOrigin: 'http://localhost:5173', host: '127.0.0.1', port: 0,
    production: false, createRoomKey: '', lifecycleSweepMs: 60000 };
  let app = await createApplication(config), running = await app.listen();
  cleanups.push(() => running.close());
  const request = async (url: string, body?: unknown, member?: any) => {
    const response = await fetch(`http://127.0.0.1:${running.port}${url}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
        ...(member ? { Authorization: `Bearer ${member.credentials}`, ...(member.access === 'spectator'
          ? { 'X-Observer-ID': member.observerID } : { 'X-Player-ID': member.playerID }) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  return { request, get app() { return app; }, async restart() { await running.close(); app = await createApplication(config); running = await app.listen(); },
    async group(gameId: string, count: number) {
      const response = await request('/api/rooms', { gameId, displayName: '房主' });
      expect(response.status).toBe(201);
      const host = response.body, seats = [host];
      for (let i = 1; i < count; i++) {
        const joined = await request(path(host, 'join'), { inviteToken: token(host), displayName: `玩家 ${i}` });
        expect(joined.status).toBe(200); seats.push(joined.body);
      }
      return { host, seats };
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function start(f: Fixture, host: any, seats: any[]) {
  for (const seat of seats) expect((await f.request(path(host, 'ready'), { ready: true }, seat)).status).toBe(200);
  return f.request(path(host, 'start'), {}, host);
}

describe('Game framework registration and shared room lifecycle', () => {
  it('registers every catalog game exactly once with its player limits', () => {
    expect(GAME_IDS).toEqual(['space-station', 'encrypted-call', 'black-fog', 'silver-moon', 'turing-test',
      'midnight-post', 'baker-street', 'hundred-ghosts', 'curtain-heist', 'firewall-breach', 'star-workshop']);
    expect(gameDefinitions.map(game => game.id)).toEqual(GAME_IDS);
    for (const game of gameDefinitions) {
      expect(game).toMatchObject({ name: gameCatalog[game.id].name, minPlayers: gameCatalog[game.id].minPlayers, maxPlayers: gameCatalog[game.id].maxPlayers });
      expect(game.game.name).toBe(game.id);
    }
    expect(ROOM_CAPACITY).toBe(Math.max(...gameDefinitions.map(game => game.maxPlayers)));
  });

  it.each(GAME_IDS)('%s inherits observation, host role switching, abort, invite and restart persistence', async gameID => {
    const f = await fixture(), { host, seats } = await f.group(gameID, gameCatalog[gameID].minPlayers + 1);
    const switched = await f.request(path(host, 'switch-role'), { matchID: host.matchID, access: 'spectator', requestID: randomUUID() }, host);
    expect(switched.status).toBe(200);
    const observerHost = switched.body;
    expect(observerHost.hostObserverID).toBe(observerHost.observerID);
    expect((await start(f, observerHost, seats.slice(1))).status).toBe(200);
    const blind = await f.request(path(host, 'view?perspective=blind'), undefined, observerHost);
    const god = await f.request(path(host, 'view?perspective=god'), undefined, observerHost);
    expect(blind.status).toBe(200); expect(god.status).toBe(200);
    expect(Object.keys(blind.body.G.private ?? {})).toHaveLength(0);
    expect(Object.keys(god.body.G.private)).toHaveLength(gameCatalog[gameID].minPlayers);
    expect(blind.body.G.secret).toBeUndefined();
    // Station's god view intentionally includes current equipment positions;
    // other games keep future draws and resolving effects server-only.
    if (gameID !== 'space-station') expect(god.body.G.secret).toBeUndefined();
    expect(blind.body.G.secretQuestionQueue).toBeUndefined();
    expect(god.body.G.secretQuestionQueue).toBeUndefined();
    expect(blind.body.G.secretDrawIDs).toBeUndefined();
    expect(god.body.G.secretDrawIDs).toBeUndefined();
    expect((await f.request(path(host, 'abort'), { matchID: observerHost.matchID }, seats[1])).status).toBe(403);
    const aborted = await f.request(path(host, 'abort'), { matchID: observerHost.matchID }, observerHost);
    expect(aborted.status).toBe(200);
    const lobby = (await f.request(path(host), undefined, observerHost)).body;
    expect(lobby.status).toBe('lobby'); expect(lobby.matchID).not.toBe(observerHost.matchID);
    expect(lobby.players.every((p: any) => !p.ready)).toBe(true);
    expect(lobby.history).toEqual([expect.objectContaining({ gameName: gameID, ending: 'host-ended' })]);
    await f.restart();
    expect((await f.request(path(host), undefined, observerHost)).body.matchID).toBe(lobby.matchID);
    expect((await f.request(path(host, 'join'), { inviteToken: token(host), displayName: '回來的朋友' })).status).toBe(200);
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  });

  it('validates and persists both bell options, resets readiness and guards host / stale settings', async () => {
    const f = await fixture(), { host, seats } = await f.group('black-fog', 5);
    const other = await f.group('encrypted-call', 2);
    await f.request(path(host, 'ready'), { ready: true }, seats[1]);
    const body = { matchID: host.matchID, options: { ...DEFAULT_FOG_OPTIONS, lancelotMode: 'forecast', percival: true } };
    expect((await f.request(path(host, 'options'), body, seats[1])).status).toBe(403);
    expect((await f.request(path(host, 'options'), body, other.host)).status).toBe(401);
    expect((await f.request(path(host, 'options'), { ...body, options: { lancelotMode: 'invalid' } }, host)).status).toBe(400);
    expect((await f.request(path(host, 'options'), { ...body, options: { secret: 'never-store' } }, host)).status).toBe(400);
    expect((await f.request(path(host, 'options'), { ...body, options: { ...DEFAULT_FOG_OPTIONS, morgana: true } }, host)).status).toBe(400);
    const changed = await f.request(path(host, 'options'), body, host);
    expect(changed.status).toBe(200);
    expect(changed.body.gameOptions).toEqual(body.options);
    expect(changed.body.matchID).not.toBe(host.matchID);
    expect(changed.body.players).toHaveLength(5);
    expect(changed.body.players.every((p: any) => !p.ready)).toBe(true);
    expect((await f.request(path(host, 'options'), body, host)).status).toBe(409);
    expect((await f.request(path(other.host), undefined, other.host)).body.matchID).toBe(other.host.matchID);
    await f.restart();
    expect((await f.request(path(host), undefined, host)).body.gameOptions).toEqual(body.options);
    expect((await start(f, host, seats)).status).toBe(200);
    const raw = await f.app.db.fetch(changed.body.matchID, { state: true });
    expect(raw.state!.G.options).toEqual(body.options);
    expect(raw.state!.G.bellForecast).toHaveLength(5);
    expect((await f.request(path(host, 'options'), { ...body, matchID: changed.body.matchID }, host)).status).toBe(409);
  });

  it.each(GAME_IDS)('%s inherits one-time removal / rejoin and automatic termination after everyone leaves', async gameID => {
    const f = await fixture(), { host, seats } = await f.group(gameID, gameCatalog[gameID].minPlayers);
    const info = (await f.request(path(host), undefined, host)).body;
    const target = info.players.find((player: any) => player.id === seats[1].playerID);
    expect((await f.request(path(host, 'remove'), { matchID: info.matchID, playerID: target.id, membershipID: target.membershipID }, host)).status).toBe(200);
    expect((await f.request(path(host), undefined, seats[1])).status).toBe(401);
    const rejoined = await f.request(path(host, 'join'), { inviteToken: token(host), displayName: '重新加入' });
    expect(rejoined.status).toBe(200); expect(rejoined.body.credentials).not.toBe(seats[1].credentials);
    seats[1] = rejoined.body;
    expect((await start(f, host, seats)).status).toBe(200);
    for (const seat of seats) expect((await f.request(path(host, 'leave'), {}, seat)).status).toBe(200);
    const room = f.app.rooms.rooms.get(host.roomId)!;
    expect(room.history?.at(-1)).toMatchObject({ ending: 'empty', gameName: gameID });
    expect(room.currentMatchID).not.toBe(info.matchID);
    expect((await f.request('/api/stats')).body.completedGames).toBe(0);
  });

  it('supports full capacity and preserves high seat IDs when switching to older games', async () => {
    const f = await fixture(), { host, seats } = await f.group('silver-moon', ROOM_CAPACITY);
    expect((await f.request(path(host, 'join'), { inviteToken: token(host), displayName: '滿席' })).status).toBe(409);
    expect((await start(f, host, seats)).body.numPlayers).toBe(ROOM_CAPACITY);
    await f.request(path(host, 'abort'), { matchID: host.matchID }, host);
    // Keep the host and final three seats, including two-digit IDs.
    for (const seat of seats.slice(1, -3)) expect((await f.request(path(host, 'leave'), {}, seat)).status).toBe(200);
    for (const gameID of ['space-station', 'encrypted-call']) {
      const lobby = (await f.request(path(host), undefined, host)).body;
      const selected = await f.request(path(host, 'game'), { gameId: gameID, matchID: lobby.matchID }, host);
      expect(selected.status).toBe(200);
      expect((await start(f, host, [host, ...seats.slice(-3)])).status).toBe(200);
      const { state } = await f.app.db.fetch(selected.body.matchID, { state: true });
      expect(Object.keys(state!.G.players)).toEqual([host, ...seats.slice(-3)].map(seat => seat.playerID));
      expect((await f.request(path(host, 'abort'), { matchID: selected.body.matchID }, host)).status).toBe(200);
    }
  });

  it('rejects a role set too large for the actual group without dropping any selected role', async () => {
    const f = await fixture(), { host, seats } = await f.group('black-fog', 5);
    const options = { ...DEFAULT_FOG_OPTIONS, percival: true, morgana: true };
    expect((await f.request(path(host, 'options'), { matchID: host.matchID, options }, host)).status).toBe(200);
    const result = await start(f, host, seats);
    expect(result.status).toBe(409); expect(result.body.error).toContain('角色');
    expect((await f.request(path(host), undefined, host)).body.status).toBe('lobby');
  });
});
