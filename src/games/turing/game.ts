import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { turingQuestionPool } from './questions';
import { normalizeTuringAnswer, normalizeTuringOptions, normalizeTuringPolicies, TURING_APPROVAL_KEYS, TURING_ROUNDS, validateTuringOptions, type TuringOptions, type TuringQuestion, type TuringPolicies } from './rules';

export type { TuringOptions, TuringQuestion } from './rules';
export type TuringStatus = 'lobby' | 'briefing' | 'answering' | 'sorting' | 'round-review' | 'finished';
export type TuringWinner = 'humans' | 'system';
export type TuringWinReason = 'calibrated' | 'integrity-lost' | 'endless-exhausted' | 'endless-stopped';
export interface TuringSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: TuringOptions }
export interface TuringPlayer { ready: boolean; acknowledged: boolean; answered: boolean }
export interface TuringCard { playerID: string; slot: 'A' | 'B'; spoken: boolean }
export interface TuringPrivateInfo { number: number; answer?: string; cards?: { id: string; number: number }[] }
export interface TuringRevealed { playerID: string; number: number; error: boolean; cardID?: string; slot?: 'A' | 'B' }
export interface TuringEvent {
  type: 'round-start' | 'question-redraw' | 'approval-change' | 'answers' | 'spoken' | 'reveal' | 'round-complete' | 'finish';
  round: number;
  examinerID?: string;
  question?: TuringQuestion;
  answers?: Record<string, string>;
  actorID?: string;
  targetID?: string;
  cardID?: string;
  slot?: 'A' | 'B';
  number?: number;
  error?: boolean;
  integrity?: number;
  winner?: TuringWinner;
  reason?: TuringWinReason;
  completedRounds?: number;
  policies?: TuringPolicies;
}
export interface TuringState {
  rulesVersion: 1 | 2 | 3 | 4;
  status: TuringStatus;
  players: Record<string, TuringPlayer>;
  private: Record<string, TuringPrivateInfo>;
  round: number;
  targetRounds: number | null;
  completedRounds?: number;
  integrity: number;
  maxIntegrity: number;
  examinerID: string;
  question: TuringQuestion | null;
  answers: Record<string, string>;
  cards?: Record<string, TuringCard>;
  /** Voice v3 small groups arrange face-down cards on a shared table. */
  tableOrder?: string[];
  orderApprovals?: string[];
  redrawApprovals?: string[];
  revealed: TuringRevealed[];
  epoch: number;
  options: TuringOptions;
  winner: TuringWinner | null;
  winReason: TuringWinReason | null;
  log: TuringEvent[];
  /** Server only, omitted from every view including god and completed games. */
  secretQuestionQueue?: TuringQuestion[];
  /** Compact draw history; future order is never preselected for voice games. */
  secretDrawIDs?: string[];
}

export function isTuringSharedTable(G: TuringState): boolean {
  const count = Object.keys(G.players).length;
  return G.rulesVersion >= 3 && count >= 2 && count <= 3;
}

/** Public answer slots, including the single slot used by persisted v1 games. */
export function turingCards(G: TuringState): Record<string, TuringCard> {
  if (G.rulesVersion >= 2) return Object.fromEntries(Object.entries(G.cards ?? {}).map(([id, card]) => [id, {
    playerID: card.playerID, slot: card.slot, spoken: card.spoken,
  }]));
  return Object.fromEntries(Object.keys(G.players).filter(id => id !== G.examinerID).map(id => [id, {
    playerID: id, slot: 'A' as const, spoken: G.players[id].answered,
  }]));
}

/** A complete public table, including cards omitted by older saved layouts. */
export function turingTableOrder(G: TuringState): string[] {
  if (!isTuringSharedTable(G)) return [];
  const cards = turingCards(G), order: string[] = [];
  for (const id of [...(G.tableOrder ?? []), ...Object.keys(cards)]) {
    if (Object.hasOwn(cards, id) && !order.includes(id)) order.push(id);
  }
  return order;
}

