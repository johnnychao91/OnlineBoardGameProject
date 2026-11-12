import type { StationState } from '../games/station/game';
import type { CipherState } from '../games/cipher/game';
import type { Perspective } from './api';

/** Defense in depth when a cached god-view payload survives a perspective change. */
export function stationSnapshotState(G: StationState, perspective: Perspective): StationState {
  if (perspective === 'god') return G;
  const { private: _private, secret: _secret, ...publicState } = G;
  const revealedChief = G.log.find(entry => entry.savior)?.actorID;
  return { ...publicState, private: {}, players: Object.fromEntries(Object.entries(G.players).map(([id, player]) => {
    const { revealedRole, ...publicPlayer } = player;
    return [id, G.status === 'finished' ? { ...publicPlayer, revealedRole }
      : id === revealedChief ? { ...publicPlayer, revealedRole: 'chief-engineer' } : publicPlayer];
  })) };
}

export function cipherSnapshotState(G: CipherState, perspective: Perspective): CipherState {
  return perspective === 'god' ? G : { ...G, private: {} };
}
