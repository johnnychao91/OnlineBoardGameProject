import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { GAME_IDS } from '../games/catalog';
import { gameDefinitions } from '../games/registry';
import { clientGames } from './game-registry';
import type { RoomInfo } from './api';

describe('Every registered game supplies the entire client framework', () => {
  it('uses the Turing sorting mode and occupied seats when validating lobby start', () => {
    const validate = clientGames['turing-test'].validateLobby!;
    for (const options of [undefined, { sortingMode: 'examiner' }]) {
      for (const count of [0, 1, 2, 3, 9]) expect(validate(options, count)).toBeUndefined();
      expect(validate(options, 10)).toContain('檢測員');
    }
    expect(validate({ sortingMode: 'group' }, 10)).toBeUndefined();
    expect(validate({ sortingMode: 'group' }, 11)).toBeDefined();
  });
  it('requires the same catalog on both sides and complete presentation adapters', () => {
    expect(Object.keys(clientGames).sort()).toEqual([...GAME_IDS].sort());
    for (const id of GAME_IDS) {
      const definition = clientGames[id];
      for (const key of ['PlayerClient', 'Snapshot', 'DetailedRules', 'createPoster', 'soundAdapter'] as const) expect(typeof definition[key], `${id}: ${key}`).toBe('function');
      expect(definition.chapters.length).toBeGreaterThan(0);
      expect(new Set(definition.chapters.map(([id]) => id)).size).toBe(definition.chapters.length);
      expect(definition.gallery.label.trim().length, `${id}: gallery label`).toBeGreaterThan(0);
      expect(definition.chapters.map(([chapter]) => chapter), `${id}: gallery chapter`).toContain(definition.gallery.chapter);
    }
  });
  it.each(gameDefinitions)('$id renders shared blind / god snapshots and bases spectator audio only on public events', definition => {
    const ids = Array.from({ length: definition.minPlayers }, (_, index) => String(index));
    const match = createMatch({ game: definition.game, numPlayers: ids.length, setupData: definition.startSetupData(ids), unlisted: true });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    const G = match.initialState.G;
    const info: RoomInfo = { roomId: 'test-room', matchID: 'test-match', gameName: definition.id, status: G.status,
      numPlayers: ids.length, minPlayers: definition.minPlayers, maxPlayers: definition.maxPlayers,
      players: ids.map(id => ({ id, name: `成員 ${id}`, isConnected: true, ready: true })), spectatorCount: 1, godViewAllowed: true };
    const renderer = clientGames[definition.id];
    const blind = definition.observerView(G, 'blind'), god = definition.observerView(G, 'god');
    expect(renderer.soundAdapter(blind)).toEqual(renderer.soundAdapter(god));
    for (const perspective of ['blind', 'god'] as const) {
      const html = renderToStaticMarkup(createElement(renderer.Snapshot, { G: perspective === 'god' ? god : blind, info, perspective, replay: true }));
      expect(html).toContain('game-layout');
      expect(html).not.toContain('credentials');
    }
    const rules = renderToStaticMarkup(createElement(renderer.DetailedRules));
    for (const [chapter] of renderer.chapters) expect(rules).toContain(`id="${chapter}"`);
  });
});
