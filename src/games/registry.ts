import type { Game } from 'boardgame.io';
import { StationGame, stationObserverView, type StationState } from './station/game';
import { CipherGame, cipherObserverView, type CipherState } from './cipher/game';
import { FogGame, fogObserverView, type FogState } from './fog/game';
import { normalizeFogOptions, validateFogOptions } from './fog/rules';
import { MoonGame, moonObserverView, advanceMoonClock, type MoonState } from './moon/game';
import { MOON_PRESETS, normalizeMoonOptions, validateMoonOptions } from './moon/rules';
import { TuringGame, isTuringSharedTable, turingObserverView, type TuringState } from './turing/game';
import { normalizeTuringOptions, validateTuringOptions } from './turing/rules';
import { gameCatalog, type GameID } from './catalog';
import { MailGame, mailObserverView, type MailState } from './post/game';
import { normalizeMailOptions, validateMailOptions } from './post/rules';
import { BakerGame, bakerObserverView, type BakerState } from './baker/game';
import { normalizeBakerOptions, validateBakerOptions } from './baker/rules';

export type ObserverPerspective = 'blind' | 'god';
export interface GameOutcome {
  winner: string;
  reason: string;
  roles: Record<string, string>;
  challenge?: { mode: string; completedRounds: number; startingLives: number };
  /** Individual competition summaries never aggregate a person's name or seat as a faction. */
  competition?: { mode: string; rounds: number };
}

/** A registered game has an isolated rules module and a matching client renderer. */
export interface GameDefinition {
  id: GameID;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  game: Game<any>;
  isJoinable: (state: any) => boolean;
  /** Passed by the authorized HTTP start flow, never accepted directly from spectators. */
  startSetupData: (participantIDs: string[], options?: Record<string, unknown>) => Record<string, unknown>;
  /** Public lobby options. Secrets and deployment settings never belong here. */
  normalizeOptions?: (options: unknown) => Record<string, unknown>;
  /** Validate a preset before its participants have all joined the waiting room. */
  validateLobbyOptions?: (options: Record<string, unknown> | undefined) => string | undefined;
  validateOptions?: (options: Record<string, unknown> | undefined, numPlayers: number, participantIDs?: string[]) => string | undefined;
  /** The caller must authorize this perspective before returning the projection. */
  observerView: (state: any, perspective: ObserverPerspective) => unknown;
  getOutcome: (state: any) => GameOutcome | null;
  /** Keep the completed live table visible before the room returns to its lobby. */
  completedDisplayMs?: (state: any) => number;
  /** Server-only, serialized with moves. Advances at most one expired stage. */
  advanceClock?: (state: any, now: number) => boolean;
  /** Omit protocol move names, actors and counters when even an action reveals a role. */
  hideMoveMetadata?: boolean;
}

