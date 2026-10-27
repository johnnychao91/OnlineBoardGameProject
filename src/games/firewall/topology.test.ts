import { describe, expect, it } from 'vitest';
import { createFirewallDeck, createFirewallRoles, FIREWALL_ACTIONS, FIREWALL_PATH_DEFINITIONS, FIREWALL_PATHS, type FirewallPathID } from './content';
import { canPlaceFirewallPath, firewallComponentKey, firewallPathPlacements, firewallReachableComponents, firewallTileTopology } from './topology';
import type { FirewallTile } from './types';

const tile = (id: string, pathID: FirewallPathID, x: number, y: number): FirewallTile => ({ id, kind: id === 'start' ? 'start' : 'path', pathID, x, y, rotation: 0, revealed: true });
const start = tile('start', 'start', 0, 0);
const reaches = (board: FirewallTile[], id: string, component = 0, color?: 'blue' | 'green') => firewallReachableComponents(board, color).has(firewallComponentKey(id, component));

describe('Firewall complete physical inventory', () => {
  it('contains 118 distinct playable cards, 42 path designs, 70 paths, 48 actions, 15 roles and 10 crystals', () => {
    const deck = createFirewallDeck(), paths = FIREWALL_PATH_DEFINITIONS.filter(path => path.id.startsWith('base_') || path.id.startsWith('exp_'));
    expect(deck).toHaveLength(118); expect(new Set(deck.map(card => card.id)).size).toBe(118);
    expect(paths).toHaveLength(42); expect(deck.filter(card => card.kind === 'path')).toHaveLength(70);
    expect(paths.filter(path => path.id.startsWith('base_')).reduce((count, path) => count + path.quantity, 0)).toBe(40);
    expect(paths.filter(path => path.id.startsWith('exp_')).reduce((count, path) => count + path.quantity, 0)).toBe(30);
    expect(deck.filter(card => card.kind === 'action')).toHaveLength(48);
    expect(FIREWALL_ACTIONS.rockfall.count).toBe(4); expect(FIREWALL_ACTIONS.map.count).toBe(6);
    expect(paths.reduce((count, path) => count + (FIREWALL_PATHS[path.id].crystals ?? 0) * path.quantity, 0)).toBe(10);
    expect(createFirewallRoles().reduce<Record<string, number>>((counts, role) => ({ ...counts, [role]: (counts[role] ?? 0) + 1 }), {}))
      .toEqual({ blue: 4, green: 4, saboteur: 3, boss: 1, profiteer: 1, geologist: 2 });
    expect(createFirewallRoles()).toHaveLength(15);
    for (const path of FIREWALL_PATH_DEFINITIONS) {
      const ports = path.components.flat(); expect(new Set(ports).size, path.id).toBe(ports.length);
      expect(path.components.every(component => component.length > 0), path.id).toBe(true);
      const topology = firewallTileTopology({ ...start, pathID: path.id })!;
      expect(topology.components).toEqual(path.components);
      const rotated = firewallTileTopology({ ...start, pathID: path.id, rotation: 180 })!;
      expect(rotated.components.flat().length).toBe(ports.length);
    }
  });
});

