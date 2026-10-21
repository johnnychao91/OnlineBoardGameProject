import type { FogFaction, FogState } from '../games/fog/game';
import { FOG_FACTIONS } from '../games/fog/rules';

export interface FogRosterMark {
  kind: FogFaction | 'initial-apostles' | 'candidate';
  label: string;
}

/** Only the viewer's granted information may identify an ordinary player's peers.
 * Initial evil knowledge cannot identify which person is the changing Lancelot. */
export function fogRosterMarks(G: FogState, viewerID: string | undefined, visible: boolean, godView = false): Record<string, FogRosterMark> {
  if (!visible) return {};
  const result: Record<string, FogRosterMark> = {};
  const own = viewerID ? G.private?.[viewerID] : undefined;
  const switched = G.options.lancelotMode !== 'off' && G.bellHistory.filter(event => event.card === 'switch').length % 2 === 1;
  for (const id of Object.keys(G.players)) {
    const publicFaction = G.status === 'finished' ? G.players[id].revealedFaction : undefined;
    const faction = publicFaction ?? (godView ? G.private?.[id]?.faction : id === viewerID ? own?.faction : undefined);
    if (faction) { result[id] = { kind: faction, label: FOG_FACTIONS[faction] }; continue; }
    if (own?.knownEvil.includes(id)) {
      result[id] = switched ? { kind: 'initial-apostles', label: '開局黑霧使徒・現效忠未明' }
        : { kind: 'apostles', label: FOG_FACTIONS.apostles };
    } else if (own?.merlinCandidates.includes(id)) {
      result[id] = own.merlinCandidates.length === 1 && !G.options.morgana
        ? { kind: 'knights', label: FOG_FACTIONS.knights }
        : { kind: 'candidate', label: '梅林候選・陣營未明' };
    }
  }
  return result;
}
