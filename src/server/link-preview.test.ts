import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { GAME_IDS } from '../games/catalog';
import { createApplication } from './app';
import { createPreviewPage } from './link-preview';

const publicOrigin = 'https://boardgame.example.com';
const iconPath = '/endless-bar-icon.svg';
const coverPath = '/social/endless-bar-cover-v2.jpg';
const title = '未央酒肆 Endless Bar';
const description = '免下載、免註冊的多人線上桌遊。開房分享連結，就能和朋友一起推理、合作、冒險，還能即時觀戰與賽後復盤。';
const roomCode = 'test-only-preview-room-key';
const gameRulesPaths = GAME_IDS.map(id => `/rules/${id}`);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'boardgame-preview-test-'));
  cleanups.push(async () => {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('boardgame-preview-test-')) throw new Error('Unexpected test directory');
    await rm(root, { recursive: true, force: true });
  });
  const clientDir = join(root, 'client');
  await mkdir(join(clientDir, 'social'), { recursive: true });
  const template = await readFile(resolve('index.html'), 'utf8');
  const icon = await readFile(resolve('public' + iconPath));
  await writeFile(join(clientDir, 'index.html'), template);
  await writeFile(join(clientDir, 'media.html'), await readFile(resolve('media.html')));
  await writeFile(join(clientDir, iconPath.slice(1)), icon);
  const cover = await readFile(resolve('public' + coverPath));
  await writeFile(join(clientDir, coverPath.slice(1)), cover);
  const app = await createApplication({
    dataDir: join(root, 'data'), clientDir, publicOrigin,
    host: '127.0.0.1', port: 0, production: true, roomCode: roomCode,
  });
  const running = await app.listen();
  cleanups.push(() => running.close());
  const request = (path: string, options?: RequestInit) => fetch(`http://127.0.0.1:${running.port}${path}`, options);
  return { app, request, icon, cover };
}

function metadata(html: string, name: string) {
  return [...html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/?\s*>/g)]
    .filter(match => match[1] === name).map(match => match[2]);
}

function jpegDimensions(bytes: Buffer) {
  expect(bytes.subarray(0,2)).toEqual(Buffer.from([0xff,0xd8]));
  for(let offset=2;offset+8<bytes.length;){
    if(bytes[offset]!==0xff)throw new Error('Invalid JPEG segment');
    const marker=bytes[offset+1], length=bytes.readUInt16BE(offset+2);
    if([0xc0,0xc1,0xc2].includes(marker))return {width:bytes.readUInt16BE(offset+7),height:bytes.readUInt16BE(offset+5)};
    if(length<2)throw new Error('Invalid JPEG segment length');
    offset+=length+2;
  }
  throw new Error('Missing JPEG dimensions');
}