/** Only reads authorized private data; a revealed public card is handled separately by callers. */
export function turingCardNumber(G: TuringState, cardID: string): number | undefined {
  if (G.rulesVersion === 1) return Object.hasOwn(G.players, cardID) ? G.private[cardID]?.number : undefined;
  const card = G.cards && Object.hasOwn(G.cards, cardID) ? G.cards[cardID] : undefined;
  return card ? G.private[card.playerID]?.cards?.find(item => item.id === cardID)?.number : undefined;
}

type MoveContext = FnContext<TuringState> & { playerID: string };
type RandomAPI = FnContext<TuringState>['random'];
function isSeat(G: TuringState, id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(G.players, id);
}
function validToken(G: TuringState, id: unknown, epoch: unknown): id is string {
  return isSeat(G, id) && Number.isInteger(epoch) && epoch === G.epoch;
}
function transition(G: TuringState, status: TuringStatus): void {
  G.status = status;
  G.epoch += 1;
  for (const player of Object.values(G.players)) player.acknowledged = false;
}
function finish(G: TuringState, won: boolean): void {
  G.winner = won ? 'humans' : 'system';
  G.winReason = won ? 'calibrated' : G.rulesVersion >= 2 && G.options.mode === 'endless' ? 'endless-exhausted' : 'integrity-lost';
  transition(G, 'finished');
  G.log.push({ type: 'finish', round: G.round, integrity: G.integrity, winner: G.winner, reason: G.winReason, ...(G.completedRounds === undefined ? {} : { completedRounds: G.completedRounds }) });
}
function drawQuestion(G: TuringState, random: RandomAPI): TuringQuestion | undefined {
  if (G.rulesVersion === 1) return G.secretQuestionQueue?.shift();
  const pool = turingQuestionPool(G.options);
  let used = new Set(G.secretDrawIDs ?? []);
  let remaining = pool.filter(item => !used.has(item.id) && item.id !== G.question?.id);
  if (!remaining.length) {
    used = new Set();
    // The new cycle may revisit older questions, but never repeat the one just played.
    remaining = pool.filter(item => item.id !== G.question?.id);
  }
  if (!remaining.length) return undefined;
  const question = random.Shuffle(remaining)[0];
  used.add(question.id); G.secretDrawIDs = [...used];
  return question;
}
function beginRound(G: TuringState, random: RandomAPI): void {
  const question = drawQuestion(G, random);
  if (!question) throw new Error('本局題目快照不足，無法開始下一輪。');
  G.question = { ...question };
  G.private = {};
  G.answers = {};
  G.revealed = [];
  if (G.rulesVersion >= 2) G.cards = {};
  if (isTuringSharedTable(G)) { G.tableOrder = []; G.orderApprovals = []; }
  if (G.rulesVersion >= 4) G.redrawApprovals = [];
  const numbers = random.Shuffle(Array.from({ length: 10 }, (_, index) => index + 1));
  const answeringIDs = Object.keys(G.players).filter(id => id !== G.examinerID);
  const perPlayer = G.rulesVersion === 2 && Object.keys(G.players).length <= 3 ? 2 : 1;
  answeringIDs.forEach((id, index) => {
    const cards = Array.from({ length: perPlayer }, (_, slot) => ({
      id: perPlayer === 1 ? id : `${id}-${slot === 0 ? 'a' : 'b'}`, number: numbers[index * perPlayer + slot],
    }));
    G.private[id] = G.rulesVersion === 1 ? { number: cards[0].number } : { number: cards[0].number, cards };
    if (G.rulesVersion >= 2) for (const [slot, card] of cards.entries()) {
      G.cards![card.id] = { playerID: id, slot: slot === 0 ? 'A' : 'B', spoken: false };
    }
  });
  if (isTuringSharedTable(G)) G.tableOrder = Object.keys(G.cards!);
  for (const player of Object.values(G.players)) player.answered = false;
  transition(G, G.rulesVersion >= 4 ? 'sorting' : 'briefing');
  G.log.push({ type: 'round-start', round: G.round, examinerID: G.examinerID, question: { ...question }, integrity: G.integrity });
}
function beginGame(G: TuringState, random: RandomAPI): void {
  G.round = 1;
  G.examinerID = isTuringSharedTable(G) ? '' : random.Shuffle(Object.keys(G.players))[0];
  if (G.rulesVersion === 1) G.secretQuestionQueue = random.Shuffle(turingQuestionPool(G.options)).slice(0, TURING_ROUNDS);
  else { G.secretDrawIDs = []; G.completedRounds = 0; }
  beginRound(G, random);
}
function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== Object.keys(G.players)[0]
    || !Object.values(G.players).every(player => player.ready)) return INVALID_MOVE;
  beginGame(G, random);
}
function acknowledge(context: MoveContext, epoch: unknown) {
  return applyAcknowledgement(context, epoch);
}
function applyAcknowledgement({ G, playerID, random }: MoveContext, epoch: unknown, host?: HostApproval) {
  if (!['briefing', 'round-review'].includes(G.status) || !validToken(G, playerID, epoch)
    || G.players[playerID].acknowledged) return INVALID_MOVE;
  const policy = G.status === 'round-review' ? G.options.nextApproval ?? 'all' : 'all';
  if (host ? policy !== 'host' : policy === 'host') return INVALID_MOVE;
  G.players[playerID].acknowledged = true;
  if (!host && policy !== 'any' && !Object.values(G.players).every(player => player.acknowledged)) return;
  if (G.status === 'briefing') transition(G, 'answering');
  else {
    const ids = Object.keys(G.players);
    G.examinerID = isTuringSharedTable(G) ? '' : ids[(ids.indexOf(G.examinerID) + 1) % ids.length];
    G.round += 1;
    beginRound(G, random);
  }
}
function submitAnswer({ G, playerID }: MoveContext, input: unknown, epoch: unknown) {
  if (G.rulesVersion !== 1 || G.status !== 'answering' || !validToken(G, playerID, epoch)
    || playerID === G.examinerID || G.players[playerID].answered) return INVALID_MOVE;
  const answer = normalizeTuringAnswer(input);
  if (answer === undefined) return INVALID_MOVE;
  G.private[playerID].answer = answer;
  G.players[playerID].answered = true;
  const answeringIDs = Object.keys(G.players).filter(id => id !== G.examinerID);
  if (!answeringIDs.every(id => G.players[id].answered)) return;
  G.answers = Object.fromEntries(answeringIDs.map(id => [id, G.private[id].answer!]));
  transition(G, 'sorting');
  G.log.push({ type: 'answers', round: G.round, answers: { ...G.answers } });
}
function confirmSpoken({ G, playerID }: MoveContext, cardID: unknown, epoch: unknown) {
  if (G.rulesVersion < 2 || G.rulesVersion >= 4 || G.status !== 'answering' || !validToken(G, playerID, epoch)
    || typeof cardID !== 'string' || !G.cards || !Object.hasOwn(G.cards, cardID)
    || G.cards[cardID].playerID !== playerID || G.cards[cardID].spoken) return INVALID_MOVE;
  G.cards[cardID].spoken = true;
  G.players[playerID].answered = Object.values(G.cards).filter(card => card.playerID === playerID).every(card => card.spoken);
  if (!Object.values(G.cards).every(card => card.spoken)) return;
  transition(G, 'sorting');
  G.log.push({ type: 'spoken', round: G.round });
}
function revealAnswer({ G, playerID }: MoveContext, cardID: unknown, epoch: unknown) {
  if (isTuringSharedTable(G) || G.status !== 'sorting' || !validToken(G, playerID, epoch) || playerID !== G.examinerID
    || (G.redrawApprovals?.length ?? 0) > 0
    || typeof cardID !== 'string') return INVALID_MOVE;
  const cards = turingCards(G);
  if (!Object.hasOwn(cards, cardID) || G.revealed.some(entry => (entry.cardID ?? entry.playerID) === cardID)) return INVALID_MOVE;
  const card = cards[cardID], number = turingCardNumber(G, cardID);
  if (number === undefined) return INVALID_MOVE;
  recordReveal(G, playerID, cardID, card, number);
  if (G.integrity === 0) { finish(G, false); return; }
  if (G.revealed.length !== Object.keys(cards).length) return;
  completeRound(G);
}
function recordReveal(G: TuringState, actorID: string | undefined, cardID: string, card: TuringCard, number: number): void {
  const previous = G.revealed.at(-1)?.number;
  const error = previous !== undefined && number < previous;
  if (error) G.integrity = Math.max(0, G.integrity - 1);
  const slot = G.rulesVersion >= 2 ? { cardID, slot: card.slot } : {};
  G.revealed.push({ playerID: card.playerID, number, error, ...slot });
  G.epoch += 1;
  G.log.push({ type: 'reveal', round: G.round, actorID, targetID: card.playerID, number, error, integrity: G.integrity, ...slot });
}
function completeRound(G: TuringState): void {
  if (G.rulesVersion >= 2) G.completedRounds = (G.completedRounds ?? 0) + 1;
  G.log.push({ type: 'round-complete', round: G.round, integrity: G.integrity });
  if (G.targetRounds !== null && G.round >= G.targetRounds) finish(G, true);
  else transition(G, 'round-review');
}
function canArrange(G: TuringState, playerID: unknown, epoch: unknown): boolean {
  return isTuringSharedTable(G) && G.status === 'sorting' && validToken(G, playerID, epoch);
}
function placeCard({ G, playerID }: MoveContext, cardID: unknown, index: unknown, epoch: unknown) {
  if (!canArrange(G, playerID, epoch) || typeof cardID !== 'string' || !G.cards || !Object.hasOwn(G.cards, cardID)
    || typeof index !== 'number' || !Number.isInteger(index)) return INVALID_MOVE;
  const previous = turingTableOrder(G);
  const next = previous.filter(id => id !== cardID);
  if (index < 0 || index > next.length) return INVALID_MOVE;
  next.splice(index, 0, cardID);
  if (next.every((id, i) => previous[i] === id)) return;
  G.tableOrder = next;
  G.orderApprovals = [];
  G.epoch += 1;
}
function removeCard(context: MoveContext, cardID: unknown, epoch: unknown) {
  // Older clients may still send this move. Keep every card on the table and
  // treat it as moving the selected card to the far end instead of removing it.
  return placeCard(context, cardID, turingTableOrder(context.G).length - 1, epoch);
}
interface HostApproval { actorID: string }
function approveOrder(context: MoveContext, epoch: unknown) {
  return applyOrderApproval(context, epoch);
}
function applyOrderApproval({ G, playerID }: MoveContext, epoch: unknown, host?: HostApproval) {
  if ((host ? G.options.orderApproval !== 'host' : G.options.orderApproval === 'host')
    || !canArrange(G, playerID, epoch) || (!host && G.orderApprovals?.includes(playerID))
    || (G.redrawApprovals?.length ?? 0) > 0 || !G.cards) return INVALID_MOVE;
  const order = turingTableOrder(G);
  if (order.length !== Object.keys(G.players).length) return INVALID_MOVE;
  const cards = order.map(id => ({ id, card: G.cards![id], number: turingCardNumber(G, id) }));
  if (cards.some(card => card.number === undefined)) return INVALID_MOVE;
  G.tableOrder = order;
  if (host) G.orderApprovals = [host.actorID];
  else {
    G.orderApprovals ??= [];
    G.orderApprovals.push(playerID);
    if (G.options.orderApproval !== 'any' && !Object.keys(G.players).every(id => G.orderApprovals!.includes(id))) return;
  }
  // One authoritative move reveals the entire agreed table. There is no
  // intermediate public state from which somebody can revise the order.
  for (const { id, card, number } of cards) recordReveal(G, host ? host.actorID : playerID, id, card, number!);
  if (G.integrity === 0) finish(G, false);
  else completeRound(G);
}
function withdrawApproval({ G, playerID }: MoveContext, epoch: unknown) {
  if ((G.options.orderApproval ?? 'all') !== 'all' || !canArrange(G, playerID, epoch) || !G.orderApprovals?.includes(playerID)) return INVALID_MOVE;
  G.orderApprovals = G.orderApprovals.filter(id => id !== playerID);
  // A delayed approval sent before the withdrawal must not restore consent.
  G.epoch += 1;
}

