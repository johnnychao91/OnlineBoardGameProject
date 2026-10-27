import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { calculateFirewallRoundResult, FirewallGame, type FirewallRole, type FirewallState, type FirewallTile } from './game';

function fixture(roles: FirewallRole[], doors: ('blue' | 'green')[] = []) {
  const participantIDs = roles.map((_, index) => String(index * 2));
  const match = createMatch({ game: FirewallGame, numPlayers: roles.length, setupData: { startImmediately: true, participantIDs }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as FirewallState;
  participantIDs.forEach((id, index) => { G.private[id].role = roles[index]; });
  G.board = [G.board[0], ...Array.from({ length: 7 }, (_, index): FirewallTile => ({ id: `route-${index}`, kind: 'path', revealed: true,
    x: index + 1, y: 0, rotation: 0, pathID: doors[index] === 'blue' ? 'exp_blue_ew' : doors[index] === 'green' ? 'exp_green_ew' : 'base_ew' })),
  { id: 'goal-middle', kind: 'goal', x: 8, y: 0, revealed: true, pathID: 'goal_gold', rotation: 0 }];
  return G;
}

describe('Firewall 2025 role victory and distributions', () => {
  it('awards only the completing color when both routes are open, but both colors for a neutral completer', () => {
    const G = fixture(['blue', 'green', 'boss', 'profiteer', 'saboteur']);
    const blue = calculateFirewallRoundResult(G, '0', true);
    expect(blue.winningColors).toEqual(['blue']); expect(blue.awards).toEqual({ '0': 3, '2': 0, '4': 2, '6': 1, '8': 0 });
    const neutral = calculateFirewallRoundResult(G, '4', true);
    expect(neutral.winningColors).toEqual(['blue', 'green']); expect(neutral.awards).toEqual({ '0': 2, '2': 2, '4': 1, '6': 0, '8': 0 });
    expect(calculateFirewallRoundResult(G, '8', true).awards).toEqual(neutral.awards);
  });
  it('gives the other team victory if the completing team is blocked by the wrong door', () => {
    const G = fixture(['blue', 'green', 'boss', 'profiteer'], ['blue']);
    const result = calculateFirewallRoundResult(G, '2', true);
    expect(result.winningColors).toEqual(['blue']); expect(result.winningIDs).toEqual(['0', '4', '6']);
    expect(result.awards).toEqual({ '0': 3, '2': 0, '4': 2, '6': 1 });
  });
  it('awards boss and profiteer through mixed doors, and implements their sole-winner payouts', () => {
    const both = fixture(['blue', 'green', 'boss', 'profiteer', 'saboteur'], ['blue', 'green']);
    expect(calculateFirewallRoundResult(both, '0', true)).toMatchObject({ winningColors: [], winningIDs: ['4', '6'], awards: { '0': 0, '2': 0, '4': 3, '6': 2, '8': 0 } });
    const boss = fixture(['blue', 'boss', 'saboteur'], ['blue', 'green']);
    expect(calculateFirewallRoundResult(boss, '0', true).awards).toEqual({ '0': 0, '2': 4, '4': 0 });
    const profiteer = fixture(['blue', 'profiteer', 'saboteur'], ['blue', 'green']);
    expect(calculateFirewallRoundResult(profiteer, '0', true).awards).toEqual({ '0': 0, '2': 3, '4': 0 });
    both.players['4'].trapped = true;
    expect(calculateFirewallRoundResult(both, '0', true).awards).toEqual({ '0': 0, '2': 0, '4': 0, '6': 3, '8': 0 });
  });
  it.each([
    { roles: ['saboteur', 'blue'], expected: [5, 0] },
    { roles: ['saboteur', 'saboteur'], expected: [4, 4] },
    { roles: ['saboteur', 'saboteur', 'saboteur'], expected: [3, 3, 3] },
    { roles: ['saboteur', 'saboteur', 'saboteur', 'profiteer'], expected: [2, 2, 2, 0] },
    { roles: ['profiteer', 'blue'], expected: [3, 0] },
    { roles: ['blue', 'green'], expected: [0, 0] },
  ])('uses the expansion payout table on exhaustion: $roles', ({ roles, expected }) => {
    const G = fixture(roles as FirewallRole[]), result = calculateFirewallRoundResult(G, null, false);
    expect(G.turnOrder.map(id => result.awards[id])).toEqual(expected); expect(result.reason).toBe('exhausted');
  });
  it('excludes trapped players from the winning group denominator and floors reductions at zero', () => {
    const G = fixture(['blue', 'blue', 'blue', 'blue', 'boss', 'profiteer']);
    expect(calculateFirewallRoundResult(G, '0', true).awards).toEqual({ '0': 1, '2': 1, '4': 1, '6': 1, '8': 0, '10': 0 });
    G.players['2'].trapped = true; G.players['4'].trapped = true; G.players['6'].trapped = true;
    expect(calculateFirewallRoundResult(G, '0', true).awards).toEqual({ '0': 3, '2': 0, '4': 0, '6': 0, '8': 2, '10': 1 });
  });
  it('counts every visible crystal, including disconnected and dead-end cards, and excludes trapped geologists', () => {
    const G = fixture(['blue', 'geologist', 'geologist', 'saboteur']);
    G.board.push(...(['exp_crystal_s', 'exp_crystal_ew_s', 'exp_crystal_nsw_e'] as const).map((pathID, index): FirewallTile => ({ id: `crystal-${index}`, kind: 'path', revealed: true, x: -10 - index, y: -10, pathID, rotation: 0 })));
    const split = calculateFirewallRoundResult(G, '0', true);
    expect(split.crystals).toBe(3); expect(split.awards['2']).toBe(1); expect(split.awards['4']).toBe(1);
    G.players['4'].trapped = true;
    expect(calculateFirewallRoundResult(G, null, false).awards).toEqual({ '0': 0, '2': 3, '4': 0, '6': 5 });
    G.board.pop(); expect(calculateFirewallRoundResult(G, null, false).awards['2']).toBe(2);
  });
});
