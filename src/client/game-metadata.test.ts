import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAME_IDS, gameCatalog, gameOptionLabel, gameTags } from '../games/catalog';
import { GameMetadata } from './GameMetadata';
import { RulesPage } from './RulesPage';
import { CipherRuleSummary } from './CipherBoard';

describe('Shared game discovery tags', () => {
  it('shows every game’s same player range and tags in the menu, overview and detailed rules', () => {
    const overview = renderToStaticMarkup(createElement(RulesPage));
    for (const gameID of GAME_IDS) {
      const html = renderToStaticMarkup(createElement(GameMetadata, { gameID }));
      const detail = renderToStaticMarkup(createElement(RulesPage, { gameID }));
      expect(overview, gameID).toContain(html);
      expect(detail, gameID).toContain(html);
      const label = gameOptionLabel(gameID), game = gameCatalog[gameID];
      expect(label).toContain(`${game.name} · ${game.minPlayers}～${game.maxPlayers} 人`);
      for (const tag of gameTags(gameID)) {
        expect(label, gameID).toContain(tag);
        expect(html, gameID).toContain(`>${tag}</li>`);
      }
      expect(html).toContain('aria-label="遊戲標籤"');
      expect(new Set(gameTags(gameID)).size).toBe(gameTags(gameID).length);
    }
  });

  it('keeps mixed formats visible and describes cooperative play without an age restriction', () => {
    expect(gameCatalog['midnight-post'].categories).toEqual(['individual', 'faction']);
    expect(gameCatalog['firewall-breach'].categories).toEqual(['faction', 'individual']);
    expect(gameCatalog['encrypted-call'].categories).toEqual(['cooperative']);
    expect(gameCatalog['turing-test'].categories).toEqual(['cooperative']);
    expect(gameTags('encrypted-call')).toEqual(['合作', '無聲默契', '訊號排序']);
    expect(renderToStaticMarkup(createElement(CipherRuleSummary))).not.toContain('8 歲以上');
    expect(GAME_IDS.map(gameOptionLabel).join('')).not.toContain('歲以上');
  });
});
