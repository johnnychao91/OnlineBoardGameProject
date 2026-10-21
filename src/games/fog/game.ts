import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import {
  FOG_ROLES, fogRoleDeck, fogTeamSizes, normalizeFogOptions, validateFogOptions,
  type FogFaction, type FogOptions, type FogRole,
} from './rules';

export type { FogFaction, FogOptions, FogRole } from './rules';
export type FogStatus = 'lobby' | 'briefing' | 'nomination' | 'voting' | 'vote-review'
  | 'quest' | 'quest-review' | 'assassination' | 'finished';
export type FogQuestCard = 'success' | 'fail';
export type FogBellCard = 'quiet' | 'switch';
export type FogWinReason = 'three-fails' | 'five-rejections' | 'merlin-found' | 'merlin-safe';
export interface FogSetupData {
  startImmediately?: boolean;
  participantIDs?: string[];
  options?: FogOptions;
}
export interface FogPlayer {
  ready: boolean;
  acknowledged: boolean;
  voteSubmitted: boolean;
  questSubmitted: boolean;
  revealedRole?: FogRole;
  revealedFaction?: FogFaction;
}
export interface FogPrivateInfo {
  role: FogRole;
  faction: FogFaction;
  /** Initial night information, never recomputed after an allegiance change. */
  knownEvil: string[];
  merlinCandidates: string[];
  ownVote: boolean | null;
  ownQuestCard: FogQuestCard | null;
}
export interface FogVoteResult {
  quest: number;
  leaderID: string;
  team: string[];
  votes: Record<string, boolean>;
  approved: boolean;
}
export interface FogQuestResult {
  quest: number;
  team: string[];
  successes: number;
  fails: number;
  succeeded: boolean;
}
export interface FogLogEntry {
  type: 'start' | 'bell' | 'team' | 'vote' | 'quest' | 'assassination' | 'finish';
  quest: number;
  actorID?: string;
  team?: string[];
  approved?: boolean;
  votes?: Record<string, boolean>;
  successes?: number;
  fails?: number;
  succeeded?: boolean;
  card?: FogBellCard;
  targetID?: string;
  winner?: FogFaction;
  reason?: FogWinReason;
}
export interface FogState {
  rulesVersion: 1;
  status: FogStatus;
  options: FogOptions;
  players: Record<string, FogPlayer>;
  private: Record<string, FogPrivateInfo>;
  quest: number;
  epoch: number;
  leaderID: string | null;
  team: string[];
  rejections: number;
  lastVote: FogVoteResult | null;
  questResults: FogQuestResult[];
  bellHistory: { quest: number; card: FogBellCard }[];
  bellForecast: FogBellCard[];
  assassinationTarget: string | null;
  winner: FogFaction | null;
  winReason: FogWinReason | null;
  log: FogLogEntry[];
  /** Never transmitted, even to an omniscient spectator. */
  secret?: {
    bellDeck: FogBellCard[];
    votes: Record<string, boolean>;
    questCards: Record<string, FogQuestCard>;
  };
}

type MoveContext = FnContext<FogState> & { playerID: string };
type RandomAPI = FnContext<FogState>['random'];

function isSeat(G: FogState, playerID: unknown): playerID is string {
  return typeof playerID === 'string' && Object.hasOwn(G.players, playerID);
}
function validToken(G: FogState, playerID: unknown, epoch: unknown): playerID is string {
  return isSeat(G, playerID) && Number.isInteger(epoch) && epoch === G.epoch;
}
function transition(G: FogState, status: FogStatus): void {
  G.status = status;
  G.epoch += 1;
  for (const player of Object.values(G.players)) player.acknowledged = false;
}
function nextLeader(G: FogState): void {
  const ids = Object.keys(G.players);
  G.leaderID = ids[(ids.indexOf(G.leaderID!) + 1) % ids.length];
}
function finish(G: FogState, winner: FogFaction, reason: FogWinReason): void {
  G.winner = winner;
  G.winReason = reason;
  transition(G, 'finished');
  for (const id of Object.keys(G.players)) {
    G.players[id].revealedRole = G.private[id].role;
    G.players[id].revealedFaction = G.private[id].faction;
  }
  G.log.push({ type: 'finish', quest: G.quest, winner, reason });
}

/** Role knowledge describes the initial reveal, not the current team after bells. */
function initialKnowledge(roles: Record<string, FogRole>, id: string): Pick<FogPrivateInfo, 'knownEvil' | 'merlinCandidates'> {
  const role = roles[id];
  let knownEvil: string[] = [];
  if (role === 'merlin') {
    knownEvil = Object.keys(roles).filter((other) => FOG_ROLES[roles[other]].faction === 'apostles' && roles[other] !== 'mordred');
  } else if (FOG_ROLES[role].faction === 'apostles' && role !== 'oberon' && role !== 'evil-lancelot') {
    knownEvil = Object.keys(roles).filter((other) => other !== id && FOG_ROLES[roles[other]].faction === 'apostles' && roles[other] !== 'oberon');
  }
  return {
    knownEvil,
    merlinCandidates: role === 'percival'
      ? Object.keys(roles).filter((other) => roles[other] === 'merlin' || roles[other] === 'morgana') : [],
  };
}