function canRedraw(G: TuringState, playerID: unknown, epoch: unknown): boolean {
  return G.rulesVersion >= 4 && G.status === 'sorting' && G.revealed.length === 0 && validToken(G, playerID, epoch);
}
function approveRedraw(context: MoveContext, epoch: unknown) {
  return applyRedrawApproval(context, epoch);
}
function applyRedrawApproval({ G, playerID, random }: MoveContext, epoch: unknown, host?: HostApproval) {
  if ((host ? G.options.redrawApproval !== 'host' : G.options.redrawApproval === 'host')
    || !canRedraw(G, playerID, epoch) || (!host && G.redrawApprovals?.includes(playerID))
    || !turingQuestionPool(G.options).some(question => question.id !== G.question?.id)) return INVALID_MOVE;
  G.redrawApprovals ??= [];
  if (!G.redrawApprovals.length) {
    // A new question proposal cancels prior consent to reveal this answer order.
    // Invalidating its epoch also rejects already queued approvals from old tabs.
    if (G.orderApprovals) G.orderApprovals = [];
    G.epoch += 1;
  }
  if (!host) {
    G.redrawApprovals.push(playerID);
    if (G.options.redrawApproval !== 'any' && !Object.keys(G.players).every(id => G.redrawApprovals!.includes(id))) return;
  }
  const question = drawQuestion(G, random)!;
  G.question = { ...question };
  if (isTuringSharedTable(G)) G.tableOrder = Object.keys(G.cards!);
  if (G.orderApprovals) G.orderApprovals = [];
  G.redrawApprovals = [];
  G.epoch += 1;
  G.log.push({ type: 'question-redraw', round: G.round, actorID: host ? host.actorID : playerID, examinerID: G.examinerID,
    question: { ...question }, integrity: G.integrity });
}
function withdrawRedraw({ G, playerID }: MoveContext, epoch: unknown) {
  if ((G.options.redrawApproval ?? 'all') !== 'all' || !canRedraw(G, playerID, epoch) || !G.redrawApprovals?.includes(playerID)) return INVALID_MOVE;
  G.redrawApprovals = G.redrawApprovals.filter(id => id !== playerID);
  G.epoch += 1;
}