export const gameDefinitions: GameDefinition[] = [{
  id: 'space-station', ...gameCatalog['space-station'], game: StationGame,
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
  id: 'encrypted-call', ...gameCatalog['encrypted-call'], game: CipherGame,
  isJoinable: (state) => state.status === 'lobby',
  startSetupData: (participantIDs) => ({ startImmediately: true, participantIDs }),
  observerView: cipherObserverView,
  getOutcome: (state: CipherState) => {
    if (state.status !== 'finished' || !state.winner || !state.winReason) return null;
    return { winner: state.winner, reason: state.winReason,
      roles: Object.fromEntries(Object.keys(state.players).map(id => [id, 'agents'])) };
  },
}, {
  id: 'black-fog', ...gameCatalog['black-fog'], game: FogGame,
  isJoinable: state => state.status === 'lobby',
  normalizeOptions: options => ({ ...normalizeFogOptions(options) }),
  validateOptions: (options, count) => validateFogOptions(normalizeFogOptions(options), count),
  startSetupData: (participantIDs, options) => ({ startImmediately: true, participantIDs, options: normalizeFogOptions(options) }),
  observerView: fogObserverView,
  completedDisplayMs: () => 8000,
  getOutcome: (state: FogState) => {
    if (state.status !== 'finished' || !state.winner || !state.winReason) return null;
    return { winner: state.winner, reason: state.winReason,
      roles: Object.fromEntries(Object.entries(state.players).map(([id, player]) => [id, player.revealedFaction!])) };
  },
}, {
  id: 'silver-moon', ...gameCatalog['silver-moon'], game: MoonGame,
  isJoinable: state => state.status === 'lobby',
  normalizeOptions: options => ({ ...normalizeMoonOptions(options) }),
  validateLobbyOptions: options => {
    const normalized = normalizeMoonOptions(options);
    const count = MOON_PRESETS.find(preset => preset.id === normalized.presetId)?.count ?? gameCatalog['silver-moon'].maxPlayers;
    return validateMoonOptions(normalized, count);
  },
  validateOptions: (options, count) => validateMoonOptions(normalizeMoonOptions(options), count),
  startSetupData: (participantIDs, options) => ({ startImmediately: true, participantIDs, options: normalizeMoonOptions(options) }),
  observerView: moonObserverView,
  advanceClock: advanceMoonClock,
  hideMoveMetadata: true,
  completedDisplayMs: () => 8000,
  getOutcome: (state: MoonState) => {
    if (state.status !== 'finished' || !state.winner || !state.winReason) return null;
    return { winner: state.winner, reason: state.winReason,
      roles: Object.fromEntries(Object.entries(state.players).map(([id, player]) => [id, player.revealedFaction!])) };
  },
}, {
  id: 'turing-test', ...gameCatalog['turing-test'], game: TuringGame,
  isJoinable: state => state.status === 'lobby',
  normalizeOptions: options => ({ ...normalizeTuringOptions(options) }),
  validateLobbyOptions: options => validateTuringOptions(options),
  validateOptions: (options, count) => validateTuringOptions(options, count),
  startSetupData: (participantIDs, options) => ({ startImmediately: true, participantIDs, options: normalizeTuringOptions(options) }),
  observerView: turingObserverView,
  hideMoveMetadata: true,
  completedDisplayMs: () => 8000,
  getOutcome: (state: TuringState) => {
    if (state.status !== 'finished' || !state.winner || !state.winReason) return null;
    return { winner: state.winner, reason: state.winReason,
      ...(state.rulesVersion >= 2 && state.options.mode === 'endless' ? { challenge: {
        mode: isTuringSharedTable(state) ? 'endless-table' : 'endless', completedRounds: state.completedRounds ?? 0, startingLives: state.maxIntegrity,
      } } : {}),
      roles: Object.fromEntries(Object.keys(state.players).map(id => [id, 'humans'])) };
  },
}, {
  id: 'midnight-post', ...gameCatalog['midnight-post'], game: MailGame,
  isJoinable: state => state.status === 'lobby',
  normalizeOptions: options => ({ ...normalizeMailOptions(options) }),
  validateLobbyOptions: options => validateMailOptions(options),
  validateOptions: (options, count, participants) => validateMailOptions(options, count, participants),
  startSetupData: (participantIDs, options) => ({ startImmediately: true, participantIDs, options: normalizeMailOptions(options) }),
  observerView: mailObserverView,
  hideMoveMetadata: true,
  completedDisplayMs: () => 8000,
  getOutcome: (state: MailState) => {
    if (state.status !== 'finished' || !state.winner || !state.winReason) return null;
    return { winner: state.winner, reason: state.winReason,
      ...(state.mode !== 'black-letter' ? { competition: { mode: state.mode, rounds: state.round } } : {}),
      roles: Object.fromEntries(Object.keys(state.players).map(id => [id,
        state.mode === 'black-letter' && state.directorID === id ? 'director' : 'couriers'])) };
  },
}];

gameDefinitions.push({
  id: 'baker-street', ...gameCatalog['baker-street'], game: BakerGame,
  isJoinable: state => state.status === 'lobby',
  normalizeOptions: options => ({ ...normalizeBakerOptions(options) }),
  validateLobbyOptions: options => validateBakerOptions(options),
  validateOptions: (options, count, participants) => validateBakerOptions(options, count, participants),
  startSetupData: (participantIDs, options) => ({ startImmediately: true, participantIDs, options: normalizeBakerOptions(options) }),
  observerView: bakerObserverView, hideMoveMetadata: true, completedDisplayMs: () => 8000,
  getOutcome: (state: BakerState) => {
    if (state.status !== 'finished' || !state.winner || !state.winReason) return null;
    return { winner: state.winner, reason: state.winReason,
      roles: Object.fromEntries(Object.entries(state.players).map(([id, player]) => [id, player.revealedFaction!])) };
  },
});

export const getGameDefinition = (id: string) => gameDefinitions.find((game) => game.id === id);
export const publicGameDefinitions = () => gameDefinitions.map(({ id, name, description, minPlayers, maxPlayers }) => ({ id, name, description, minPlayers, maxPlayers }));
