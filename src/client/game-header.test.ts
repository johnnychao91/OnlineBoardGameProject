import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAME_IDS, gameCatalog } from '../games/catalog';
import { Header } from './ui';
import { GameHeaderContext, GameHeaderProvider } from './game-header-context';

describe('Shared game header', () => {
  it.each(GAME_IDS)('%s renders its catalog name beside the brand and links its own rules', gameID => {
    const html = renderToStaticMarkup(createElement(GameHeaderProvider, null, createElement(Header, { room: 'test-room', gameID })));
    expect(html).toContain('class="header-game-name">' + gameCatalog[gameID].name);
    expect(html).toContain('href="/rules/' + gameID + '"');
    expect(html).toContain('class="header-sound-slot"');
    expect(html.indexOf('header-game-name')).toBeLessThan(html.indexOf('header-links'));
  });
  it('uses the archived replay game rather than the room current game, including the rules link', () => {
    const html = renderToStaticMarkup(createElement(GameHeaderContext.Provider, { value: {
      soundTarget: null, setSoundTarget: () => {}, replayGameID: 'curtain-heist', setReplayGameID: () => {},
    } }, createElement(Header, { room: 'test-room', gameID: 'space-station', rulesGame: 'space-station' })));
    expect(html).toContain('header-game-name">謝幕劫案');
    expect(html).toContain('href="/rules/curtain-heist"');
    expect(html).not.toContain('href="/rules/space-station"');
  });
  it('keeps the home header and unknown game free of an invented game title', () => {
    for (const gameID of [undefined, 'unknown']) {
      const html = renderToStaticMarkup(createElement(Header, { gameID }));
      expect(html).not.toContain('class="header-game-name"');
      expect(html).toContain('href="/rules"');
    }
  });
});
