import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { MoonGame, moonPlayerView, moonObserverView, type MoonState } from '../games/moon/game';
import { MoonParticipants } from './MoonBoard';
import { moonKnownFactions, stampMoonTicket } from './moon-view';

function fixture() {
  const match = createMatch({ game: MoonGame, numPlayers: 8, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as MoonState;
  for (const value of Object.values(G.private)) { value.knownWolves = []; value.checks = []; }
  G.private['0'].role = 'wolf'; G.private['0'].faction = 'wolves'; G.private['0'].knownWolves = ['2', '5'];
  G.private['1'].role = 'seer'; G.private['1'].faction = 'town';
  G.private['1'].checks = [{ day: 1, targetID: '2', isWolf: true }, { day: 2, targetID: '4', isWolf: false }];
  return G;
}

describe('Moon passenger intelligence', () => {
  it('only marks the wolf and known teammates, without deducing every other passenger is good', () => {
    const G = fixture();
    const known = { '0': 'wolves', '2': 'wolves', '5': 'wolves' };
    expect(moonKnownFactions(G, '0')).toEqual(known);
    expect(moonKnownFactions(moonPlayerView({ G, playerID: '0' }), '0')).toEqual(known);
    expect(moonKnownFactions(G, '0')['4']).toBeUndefined();
  });
  it('uses only the selected player checks, never another player private record', () => {
    const G = fixture();
    expect(moonKnownFactions(G, '1')).toEqual({ '1': 'town', '2': 'wolves', '4': 'town' });
    expect(moonKnownFactions(G, '1')['5']).toBeUndefined();
    expect(moonKnownFactions(G)).toEqual({});
  });
  it('marks public reveals but hides all faction labels and classes when concealed', () => {
    const G = fixture(); G.players['6'].revealedFaction = 'town'; G.players['6'].revealedRole = 'hunter';
    expect(moonKnownFactions(G, '0')['6']).toBe('town');
    expect(moonKnownFactions(G, '0', true, true)).toEqual({});
    const html = renderToStaticMarkup(createElement(MoonParticipants, { G, nameOf: id => `乘客 ${id}`, ownID: '0', concealed: true, omniscient: true }));
    expect(html).not.toMatch(/known-wolves|known-town|moon-known-faction|moon-wolf-text|狼人陣營|好人陣營/);
    expect(html).toContain('獵人'); // The already public role remains public, without color.
  });
  it('god colors require explicit authorization and vanish on blind reprojection', () => {
    const G = fixture();
    expect(Object.keys(moonKnownFactions(moonObserverView(G, 'god'), undefined, false, true))).toHaveLength(8);
    expect(moonKnownFactions(moonObserverView(G, 'blind'), undefined, false, true)).toEqual({});
  });
});

describe('Local moon patrol', () => {
  it('does not count an unlit ticket or move the light', () => {
    const before = { taps: 7, active: 3 };
    expect(stampMoonTicket(before, 2, 8, .4)).toBe(before);
  });
  it('counts a correct ticket once and never leaves the same ticket lit, including seven players', () => {
    for (let count = 6; count <= 12; count++) for (const roll of [0, .13, .5, .999999, 1]) {
      const before = { taps: 7, active: count - 1 };
      const next = stampMoonTicket(before, count - 1, count, roll);
      expect(next.taps).toBe(8); expect(next.active).not.toBe(before.active);
      expect(next.active).toBeGreaterThanOrEqual(0); expect(next.active).toBeLessThan(count);
      expect(stampMoonTicket(next, before.active, count, roll)).toBe(next);
      expect(before).toEqual({ taps: 7, active: count - 1 });
    }
  });
});
