import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createApplication } from './app';
import { createPreviewPage } from './link-preview';

const publicOrigin = 'https://boardgame.example.com';
const iconPath = '/assets/site-icon-test-fingerprint.png';
const createKey = 'test-only-preview-room-key';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'boardgame-preview-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('boardgame-preview-test-')) throw new Error('Unexpected test directory');
    await rm(root, { recursive: true, force: true });
  });
  const clientDir = join(root, 'client');
  await mkdir(join(clientDir, 'assets'), { recursive: true });
  const original = await readFile(resolve('index.html'), 'utf8');
  const template = original.replace('/src/client/assets/site-icon.png', iconPath);
  const icon = await readFile(resolve('src/client/assets/site-icon.png'));
  await writeFile(join(clientDir, 'index.html'), template);
  await writeFile(join(clientDir, iconPath.slice(1)), icon);
  const app = await createApplication({
    dataDir: join(root, 'data'), clientDir, publicOrigin,
    host: '127.0.0.1', port: 0, production: true, createRoomKey: createKey,
  });
  const running = await app.listen();
  cleanups.push(() => running.close());
  const request = (path: string, options?: RequestInit) => fetch(`http://127.0.0.1:${running.port}${path}`, options);
  return { app, request, icon };
}

function metadata(html: string, name: string) {
  return [...html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/?\s*>/g)]
    .filter(match => match[1] === name).map(match => match[2]);
}

describe('Public link previews', () => {
  it('provides branded HTML on every page route without JavaScript or authentication', async () => {
    const f = await fixture();
    for (const path of ['/', '/index.html', '/join/unknown-room', '/room/unknown-room', '/replay/unknown-room']) {
      const response = await f.request(path, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      const html = await response.text();
      expect(html).toContain('<title>捷寶桌遊室</title>');
      expect(metadata(html, 'og:title')).toEqual(['捷寶桌遊室']);
      expect(metadata(html, 'og:site_name')).toEqual(['捷寶桌遊室']);
      expect(metadata(html, 'og:type')).toEqual(['website']);
      expect(metadata(html, 'og:locale')).toEqual(['zh_TW']);
      expect(metadata(html, 'og:image')).toEqual([publicOrigin + iconPath]);
      expect(metadata(html, 'og:image:type')).toEqual(['image/png']);
      expect(metadata(html, 'og:image:width')).toEqual(['1024']);
      expect(metadata(html, 'og:image:height')).toEqual(['1024']);
      expect(metadata(html, 'og:image:alt')).toEqual(['捷寶桌遊室 JB 圖示']);
      expect(metadata(html, 'og:url')).toEqual([publicOrigin + (path === '/index.html' ? '/' : path)]);
      expect(metadata(html, 'twitter:title')).toEqual(['捷寶桌遊室']);
      expect(metadata(html, 'twitter:image')).toEqual([publicOrigin + iconPath]);
      expect(metadata(html, 'twitter:card')).toEqual(['summary']);
      expect(html.indexOf('property="og:title"')).toBeLessThan(html.indexOf('</head>'));
    }
    const image = await f.request(iconPath, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toContain('image/png');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(f.icon);
    expect(f.app.rooms.rooms.size).toBe(0);
  });

  it('uses only the configured public origin and excludes query inputs from metadata', async () => {
    const f = await fixture();
    const response = await f.request('/join/unknown-room?invite=do-not-reflect&name=%22%3E%3Cscript%3Eunsafe', {
      headers: {
        Host: 'attacker.example', 'X-Forwarded-Host': 'forwarded.example',
        'X-Forwarded-Proto': 'http', 'User-Agent': 'Line/1.0',
      },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(metadata(html, 'og:url')).toEqual([`${publicOrigin}/join/unknown-room`]);
    expect(metadata(html, 'og:image')).toEqual([publicOrigin + iconPath]);
    expect(html).not.toMatch(/attacker\.example|forwarded\.example|do-not-reflect|unsafe|invite=/);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
  });

  it('supports crawler HEAD requests and does not route arbitrary or POST paths to the app shell', async () => {
    const f = await fixture();
    const response = await f.request('/join/unknown-room', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0);
    expect(await response.text()).toBe('');
    expect((await f.request('/join/unknown-room/private')).status).toBe(404);
    expect((await f.request('/join/unknown-room', { method: 'POST' })).status).toBe(404);
    expect((await f.request('/.env')).status).toBe(404);
  });

  it('never exposes room members or credentials, grants a seat, or bypasses room authorization', async () => {
    const f = await fixture();
    const created = await f.request('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'space-station', displayName: '不可曝光的房主', createKey }),
    });
    expect(created.status).toBe(201);
    const host = await created.json();
    const invite = new URLSearchParams(new URL(host.inviteUrl).hash.slice(1)).get('invite')!;
    const before = await f.app.db.fetch(host.matchID, { metadata: true, state: true });
    const roomBefore = JSON.stringify(f.app.rooms.rooms.get(host.roomId));
    for (const prefix of ['join', 'room', 'replay']) {
      const response = await f.request(`/${prefix}/${host.roomId}#invite=${invite}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(metadata(html, 'og:title')).toEqual(['捷寶桌遊室']);
      for (const privateValue of ['不可曝光的房主', invite, host.credentials, createKey]) expect(html).not.toContain(privateValue);
      expect(html).not.toMatch(/inviteHash|credentialHash|spectators|hostPlayerID/);
    }
    expect(await f.app.db.fetch(host.matchID, { metadata: true, state: true })).toEqual(before);
    expect(JSON.stringify(f.app.rooms.rooms.get(host.roomId))).toBe(roomBefore);
    expect((await f.request(`/api/rooms/${host.roomId}`)).status).toBe(401);
    expect((await f.request(`/api/replays/${host.roomId}`)).status).toBe(403);
    expect((await f.request(`/api/rooms/${host.roomId}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: '未持有邀請的訪客' }),
    })).status).toBe(403);
  });

  it('can render the source page and requires the same-origin favicon contract', async () => {
    const original = await readFile(resolve('index.html'), 'utf8');
    const html = createPreviewPage(original, publicOrigin)('/join/example?discard=this#invite=private');
    expect(metadata(html, 'og:image')).toEqual([`${publicOrigin}/src/client/assets/site-icon.png`]);
    expect(metadata(html, 'og:url')).toEqual([`${publicOrigin}/join/example`]);
    expect(html).not.toMatch(/discard=this|invite=private/);
    expect(() => createPreviewPage('<head></head>', publicOrigin)).toThrow('local favicon');
    expect(() => createPreviewPage('<head><link rel="icon" href="//other.example/icon.png"></head>', publicOrigin)).toThrow('local favicon');
    expect(() => createPreviewPage('<head><link rel="icon" href="https://other.example/icon.png"></head>', publicOrigin)).toThrow('local favicon');
  });
});