function setApprovalPolicies({ G, playerID }: MoveContext, epoch: unknown, input: unknown) {
  if (!validToken(G, playerID, epoch) || G.status === 'finished' || (G.status !== 'lobby' && G.rulesVersion < 4)) return INVALID_MOVE;
  let policies: TuringPolicies;
  try { policies = normalizeTuringPolicies(input); } catch { return INVALID_MOVE; }
  if (TURING_APPROVAL_KEYS.every(key => policies[key] === undefined || policies[key] === (G.options[key] ?? 'all'))) return INVALID_MOVE;
  Object.assign(G.options, policies);
  G.orderApprovals = []; G.redrawApprovals = [];
  for (const player of Object.values(G.players)) { player.acknowledged = false; if (G.status === 'lobby') player.ready = false; }
  G.epoch++;
  if (G.status !== 'lobby') G.log.push({ type: 'approval-change', round: G.round, policies: { ...policies } });
}
function finishChallenge({ G, playerID }: MoveContext, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.rulesVersion < 2 || G.options.mode !== 'endless' || G.targetRounds !== null
    || G.status === 'lobby' || G.status === 'finished') return INVALID_MOVE;
  G.winner = 'humans'; G.winReason = 'endless-stopped';
  transition(G, 'finished');
  G.log.push({ type: 'finish', round: G.round, integrity: G.integrity, winner: G.winner, reason: G.winReason, completedRounds: G.completedRounds ?? 0 });
}

