import { GAME_IDS, ROOM_CAPACITY } from '../games/catalog';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnection } from 'node:net';
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
  const config: AppConfig = { dataDir, publicOrigin: 'http://localhost:5173', host: '127.0.0.1', port: 0, production: false, roomCode: '', ...overrides };
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

it('shuts down with a stalled HTTP upload and an unresponsive WebSocket, while preserving accepted room writes', async () => {
  const f = await fixture();
  const client = () => createConnection(f.running.port, '127.0.0.1');
  const upload = client();
  const websocket = client();
  const deadline = AbortSignal.timeout(8000);
  const disconnected = Promise.all([
    once(upload, 'close', { signal: deadline }),
    once(websocket, 'close', { signal: deadline }),
  ]);
  // Observe immediately in case setup fails before awaiting this promise.
  void disconnected.catch(() => {});
  let markAccepted!: (roomId: string) => void;
  let releaseWrite!: () => void;
  const accepted = new Promise<string>(resolve => { markAccepted = resolve; });
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
  const save = f.app.rooms.save.bind(f.app.rooms);
  const spy = vi.spyOn(f.app.rooms, 'save').mockImplementation(async room => {
    markAccepted(room.roomId);
    await writeGate;
    return save(room);
  });
  try {
    const uploadReady = once(upload, 'data', { signal: deadline });
    upload.write('POST /api/rooms HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');
    expect(String((await uploadReady)[0])).toContain('100 Continue');
    const upgraded = once(websocket, 'data', { signal: deadline });
    websocket.write('GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
    expect(String((await upgraded)[0])).toContain('101 Switching Protocols');
    // Read the close frame without sending a WebSocket close response.
    websocket.resume();
    const creating = f.create().catch(() => {});
    const roomId = await accepted;
    let closed = false;
    const closing = f.running.close().then(() => { closed = true; });
    await disconnected;
    expect(closed).toBe(false);
    releaseWrite();
    await closing;
    await creating;
    const restored = await createApplication(f.config);
    expect(restored.rooms.rooms.has(roomId)).toBe(true);
  } finally {
    releaseWrite();
    upload.destroy();
    websocket.destroy();
    spy.mockRestore();
  }
});

describe('Private room admission API', () => {
  it('publishes only an optional validated measurement ID and permits Analytics independently of advertising', async () => {
    for (const enabled of [false, true]) for (const ads of [false, true]) {
      const f = await fixture({ production: true, publicOrigin: 'https://boardgame.example.com',
        analyticsMeasurementId: enabled ? ' G-TEST123456 ' : '',
        adsense: ads ? { client: 'ca-pub-1234567890123456', slot: '12345' } : undefined,
        roomCode: 'private-room-code-test', testRoomCode: 'private-testing-code', roomVipCode: 'private-vip-code',
      });
      const response = await f.request('/api/analytics');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ measurementId: enabled ? 'G-TEST123456' : null });
      expect(response.headers.get('cache-control')).toBe('no-store');
      const csp = response.headers.get('content-security-policy')!;
      expect(csp.includes('googletagmanager.com')).toBe(enabled);
      expect(csp.includes('google-analytics.com')).toBe(enabled);
      expect(csp.includes('googlesyndication.com')).toBe(ads);
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'none'");
    }
    for (const analyticsMeasurementId of ['bad-id', ['G-', 'TEST<script>'].join(''), 'G-TEST123456;other']) {
      await expect(fixture({ analyticsMeasurementId })).rejects.toThrow('GA_MEASUREMENT_ID');
    }
  });
  it('publishes only the configured public contact, with safe email / HTTPS links and no private settings', async () => {
    for (const contact of [undefined, 'contact@example.invalid', 'https://contact.example.invalid/help']) {
      const f = await fixture({ privacyContact: contact, roomCode: 'private-room-test-value', testRoomCode: 'private-testing-value', roomVipCode: 'private-vip-value' });
      const response = await f.request('/api/site-info');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ contact: contact ? { label: contact, href: contact.includes('@') ? `mailto:${contact}` : contact } : null });
      expect(response.headers.get('cache-control')).toBe('no-cache');
    }
    for (const privacyContact of ['javascript:alert(1)', 'data:text/html,unsafe', 'http://example.invalid']) {
      await expect(fixture({ privacyContact })).rejects.toThrow('PRIVACY_CONTACT');
    }
  });
  it('allows locally generated PNG previews under production CSP without external scripts', async () => {
    const f = await fixture({ production: true, publicOrigin: 'https://station.example', roomCode: 'test-only-production-key' });
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
    const preselectedCount = await f.request('/api/rooms', { gameId: 'space-station', numPlayers: 9, displayName: 'A' });
    expect(preselectedCount).toMatchObject({ status: 400, body: { error: '不需預選人數，開局時依參與者人數決定' } });
    const invalidName = await f.request('/api/rooms', { gameId: 'space-station', displayName: '\u0000bad' });
    expect(invalidName).toMatchObject({ status: 400, body: { error: '暱稱需為 1～24 個字，不能含控制字元' } });
    const games = await f.request('/api/games');
    expect(games.status).toBe(200);
    expect(games.body.games.map((game: { id: string }) => game.id)).toEqual(GAME_IDS);
    for (const game of games.body.games) {
      expect(Object.keys(game).sort()).toEqual(['id', 'name', 'description', 'minPlayers', 'maxPlayers'].sort());
      expect(game).toMatchObject({ id: expect.any(String), name: expect.any(String), description: expect.any(String), minPlayers: expect.any(Number), maxPlayers: expect.any(Number) });
    }
    expect(games.body.games.find((game: { id: string }) => game.id === 'space-station')).toEqual({ id: 'space-station', name: '太空維修站', description: expect.any(String), minPlayers: 4, maxPlayers: 8 });
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
  it('rejects foreign origins while allowing ordinary rooms without a configured special code', async () => {
    const f = await fixture();
    expect((await f.request('/api/rooms', {}, { Origin: 'https://untrusted.example' })).status).toBe(403);
    f.config.roomCode = 'a-private-create-key';
    const input = { gameId: 'space-station', displayName: '站長' };
    const ordinary=await f.request('/api/rooms', input);
    expect(ordinary.status).toBe(201);expect(ordinary.body.testRoom).toBe(false);
    const special=await f.request('/api/rooms', { ...input, roomCode: f.config.roomCode });
    expect(special.status).toBe(201);expect(f.app.rooms.rooms.get(special.body.roomId)?.adsMode).toBe('adfree');
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