function beginGame(G: FogState, random: RandomAPI): void {
  const ids = Object.keys(G.players);
  const deck = random.Shuffle(fogRoleDeck(ids.length, G.options));
  const roles = Object.fromEntries(ids.map((id, index) => [id, deck[index]]));
  for (const id of ids) {
    G.private[id] = {
      role: roles[id], faction: FOG_ROLES[roles[id]].faction,
      ...initialKnowledge(roles, id), ownVote: null, ownQuestCard: null,
    };
  }
  G.leaderID = random.Shuffle(ids)[0];
  G.quest = 1;
  const quietCount = G.options.lancelotMode === 'random' ? 4 : 5;
  const bells: FogBellCard[] = [...Array<FogBellCard>(quietCount).fill('quiet'), 'switch', 'switch'];
  G.secret = { bellDeck: [], votes: {}, questCards: {} };
  if (G.options.lancelotMode === 'random') G.secret.bellDeck = random.Shuffle(bells);
  if (G.options.lancelotMode === 'forecast') G.bellForecast = random.Shuffle(bells).slice(0, 5);
  G.log.push({ type: 'start', quest: 1, actorID: G.leaderID });
  transition(G, 'briefing');
}

function beginQuest(G: FogState): void {
  G.team = [];
  G.lastVote = null;
  G.rejections = 0;
  if (G.options.lancelotMode !== 'off') {
    const card = G.options.lancelotMode === 'random'
      ? G.secret!.bellDeck.shift()! : G.bellForecast[G.quest - 1];
    if (card === 'switch') {
      for (const info of Object.values(G.private)) {
        if (info.role === 'good-lancelot' || info.role === 'evil-lancelot') {
          info.faction = info.faction === 'knights' ? 'apostles' : 'knights';
        }
      }
    }
    G.bellHistory.push({ quest: G.quest, card });
    G.log.push({ type: 'bell', quest: G.quest, card });
  }
  transition(G, 'nomination');
}

function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== Object.keys(G.players)[0]
    || !Object.values(G.players).every((player) => player.ready)) return INVALID_MOVE;
  beginGame(G, random);
}

