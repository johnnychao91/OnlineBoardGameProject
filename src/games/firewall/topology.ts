import { FIREWALL_PATHS, type FirewallColor, type FirewallDirection, type FirewallPathID, type FirewallRotation } from './content';
import type { FirewallPlacement, FirewallTile } from './types';

export const FIREWALL_DIRECTIONS: readonly FirewallDirection[] = ['N', 'E', 'S', 'W'];
export const FIREWALL_OFFSETS: Record<FirewallDirection, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const FIREWALL_OPPOSITE: Record<FirewallDirection, FirewallDirection> = { N: 'S', E: 'W', S: 'N', W: 'E' };
export const firewallPositionKey = (x: number, y: number) => `${x},${y}`;
export const firewallComponentKey = (tileID: string, component: number) => `${tileID}#${component}`;

/** Only visible geometry is ever read; unknown goals stay opaque even on a raw server board. */
export function firewallTileTopology(tile: FirewallTile) {
  if (!tile.revealed || !tile.pathID || !Object.hasOwn(FIREWALL_PATHS, tile.pathID)) return null;
  const path = FIREWALL_PATHS[tile.pathID], rotate = tile.rotation === 180;
  return { components: path.components.map(component => component.map(direction => rotate ? FIREWALL_OPPOSITE[direction] : direction)),
    ladderComponent: path.ladderComponent, door: path.door ? { ...path.door } : undefined,
    crystals: path.crystals ?? 0, crystalComponent: path.crystalComponent, feature: path.feature };
}

/** Graph vertices are internal components, not whole cards or a four-edge bitmask. */
export function firewallReachableComponents(board: readonly FirewallTile[], color?: FirewallColor): Set<string> {
  const occupied = new Map(board.map(tile => [firewallPositionKey(tile.x, tile.y), tile]));
  const topologies = new Map(board.map(tile => [tile.id, firewallTileTopology(tile)]));
  const edges = new Map<string, Set<string>>();
  const allowed = (tileID: string, component: number) => {
    const topology = topologies.get(tileID);
    return !!topology && !(color && topology.door?.component === component && topology.door.color !== color);
  };
  const connect = (a: string, b: string) => { edges.get(a)?.add(b); edges.get(b)?.add(a); };
  for (const tile of board) topologies.get(tile.id)?.components.forEach((_, index) => {
    if (allowed(tile.id, index)) edges.set(firewallComponentKey(tile.id, index), new Set());
  });
  const start = board.find(tile => tile.kind === 'start'), root = start ? firewallComponentKey(start.id, 0) : '';
  for (const tile of board) {
    const topology = topologies.get(tile.id); if (!topology) continue;
    topology.components.forEach((component, index) => {
      if (!allowed(tile.id, index)) return;
      const node = firewallComponentKey(tile.id, index);
      if (topology.ladderComponent === index) connect(root, node);
      for (const direction of component) {
        const [dx, dy] = FIREWALL_OFFSETS[direction], neighbor = occupied.get(firewallPositionKey(tile.x + dx, tile.y + dy));
        if (!neighbor) continue;
        const neighborTopology = topologies.get(neighbor.id);
        const next = neighborTopology?.components.findIndex(other => other.includes(FIREWALL_OPPOSITE[direction])) ?? -1;
        if (next >= 0 && allowed(neighbor.id, next)) connect(node, firewallComponentKey(neighbor.id, next));
      }
    });
  }
  const reachable = new Set<string>(); if (!edges.has(root)) return reachable;
  const queue = [root]; reachable.add(root);
  for (let index = 0; index < queue.length; index++) for (const next of edges.get(queue[index]) ?? []) {
    if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  }
  return reachable;
}

export function canPlaceFirewallPath(board: readonly FirewallTile[], pathID: FirewallPathID, x: number, y: number, rotation: FirewallRotation): boolean {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || (rotation !== 0 && rotation !== 180)
    || !Object.hasOwn(FIREWALL_PATHS, pathID) || (!pathID.startsWith('base_') && !pathID.startsWith('exp_'))
    || board.some(tile => tile.x === x && tile.y === y)) return false;
  const candidate: FirewallTile = { id: '@candidate', kind: 'path', revealed: true, pathID, x, y, rotation };
  const topology = firewallTileTopology(candidate)!;
  let adjacentPath = false;
  for (const direction of FIREWALL_DIRECTIONS) {
    const [dx, dy] = FIREWALL_OFFSETS[direction], neighbor = board.find(tile => tile.x === x + dx && tile.y === y + dy);
    if (!neighbor) continue;
    if (topology.ladderComponent !== undefined && neighbor.kind === 'goal') return false;
    const other = firewallTileTopology(neighbor);
    if (!other) continue; // Hidden goal topology cannot affect validation or hint generation.
    adjacentPath = true;
    const open = topology.components.some(component => component.includes(direction));
    const neighborOpen = other.components.some(component => component.includes(FIREWALL_OPPOSITE[direction]));
    if (open !== neighborOpen) return false;
  }
  if (!adjacentPath) return false;
  const reachable = firewallReachableComponents([...board, candidate]);
  return topology.components.some((_, index) => reachable.has(firewallComponentKey(candidate.id, index)));
}

export function firewallPathPlacements(board: readonly FirewallTile[], pathID: FirewallPathID): FirewallPlacement[] {
  const positions = new Map<string, readonly [number, number]>();
  for (const tile of board) for (const [dx, dy] of Object.values(FIREWALL_OFFSETS)) {
    const x = tile.x + dx, y = tile.y + dy; positions.set(firewallPositionKey(x, y), [x, y]);
  }
  const result: FirewallPlacement[] = [];
  for (const [x, y] of positions.values()) for (const rotation of [0, 180] as const) {
    if (canPlaceFirewallPath(board, pathID, x, y, rotation)) result.push({ x, y, rotation });
  }
  return result;
}
