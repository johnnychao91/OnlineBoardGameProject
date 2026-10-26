import type { BanquetState } from '../games/banquet/game';
import type { SoundCueState } from './sound-cues';

/** Event identities are public and identical for genuine exchanges and feints. */
export function banquetSoundAdapter(G: BanquetState, playerID?: string): SoundCueState | undefined {
  if (!G || !Array.isArray(G.log)) return undefined;
  let attention: string | undefined;
  if (playerID && G.players[playerID]) {
    if (G.status === 'briefing' && !G.players[playerID].acknowledged) attention = 'briefing';
    if (G.status === 'playing') {
      if (G.pending?.actorID === playerID) attention = `choice:${G.turnNumber}:${G.pending.kind}:${playerID}`;
      else if (!G.pending && G.claim?.responderIDs[G.claim.responseIndex] === playerID) attention = `claim:${G.turnNumber}:${playerID}`;
      else if (!G.pending && !G.claim && G.activePlayer === playerID) attention = `turn:${G.turnNumber}:${playerID}`;
    }
  }
  return { revision: G.epoch, events: G.log.map((event, index) => `${index}:${event.type}`), attention };
}
