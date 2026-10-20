import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { StationGame, type StationState } from '../games/station/game';
import { RoundRevealList, TurnNotice } from './StationTable';

function state(): StationState {
  const match = createMatch({
    game: StationGame, numPlayers: 4,
    setupData: { startImmediately: true }, unlisted: true,
  });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as StationState;
  G.round = 2;
  G.status = 'round-review';
  G.log = [
    { round: 1, actorID: '0', targetID: '1', slot: 0, kind: 'stable' },
    { round: 2, actorID: '3', targetID: '2', slot: 3, kind: 'repair' },
    { round: 2, actorID: '2', targetID: '0', slot: 1, kind: 'stable' },
    { round: 2, actorID: '0', targetID: '1', slot: 2, kind: 'repair' },
    { round: 2, actorID: '1', targetID: '3', slot: 0, kind: 'stable' },
  ];
  return G;
}

const nameOf = (id: string) => `隊員 ${id}`;
const renderList = (G: StationState) => renderToStaticMarkup(createElement(RoundRevealList, { G, nameOf }));

describe('Station public round display', () => {
  it('renders only the current round in reveal order without changing the public log', () => {
    const G = state();
    const before = structuredClone(G.log);
    const html = renderList(G);
    expect(html).toContain('第 2 輪 · 4 張');
    expect(html).toContain('aria-label="第 2 輪檢修順序"');
    const entries = [...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map(match => match[0]);
    expect(entries).toHaveLength(4);
    for (const [index, entry] of entries.entries()) {
      const reveal = G.log[index + 1];
      expect(entry).toContain(`<span class="reveal-order">${index + 1}</span>`);
      expect(entry.indexOf(nameOf(reveal.actorID))).toBeLessThan(entry.indexOf(nameOf(reveal.targetID)));
      expect(entry).toContain(`第 ${reveal.slot + 1} 張`);
      expect(entry).toContain(index % 2 === 0 ? '維修模組' : '穩定設備');
      expect(entry.includes('latest-reveal')).toBe(index === entries.length - 1);
    }
    expect(G.log).toEqual(before);
  });

  it('uses only the public log even if an observer state also contains secret hands and identities', () => {
    const G = state();
    // Accessors ensure the display cannot silently start reading a god-view
    // hand, private identity, or fixed-slot table when constructing its list.
    for (const field of ['private', 'secret', 'publicCards']) {
      Object.defineProperty(G, field, { get: () => { throw new Error(`Private source read: ${field}`); } });
    }
    expect(() => renderList(G)).not.toThrow();
    const html = renderList(G);
    expect(html).not.toMatch(/反應爐危機|維修員|干擾者|unusedRoles|composition|secret/);
    expect(html.match(/class="reveal-order"/g)).toHaveLength(4);
  });

  it('shows an empty new round instead of carrying forward the preceding round list', () => {
    const G = state();
    G.round = 3;
    G.status = 'briefing';
    const html = renderList(G);
    expect(html).toContain('第 3 輪 · 0 張');
    expect(html).toContain('本輪尚未檢修');
    expect(html).not.toMatch(/<ol>|<li\b|latest-reveal|維修模組|穩定設備|隊員 [0-3]/);
  });

  it('announces the actual final public card during review and escapes player names', () => {
    const G = state();
    G.log.at(-1)!.kind = 'repair';
    const html = renderToStaticMarkup(createElement(TurnNotice, {
      G, ownID: '0',
      nameOf: (id: string) => id === '1' ? '<script>alert("name")</script>' : nameOf(id),
    }));
    expect(html).toContain('本輪檢修完成 · 先確認最後一張');
    expect(html).toContain('全體隊員確認後才重新發牌');
    expect(html).toContain('最後揭開：');
    expect(html).toContain('維修模組');
    expect(html).toContain('隊員 3');
    expect(html).toContain('第 1 張');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('輪到你檢修設備');
  });
});