describe('Firewall component graph and legal public placement geometry', () => {
  it('cannot turn on bridges or jump between double bends and dead ends', () => {
    const bridge = [start, tile('bridge', 'exp_bridge', 0, -1), tile('north', 'base_ns', 0, -2), tile('west', 'base_ew', -1, -1)];
    expect(reaches(bridge, 'bridge', 0)).toBe(true); expect(reaches(bridge, 'bridge', 1)).toBe(false);
    expect(reaches(bridge, 'north')).toBe(true); expect(reaches(bridge, 'west')).toBe(false);
    const double = [start, tile('double', 'exp_double_nw_es', 0, -1), tile('east', 'base_ew', 1, -1), tile('north', 'base_ns', 0, -2)];
    expect(reaches(double, 'double', 1)).toBe(true); expect(reaches(double, 'double', 0)).toBe(false);
    expect(reaches(double, 'east')).toBe(true); expect(reaches(double, 'north')).toBe(false);
    const dead = [start, tile('dead', 'base_dead_nesw', 0, -1), tile('north', 'base_ns', 0, -2)];
    expect(reaches(dead, 'dead', 2)).toBe(true); expect(reaches(dead, 'dead', 0)).toBe(false); expect(reaches(dead, 'north')).toBe(false);
    expect(canPlaceFirewallPath(dead, 'base_ns', 0, -3, 0)).toBe(false);
  });
  it('blocks only a door component and lets the other color use an independent dead-end approach', () => {
    const board = [start, tile('door', 'exp_green_ns_e', 0, -1), tile('north', 'base_ns', 0, -2),
      tile('east', 'base_nsw', 1, 0), tile('bend', 'base_sw', 1, -1)];
    expect(reaches(board, 'door', 0, 'blue')).toBe(false); expect(reaches(board, 'north', 0, 'blue')).toBe(false);
    expect(reaches(board, 'door', 1, 'blue')).toBe(true);
    expect(reaches(board, 'north', 0, 'green')).toBe(true); expect(reaches(board, 'north')).toBe(true);
  });
  it('connects single-port ladders to the start and other ladders, while enforcing adjacency and no goal neighbors', () => {
    const board = [start, tile('island', 'base_ew', -3, -2)];
    expect(canPlaceFirewallPath(board, 'exp_ladder_s', -3, -1, 0)).toBe(true);
    expect(canPlaceFirewallPath(board, 'base_dead_n', -3, -1, 0)).toBe(false);
    expect(canPlaceFirewallPath(board, 'exp_ladder_s', -5, -1, 0)).toBe(false);
    const withLadder = [...board, tile('ladder', 'exp_ladder_s', -3, -1), tile('south', 'base_ns', -3, 0)];
    expect(reaches(withLadder, 'south')).toBe(true);
    const goal: FirewallTile = { id: 'goal', kind: 'goal', x: -4, y: -1, revealed: false };
    expect(canPlaceFirewallPath([...board, goal], 'exp_ladder_s', -3, -1, 0)).toBe(false);
  });
  it('requires every visible adjacent edge to match, only permits half turns, and has no 9 by 5 board boundary', () => {
    expect(canPlaceFirewallPath([start], 'base_es', -1, 0, 0)).toBe(true);
    expect(canPlaceFirewallPath([start], 'base_es', -1, 0, 180)).toBe(false);
    expect(canPlaceFirewallPath([start], 'base_es', -1, 0, 90 as 0)).toBe(false);
    expect(canPlaceFirewallPath([start], 'base_ns', 0, 0, 0)).toBe(false);
    expect(canPlaceFirewallPath([start], 'goal_gold', 0, -1, 0)).toBe(false);
    const chain = [start, ...Array.from({ length: 8 }, (_, index) => tile(`w${index}`, 'base_ew', -index - 1, 0))];
    expect(canPlaceFirewallPath(chain, 'base_ew', -9, 0, 0)).toBe(true);
    expect(canPlaceFirewallPath([start, tile('east', 'base_ns', 1, -1)], 'base_ns', 0, -1, 0)).toBe(true);
    expect(canPlaceFirewallPath([start, tile('east', 'base_ew', 1, -1)], 'base_ns', 0, -1, 0)).toBe(false);
  });
  it('never reads hidden goal geometry for placement or connectivity, even if it is injected into a raw board', () => {
    const goal: FirewallTile = { id: 'goal-middle', kind: 'goal', x: 8, y: 0, revealed: false };
    const board = [start, ...Array.from({ length: 6 }, (_, index) => tile(`e${index}`, 'base_ew', index + 1, 0)), goal];
    const expected = firewallPathPlacements(board, 'base_ew');
    expect(expected).toContainEqual({ x: 7, y: 0, rotation: 0 });
    Object.defineProperty(goal, 'pathID', { get: () => { throw new Error('hidden goal geometry read'); } });
    Object.defineProperty(goal, 'rotation', { get: () => { throw new Error('hidden goal orientation read'); } });
    expect(firewallPathPlacements(board, 'base_ew')).toEqual(expected);
    expect(firewallTileTopology(goal)).toBeNull(); expect(reaches(board, goal.id)).toBe(false);
    expect(canPlaceFirewallPath(board, 'base_ew', 9, 0, 0)).toBe(false);
  });
  it('preserves independently documented crystal dead ends and one-ended ladder topology under rotation', () => {
    expect(FIREWALL_PATHS.exp_crystal_ew_s.components).toEqual([['E', 'W'], ['S']]);
    expect(FIREWALL_PATHS.exp_crystal_ew_s.crystalComponent).toBe(0);
    expect(FIREWALL_PATHS.exp_green_ns_e.components).toEqual([['N', 'S'], ['E']]);
    expect(FIREWALL_PATHS.exp_ladder_s.components).toEqual([['S']]);
    expect(firewallTileTopology({ ...start, pathID: 'exp_ladder_s', rotation: 180 })?.components).toEqual([['N']]);
    expect(firewallTileTopology({ ...start, pathID: 'exp_crystal_nsw_e', rotation: 180 })?.components).toEqual([['S', 'N', 'E'], ['W']]);
  });
});