function acknowledge({ G, playerID }: MoveContext, epoch: unknown) {
  if (!['briefing', 'vote-review', 'quest-review'].includes(G.status)
    || !validToken(G, playerID, epoch) || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.players[playerID].acknowledged = true;
  if (!Object.values(G.players).every((player) => player.acknowledged)) return;
  if (G.status === 'briefing') { beginQuest(G); return; }
  if (G.status === 'vote-review') {
    if (G.lastVote!.approved) {
      G.secret!.questCards = {};
      for (const id of Object.keys(G.players)) {
        G.players[id].questSubmitted = false;
        G.private[id].ownQuestCard = null;
      }
      transition(G, 'quest');
    } else if (G.rejections >= 5) {
      finish(G, 'apostles', 'five-rejections');
    } else {
      nextLeader(G);
      G.team = [];
      transition(G, 'nomination');
    }
    return;
  }
  if (G.questResults.filter((quest) => !quest.succeeded).length >= 3) {
    finish(G, 'apostles', 'three-fails');
  } else if (G.questResults.filter((quest) => quest.succeeded).length >= 3) {
    transition(G, 'assassination');
  } else {
    G.quest += 1;
    nextLeader(G);
    beginQuest(G);
  }
}

function selectTeam({ G, playerID }: MoveContext, ids: unknown, epoch: unknown) {
  if (G.status !== 'nomination' || !validToken(G, playerID, epoch) || playerID !== G.leaderID
    || !Array.isArray(ids) || ids.some((id) => !isSeat(G, id)) || new Set(ids).size !== ids.length
    || ids.length > fogTeamSizes(Object.keys(G.players).length)[G.quest - 1]) return INVALID_MOVE;
  G.team = [...ids];
}
function confirmTeam({ G, playerID }: MoveContext, epoch: unknown) {
  if (G.status !== 'nomination' || !validToken(G, playerID, epoch) || playerID !== G.leaderID
    || G.team.length !== fogTeamSizes(Object.keys(G.players).length)[G.quest - 1]) return INVALID_MOVE;
  G.secret!.votes = {};
  for (const id of Object.keys(G.players)) { G.players[id].voteSubmitted = false; G.private[id].ownVote = null; }
  G.log.push({ type: 'team', quest: G.quest, actorID: playerID, team: [...G.team] });
  transition(G, 'voting');
}
function vote({ G, playerID }: MoveContext, approve: unknown, epoch: unknown) {
  if (G.status !== 'voting' || !validToken(G, playerID, epoch) || typeof approve !== 'boolean'
    || G.players[playerID].voteSubmitted) return INVALID_MOVE;
  G.secret!.votes[playerID] = approve;
  G.private[playerID].ownVote = approve;
  G.players[playerID].voteSubmitted = true;
  if (!Object.values(G.players).every((player) => player.voteSubmitted)) return;
  const approved = Object.values(G.secret!.votes).filter(Boolean).length > Object.keys(G.players).length / 2;
  G.lastVote = { quest: G.quest, leaderID: G.leaderID!, team: [...G.team], votes: { ...G.secret!.votes }, approved };
  G.log.push({ type: 'vote', quest: G.quest, actorID: G.leaderID!, team: [...G.team], votes: { ...G.secret!.votes }, approved });
  G.rejections = approved ? 0 : G.rejections + 1;
  G.secret!.votes = {};
  transition(G, 'vote-review');
}

export function fogAllowedQuestCards(info: FogPrivateInfo, options: FogOptions): FogQuestCard[] {
  if (info.faction === 'knights') return ['success'];
  if (options.lancelotMode === 'forecast' && (info.role === 'good-lancelot' || info.role === 'evil-lancelot')) return ['fail'];
  return ['success', 'fail'];
}

function submitQuest({ G, playerID }: MoveContext, card: unknown, epoch: unknown) {
  if (G.status !== 'quest' || !validToken(G, playerID, epoch) || !G.team.includes(playerID)
    || G.players[playerID].questSubmitted || (card !== 'success' && card !== 'fail')
    || !fogAllowedQuestCards(G.private[playerID], G.options).includes(card)) return INVALID_MOVE;
  G.secret!.questCards[playerID] = card;
  G.private[playerID].ownQuestCard = card;
  G.players[playerID].questSubmitted = true;
  if (!G.team.every((id) => G.players[id].questSubmitted)) return;
  const fails = Object.values(G.secret!.questCards).filter((value) => value === 'fail').length;
  const requiredFails = G.quest === 4 && Object.keys(G.players).length >= 7 ? 2 : 1;
  const result: FogQuestResult = {
    quest: G.quest, team: [...G.team], successes: G.team.length - fails, fails, succeeded: fails < requiredFails,
  };
  G.questResults.push(result);
  G.log.push({ type: 'quest', ...result });
  // Store only the anonymous tally once resolved, including in replay snapshots.
  G.secret!.questCards = {};
  for (const info of Object.values(G.private)) info.ownQuestCard = null;
  transition(G, 'quest-review');
}

function assassinate({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  if (G.status !== 'assassination' || !validToken(G, playerID, epoch) || G.private[playerID].role !== 'assassin'
    || !isSeat(G, targetID) || targetID === playerID) return INVALID_MOVE;
  G.assassinationTarget = targetID;
  G.log.push({ type: 'assassination', quest: G.quest, actorID: playerID, targetID });
  const found = G.private[targetID].role === 'merlin';
  finish(G, found ? 'apostles' : 'knights', found ? 'merlin-found' : 'merlin-safe');
}

function copyPrivate(info: FogPrivateInfo): FogPrivateInfo {
  return {
    role: info.role, faction: info.faction, knownEvil: [...info.knownEvil], merlinCandidates: [...info.merlinCandidates],
    ownVote: info.ownVote, ownQuestCard: info.ownQuestCard,
  };
}
/** Use a whitelist so future internal fields cannot silently leak to clients. */
export function fogPlayerView({ G, playerID }: { G: FogState; playerID: string | null }): FogState {
  const privateInfo = isSeat(G, playerID) ? G.private[playerID] : undefined;
  return {
    rulesVersion: 1, status: G.status, options: normalizeFogOptions(G.options),
    players: Object.fromEntries(Object.entries(G.players).map(([id, player]) => [id, {
      ready: player.ready, acknowledged: player.acknowledged, voteSubmitted: player.voteSubmitted, questSubmitted: player.questSubmitted,
      ...(player.revealedRole === undefined ? {} : { revealedRole: player.revealedRole }),
      ...(player.revealedFaction === undefined ? {} : { revealedFaction: player.revealedFaction }),
    }])),
    private: privateInfo && playerID !== null ? { [playerID]: copyPrivate(privateInfo) } : {},
    quest: G.quest, epoch: G.epoch, leaderID: G.leaderID, team: [...G.team], rejections: G.rejections,
    lastVote: G.lastVote ? {
      quest: G.lastVote.quest, leaderID: G.lastVote.leaderID, team: [...G.lastVote.team], votes: { ...G.lastVote.votes }, approved: G.lastVote.approved,
    } : null,
    questResults: G.questResults.map(({ quest, team, successes, fails, succeeded }) => ({ quest, team: [...team], successes, fails, succeeded })),
    bellHistory: G.bellHistory.map(({ quest, card }) => ({ quest, card })), bellForecast: [...G.bellForecast],
    assassinationTarget: G.assassinationTarget, winner: G.winner, winReason: G.winReason,
    log: G.log.map((entry) => ({
      type: entry.type, quest: entry.quest,
      ...(entry.actorID === undefined ? {} : { actorID: entry.actorID }),
      ...(entry.team === undefined ? {} : { team: [...entry.team] }),
      ...(entry.approved === undefined ? {} : { approved: entry.approved }),
      ...(entry.votes === undefined ? {} : { votes: { ...entry.votes } }),
      ...(entry.successes === undefined ? {} : { successes: entry.successes }),
      ...(entry.fails === undefined ? {} : { fails: entry.fails }),
      ...(entry.succeeded === undefined ? {} : { succeeded: entry.succeeded }),
      ...(entry.card === undefined ? {} : { card: entry.card }),
      ...(entry.targetID === undefined ? {} : { targetID: entry.targetID }),
      ...(entry.winner === undefined ? {} : { winner: entry.winner }),
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    })),
  };
}
export function fogObserverView(G: FogState, perspective: 'blind' | 'god'): FogState {
  const view = fogPlayerView({ G, playerID: null });
  if (perspective === 'god') {
    for (const id of Object.keys(G.players)) if (G.private[id]) view.private[id] = copyPrivate(G.private[id]);
  }
  return view;
}

const simultaneousMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const FogGame: Game<FogState, Record<string, unknown>, FogSetupData> = {
  name: 'black-fog', minPlayers: 5, maxPlayers: 10,
  validateSetupData: (data, numPlayers) => {
    if (!Number.isInteger(numPlayers) || numPlayers < 5 || numPlayers > 10) return '黑霧襲城需要 5～10 位玩家。';
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data)
      || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '遊戲開始設定不正確。';
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs)
      || data.participantIDs.length !== numPlayers
      || data.participantIDs.some((id: unknown) => !isPlayerSeatID(id))
      || new Set(data.participantIDs).size !== numPlayers)) return '參與玩家席位不正確。';
    try { return validateFogOptions(normalizeFogOptions(data?.options), numPlayers); }
    catch (error) { return (error as Error).message; }
  },
  setup: ({ ctx, random }, data) => {
    const options = normalizeFogOptions(data?.options);
    const error = validateFogOptions(options, ctx.numPlayers);
    if (error) throw new Error(error);
    const ids = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, index) => String(index));
    const G: FogState = {
      rulesVersion: 1, status: 'lobby', options,
      players: Object.fromEntries(ids.map((id) => [id, {
        ready: data?.startImmediately === true, acknowledged: false, voteSubmitted: false, questSubmitted: false,
      }])),
      private: {}, quest: 0, epoch: 0, leaderID: null, team: [], rejections: 0,
      lastVote: null, questResults: [], bellHistory: [], bellForecast: [], assassinationTarget: null,
      winner: null, winReason: null, log: [],
    };
    if (data?.startImmediately) beginGame(G, random);
    return G;
  },
  turn: {
    order: {
      first: () => 0,
      next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length,
      playOrder: ({ G }) => Object.keys(G.players),
    },
    activePlayers: ActivePlayers.ALL,
  },
  moves: {
    setReady: { move: setReady, client: false, undoable: false, redact: true },
    startGame: { move: startGame, client: false, undoable: false, redact: true },
    acknowledge: { move: acknowledge, ...simultaneousMove },
    selectTeam: { move: selectTeam, ...simultaneousMove },
    confirmTeam: { move: confirmTeam, ...simultaneousMove },
    vote: { move: vote, ...simultaneousMove },
    submitQuest: { move: submitQuest, ...simultaneousMove },
    assassinate: { move: assassinate, ...simultaneousMove },
  },
  disableUndo: true,
  plugins: [{
    name: 'fog-flow-guard', setup: () => ({}),
    isInvalid: ({ G, ctx }) => {
      if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason
        ? false : 'Game completion must follow the fog rules.';
      if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== Object.keys(G.players)[0]
        || ctx.phase !== null || !ctx.activePlayers
        || Object.keys(ctx.activePlayers).length !== Object.keys(G.players).length
        || Object.keys(G.players).some((id) => ctx.activePlayers![id] !== null)
        || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
        || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for this game.';
      return false;
    },
  }],
  events: {
    endGame: false, endPhase: false, endTurn: false, setPhase: false,
    endStage: false, setStage: false, pass: false, setActivePlayers: false,
  },
  playerView: fogPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