describe('Public link previews', () => {
  it('serves the standalone media gallery by direct URL without linking to it from public pages', async () => {
    const f = await fixture();
    for (const path of ['/media', '/media/', '/media/endless-bar', ...GAME_IDS.map(id => `/media/${id}`)]) {
      const response = await f.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      const html = await response.text();
      expect(html).toContain('/src/client/media.tsx');
      expect(metadata(html, 'robots')).toEqual(['noindex, nofollow']);
      expect(metadata(html, 'og:title')).toEqual([]);
    }
    const head = await f.request('/media/baker-street/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await f.request('/media/unknown')).status).toBe(404);
    expect((await f.request('/media/', { method: 'POST' })).status).toBe(404);
    for (const path of ['/', '/rules', '/rules/baker-street']) {
      const response = await f.request(path);
      expect(await response.text()).not.toContain('/media');
    }
  });

  it('provides branded HTML on every page route without JavaScript or authentication', async () => {
    const f = await fixture();
    for (const path of ['/', '/index.html', '/join/unknown-room', '/room/unknown-room', '/replay/unknown-room']) {
      const response = await f.request(path, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      const html = await response.text();
      expect(html).toContain(`<title>${title}</title>`);
      expect(metadata(html, 'og:title')).toEqual([title]);
      expect(metadata(html, 'og:site_name')).toEqual([title]);
      expect(html).toContain('rel="icon" type="image/svg+xml" href="' + iconPath + '"');
      expect(metadata(html, 'og:type')).toEqual(['website']);
      expect(metadata(html, 'og:locale')).toEqual(['zh_TW']);
      for(const key of ['description','og:description','twitter:description'])expect(metadata(html,key)).toEqual([description]);
      expect(metadata(html, 'og:image')).toEqual([publicOrigin + coverPath]);
      expect(metadata(html, 'og:image:secure_url')).toEqual([publicOrigin + coverPath]);
      expect(metadata(html, 'og:image:type')).toEqual(['image/jpeg']);
      expect(metadata(html, 'og:image:width')).toEqual(['1200']);
      expect(metadata(html, 'og:image:height')).toEqual(['630']);
      expect(metadata(html, 'og:image:alt')).toEqual(['雲海酒館夜景上的金色標題「未央酒肆 Endless Bar」，前景有牌、骰子與酒杯']);
      expect(metadata(html, 'og:url')).toEqual([publicOrigin + (path === '/index.html' ? '/' : path)]);
      expect(metadata(html, 'twitter:title')).toEqual([title]);
      expect(metadata(html, 'twitter:image')).toEqual([publicOrigin + coverPath]);
      expect(metadata(html, 'twitter:card')).toEqual(['summary_large_image']);
      expect(html.indexOf('property="og:title"')).toBeLessThan(html.indexOf('</head>'));
    }
    const image = await f.request(coverPath, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toContain('image/jpeg');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(f.cover);
    expect(jpegDimensions(f.cover)).toEqual({width:1200,height:630});
    expect(f.cover.length).toBeLessThan(512*1024);
    const imageHead=await f.request(coverPath,{method:'HEAD'});
    expect(imageHead.status).toBe(200);expect(imageHead.headers.get('content-type')).toContain('image/jpeg');
    expect(Number(imageHead.headers.get('content-length'))).toBe(f.cover.length);expect(await imageHead.text()).toBe('');
    const icon = await f.request(iconPath);
    expect(icon.status).toBe(200);expect(icon.headers.get('content-type')).toContain('image/svg+xml');expect(Buffer.from(await icon.arrayBuffer())).toEqual(f.icon);
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
    expect(metadata(html, 'og:image')).toEqual([publicOrigin + coverPath]);
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

  it('serves public detailed rules directly, including trailing slashes, without reflecting private inputs', async () => {
    const f = await fixture();
    for (const path of ['/rules', ...gameRulesPaths].flatMap(path => [path, `${path}/`])) {
      const response = await f.request(`${path}?room=private-room&invite=private-invite&credentials=private-credential`, {
        headers: { Host: 'attacker.example', 'X-Forwarded-Host': 'forwarded.example' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      const html = await response.text();
      expect(html).toContain(`<title>${title}</title>`);
      expect(metadata(html, 'og:url')).toEqual([publicOrigin + path]);
      expect(metadata(html, 'og:image')).toEqual([publicOrigin + coverPath]);
      expect(html).not.toMatch(/private-room|private-invite|private-credential|attacker\.example|forwarded\.example/);
      const head = await f.request(path, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toContain('text/html');
      expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
      expect(await head.text()).toBe('');
    }
    expect(f.app.rooms.rooms.size).toBe(0);
    expect((await f.request('/rules/unknown-game')).status).toBe(404);
    for (const path of gameRulesPaths) {
      expect((await f.request(`${path}/private-room`)).status).toBe(404);
      expect((await f.request(path, { method: 'POST' })).status).toBe(404);
    }
  });

  it('never exposes room members or credentials, grants a seat, or bypasses room authorization', async () => {
    const f = await fixture();
    const created = await f.request('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'space-station', displayName: '不可曝光的房主', roomCode }),
    });
    expect(created.status).toBe(201);
    const host = await created.json();
    const invite = new URLSearchParams(new URL(host.inviteUrl).hash.slice(1)).get('invite')!;
    const before = await f.app.db.fetch(host.matchID, { metadata: true, state: true });
    const roomBefore = JSON.stringify(f.app.rooms.rooms.get(host.roomId));
    for (const path of [`/join/${host.roomId}`, `/room/${host.roomId}`, `/replay/${host.roomId}`, '/rules', ...gameRulesPaths]) {
      const response = await f.request(`${path}#invite=${invite}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(metadata(html, 'og:title')).toEqual([title]);
      for (const privateValue of ['不可曝光的房主', invite, host.credentials, roomCode]) expect(html).not.toContain(privateValue);
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

  it('requires a dedicated local sharing cover while preserving the favicon contract', async () => {
    const original = await readFile(resolve('index.html'), 'utf8');
    const html = createPreviewPage(original, publicOrigin)('/join/example?discard=this#invite=private');
    expect(metadata(html, 'og:image')).toEqual([publicOrigin + coverPath]);
    expect(metadata(html, 'og:url')).toEqual([`${publicOrigin}/join/example`]);
    expect(html).not.toMatch(/discard=this|invite=private/);
    expect(() => createPreviewPage('<head></head>', publicOrigin)).toThrow('local favicon');
    expect(() => createPreviewPage('<head><link rel="icon" href="//other.example/icon.png"></head>', publicOrigin)).toThrow('local favicon');
    expect(() => createPreviewPage('<head><link rel="icon" href="https://other.example/icon.png"></head>', publicOrigin)).toThrow('local favicon');
    expect(()=>createPreviewPage(original.replace(/<link rel="image_src"[^>]*>/,''),publicOrigin)).toThrow('local sharing cover');
    for(const unsafe of ['//other.example/cover.jpg','https://other.example/cover.jpg','/social/../private.jpg',
      '/social/cover.jpg?credentials=private','/social/cover.jpg#invite=private','/src/client/assets/site-icon.png'])
      expect(()=>createPreviewPage(original.replace(coverPath,unsafe),publicOrigin)).toThrow('local sharing cover');
    const local=createPreviewPage(original,'http://localhost:5173')('/');
    expect(metadata(local,'og:image')).toEqual(['http://localhost:5173'+coverPath]);
    expect(metadata(local,'og:image:secure_url')).toEqual([]);
  });
});
