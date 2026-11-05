import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_IDS } from '../games/catalog';
import { analyticsPage } from './analytics';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

function browserFixture(path = '/') {
  const location = new URL('https://boardgame.example.com' + path);
  const events = new EventTarget();
  const appended: any[] = [];
  const browser = { dataLayer: [] as IArguments[], addEventListener: events.addEventListener.bind(events) };
  vi.stubGlobal('location', location);
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', {
    referrer: 'https://example.com/private-name?token=referrer-secret#sensitive',
    createElement: () => ({}), head: { appendChild: (script: any) => appended.push(script) },
  });
  const views = () => browser.dataLayer.map(args => Array.from(args)).filter(args => args[0] === 'event');
  const visit = (path: string) => { location.href = new URL(path, location).href; events.dispatchEvent(new Event('popstate')); };
  return { browser, appended, views, visit };
}

describe('Optional Analytics and safe virtual pages', () => {
  it('groups private routes and only preserves registered public rules', () => {
    for (const route of ['room', 'join', 'replay']) expect(analyticsPage(`/${route}/private-id`).path).toBe('/' + route);
    for (const game of GAME_IDS) expect(analyticsPage(`/rules/${game}/`).path).toBe('/rules/' + game);
    expect(analyticsPage('/rules/private-name').path).toBe('/other');
    expect(analyticsPage('/private-name').path).toBe('/other');
    expect(analyticsPage('/privacy.html').path).toBe('/privacy');
    expect(analyticsPage('/index.html').path).toBe('/');
  });

  it.each([null, '', 'bad-id', '<script>', 123])('does not load a tag for disabled or invalid settings: %s', async measurementId => {
    const f = browserFixture();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ measurementId }) })));
    await (await import('./analytics')).startAnalytics();
    expect(f.appended).toHaveLength(0); expect(f.views()).toHaveLength(0);
  });

  it('counts initial / SPA / back navigation once and omits all private URL data and personal values', async () => {
    const f = browserFixture('/join/private-room?credentials=secret#invite=fragment-secret');
    const fetchConfig = vi.fn(async () => ({ ok: true, json: async () => ({ measurementId: 'G-TEST123456' }) }));
    vi.stubGlobal('fetch', fetchConfig);
    const { startAnalytics } = await import('./analytics');
    await Promise.all([startAnalytics(), startAnalytics()]);
    expect(fetchConfig).toHaveBeenCalledOnce(); expect(f.appended).toHaveLength(1);
    expect(f.appended[0]).toMatchObject({ async: true, referrerPolicy: 'no-referrer' });
    expect(f.views()[0][2]).toMatchObject({ page_location: 'https://boardgame.example.com/join', page_referrer: 'https://example.com/' });
    f.visit('/join/private-room'); // Invite capture cleans the URL, not a new page.
    f.visit('/room/private-room?roomCode=secret-code');
    f.visit('/rules/curtain-heist?room=private-room#gallery');
    f.visit('/rules/curtain-heist?room=private-room#victory');
    f.visit('/room/private-room');
    expect(f.views().map(row => (row[2] as any).page_location)).toEqual([
      'https://boardgame.example.com/join', 'https://boardgame.example.com/room',
      'https://boardgame.example.com/rules/curtain-heist', 'https://boardgame.example.com/room',
    ]);
    const payload = JSON.stringify(f.browser.dataLayer.map(args => Array.from(args)));
    for (const secret of ['private-room', 'secret-code', 'fragment-secret', 'credentials', 'private-name', 'referrer-secret']) expect(payload).not.toContain(secret);
    expect(payload).toContain('"send_page_view":false');
    expect(payload).toContain('"allow_google_signals":false');
  });

  it.each(['network', 'http', 'json'])('keeps play independent of a failed configuration request: %s', async failure => {
    const f = browserFixture('/privacy?room=private-room');
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'network') throw new Error('offline');
      return { ok: failure !== 'http', json: async () => { throw new Error('bad json'); } };
    }));
    await expect((await import('./analytics')).startAnalytics()).resolves.toBeUndefined();
    expect(f.appended).toHaveLength(0);
  });
});