function copyQuestion(question: TuringQuestion): TuringQuestion {
  return { id: question.id, category: question.category, prompt: question.prompt, low: question.low, high: question.high };
}
function publicLog(entry: TuringEvent): TuringEvent {
  return {
    type: entry.type, round: entry.round,
    ...(entry.examinerID === undefined ? {} : { examinerID: entry.examinerID }),
    ...(entry.question === undefined ? {} : { question: copyQuestion(entry.question) }),
    ...(entry.answers === undefined ? {} : { answers: { ...entry.answers } }),
    ...(entry.actorID === undefined ? {} : { actorID: entry.actorID }),
    ...(entry.targetID === undefined ? {} : { targetID: entry.targetID }),
    ...(entry.cardID === undefined ? {} : { cardID: entry.cardID }),
    ...(entry.slot === undefined ? {} : { slot: entry.slot }),
    ...(entry.number === undefined ? {} : { number: entry.number }),
    ...(entry.error === undefined ? {} : { error: entry.error }),
    ...(entry.integrity === undefined ? {} : { integrity: entry.integrity }),
    ...(entry.winner === undefined ? {} : { winner: entry.winner }),
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.completedRounds === undefined ? {} : { completedRounds: entry.completedRounds }),
    ...(entry.policies === undefined ? {} : { policies: Object.fromEntries(TURING_APPROVAL_KEYS.filter(key => entry.policies![key] !== undefined).map(key => [key, entry.policies![key]])) }),
  };
}
function copyPrivate(info: TuringPrivateInfo): TuringPrivateInfo {
  return { number: info.number, ...(info.answer === undefined ? {} : { answer: info.answer }),
    ...(info.cards === undefined ? {} : { cards: info.cards.map(({ id, number }) => ({ id, number })) }) };
}
/** All views are reconstructed, so added server secrets are private by default. */
export function turingPlayerView({ G, playerID }: { G: TuringState; playerID: string | null }): TuringState {
  const privateInfo: TuringState['private'] = {};
  for (const id of Object.keys(G.players)) {
    if (G.private[id] && (G.status === 'finished' || id === playerID)) privateInfo[id] = copyPrivate(G.private[id]);
  }
  return {
    rulesVersion: G.rulesVersion, status: G.status,
    players: Object.fromEntries(Object.entries(G.players).map(([id, player]) => [id, {
      ready: player.ready, acknowledged: player.acknowledged, answered: player.answered,
    }])),
    private: privateInfo, round: G.round, targetRounds: G.targetRounds,
    ...(G.completedRounds === undefined ? {} : { completedRounds: G.completedRounds }),
    integrity: G.integrity, maxIntegrity: G.maxIntegrity, examinerID: G.examinerID,
    question: G.question ? copyQuestion(G.question) : null,
    answers: { ...G.answers }, ...(G.cards === undefined ? {} : { cards: turingCards(G) }),
    ...(isTuringSharedTable(G) ? { tableOrder: turingTableOrder(G) } : G.tableOrder === undefined ? {} : { tableOrder: [...G.tableOrder] }),
    ...(G.orderApprovals === undefined ? {} : { orderApprovals: [...G.orderApprovals] }),
    ...(G.redrawApprovals === undefined ? {} : { redrawApprovals: [...G.redrawApprovals] }),
    revealed: G.revealed.map(({ playerID, number, error, cardID, slot }) => ({ playerID, number, error,
      ...(cardID === undefined ? {} : { cardID }), ...(slot === undefined ? {} : { slot }) })),
    epoch: G.epoch, options: { deck: G.options.deck, customQuestions: G.options.customQuestions.map(({ prompt, low, high }) => ({ prompt, low, high })),
      ...(G.options.mode === undefined ? {} : { mode: G.options.mode }), ...(G.options.lives === undefined ? {} : { lives: G.options.lives }),
      ...(G.options.redrawApproval === undefined ? {} : { redrawApproval: G.options.redrawApproval }),
      ...(G.options.orderApproval === undefined ? {} : { orderApproval: G.options.orderApproval }),
      ...(G.options.nextApproval === undefined ? {} : { nextApproval: G.options.nextApproval }) },
    winner: G.winner, winReason: G.winReason, log: G.log.map(publicLog),
  };
}
export function turingObserverView(G: TuringState, perspective: 'blind' | 'god'): TuringState {
  const view = turingPlayerView({ G, playerID: null });
  if (perspective === 'god') {
    for (const id of Object.keys(G.players)) if (G.private[id]) view.private[id] = copyPrivate(G.private[id]);
  }
  return view;
}

const simultaneousMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const TuringGame: Game<TuringState, Record<string, unknown>, TuringSetupData> = {
  name: 'turing-test', minPlayers: 2, maxPlayers: 9,
  validateSetupData: (data, numPlayers) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data)
      || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '遊戲開始設定不正確。';
    const optionsError = validateTuringOptions(data?.options, numPlayers);
    if (optionsError) return optionsError;
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs)
      || data.participantIDs.length !== numPlayers || data.participantIDs.some(id => !isPlayerSeatID(id))
      || new Set(data.participantIDs).size !== numPlayers)) return '參與玩家席位不正確。';
    return undefined;
  },
  setup: ({ ctx, random }, data) => {
    const invalid = validateTuringOptions(data?.options, ctx.numPlayers);
    if (invalid) throw new Error(invalid);
    const ids = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, index) => String(index));
    const options = normalizeTuringOptions(data?.options);
    const integrity = options.mode === 'endless' ? options.lives! : Math.max(3, Math.min(ctx.numPlayers, 8));
    const G: TuringState = {
      rulesVersion: 4, status: 'lobby',
      players: Object.fromEntries(ids.map(id => [id, { ready: data?.startImmediately === true, acknowledged: false, answered: false }])),
      private: {}, cards: {}, round: 0, completedRounds: 0, targetRounds: options.mode === 'endless' ? null : TURING_ROUNDS, integrity, maxIntegrity: integrity,
      examinerID: '', question: null, answers: {}, revealed: [], epoch: 0,
      options, winner: null, winReason: null, log: [],
    };
    if (data?.startImmediately) beginGame(G, random);
    return G;
  },
  turn: {
    order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => Object.keys(G.players) },
    activePlayers: ActivePlayers.ALL,
  },
  moves: {
    setReady: { move: setReady, client: false, undoable: false, redact: true },
    startGame: { move: startGame, client: false, undoable: false, redact: true },
    acknowledge: { move: acknowledge, ...simultaneousMove },
    submitAnswer: { move: submitAnswer, ...simultaneousMove },
    confirmSpoken: { move: confirmSpoken, ...simultaneousMove },
    revealAnswer: { move: revealAnswer, ...simultaneousMove },
    placeCard: { move: placeCard, ...simultaneousMove },
    removeCard: { move: removeCard, ...simultaneousMove },
    approveOrder: { move: approveOrder, ...simultaneousMove },
    withdrawApproval: { move: withdrawApproval, ...simultaneousMove },
    approveRedraw: { move: approveRedraw, ...simultaneousMove },
    withdrawRedraw: { move: withdrawRedraw, ...simultaneousMove },
  },
  disableUndo: true,
  plugins: [{
    name: 'turing-flow-guard', setup: () => ({}),
    isInvalid: ({ G, ctx }) => {
      if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason
        ? false : 'Game completion must follow the turing rules.';
      if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== Object.keys(G.players)[0]
        || ctx.phase !== null || !ctx.activePlayers || Object.keys(ctx.activePlayers).length !== Object.keys(G.players).length
        || Object.keys(G.players).some(id => ctx.activePlayers![id] !== null)
        || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
        || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for this game.';
      return false;
    },
  }],
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: turingPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};

