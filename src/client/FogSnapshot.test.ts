import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { FogGame, fogPlayerView, type FogState } from '../games/fog/game';
import { FogPrivatePanel } from './FogBoard';
import { FogSnapshot } from './FogSnapshot';
import type { RoomInfo } from './api';

function fixture(): FogState {
  const match = createMatch({ game: FogGame, numPlayers: 5, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as FogState;
  G.status = 'quest-review';
  G.private['0'].ownVote = true;
  G.private['0'].ownQuestCard = 'fail';
  return G;
}
const info: RoomInfo = {
  roomId: 'test-room', matchID: 'test-match', gameName: 'black-fog', status: 'quest-review',
  numPlayers: 5, minPlayers: 5, maxPlayers: 10, spectatorCount: 1, godViewAllowed: true,
  players: Array.from({ length: 5 }, (_, id) => ({ id, name: `巡夜者 ${id}`, isConnected: true, ready: true })),
};
function snapshot(G: FogState, perspective: 'blind' | 'god') {
  return renderToStaticMarkup(createElement(FogSnapshot, { G, info, perspective, replay: true }));
}

describe('Fog private choices in read-only snapshots', () => {
  it('shows the inspected god-view player’s submitted choices even during result review', () => {
    const html = snapshot(fixture(), 'god');
    expect(html).toContain('此巡夜者的密票：贊成');
    expect(html).toContain('此巡夜者已密封的行動：侵蝕燈塔');
    expect(html).not.toContain('確認這');
    expect(html).not.toContain('確認指認');
  });

  it('removes all individual choices and role artwork from a stale god payload in blind mode', () => {
    const html = snapshot(fixture(), 'blind');
    expect(html).not.toContain('的密票：');
    expect(html).not.toContain('已密封的行動：');
    expect(html).not.toContain('data-fog-role=');
    expect(html).toContain('盲視角不顯示秘密身分');
  });

  it('lets the actual player confirm their own submitted choices with player-facing wording', () => {
    const G = fixture();
    G.private['0'].ownVote = false;
    G.private['0'].ownQuestCard = 'success';
    const html = renderToStaticMarkup(createElement(FogPrivatePanel, {
      G: fogPlayerView({ G, playerID: '0' }), playerID: '0', nameOf: id => `巡夜者 ${id}`,
    }));
    expect(html).toContain('你的密票：反對');
    expect(html).toContain('你已密封的行動：守護燈塔');
    expect(html).not.toContain('此巡夜者的密票');
  });

  it.each([null, undefined])('does not invent a choice for an unsubmitted or absent field (%s)', value => {
    const G = fixture();
    G.private['0'].ownVote = value as null;
    G.private['0'].ownQuestCard = value as null;
    const html = snapshot(G, 'god');
    expect(html).not.toContain('的密票：');
    expect(html).not.toContain('已密封的行動：');
  });
});
