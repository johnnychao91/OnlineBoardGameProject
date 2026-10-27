import type { FirewallState } from '../games/firewall/types';
import type { SoundCueState } from './sound-cues';

/** Audio depends only on public progression and this seat's public turn. */
export function firewallSoundAdapter(G: FirewallState, playerID?: string): SoundCueState | undefined {
  if (!G || !Array.isArray(G.log)) return undefined;
  const own = playerID ? G.players[playerID] : undefined;
  const acknowledge = own && (G.status === 'briefing' || G.status === 'review') && !own.acknowledged;
  const active = own && (G.status === 'turn' || G.status === 'theft') && G.activePlayer === playerID;
  return { revision: G.epoch, events: G.log.map((event, index) => `${index}:${event.type}`),
    attention: acknowledge ? `acknowledge:${G.phaseEpoch}:${playerID}` : active ? `${G.status}:${G.epoch}:${playerID}` : undefined };
}
