import { ROOM_CAPACITY } from '../games/catalog';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { createApplication, type AppConfig } from './app';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); });

async function fixture(overrides: Partial<AppConfig> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'boardgame-api-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('boardgame-api-test-')) throw new Error('Unexpected test directory');
    await rm(dataDir, { recursive: true, force: true });
  });
  const config: AppConfig = { dataDir, publicOrigin: 'http://localhost:5173', host: '127.0.0.1', port: 0, production: false, createRoomKey: '', ...overrides };
  const app = await createApplication(config);
  const running = await app.listen();
  cleanups.push(() => running.close());
  const request = async (path: string, body?: unknown, headers: Record<string, string> = {}, method?: string) => {
    const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const create = async () => (await request('/api/rooms', { gameId: 'space-station', displayName: '站長' })).body;
  return { app, config, running, request, create };
}
const seatHeaders = (seat: any) => ({ Authorization: `Bearer ${seat.credentials}`, 'X-Player-ID': seat.playerID });
const inviteToken = (seat: any) => new URLSearchParams(new URL(seat.inviteUrl).hash.slice(1)).get('invite');

describe('Private room admission API', () => {
  it('allows locally generated PNG previews under production CSP without external scripts', async () => {
    const f = await fixture({ production: true, publicOrigin: 'https://station.example', createRoomKey: 'test-only-production-key' });
    const response = await f.request('/api/health');
    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain('unsafe-inline');
  });
  it('keeps raw Lobby APIs and private files inaccessible, and validates input', async () => {
    const f = await fixture();
    expect((await f.request('/games')).status).toBe(404);
    expect((await f.request('/games/space-station/create', { numPlayers: 4 })).status).toBe(404);
    expect((await f.request('/.env')).status).toBe(404);
    expect((await f.request('/api/rooms', { gameId: 'space-station', numPlayers: 9, displayName: 'A' })).status).toBe(400);
    expect((await f.request('/api/rooms', { gameId: 'space-station', numPlayers: 4, displayName: '\u0000bad' })).status).toBe(400);
    const games = await f.request('/api/games');
    expect(games.body.games[0]).toEqual({ id: 'space-station', name: '太空維修站', description: expect.any(String), minPlayers: 4, maxPlayers: 8 });
  });
  it('exchanges an invite for an independent seat and never returns other credentials', async () => {
    const f = await fixture(); const host = await f.create();
    expect(new URL(host.inviteUrl).search).toBe('');
    expect(host.inviteUrl).not.toContain(host.credentials);
    expect((await f.request(`/api/rooms/${host.roomId}`)).status).toBe(401);
    const joined = await f.request(`/api/rooms/${host.roomId}/join`, { inviteToken: inviteToken(host), displayName: '朋友' });
    expect(joined.status).toBe(200);
    expect(joined.body.playerID).toBe('1');
    expect(joined.body.credentials).not.toBe(host.credentials);
    expect(JSON.stringify(joined.body)).not.toContain(host.credentials);
    expect(joined.body.inviteUrl).toBeUndefined();
    const info = await f.request(`/api/rooms/${host.roomId}`, undefined, seatHeaders(host));
    expect(info.headers.get('cache-control')).toBe('no-store');
    expect(info.headers.get('referrer-policy')).toBe('no-referrer');
    expect(JSON.stringify(info.body)).not.toMatch(/credentials|inviteHash|inviteToken/);
    expect((await f.request(`/api/rooms/${host.roomId}`, undefined, { ...seatHeaders(host), 'X-Player-ID': '1' })).status).toBe(401);
  });
  it('only the host can rotate invitations and rotation invalidates the old link', async () => {
    const f = await fixture(); const host = await f.create();
    const guest = (await f.request(`/api/rooms/${host.roomId}/join`, { inviteToken: inviteToken(host), displayName: '客人' })).body;
    expect((await f.request(`/api/rooms/${host.roomId}/invite`, {}, seatHeaders(guest))).status).toBe(403);
    const rotated = await f.request(`/api/rooms/${host.roomId}/invite`, {}, seatHeaders(host));
    expect(rotated.status).toBe(200);
    expect((await f.request(`/api/rooms/${host.roomId}/join`, { inviteToken: inviteToken(host), displayName: '舊連結' })).status).toBe(403);
    expect((await f.request(`/api/rooms/${host.roomId}/join`, { inviteToken: inviteToken(rotated.body), displayName: '新連結' })).status).toBe(200);
    expect((await f.request(`/api/rooms/${host.roomId}`, undefined, seatHeaders(guest))).status).toBe(200);
  });
  it('rejects expired invites and admission after a game starts', async () => {
    const f = await fixture(); const host = await f.create();
    const room = f.app.rooms.rooms.get(host.roomId)!;
    await f.app.rooms.save({ ...room, inviteExpiresAt: Date.now() - 1 });
    expect((await f.request(`/api/rooms/${host.roomId}/join`, { inviteToken: inviteToken(host), displayName: '過期' })).status).toBe(403);
    const rotated = await f.request(`/api/rooms/${host.roomId}/invite`, {}, seatHeaders(host));
    const { state } = await f.app.db.fetch(host.roomId, { state: true });
    state.G.status = 'briefing';
    state._stateID += 1;
    await f.app.db.setState(host.roomId, state);
    expect((await f.request(`/api/rooms/${host.roomId}/join`, { inviteToken: inviteToken(rotated.body), displayName: '太晚' })).status).toBe(409);
  });
  it('serializes concurrent joins without assigning the same seat twice', async () => {
    const f = await fixture(); const host = await f.create();
    const joined = await Promise.all(Array.from({ length: ROOM_CAPACITY }, (_, i) => f.request(`/api/rooms/${host.roomId}/join`, { inviteToken: inviteToken(host), displayName: `朋友${i}` })));
    const successful = joined.filter((r) => r.status === 200);
    expect(successful).toHaveLength(ROOM_CAPACITY - 1);
    expect(new Set(successful.map((r) => r.body.playerID)).size).toBe(ROOM_CAPACITY - 1);
    expect(joined.filter((r) => r.status === 409)).toHaveLength(1);
  });
  it('safely retries a lost admission response without consuming another seat', async () => {
    const f = await fixture(); const host = await f.create();
    const body = { inviteToken: inviteToken(host), displayName: '可重試的朋友', requestID: randomUUID() };
    const responses = await Promise.all(Array.from({ length: 3 }, () => f.request(`/api/rooms/${host.roomId}/join`, body)));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(responses.map((r) => r.body.credentials)).size).toBe(1);
    expect(responses[0].body.playerID).toBe('1');
    await f.request(`/api/rooms/${host.roomId}/invite`, {}, seatHeaders(host));
    const retry = await f.request(`/api/rooms/${host.roomId}/join`, body);
    expect(retry.body.credentials).toBe(responses[0].body.credentials);
    const other = await f.request(`/api/rooms/${host.roomId}/join`, { ...body, requestID: randomUUID() });
    expect(other.status).toBe(403);
  });
  it('refuses to place stored secrets inside the public frontend directory', async () => {
    const f = await fixture();
    await expect(createApplication({ ...f.config, clientDir: f.config.dataDir })).rejects.toThrow('DATA_DIR');
    await expect(createApplication({ ...f.config, clientDir: f.config.dataDir, dataDir: join(f.config.dataDir, '..secrets') })).rejects.toThrow('DATA_DIR');
  });
  it('rejects foreign browser origins and enforces a configured create key', async () => {
    const f = await fixture();
    expect((await f.request('/api/rooms', {}, { Origin: 'https://untrusted.example' })).status).toBe(403);
    f.config.createRoomKey = 'a-private-create-key';
    const input = { gameId: 'space-station', displayName: '站長' };
    expect((await f.request('/api/rooms', input)).status).toBe(403);
    expect((await f.request('/api/rooms', { ...input, createKey: f.config.createRoomKey })).status).toBe(201);
  });
  it('restores room invitations and seat credentials after server restart', async () => {
    const f = await fixture(); const host = await f.create();
    await f.running.close();
    const restored = await createApplication(f.config);
    const second = await restored.listen();
    cleanups.push(() => second.close());
    const response = await fetch(`http://127.0.0.1:${second.port}/api/rooms/${host.roomId}`, { headers: seatHeaders(host) });
    expect(response.status).toBe(200);
    const joinResponse = await fetch(`http://127.0.0.1:${second.port}/api/rooms/${host.roomId}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteToken: inviteToken(host), displayName: '重啟後加入' }) });
    expect(joinResponse.status).toBe(200);
  });
});
