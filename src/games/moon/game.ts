import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { MOON_ROLES, moonNightSteps, moonRoleDeck, normalizeMoonOptions, validateMoonOptions, type MoonFaction, type MoonOptions, type MoonRole } from './rules';
export type { MoonFaction, MoonOptions, MoonRole } from './rules';

export type MoonStatus = 'lobby' | 'briefing' | 'night' | 'dawn' | 'speaking' | 'voting' | 'vote-review' | 'hunter' | 'finished'
  | 'sheriff-signup' | 'sheriff-speech' | 'sheriff-voting' | 'sheriff-order' | 'sheriff-transfer';
export type MoonWinReason = 'wolves-eliminated' | 'wolves-dominate';
export type MoonWitchAction = 'save' | 'poison' | 'skip';
export interface MoonPlayer { ready: boolean; acknowledged: boolean; alive: boolean; revealedRole?: MoonRole; revealedFaction?: MoonFaction }
export interface MoonPrivateInfo {
  role: MoonRole;
  faction: MoonFaction;
  knownWolves: string[];
  checks: { day: number; targetID: string; isWolf: boolean }[];
  antidote: boolean;
  poison: boolean;
  previousGuard: string | null;
  nightChoice: string | null;
  nightSubmitted: boolean;
  witchChoice: MoonWitchAction | null;
  wolfVotes: Record<string, string | null>;
  attackedID: string | null;
  ownVote: string | null;
  voteSubmitted: boolean;
}
export interface MoonVoteResult {
  day: number;
  round: 1 | 2;
  votes: Record<string, string | null>;
  tied: string[];
  exiledID: string | null;
  /** Integer half-votes: normal vote = 2, sheriff vote = 3. */
  weights: Record<string, number>;
}
export interface MoonElectionResult { round: 1 | 2; votes: Record<string, string | null>; tied: string[]; winnerID: string | null }
export interface MoonLogEntry {
  type: 'start' | 'night' | 'dawn' | 'speech' | 'vote' | 'hunter' | 'finish' | 'sheriff-election' | 'sheriff-transfer';
  day: number;
  actorID?: string;
  targetID?: string | null;
  deaths?: string[];
  votes?: Record<string, string | null>;
  round?: 1 | 2;
  tied?: string[];
  winner?: MoonFaction;
  reason?: MoonWinReason;
  weights?: Record<string, number>;
}
export interface MoonState {
  rulesVersion: 1 | 2;
  status: MoonStatus;
  options: MoonOptions;
  day: number;
  epoch: number;
  deadline: number | null;
  nightStep: number;
  players: Record<string, MoonPlayer>;
  private: Record<string, MoonPrivateInfo>;
  speakerID: string | null;
  speakingOrder: string[];
  speechIndex: number;
  hunterID: string | null;
  dawnDeaths: string[];
  voteCandidates: string[];
  voteRound: 1 | 2;
  lastVote: MoonVoteResult | null;
  sheriffID: string | null;
  sheriffCandidates: string[];
  sheriffRound: 1 | 2;
  electionDone: boolean;
  sheriffTransferID: string | null;
  electionResult: MoonElectionResult | null;
  winner: MoonFaction | null;
  winReason: MoonWinReason | null;
  log: MoonLogEntry[];
  /** Server-only choices, removed before every player/observer projection. */
  secret?: {
    guardTarget: string | null;
    wolfVotes: Record<string, string | null>;
    attackTarget: string | null;
    poisonTarget: string | null;
    saved: boolean;
    votes: Record<string, string | null>;
    afterHunter: 'dawn' | 'vote-review';
    afterTransfer: 'dawn' | 'vote-review';
    sheriffVotes: Record<string, string | null>;
    /** Shuffled with the game's persisted RNG once per night; never exposed to clients. */
    attackTieOrder?: string[];
    /** Wolf-consensus grace period; never changes the publicly visible countdown. */
    nightAdvance?: { epoch: number; deadline: number; targetID?: string };
  };
}
export interface MoonSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: MoonOptions }
type MoveContext = FnContext<MoonState> & { playerID: string };
type RandomAPI = FnContext<MoonState>['random'];
const aliveIDs = (G: MoonState) => Object.keys(G.players).filter(id => G.players[id].alive);
const seat = (G: MoonState, id: unknown): id is string => typeof id === 'string' && Object.hasOwn(G.players, id);
const living = (G: MoonState, id: unknown): id is string => seat(G, id) && G.players[id].alive;
const token = (G: MoonState, id: unknown, epoch: unknown): id is string => seat(G, id) && Number.isInteger(epoch) && epoch === G.epoch;
const beforeDeadline = (G: MoonState) => G.deadline !== null && Date.now() < G.deadline;
const targetOrSkip = (G: MoonState, id: unknown) => id === null || living(G, id);

