import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { turingQuestionPool } from './questions';
import { normalizeTuringAnswer, normalizeTuringOptions, TURING_ROUNDS, validateTuringOptions, type TuringOptions, type TuringQuestion } from './rules';

export type { TuringOptions, TuringQuestion } from './rules';
export type TuringStatus = 'lobby' | 'briefing' | 'answering' | 'sorting' | 'round-review' | 'finished';
export type TuringWinner = 'humans' | 'system';
export type TuringWinReason = 'calibrated' | 'integrity-lost' | 'endless-exhausted';
export interface TuringSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: TuringOptions }
export interface TuringPlayer { ready: boolean; acknowledged: boolean; answered: boolean }
export interface TuringCard { playerID: string; slot: 'A' | 'B'; spoken: boolean }
export interface TuringPrivateInfo { number: number; answer?: string; cards?: { id: string; number: number }[] }
export interface TuringRevealed { playerID: string; number: number; error: boolean; cardID?: string; slot?: 'A' | 'B' }
export interface TuringEvent {
  type: 'round-start' | 'answers' | 'spoken' | 'reveal' | 'round-complete' | 'finish';
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
}
export interface TuringState {
  rulesVersion: 1 | 2;
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

/** Public answer slots, including the single slot used by persisted v1 games. */
export function turingCards(G: TuringState): Record<string, TuringCard> {
  if (G.rulesVersion === 2) return Object.fromEntries(Object.entries(G.cards ?? {}).map(([id, card]) => [id, {
    playerID: card.playerID, slot: card.slot, spoken: card.spoken,
  }]));
  return Object.fromEntries(Object.keys(G.players).filter(id => id !== G.examinerID).map(id => [id, {
    playerID: id, slot: 'A' as const, spoken: G.players[id].answered,
  }]));
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
  G.winReason = won ? 'calibrated' : G.rulesVersion === 2 && G.options.mode === 'endless' ? 'endless-exhausted' : 'integrity-lost';
  transition(G, 'finished');
  G.log.push({ type: 'finish', round: G.round, integrity: G.integrity, winner: G.winner, reason: G.winReason });
}
function beginRound(G: TuringState, random: RandomAPI): void {
  let question: TuringQuestion | undefined;
  if (G.rulesVersion === 1) question = G.secretQuestionQueue?.shift();
  else {
    const pool = turingQuestionPool(G.options);
    let used = new Set(G.secretDrawIDs ?? []);
    let remaining = pool.filter(item => !used.has(item.id));
    if (!remaining.length) {
      used = new Set();
      // The new cycle may revisit older questions, but never repeat the one just played.
      remaining = pool.filter(item => item.id !== G.question?.id);
    }
    question = random.Shuffle(remaining)[0];
    if (question) { used.add(question.id); G.secretDrawIDs = [...used]; }
  }
  if (!question) throw new Error('本局題目快照不足，無法開始下一輪。');
  G.question = { ...question };
  G.private = {};
  G.answers = {};
  G.revealed = [];
  if (G.rulesVersion === 2) G.cards = {};
  const numbers = random.Shuffle(Array.from({ length: 10 }, (_, index) => index + 1));
  const answeringIDs = Object.keys(G.players).filter(id => id !== G.examinerID);
  const perPlayer = G.rulesVersion === 2 && Object.keys(G.players).length <= 3 ? 2 : 1;
  answeringIDs.forEach((id, index) => {
    const cards = Array.from({ length: perPlayer }, (_, slot) => ({
      id: perPlayer === 1 ? id : `${id}-${slot === 0 ? 'a' : 'b'}`, number: numbers[index * perPlayer + slot],
    }));
    G.private[id] = G.rulesVersion === 1 ? { number: cards[0].number } : { number: cards[0].number, cards };
    if (G.rulesVersion === 2) for (const [slot, card] of cards.entries()) {
      G.cards![card.id] = { playerID: id, slot: slot === 0 ? 'A' : 'B', spoken: false };
    }
  });
  for (const player of Object.values(G.players)) player.answered = false;
  transition(G, 'briefing');
  G.log.push({ type: 'round-start', round: G.round, examinerID: G.examinerID, question: { ...question }, integrity: G.integrity });
}
function beginGame(G: TuringState, random: RandomAPI): void {
  G.round = 1;
  G.examinerID = random.Shuffle(Object.keys(G.players))[0];
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
function acknowledge({ G, playerID, random }: MoveContext, epoch: unknown) {
  if (!['briefing', 'round-review'].includes(G.status) || !validToken(G, playerID, epoch)
    || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.players[playerID].acknowledged = true;
  if (!Object.values(G.players).every(player => player.acknowledged)) return;
  if (G.status === 'briefing') transition(G, 'answering');
  else {
    const ids = Object.keys(G.players);
    G.examinerID = ids[(ids.indexOf(G.examinerID) + 1) % ids.length];
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
  if (G.rulesVersion !== 2 || G.status !== 'answering' || !validToken(G, playerID, epoch)
    || typeof cardID !== 'string' || !G.cards || !Object.hasOwn(G.cards, cardID)
    || G.cards[cardID].playerID !== playerID || G.cards[cardID].spoken) return INVALID_MOVE;
  G.cards[cardID].spoken = true;
  G.players[playerID].answered = Object.values(G.cards).filter(card => card.playerID === playerID).every(card => card.spoken);
  if (!Object.values(G.cards).every(card => card.spoken)) return;
  transition(G, 'sorting');
  G.log.push({ type: 'spoken', round: G.round });
}
function revealAnswer({ G, playerID }: MoveContext, cardID: unknown, epoch: unknown) {
  if (G.status !== 'sorting' || !validToken(G, playerID, epoch) || playerID !== G.examinerID
    || typeof cardID !== 'string') return INVALID_MOVE;
  const cards = turingCards(G);
  if (!Object.hasOwn(cards, cardID) || G.revealed.some(entry => (entry.cardID ?? entry.playerID) === cardID)) return INVALID_MOVE;
  const card = cards[cardID], targetID = card.playerID, number = turingCardNumber(G, cardID);
  if (number === undefined) return INVALID_MOVE;
  const previous = G.revealed.at(-1)?.number;
  const error = previous !== undefined && number < previous;
  if (error) G.integrity -= 1;
  const slot = G.rulesVersion === 2 ? { cardID, slot: card.slot } : {};
  G.revealed.push({ playerID: targetID, number, error, ...slot });
  G.epoch += 1;
  G.log.push({ type: 'reveal', round: G.round, actorID: playerID, targetID, number, error, integrity: G.integrity, ...slot });
  if (G.integrity === 0) { finish(G, false); return; }
  if (G.revealed.length !== Object.keys(cards).length) return;
  if (G.rulesVersion === 2) G.completedRounds = (G.completedRounds ?? 0) + 1;
  G.log.push({ type: 'round-complete', round: G.round, integrity: G.integrity });
  if (G.targetRounds !== null && G.round >= G.targetRounds) finish(G, true);
  else transition(G, 'round-review');
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
    revealed: G.revealed.map(({ playerID, number, error, cardID, slot }) => ({ playerID, number, error,
      ...(cardID === undefined ? {} : { cardID }), ...(slot === undefined ? {} : { slot }) })),
    epoch: G.epoch, options: { deck: G.options.deck, customQuestions: G.options.customQuestions.map(({ prompt, low, high }) => ({ prompt, low, high })),
      ...(G.options.mode === undefined ? {} : { mode: G.options.mode }), ...(G.options.lives === undefined ? {} : { lives: G.options.lives }) },
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
      rulesVersion: 2, status: 'lobby',
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
