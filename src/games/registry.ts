import type { Game } from 'boardgame.io';
import { StationGame, stationObserverView, type StationState } from './station/game';
import { CipherGame, cipherObserverView, type CipherState } from './cipher/game';

export type ObserverPerspective = 'blind' | 'god';
export interface GameOutcome {
  winner: string;
  reason: string;
  roles: Record<string, string>;
}

/** A registered game has an isolated rules module and a matching client renderer. */
export interface GameDefinition {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  game: Game<any>;
  isJoinable: (state: any) => boolean;
  /** Passed by the authorized HTTP start flow, never accepted directly from spectators. */
  startSetupData: (participantIDs: string[]) => Record<string, unknown>;
  /** The caller must authorize this perspective before returning the projection. */
  observerView: (state: any, perspective: ObserverPerspective) => unknown;
  getOutcome: (state: any) => GameOutcome | null;
  /** Keep the completed live table visible before the room returns to its lobby. */
  completedDisplayMs?: (state: any) => number;
}

export const gameDefinitions: GameDefinition[] = [{
  id: 'space-station', name: '太空維修站',
  description: '在未知與信任之間，讓太空站恢復運作。',
  minPlayers: 4, maxPlayers: 8, game: StationGame,
  isJoinable: (state) => state.status === 'lobby',
  startSetupData: (participantIDs) => ({ startImmediately: true, participantIDs }),
  observerView: stationObserverView,
  completedDisplayMs: (state: StationState) => state.rulesVersion === 3 ? 8000 : 0,
  getOutcome: (state: StationState) => {
    if (state.status !== 'finished' || !state.winner || !state.winReason) return null;
    const roles: Record<string, string> = {};
    for (const [id, player] of Object.entries(state.players)) {
      const role = player.revealedRole ?? state.private[id]?.role;
      if (!role) return null;
      roles[id] = role;
    }
    return { winner: state.winner, reason: state.winReason, roles };
  },
}, {
  id: 'encrypted-call', name: '加密通話',
  description: '潛伏諜報戰線，以沉默與默契完成遞增的訊號傳送。',
  minPlayers: 2, maxPlayers: 4, game: CipherGame,
  isJoinable: (state) => state.status === 'lobby',
  startSetupData: (participantIDs) => ({ startImmediately: true, participantIDs }),
  observerView: cipherObserverView,
  getOutcome: (state: CipherState) => {
    if (state.status !== 'finished' || !state.winner || !state.winReason) return null;
    return { winner: state.winner, reason: state.winReason,
      roles: Object.fromEntries(Object.keys(state.players).map(id => [id, 'agents'])) };
  },
}];

export const getGameDefinition = (id: string) => gameDefinitions.find((game) => game.id === id);
export const publicGameDefinitions = () => gameDefinitions.map(({ id, name, description, minPlayers, maxPlayers }) => ({ id, name, description, minPlayers, maxPlayers }));
