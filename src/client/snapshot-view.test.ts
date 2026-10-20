import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { StationGame, type StationState } from '../games/station/game';
import { CipherGame, type CipherState } from '../games/cipher/game';
import type { RoomInfo } from './api';
import { StationSnapshot } from './StationSnapshot';
import { CipherSnapshot } from './CipherSnapshot';
import { cipherSnapshotState, stationSnapshotState } from './snapshot-view';

const info: RoomInfo = {
  roomId: 'snapshot-room', matchID: 'snapshot-match', gameName: 'space-station', status: 'playing',
  numPlayers: 4, minPlayers: 4, maxPlayers: 8,
  players: Array.from({ length: 4 }, (_, id) => ({ id: String(id), name: `隊員 ${id}`, ready: true, isConnected: true })),
  spectatorCount: 1, spectators: [], godViewAllowed: true,
};

function stationState(): StationState {
  const match = createMatch({ game: StationGame, numPlayers: 4, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as StationState;
  G.private['0'].role = 'saboteur';
  G.status = 'playing';
  return G;
}

function cipherState(): CipherState {
  const match = createMatch({ game: CipherGame, numPlayers: 4, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as CipherState;
  G.private['0'].cards = [97, 99];
  G.players['0'].cardCount = 2;
  return G;
}

describe('read-only snapshot layouts', () => {
  it('removes station secret sources from blind views even when handed a stale god payload', () => {
    const G = stationState();
    const before = structuredClone(G);
    const view = stationSnapshotState(G, 'blind');
    expect(view.private).toEqual({});
    expect(view.secret).toBeUndefined();
    const html = renderToStaticMarkup(createElement(StationSnapshot, { G, info, perspective: 'blind' }));
    expect(html).toContain('查看隊員資訊');
    expect(html).toContain('role-card unrevealed');
    expect(html).not.toMatch(/role-card saboteur|observer-composition|face-hazard|face-repair|face-stable/);
    expect(html).not.toMatch(/data-art-kind|data-art-role/);
    expect(html).not.toMatch(/<button\b/);
    expect(G).toEqual(before);
  });

  it('lets god view inspect received information, while finished blind views show only public identities', () => {
    const G = stationState();
    const god = renderToStaticMarkup(createElement(StationSnapshot, { G, info, perspective: 'god', replay: true }));
    expect(god).toContain('role-card saboteur');
    expect(god).toContain('data-art-role="saboteur"');
    expect(god).not.toMatch(/<button\b/);
    G.status = 'finished';
    G.players['0'].revealedRole = 'engineer';
    const blind = renderToStaticMarkup(createElement(StationSnapshot, { G, info, perspective: 'blind', replay: true }));
    expect(blind).toContain('role-card engineer');
    expect(blind).toContain('data-art-role="engineer"');
    expect(blind).not.toContain('data-art-role="saboteur"');
    expect(blind).not.toMatch(/role-card saboteur|observer-composition/);
    expect(stationSnapshotState(G, 'blind').secret).toBeUndefined();
  });

  it('renders cipher public card backs in blind view and numeric read-only cards only in god view', () => {
    const G = cipherState();
    const before = structuredClone(G);
    const cipherInfo = { ...info, gameName: 'encrypted-call', minPlayers: 2, maxPlayers: 4 };
    const blind = renderToStaticMarkup(createElement(CipherSnapshot, { G, info: cipherInfo, perspective: 'blind' }));
    expect(cipherSnapshotState(G, 'blind').private).toEqual({});
    expect(blind).toContain('查看特務手牌');
    expect(blind.match(/class="cipher-card cipher-card-back"/g)).toHaveLength(2);
    expect(blind).not.toMatch(/>97<|>99<|<button\b/);
    const god = renderToStaticMarkup(createElement(CipherSnapshot, { G, info: cipherInfo, perspective: 'god', replay: true }));
    expect(god).toContain('<strong>97</strong>');
    expect(god).toContain('<strong>99</strong>');
    expect(god).not.toMatch(/<button\b|傳送訊號 97|cipher-card-send/);
    expect(G).toEqual(before);
  });
});
