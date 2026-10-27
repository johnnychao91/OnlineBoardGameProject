import type { StarBonuses, StarTier, StarTokenCounts } from './content';
import type { StarOptions } from './rules';
export type StarStatus = 'lobby' | 'briefing' | 'turn' | 'return-tokens' | 'choose-guardian' | 'finished';
export interface StarReservation { id: string; tier: StarTier; knownCardID: string | null }
export interface StarPrivate { reserved: { id: string; cardID: string }[] }
export interface StarPlayer { ready: boolean; acknowledged: boolean; tokens: StarTokenCounts; bonuses: StarBonuses; purchased: string[]; guardians: string[]; prestige: number; reserved: StarReservation[] }
export interface StarPending { playerID: string; returnCount: number; guardianIDs: string[]; forcedPass?: boolean }
export interface StarLogEntry { type: 'start' | 'take' | 'reserve' | 'purchase' | 'return' | 'guardian' | 'forced-pass' | 'final-round' | 'finish'; round: number; epoch: number; message: string; actor?: string; tokens?: StarTokenCounts; payment?: StarTokenCounts; cardID?: string; tier?: StarTier; reservationID?: string; guardianID?: string }
export interface StarSecret { decks: Record<StarTier, string[]>; unusedGuardians: string[] }
export interface StarState {
  rulesVersion: 1; status: StarStatus; options: StarOptions; epoch: number; phaseEpoch: number;
  turnOrder: string[]; starter: string; activePlayer: string | null; round: number; turnNumber: number;
  players: Record<string, StarPlayer>; private: Record<string, StarPrivate>; bank: StarTokenCounts;
  market: Record<StarTier, (string | null)[]>; deckCounts: Record<StarTier, number>; guardians: string[];
  pending: StarPending | null; nextReservationID: number; endTriggeredBy: string | null; forcedPasses: string[];
  finalScores: Record<string, number>; winner: 'prestige' | null; winnerIDs: string[]; winReason: 'completed-round' | 'stalemate' | null;
  log: StarLogEntry[]; secret?: StarSecret;
}
export interface StarSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: StarOptions }
export type StarReserveTarget = { kind: 'market'; cardID: string } | { kind: 'deck'; tier: StarTier };
export interface StarAction { move: 'acknowledge' | 'takeTokens' | 'reserveCard' | 'buyCard' | 'returnTokens' | 'chooseGuardian' | 'forcedPass'; args: unknown[] }