/** Only wolf consensus may shorten a night slot, including for old saved games. */
export function moonClockDeadline(G: MoonState): number | null {
  if (G.deadline === null) return null;
  const early = G.secret?.nightAdvance;
  if (G.status === 'night' && G.nightStep === 1 && early?.epoch === G.epoch && Number.isFinite(early.deadline)) {
    return Math.min(G.deadline, early.deadline);
  }
  return G.deadline;
}
function scheduleNightAdvance(G: MoonState, now: number, targetID: string) {
  const current = G.secret!.nightAdvance;
  if (current?.epoch === G.epoch && current.targetID === targetID && Number.isFinite(current.deadline)) return;
  G.secret!.nightAdvance = { epoch: G.epoch, deadline: now + 3000, targetID };
}
function transition(G: MoonState, status: MoonStatus, now: number, seconds?: number) {
  G.status = status;
  G.epoch += 1;
  G.deadline = seconds === undefined ? null : now + seconds * 1000;
  if (G.secret) delete G.secret.nightAdvance;
  for (const player of Object.values(G.players)) player.acknowledged = false;
}
function finish(G: MoonState, winner: MoonFaction, reason: MoonWinReason, now: number) {
  G.winner = winner; G.winReason = reason; G.speakerID = null; G.hunterID = null; G.sheriffTransferID = null;
  transition(G, 'finished', now);
  for (const id of Object.keys(G.players)) {
    G.players[id].revealedRole = G.private[id].role;
    G.players[id].revealedFaction = G.private[id].faction;
  }
  G.log.push({ type: 'finish', day: G.day, winner, reason });
}
function checkWinner(G: MoonState, now: number): boolean {
  const alive = aliveIDs(G);
  const wolves = alive.filter(id => G.private[id].role === 'wolf').length;
  if (!wolves) { finish(G, 'town', 'wolves-eliminated', now); return true; }
  if (wolves >= alive.length - wolves) { finish(G, 'wolves', 'wolves-dominate', now); return true; }
  return false;
}
function beginGame(G: MoonState, random: RandomAPI) {
  const ids = Object.keys(G.players);
  const deck = random.Shuffle(moonRoleDeck(ids.length));
  const wolves = ids.filter((_, index) => deck[index] === 'wolf');
  ids.forEach((id, index) => {
    const role = deck[index];
    G.private[id] = {
      role, faction: MOON_ROLES[role].faction, knownWolves: role === 'wolf' ? wolves.filter(other => other !== id) : [],
      checks: [], antidote: role === 'witch', poison: role === 'witch', previousGuard: null,
      nightChoice: null, nightSubmitted: false, witchChoice: null, wolfVotes: {}, attackedID: null, ownVote: null, voteSubmitted: false,
    };
  });
  G.day = 1;
  G.secret = emptySecret();
  G.log.push({ type: 'start', day: 1 });
  transition(G, 'briefing', Date.now());
}
function emptySecret(): NonNullable<MoonState['secret']> {
  return { guardTarget: null, wolfVotes: {}, attackTarget: null, poisonTarget: null, saved: false, votes: {}, afterHunter: 'dawn', afterTransfer: 'dawn', sheriffVotes: {} };
}
function beginNight(G: MoonState, now: number, random: RandomAPI) {
  G.nightStep = moonNightSteps(Object.keys(G.players).length, G.rulesVersion)[0];
  G.speakerID = null; G.speakingOrder = []; G.speechIndex = 0; G.hunterID = null; G.dawnDeaths = [];
  G.secret = emptySecret();
  G.secret.attackTieOrder = random.Shuffle(aliveIDs(G).filter(id => G.private[id].role !== 'wolf'));
  for (const info of Object.values(G.private)) {
    info.nightChoice = null; info.nightSubmitted = false; info.witchChoice = null; info.wolfVotes = {}; info.attackedID = null;
    info.ownVote = null; info.voteSubmitted = false;
  }
  transition(G, 'night', now, G.options.nightSeconds);
  G.log.push({ type: 'night', day: G.day });
}
function beginSpeeches(G: MoonState, now: number, firstID?: string, direction: 'clockwise' | 'counterclockwise' = 'clockwise') {
  const ids = Object.keys(G.players);
  const start = firstID === undefined ? (G.day - 1) % ids.length : ids.indexOf(firstID);
  G.speakingOrder = Array.from({ length: ids.length }, (_, index) => ids[(start + (direction === 'clockwise' ? index : -index) + ids.length) % ids.length]).filter(id => G.players[id].alive);
  G.speechIndex = 0; G.speakerID = G.speakingOrder[0] ?? null;
  transition(G, 'speaking', now, G.options.speechSeconds);
  G.log.push({ type: 'speech', day: G.day, actorID: G.speakerID! });
}
function beginVoting(G: MoonState, now: number, round: 1 | 2 = 1, candidates = aliveIDs(G)) {
  G.speakerID = null; G.voteCandidates = [...candidates]; G.voteRound = round; G.secret!.votes = {};
  for (const info of Object.values(G.private)) { info.ownVote = null; info.voteSubmitted = false; }
  transition(G, 'voting', now, G.options.voteSeconds);
}
function nextSpeech(G: MoonState, now: number) {
  G.speechIndex += 1;
  if (G.speechIndex >= G.speakingOrder.length) { beginVoting(G, now); return; }
  G.speakerID = G.speakingOrder[G.speechIndex];
  transition(G, 'speaking', now, G.options.speechSeconds);
  G.log.push({ type: 'speech', day: G.day, actorID: G.speakerID });
}
function afterDeaths(G: MoonState, deaths: string[], poisoned: string | null, next: 'dawn' | 'vote-review', now: number) {
  const hunter = deaths.find(id => G.private[id].role === 'hunter' && id !== poisoned);
  if (hunter) {
    G.hunterID = hunter;
    G.players[hunter].revealedRole = 'hunter'; G.players[hunter].revealedFaction = 'town';
    G.secret!.afterHunter = next;
    transition(G, 'hunter', now, 30);
    return;
  }
  afterHunter(G, next, now);
}
function afterHunter(G: MoonState, next: 'dawn' | 'vote-review', now: number) {
  if (G.sheriffID !== null && !G.players[G.sheriffID].alive) {
    G.sheriffTransferID = G.sheriffID; G.secret!.afterTransfer = next;
    transition(G, 'sheriff-transfer', now, 30);
    return;
  }
  if (!checkWinner(G, now)) transition(G, next, now);
}
function resolveNight(G: MoonState, now: number) {
  const secret = G.secret!;
  const deaths = new Set<string>();
  if (secret.attackTarget && secret.attackTarget !== secret.guardTarget && !secret.saved) deaths.add(secret.attackTarget);
  if (secret.poisonTarget) deaths.add(secret.poisonTarget);
  G.dawnDeaths = Object.keys(G.players).filter(id => deaths.has(id));
  for (const id of G.dawnDeaths) G.players[id].alive = false;
  G.log.push({ type: 'dawn', day: G.day, deaths: [...G.dawnDeaths] });
  // The public dawn reveals people, never whether poison or an attack caused death.
  afterDeaths(G, G.dawnDeaths, secret.poisonTarget, 'dawn', now);
}
function uniqueHighest(votes: Record<string, string | null>, weights: Record<string, number> = {}): { selected: string | null; tied: string[] } {
  const counts = new Map<string, number>();
  for (const [id, target] of Object.entries(votes)) if (target !== null) counts.set(target, (counts.get(target) ?? 0) + (weights[id] ?? 1));
  const high = Math.max(0, ...counts.values());
  const tied = [...counts].filter(([, count]) => count === high).map(([id]) => id).sort((a, b) => Number(a) - Number(b));
  return { selected: tied.length === 1 ? tied[0] : null, tied: tied.length > 1 ? tied : [] };
}
function finishNightSlot(G: MoonState, now: number) {
  if (G.nightStep === 0) {
    for (const id of aliveIDs(G)) if (G.private[id].role === 'guard') G.private[id].previousGuard = G.secret!.guardTarget;
  }
  if (G.nightStep === 1) {
    const votes = Object.fromEntries(aliveIDs(G).filter(id => G.private[id].role === 'wolf').map(id => [id, G.secret!.wolfVotes[id] ?? null]));
    const { selected, tied } = uniqueHighest(votes);
    // Pre-shuffling gives each tied target the same chance without re-rolling after a restart.
    // An untouched pre-upgrade night has no order and retains its old no-attack-on-tie rule.
    G.secret!.attackTarget = selected ?? G.secret!.attackTieOrder?.find(id => tied.includes(id)) ?? null;
  }
  const nextStep = moonNightSteps(Object.keys(G.players).length, G.rulesVersion).find(step => step > G.nightStep);
  if (nextStep === undefined) { resolveNight(G, now); return; }
  G.nightStep = nextStep;
  if (G.nightStep === 3) {
    for (const id of aliveIDs(G)) {
      if (G.private[id].role === 'witch' && G.private[id].antidote) G.private[id].attackedID = G.secret!.attackTarget;
    }
  }
  transition(G, 'night', now, G.options.nightSeconds);
}
function resolveVotes(G: MoonState, now: number) {
  const votes = Object.fromEntries(aliveIDs(G).map(id => [id, G.secret!.votes[id] ?? null]));
  const weights = Object.fromEntries(aliveIDs(G).map(id => [id, id === G.sheriffID ? 3 : 2]));
  const { selected, tied } = uniqueHighest(votes, weights);
  G.lastVote = { day: G.day, round: G.voteRound, votes, tied, exiledID: selected, weights };
  G.log.push({ type: 'vote', day: G.day, votes: { ...votes }, weights: { ...weights }, round: G.voteRound, tied: [...tied], targetID: selected });
  if (selected) G.players[selected].alive = false;
  afterDeaths(G, selected ? [selected] : [], null, 'vote-review', now);
}
function resolveHunter(G: MoonState, targetID: string | null, now: number) {
  const actorID = G.hunterID!;
  if (targetID !== null) G.players[targetID].alive = false;
  G.log.push({ type: 'hunter', day: G.day, actorID, targetID });
  G.hunterID = null;
  afterHunter(G, G.secret!.afterHunter, now);
}

