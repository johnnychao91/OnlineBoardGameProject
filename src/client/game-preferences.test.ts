import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameCatalog } from '../games/catalog';
import { rememberGameOptions, rememberedGameOptions } from './game-preferences';
import type { AuthSession, RoomInfo } from './api';

const info: RoomInfo = { roomId: 'example-room', matchID: 'example-match', gameName: 'turing-test', gameSelected: true,
  status: 'lobby', numPlayers: 1, minPlayers: 2, maxPlayers: 9, players: [], spectatorCount: 0, godViewAllowed: true, hostPlayerID: '0',
  gameOptions: { mode: 'endless', lives: 7, redrawApproval: 'any', orderApproval: 'all',
    customQuestions: [{ prompt: '給新鄰居留一句話。', low: '使人退租', high: '使人想長住' }] },
};
const host: AuthSession = { ...info, playerID: '0', credentials: 'secret-credential' };
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe('Public game preferences for future rooms', () => {
  it('remembers each registered game independently, immediately after acknowledgement, without identities or secrets', () => {
    for (const gameName of Object.keys(gameCatalog)) {
      const room = { ...info, gameName, gameOptions: { ...info.gameOptions, example: gameName } };
      rememberGameOptions(host, room);
      const read = rememberedGameOptions(gameName)!;
      expect(read).toEqual(room.gameOptions);
      read.example = 'modified copy';
      expect(rememberedGameOptions(gameName)).toEqual(room.gameOptions);
    }
    expect(values.size).toBe(Object.keys(gameCatalog).length);
    expect([...values.values()].join('')).not.toMatch(/secret-credential|example-room|example-match|playerID|godViewAllowed/);
    expect(rememberedGameOptions('turing-test')).toMatchObject({ mode: 'endless', lives: 7, redrawApproval: 'any' });
    expect(rememberedGameOptions('not-a-game')).toBeUndefined();
  });

  it('does not replace preferences from guests, unselected rooms or another room; accepts current observer hosts', () => {
    rememberGameOptions(host, info);
    const different = { ...info, gameOptions: { mode: 'standard' } };
    rememberGameOptions({ ...host, playerID: '1' }, different);
    rememberGameOptions(host, { ...different, gameSelected: false });
    rememberGameOptions(host, { ...different, roomId: 'foreign-room' });
    rememberGameOptions(host, { ...different, hostPlayerID: '1' });
    expect(rememberedGameOptions(info.gameName)).toEqual(info.gameOptions);
    const observing: AuthSession = { ...host, access: 'spectator', observerID: 'host-observer' };
    rememberGameOptions(observing, { ...different, hostPlayerID: null, hostObserverID: 'host-observer' });
    expect(rememberedGameOptions(info.gameName)).toEqual(different.gameOptions);
  });

  it('ignores damaged, oversized or unavailable storage without interrupting room changes', () => {
    const key = 'friends-table.game-options.v1.turing-test';
    for (const value of ['{', 'null', '[]', '1', JSON.stringify({ value: 'x'.repeat(65536) })]) {
      values.set(key, value);
      expect(rememberedGameOptions('turing-test')).toBeUndefined();
    }
    vi.stubGlobal('localStorage', { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('full'); } });
    expect(() => rememberGameOptions(host, info)).not.toThrow();
    expect(rememberedGameOptions('turing-test')).toBeUndefined();
  });
});
