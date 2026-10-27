import type { FirewallActionID, FirewallCard, FirewallGoalPathID, FirewallPathID, FirewallRole, FirewallRotation, FirewallTool } from './content';
import type { FirewallOptions } from './rules';
export type FirewallStatus = 'lobby' | 'briefing' | 'turn' | 'theft' | 'review' | 'finished';
export type FirewallEffect = FirewallTool | 'trapped' | 'theft';
export interface FirewallTile { id: string; x: number; y: number; kind: 'start' | 'path' | 'goal'; revealed: boolean; pathID?: FirewallPathID; rotation?: FirewallRotation }
export interface FirewallPlayer { ready: boolean; acknowledged: boolean; handCount: number; broken: FirewallTool[]; trapped: boolean; theftOrder: number | null; publicRole: FirewallRole | null }
export interface FirewallGoalMemory { round: number; epoch: number; goalID: string; pathID: FirewallGoalPathID }
export interface FirewallRoleMemory { round: number; epoch: number; playerID: string; role: FirewallRole }
export interface FirewallPrivate { role: FirewallRole; hand: FirewallCard[]; gold: number; goalMemory: FirewallGoalMemory[]; roleMemory: FirewallRoleMemory[] }
export interface FirewallActionTarget { playerID?: string; tool?: FirewallTool; goalID?: string; tileID?: string }
export interface FirewallRoundResult { round: number; reason: 'connected' | 'exhausted'; completedBy: string | null; winningColors: ('blue' | 'green')[]; winningIDs: string[]; awards: Record<string, number>; roles: Record<string, FirewallRole>; crystals: number; thefts: { playerID: string; targetID: string; amount: number }[] }
export interface FirewallLogEntry { type: 'round-start' | 'path' | 'action' | 'discard' | 'clear-effect' | 'goal-reveal' | 'round-end' | 'theft' | 'finish'; round: number; epoch: number; message: string; actor?: string; target?: string; card?: FirewallCard; tile?: FirewallTile; action?: FirewallActionID; count?: number; effect?: FirewallEffect; amount?: number }
export interface FirewallSecret { deck: FirewallCard[]; removed: FirewallCard[]; discard: FirewallCard[]; effects: Record<string, Partial<Record<FirewallEffect, FirewallCard>>>; roleDeck: FirewallRole[]; goals: Record<string, FirewallGoalPathID>; theftQueue: string[] }
export interface FirewallState {
  rulesVersion: 1; status: FirewallStatus; options: FirewallOptions; round: number; targetRounds: number;
  epoch: number; phaseEpoch: number; turnNumber: number; turnOrder: string[]; activePlayer: string | null; starter: string; lastActor: string | null;
  players: Record<string, FirewallPlayer>; private: Record<string, FirewallPrivate>; board: FirewallTile[];
  deckCount: number; discardCount: number; roleDeckCount: number; log: FirewallLogEntry[]; roundResult: FirewallRoundResult | null;
  finalScores: Record<string, number>; winner: 'wealth' | null; winnerIDs: string[]; winReason: 'three-rounds' | null;
  secret?: FirewallSecret;
}
export interface FirewallSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: FirewallOptions }
export interface FirewallAction { move: 'acknowledge' | 'placePath' | 'playAction' | 'discard' | 'clearEffect' | 'steal'; args: unknown[] }
export interface FirewallPlacement { x: number; y: number; rotation: FirewallRotation }