function startDay(G: MoonState, now: number) {
  if (G.options.sheriff && !G.electionDone) {
    G.sheriffCandidates = []; G.sheriffRound = 1; G.electionResult = null;
    transition(G, 'sheriff-signup', now, G.options.voteSeconds);
  } else if (G.sheriffID && living(G, G.sheriffID)) transition(G, 'sheriff-order', now, G.options.voteSeconds);
  else beginSpeeches(G, now);
}
function finishElection(G: MoonState, winnerID: string | null, now: number) {
  G.electionDone = true; G.sheriffID = winnerID; G.speakerID = null;
  const result = G.electionResult?.round === G.sheriffRound ? G.electionResult : null;
  G.electionResult = { round: G.sheriffRound, votes: { ...(result?.votes ?? {}) }, tied: [...(result?.tied ?? [])], winnerID };
  G.log.push({ type: 'sheriff-election', day: G.day, targetID: winnerID, round: G.sheriffRound,
    votes: { ...G.electionResult.votes }, tied: [...G.electionResult.tied] });
  startDay(G, now);
}
function electionSpeeches(G: MoonState, now: number) {
  G.sheriffCandidates = G.sheriffCandidates.filter(id => living(G, id));
  if (G.sheriffCandidates.length <= 1) { finishElection(G, G.sheriffCandidates[0] ?? null, now); return; }
  G.speakingOrder = Object.keys(G.players).filter(id => G.sheriffCandidates.includes(id));
  G.speechIndex = 0; G.speakerID = G.speakingOrder[0];
  transition(G, 'sheriff-speech', now, G.options.speechSeconds);
}
function nextElectionSpeech(G: MoonState, now: number) {
  if (G.sheriffCandidates.length <= 1) { finishElection(G, G.sheriffCandidates[0] ?? null, now); return; }
  do { G.speechIndex += 1; } while (G.speechIndex < G.speakingOrder.length && !G.sheriffCandidates.includes(G.speakingOrder[G.speechIndex]));
  if (G.speechIndex >= G.speakingOrder.length) {
    G.speakerID = null; G.secret!.sheriffVotes = {};
    for (const info of Object.values(G.private)) { info.ownVote = null; info.voteSubmitted = false; }
    if (!aliveIDs(G).some(id => !G.sheriffCandidates.includes(id))) { finishElection(G, null, now); return; }
    transition(G, 'sheriff-voting', now, G.options.voteSeconds);
  } else {
    G.speakerID = G.speakingOrder[G.speechIndex];
    transition(G, 'sheriff-speech', now, G.options.speechSeconds);
  }
}
function resolveElection(G: MoonState, now: number) {
  const voters = aliveIDs(G).filter(id => !G.sheriffCandidates.includes(id));
  const votes = Object.fromEntries(voters.map(id => [id, G.secret!.sheriffVotes[id] ?? null]));
  const { selected, tied } = uniqueHighest(votes);
  G.electionResult = { round: G.sheriffRound, votes, tied, winnerID: selected };
  if (!selected && tied.length > 1 && G.sheriffRound === 1) {
    G.log.push({ type: 'sheriff-election', day: G.day, targetID: null, round: 1, votes: { ...votes }, tied: [...tied] });
    G.sheriffCandidates = tied; G.sheriffRound = 2; electionSpeeches(G, now);
  } else finishElection(G, selected, now);
}
function resolveBadge(G: MoonState, targetID: string | null, now: number) {
  const actorID = G.sheriffTransferID!;
  G.sheriffID = targetID; G.sheriffTransferID = null;
  G.log.push({ type: 'sheriff-transfer', day: G.day, actorID, targetID });
  if (!checkWinner(G, now)) transition(G, G.secret!.afterTransfer, now);
}

