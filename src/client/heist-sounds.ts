import type { HeistState } from '../games/heist/game';
import type { SoundCueState } from './sound-cues';

/** The pending choice and the vault never influence audio. */
export function heistSoundAdapter(G: HeistState, playerID?: string): SoundCueState | undefined {
  if (!G || !Array.isArray(G.log)) return undefined;
  let attention: string | undefined;
  const player = playerID ? G.players[playerID] : undefined;
  if (player) {
    if ((G.status === 'briefing' || G.status === 'review') && !player.acknowledged) attention = `acknowledge:${G.phaseEpoch}:${playerID}`;
    if (G.status === 'decision' && player.exploring && !player.submitted) attention = `decision:${G.phaseEpoch}:${playerID}`;
  }
  return { revision: G.epoch, events: G.log.map((event, index) => `${index}:${event.type}`), attention };
}
