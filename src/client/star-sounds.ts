import type { StarState } from '../games/star/types';
import type { SoundCueState } from './sound-cues';
/** Reservation contents and future designs never influence sound identities. */
export function starSoundAdapter(G: StarState, playerID?: string): SoundCueState | undefined {
  if (!G || !Array.isArray(G.log)) return undefined;
  const own = playerID ? G.players[playerID] : undefined;
  const waiting = own && G.status === 'briefing' && !own.acknowledged;
  const active = own && G.activePlayer === playerID && ['turn', 'return-tokens', 'choose-guardian'].includes(G.status);
  return { revision: G.epoch, events: G.log.map((event, index) => `${index}:${event.type}`), attention: waiting ? `acknowledge:${G.phaseEpoch}:${playerID}` : active ? `${G.status}:${G.epoch}:${playerID}` : undefined };
}
