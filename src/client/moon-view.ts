import type { MoonFaction, MoonState } from '../games/moon/game';

/** Derive labels only from this viewer's authorized information, never by
 * eliminating unlisted players or reading another player's private record. */
export function moonKnownFactions(G: MoonState, ownID?: string, concealed = false, omniscient = false): Record<string, MoonFaction> {
  if (concealed) return {};
  const known: Record<string, MoonFaction> = {};
  const mark = (id: string, faction: MoonFaction | undefined) => {
    if (G.players[id] && (faction === 'town' || faction === 'wolves')) known[id] = faction;
  };
  if (omniscient) {
    for (const [id, secret] of Object.entries(G.private ?? {})) mark(id, secret.faction);
  } else if (ownID && G.private?.[ownID]) {
    const secret = G.private[ownID];
    mark(ownID, secret.faction);
    for (const id of secret.knownWolves) mark(id, 'wolves');
    for (const check of secret.checks) mark(check.targetID, check.isWolf ? 'wolves' : 'town');
  }
  for (const [id, player] of Object.entries(G.players)) mark(id, player.revealedFaction);
  return known;
}

export interface MoonPatrol { taps: number; active: number }
/** A correct stamp advances to one of the other tickets. Incorrect clicks do
 * not count or move the light; this state never leaves the browser. */
export function stampMoonTicket(current: MoonPatrol, clicked: number, count: number, roll: number): MoonPatrol {
  if (clicked !== current.active || count < 2) return current;
  const offset = 1 + Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, roll)) * (count - 1));
  return { taps: current.taps + 1, active: (current.active + offset) % count };
}
