import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_IDS, gameCatalog } from '../games/catalog';
import { BACKGROUND_IDS, BACKGROUND_KEY, rememberBackground, rememberedBackground } from './background-preference';
import { RulesPage } from './RulesPage';
import { GameIcon, Header } from './ui';

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe('Public-page background preference', () => {
  it('persists every catalog background and safely defaults for missing, invalid or inaccessible storage', () => {
    expect(rememberedBackground()).toBe('jiebao-studio');
    for (const id of BACKGROUND_IDS) {
      expect(rememberBackground(id)).toBe(true);
      expect(rememberedBackground()).toBe(id);
    }
    expect([...values.keys()]).toEqual([BACKGROUND_KEY]);
    for (const invalid of ['unknown', '__proto__', 'https://example.invalid/image', '']) {
      expect(rememberBackground(invalid)).toBe(false);
      expect(rememberedBackground()).toBe(GAME_IDS.at(-1));
      values.set(BACKGROUND_KEY, invalid);
      expect(rememberedBackground()).toBe('jiebao-studio');
      rememberBackground(GAME_IDS.at(-1)!);
    }
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } });
    expect(rememberedBackground()).toBe('jiebao-studio');
    expect(rememberBackground('silver-moon')).toBe(true);
  });

  it('shows the ordered selector in the shared header and overview; detailed rules and room headers keep their game context', () => {
    rememberBackground('midnight-post');
    const header = renderToStaticMarkup(createElement(Header, { background: { gameID: rememberedBackground(), onChange: () => {} } }));
    expect(header).toContain('aria-label="選擇遊戲背景"');
    expect(header).toContain('value="midnight-post" selected=""');
    expect([...header.matchAll(/<option value="([^"]+)"/g)].map(match => match[1])).toEqual(['jiebao-studio', ...GAME_IDS]);
    expect(header).toContain('value="jiebao-studio">捷寶桌遊室</option>');
    expect(header).not.toContain('試玩版');
    const overview = renderToStaticMarkup(createElement(RulesPage));
    expect(overview).toContain('class="rules-page" data-art-game="midnight-post"');
    expect(overview).toContain('aria-label="選擇遊戲背景"');
    rememberBackground('jiebao-studio');
    const studio = renderToStaticMarkup(createElement(RulesPage));
    expect(studio).toContain('class="rules-page" data-art-game="jiebao-studio"');
    expect(studio).toContain('value="jiebao-studio" selected="">捷寶桌遊室</option>');
    rememberBackground('midnight-post');
    for (const id of GAME_IDS) {
      const detail = renderToStaticMarkup(createElement(RulesPage, { gameID: id }));
      expect(detail).toContain(`class="rules-page" data-art-game="${id}"`);
      expect(detail).not.toContain('aria-label="選擇遊戲背景"');
      const room = renderToStaticMarkup(createElement(Header, { room: 'example-room', gameID: id }));
      expect(room).toContain(gameCatalog[id].name);
      expect(room).not.toContain('aria-label="選擇遊戲背景"');
    }
    expect(rememberedBackground()).toBe('midnight-post');
  });

  it('renders a distinct decorative theme icon for every game in the overview', () => {
    const icons = GAME_IDS.map(gameID => renderToStaticMarkup(createElement(GameIcon, { gameID })));
    expect(new Set(icons).size).toBe(GAME_IDS.length);
    const overview = renderToStaticMarkup(createElement(RulesPage));
    for (const icon of icons) {
      expect(icon).toContain('aria-hidden="true"');
      expect(overview).toContain(icon);
    }
  });
});
