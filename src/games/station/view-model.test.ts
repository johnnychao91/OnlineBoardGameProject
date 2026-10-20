import { describe, expect, it } from 'vitest';
import { createMatch } from 'boardgame.io/internal';
import { StationGame, stationPlayerView } from './game';
import type { Role, StationState } from './game';
import { getCardSlots, possibleRoleCounts } from './view-model';

describe('公開陣營可能人數', () => {
  it.each([
    [4, [{ engineer: 2, saboteur: 2 }, { engineer: 3, saboteur: 1 }]],
    [5, [{ engineer: 3, saboteur: 2 }]],
    [6, [{ engineer: 4, saboteur: 2 }]],
    [7, [{ engineer: 4, saboteur: 3 }, { engineer: 5, saboteur: 2 }]],
    [8, [{ engineer: 5, saboteur: 3 }]],
  ] as const)('%i 人顯示全場可能組合，沒有額外洩漏真正配置', (n, expected) => {
    for (const ownRole of [undefined, 'engineer', 'saboteur'] as Array<Role | undefined>) {
      expect(possibleRoleCounts(n, ownRole)).toEqual(expected);
    }
  });

  it.each([0, 3, 9, 4.5, NaN, Infinity])('不支援的人數 %s 不虛構組合', (n) => {
    expect(possibleRoleCounts(n)).toEqual([]);
  });
});

describe('牌位顯示', () => {
  function state(): StationState {
    const match = createMatch({ game: StationGame, numPlayers: 4,
      setupData: { startImmediately: true }, unlisted: true });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    return structuredClone(match.initialState.G) as StationState;
  }

  it('固定暗牌與已翻牌的位置，資訊只來自公開牌面', () => {
    const G = state();
    G.publicCards!['1'] = [null, 'stable', null, 'repair', null];
    G.players['1'].cardCount = 3;
    const view = stationPlayerView({ G, playerID: '0' });
    const slots = getCardSlots(view, '1');
    expect(slots).toEqual([
      { slot: 0, kind: null },
      { slot: 1, kind: 'stable' },
      { slot: 2, kind: null },
      { slot: 3, kind: 'repair' },
      { slot: 4, kind: null },
    ]);
    slots[1].kind = 'hazard';
    expect(view.publicCards!['1'][1]).toBe('stable');
  });

  it('舊局只顯示 compact 暗牌，不用日志猜測已消失的位置', () => {
    const G = state();
    delete G.rulesVersion;
    delete G.publicCards;
    G.players['1'].cardCount = 3;
    G.log.push({ round: 1, actorID: '0', targetID: '1', slot: 0, kind: 'repair' });
    expect(getCardSlots(G, '1')).toEqual([
      { slot: 0, kind: null }, { slot: 1, kind: null }, { slot: 2, kind: null },
    ]);
    expect(G.log).toHaveLength(1);
  });

  it('缺少 v2 公開牌位或未參與席位不產生可點擊牌', () => {
    const G = state();
    delete G.publicCards!['1'];
    expect(getCardSlots(G, '1')).toEqual([]);
    for (const id of ['99', '__proto__', 'constructor']) expect(getCardSlots(G, id)).toEqual([]);
  });
});