/** Called only by the server scheduler, under the same room queue as player moves.
 * At most one deadline is consumed: a restart grants a full next stage, not a cascade.
 */
export function advanceMoonClock(G: MoonState, now: number): boolean {
  const deadline = moonClockDeadline(G);
  if (!Number.isFinite(now) || deadline === null || now < deadline || G.status === 'finished') return false;
  if (G.status === 'night') finishNightSlot(G, now);
  else if (G.status === 'speaking') nextSpeech(G, now);
  else if (G.status === 'voting') resolveVotes(G, now);
  else if (G.status === 'hunter') resolveHunter(G, null, now);
  else if (G.status === 'sheriff-signup') electionSpeeches(G, now);
  else if (G.status === 'sheriff-speech') nextElectionSpeech(G, now);
  else if (G.status === 'sheriff-voting') resolveElection(G, now);
  else if (G.status === 'sheriff-order') beginSpeeches(G, now);
  else if (G.status === 'sheriff-transfer') resolveBadge(G, null, now);
  else return false;
  return true;
}
function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !seat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== Object.keys(G.players)[0] || !Object.values(G.players).every(p => p.ready)) return INVALID_MOVE;
  beginGame(G, random);
}
function acknowledge({ G, playerID, random }: MoveContext, epoch: unknown) {
  if (!['briefing', 'dawn', 'vote-review'].includes(G.status) || !token(G, playerID, epoch)
    || !G.players[playerID].alive || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.players[playerID].acknowledged = true;
  if (!aliveIDs(G).every(id => G.players[id].acknowledged)) return;
  const now = Date.now();
  if (G.status === 'briefing') beginNight(G, now, random);
  else if (G.status === 'dawn') startDay(G, now);
  else if (G.lastVote?.round === 1 && G.lastVote.tied.length > 1) beginVoting(G, now, 2, G.lastVote.tied);
  else { G.day += 1; beginNight(G, now, random); }
}
function canNight(G: MoonState, playerID: string, epoch: unknown, role: MoonRole, step: number, now: number) {
  const deadline = moonClockDeadline(G);
  return G.status === 'night' && token(G, playerID, epoch) && living(G, playerID)
    && G.private[playerID].role === role && G.nightStep === step && deadline !== null && now < deadline;
}
function guard({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  const now = Date.now();
  if (!canNight(G, playerID, epoch, 'guard', 0, now) || !targetOrSkip(G, targetID)
    || (targetID !== null && targetID === G.private[playerID].previousGuard)) return INVALID_MOVE;
  G.secret!.guardTarget = targetID as string | null;
  G.private[playerID].nightChoice = targetID as string | null; G.private[playerID].nightSubmitted = true;
}
function wolfVote({ G, playerID, random }: MoveContext, targetID: unknown, epoch: unknown) {
  const now = Date.now();
  if (!canNight(G, playerID, epoch, 'wolf', 1, now) || !targetOrSkip(G, targetID)
    || (targetID !== null && G.private[targetID as string].role === 'wolf')) return INVALID_MOVE;
  if (!G.secret!.attackTieOrder) G.secret!.attackTieOrder = random.Shuffle(aliveIDs(G).filter(id => G.private[id].role !== 'wolf'));
  G.secret!.wolfVotes[playerID] = targetID as string | null;
  G.private[playerID].nightChoice = targetID as string | null; G.private[playerID].nightSubmitted = true;
  for (const id of Object.keys(G.private)) if (G.private[id].role === 'wolf') G.private[id].wolfVotes = { ...G.secret!.wolfVotes };
  const wolves = aliveIDs(G).filter(id => G.private[id].role === 'wolf');
  const target = G.secret!.wolfVotes[wolves[0]];
  if (target != null && wolves.every(id => G.secret!.wolfVotes[id] === target)) scheduleNightAdvance(G, now, target);
  else delete G.secret!.nightAdvance;
}
function inspect({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  const now = Date.now();
  if (!canNight(G, playerID, epoch, 'seer', 2, now) || !targetOrSkip(G, targetID) || targetID === playerID
    || G.private[playerID].nightSubmitted) return INVALID_MOVE;
  const info = G.private[playerID];
  info.nightChoice = targetID as string | null; info.nightSubmitted = true;
  if (targetID !== null) info.checks.push({ day: G.day, targetID: targetID as string, isWolf: G.private[targetID as string].role === 'wolf' });
}
function witch({ G, playerID }: MoveContext, action: unknown, targetID: unknown, epoch: unknown) {
  const now = Date.now();
  if (!canNight(G, playerID, epoch, 'witch', 3, now) || !['save', 'poison', 'skip'].includes(action as string)
    || G.private[playerID].nightSubmitted) return INVALID_MOVE;
  const info = G.private[playerID];
  if (action === 'save') {
    if (!info.antidote || !G.secret!.attackTarget || targetID !== G.secret!.attackTarget
      || (targetID === playerID && G.day !== 1)) return INVALID_MOVE;
    info.antidote = false; G.secret!.saved = true;
  } else if (action === 'poison') {
    if (!info.poison || !living(G, targetID) || targetID === playerID) return INVALID_MOVE;
    info.poison = false; G.secret!.poisonTarget = targetID;
  } else if (targetID !== null) return INVALID_MOVE;
  info.witchChoice = action as MoonWitchAction;
  info.nightChoice = targetID as string | null; info.nightSubmitted = true;
}
function finishSpeech({ G, playerID }: MoveContext, epoch: unknown) {
  if (!['speaking', 'sheriff-speech'].includes(G.status) || !token(G, playerID, epoch) || G.speakerID !== playerID || !living(G, playerID) || !beforeDeadline(G)) return INVALID_MOVE;
  if (G.status === 'sheriff-speech') nextElectionSpeech(G, Date.now());
  else nextSpeech(G, Date.now());
}
function exileVote({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  if (G.status !== 'voting' || !token(G, playerID, epoch) || !living(G, playerID) || !beforeDeadline(G)
    || (targetID !== null && (typeof targetID !== 'string' || !G.voteCandidates.includes(targetID)))
    || G.private[playerID].voteSubmitted) return INVALID_MOVE;
  G.private[playerID].ownVote = targetID as string | null; G.private[playerID].voteSubmitted = true;
  G.secret!.votes[playerID] = targetID as string | null;
  if (aliveIDs(G).every(id => G.private[id].voteSubmitted)) resolveVotes(G, Date.now());
}
function hunterShoot({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  if (G.status !== 'hunter' || !token(G, playerID, epoch) || G.hunterID !== playerID || !targetOrSkip(G, targetID) || !beforeDeadline(G)) return INVALID_MOVE;
  resolveHunter(G, targetID as string | null, Date.now());
}
function standForSheriff({ G, playerID }: MoveContext, standing: unknown, epoch: unknown) {
  if (!['sheriff-signup', 'sheriff-speech'].includes(G.status) || !token(G, playerID, epoch) || !living(G, playerID)
    || !beforeDeadline(G) || typeof standing !== 'boolean' || (G.status === 'sheriff-speech' && standing)) return INVALID_MOVE;
  if (standing) {
    if (G.sheriffCandidates.includes(playerID)) return INVALID_MOVE;
    G.sheriffCandidates.push(playerID);
  } else {
    if (!G.sheriffCandidates.includes(playerID)) return INVALID_MOVE;
    G.sheriffCandidates = G.sheriffCandidates.filter(id => id !== playerID);
    if (G.status === 'sheriff-speech') {
      if (G.sheriffCandidates.length <= 1) finishElection(G, G.sheriffCandidates[0] ?? null, Date.now());
      else if (G.speakerID === playerID) nextElectionSpeech(G, Date.now());
    }
  }
}
function sheriffVote({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  if (G.status !== 'sheriff-voting' || !token(G, playerID, epoch) || !living(G, playerID) || !beforeDeadline(G)
    || G.sheriffCandidates.includes(playerID) || (targetID !== null && (typeof targetID !== 'string' || !G.sheriffCandidates.includes(targetID)))
    || G.private[playerID].voteSubmitted) return INVALID_MOVE;
  G.private[playerID].ownVote = targetID as string | null; G.private[playerID].voteSubmitted = true;
  G.secret!.sheriffVotes[playerID] = targetID as string | null;
  if (aliveIDs(G).filter(id => !G.sheriffCandidates.includes(id)).every(id => G.private[id].voteSubmitted)) resolveElection(G, Date.now());
}
function chooseOrder({ G, playerID }: MoveContext, firstID: unknown, direction: unknown, epoch: unknown) {
  if (G.status !== 'sheriff-order' || !token(G, playerID, epoch) || G.sheriffID !== playerID || !living(G, playerID)
    || !living(G, firstID) || !beforeDeadline(G) || (direction !== 'clockwise' && direction !== 'counterclockwise')) return INVALID_MOVE;
  beginSpeeches(G, Date.now(), firstID, direction);
}
function transferBadge({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  if (G.status !== 'sheriff-transfer' || !token(G, playerID, epoch) || G.sheriffTransferID !== playerID
    || !targetOrSkip(G, targetID) || !beforeDeadline(G)) return INVALID_MOVE;
  resolveBadge(G, targetID as string | null, Date.now());
}

function copyPrivate(info: MoonPrivateInfo): MoonPrivateInfo {
  return {
    role: info.role, faction: info.faction, knownWolves: [...info.knownWolves],
    checks: info.checks.map(({ day, targetID, isWolf }) => ({ day, targetID, isWolf })), antidote: info.antidote, poison: info.poison,
    previousGuard: info.previousGuard, nightChoice: info.nightChoice, nightSubmitted: info.nightSubmitted, witchChoice: info.witchChoice,
    wolfVotes: { ...info.wolfVotes }, attackedID: info.attackedID, ownVote: info.ownVote, voteSubmitted: info.voteSubmitted,
  };
}
function copyVote(result: MoonVoteResult | null): MoonVoteResult | null {
  return result ? { day: result.day, round: result.round, votes: { ...result.votes }, weights: { ...result.weights }, tied: [...result.tied], exiledID: result.exiledID } : null;
}
/** Explicit allowlist; never spread server state into a client-visible object. */
export function moonPlayerView({ G, playerID }: { G: MoonState; playerID: string | null }): MoonState {
  return {
    rulesVersion: G.rulesVersion, status: G.status, options: { mode: G.options.mode, sheriff: G.options.sheriff, speechSeconds: G.options.speechSeconds, nightSeconds: G.options.nightSeconds, voteSeconds: G.options.voteSeconds }, day: G.day, epoch: G.epoch, deadline: G.deadline, nightStep: G.nightStep,
    players: Object.fromEntries(Object.entries(G.players).map(([id, p]) => [id, {
      ready: p.ready, acknowledged: p.acknowledged, alive: p.alive,
      ...(p.revealedRole ? { revealedRole: p.revealedRole } : {}), ...(p.revealedFaction ? { revealedFaction: p.revealedFaction } : {}),
    }])),
    private: playerID && seat(G, playerID) && Object.hasOwn(G.private, playerID) ? { [playerID]: copyPrivate(G.private[playerID]) } : {},
    speakerID: G.speakerID, speakingOrder: [...G.speakingOrder], speechIndex: G.speechIndex, hunterID: G.hunterID,
    dawnDeaths: [...G.dawnDeaths], voteCandidates: [...G.voteCandidates], voteRound: G.voteRound, lastVote: copyVote(G.lastVote),
    sheriffID: G.sheriffID, sheriffCandidates: [...G.sheriffCandidates], sheriffRound: G.sheriffRound, electionDone: G.electionDone,
    sheriffTransferID: G.sheriffTransferID, electionResult: G.electionResult ? { round: G.electionResult.round, votes: { ...G.electionResult.votes }, tied: [...G.electionResult.tied], winnerID: G.electionResult.winnerID } : null,
    winner: G.winner, winReason: G.winReason,
    log: G.log.map(e => ({ type: e.type, day: e.day,
      ...(e.actorID === undefined ? {} : { actorID: e.actorID }), ...(e.targetID === undefined ? {} : { targetID: e.targetID }),
      ...(e.deaths === undefined ? {} : { deaths: [...e.deaths] }), ...(e.votes === undefined ? {} : { votes: { ...e.votes } }),
      ...(e.round === undefined ? {} : { round: e.round }), ...(e.tied === undefined ? {} : { tied: [...e.tied] }),
      ...(e.weights === undefined ? {} : { weights: { ...e.weights } }),
      ...(e.winner === undefined ? {} : { winner: e.winner }), ...(e.reason === undefined ? {} : { reason: e.reason }),
    })),
  };
}
export function moonObserverView(G: MoonState, perspective: 'blind' | 'god'): MoonState {
  const view = moonPlayerView({ G, playerID: null });
  if (perspective === 'god') for (const id of Object.keys(G.players)) if (G.private[id]) view.private[id] = copyPrivate(G.private[id]);
  return view;
}
const serverMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const MoonGame: Game<MoonState, Record<string, unknown>, MoonSetupData> = {
  name: 'silver-moon', minPlayers: 6, maxPlayers: 12,
  validateSetupData: (data, count) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data)
      || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '銀月列車開局資料不正確。';
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs) || data.participantIDs.length !== count
      || data.participantIDs.some(id => !isPlayerSeatID(id)) || new Set(data.participantIDs).size !== count)) return '參與玩家席位不正確。';
    try { return validateMoonOptions(normalizeMoonOptions(data?.options), count); } catch (error) { return (error as Error).message; }
  },
  setup: ({ ctx, random }, data) => {
    const options = normalizeMoonOptions(data?.options);
    const error = validateMoonOptions(options, ctx.numPlayers);
    if (error) throw new Error(error);
    const ids = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, i) => String(i));
    const G: MoonState = {
      rulesVersion: 2, status: 'lobby', options, day: 0, epoch: 0, deadline: null, nightStep: 0,
      players: Object.fromEntries(ids.map(id => [id, { ready: data?.startImmediately === true, acknowledged: false, alive: true }])),
      private: {}, speakerID: null, speakingOrder: [], speechIndex: 0, hunterID: null, dawnDeaths: [],
      voteCandidates: [], voteRound: 1, lastVote: null, winner: null, winReason: null, log: [],
      sheriffID: null, sheriffCandidates: [], sheriffRound: 1, electionDone: false, sheriffTransferID: null, electionResult: null,
    };
    if (data?.startImmediately) beginGame(G, random);
    return G;
  },
  turn: { order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => Object.keys(G.players) }, activePlayers: ActivePlayers.ALL },
  moves: {
    setReady: { move: setReady, ...serverMove }, startGame: { move: startGame, ...serverMove },
    acknowledge: { move: acknowledge, ...serverMove }, guard: { move: guard, ...serverMove }, wolfVote: { move: wolfVote, ...serverMove },
    inspect: { move: inspect, ...serverMove }, witch: { move: witch, ...serverMove }, finishSpeech: { move: finishSpeech, ...serverMove },
    exileVote: { move: exileVote, ...serverMove }, hunterShoot: { move: hunterShoot, ...serverMove },
    standForSheriff: { move: standForSheriff, ...serverMove }, sheriffVote: { move: sheriffVote, ...serverMove },
    chooseOrder: { move: chooseOrder, ...serverMove }, transferBadge: { move: transferBadge, ...serverMove },
  },
  disableUndo: true,
  plugins: [{ name: 'moon-flow-guard', setup: () => ({}), isInvalid: ({ G, ctx }) => {
    if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason ? false : 'Moon completion must follow its rules.';
    if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== Object.keys(G.players)[0] || ctx.phase !== null || !ctx.activePlayers
      || Object.keys(ctx.activePlayers).length !== Object.keys(G.players).length
      || Object.keys(G.players).some(id => ctx.activePlayers![id] !== null)
      || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
      || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for silver-moon.';
    return false;
  } }],
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: moonPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
