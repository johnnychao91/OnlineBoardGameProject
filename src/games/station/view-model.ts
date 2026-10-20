import type { CardKind, Role, StationState } from './game';

/** Public setup information; never derived from a match's assigned identities. */
export function stationRolePool(numPlayers: number): Role[] {
  if (!Number.isInteger(numPlayers) || numPlayers < 4 || numPlayers > 8) return [];
  const engineer = numPlayers <= 5 ? 3 : numPlayers === 6 ? 4 : 5;
  const saboteur = numPlayers <= 6 ? 2 : 3;
  return [
    ...Array<Role>(engineer).fill('engineer'),
    ...Array<Role>(saboteur).fill('saboteur'),
  ];
}

/** Possible totals for the whole table, including the viewing player. */
export function possibleRoleCounts(
  numPlayers: number,
  ownRole?: Role,
): Array<{ engineer: number; saboteur: number }> {
  const pool = stationRolePool(numPlayers);
  if (pool.length === 0) return [];
  const engineers = pool.filter((role) => role === 'engineer').length;
  const saboteurs = pool.length - engineers;
  const result: Array<{ engineer: number; saboteur: number }> = [];
  for (let engineer = Math.max(0, numPlayers - saboteurs); engineer <= Math.min(engineers, numPlayers); engineer += 1) {
    const saboteur = numPlayers - engineer;
    if (ownRole === 'engineer' && engineer === 0) continue;
    if (ownRole === 'saboteur' && saboteur === 0) continue;
    result.push({ engineer, saboteur });
  }
  return result;
}

/** Legacy snapshots retain compact remaining-card positions; do not invent slots. */
export function getCardSlots(
  G: Pick<StationState, 'rulesVersion' | 'players' | 'publicCards'>,
  playerID: string,
): Array<{ slot: number; kind: CardKind | null }> {
  if (!Object.prototype.hasOwnProperty.call(G.players, playerID)) return [];
  if (G.rulesVersion === 2 || G.rulesVersion === 3) {
    const cards = G.publicCards?.[playerID];
    return cards ? cards.map((kind, slot) => ({ slot, kind })) : [];
  }
  return Array.from({ length: G.players[playerID].cardCount }, (_, slot) => ({ slot, kind: null }));
}