/** Only the authenticated HTTP host route may construct this reducer. Do not
 * register it with the public Socket.IO game registry: the execution seat is
 * merely a framework slot and is not proof of host authority. */
export const TuringHostGame: typeof TuringGame = {
  ...TuringGame,
  moves: {
    ...TuringGame.moves,
    serverApproveOrder: {
      move: (context: MoveContext, epoch: unknown, actorID: unknown) => {
        if (!isSeat(context.G, actorID)) return INVALID_MOVE;
        return applyOrderApproval(context, epoch, { actorID });
      }, ...simultaneousMove,
    },
    serverApproveRedraw: {
      move: (context: MoveContext, epoch: unknown, actorID: unknown) => {
        if (!isSeat(context.G, actorID)) return INVALID_MOVE;
        return applyRedrawApproval(context, epoch, { actorID });
      }, ...simultaneousMove,
    },
    serverApproveNext: {
      move: (context: MoveContext, epoch: unknown, actorID: unknown) => {
        if (!isSeat(context.G, actorID) || context.G.status !== 'round-review') return INVALID_MOVE;
        return applyAcknowledgement(context, epoch, { actorID });
      }, ...simultaneousMove,
    },
    serverSetApprovalPolicies: { move: setApprovalPolicies, ...simultaneousMove },
    serverFinishChallenge: { move: finishChallenge, ...simultaneousMove },
  },
};
