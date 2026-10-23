import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { turingQuestionPool } from './questions';
import { normalizeTuringAnswer, normalizeTuringOptions, TURING_ROUNDS, validateTuringOptions, type TuringOptions, type TuringQuestion } from './rules';

export type { TuringOptions, TuringQuestion } from './rules';
export type TuringStatus = 'lobby' | 'briefing' | 'answering' | 'sorting' | 'round-review' | 'finished';
export type TuringWinner = 'humans' | 'system';
export type TuringWinReason = 'calibrated' | 'integrity-lost';
export interface TuringSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: TuringOptions }
export interface TuringPlayer { ready: boolean; acknowledged: boolean; answered: boolean }
export interface TuringPrivateInfo { number: number; answer?: string }
export interface TuringRevealed { playerID: string; number: number; error: boolean }
export interface TuringEvent {
  type: 'round-start' | 'answers' | 'reveal' | 'round-complete' | 'finish';
  round: number;
  examinerID?: string;
  question?: TuringQuestion;
  answers?: Record<string, string>;
  actorID?: string;
  targetID?: string;
  number?: number;
  error?: boolean;
  integrity?: number;
  winner?: TuringWinner;
  reason?: TuringWinReason;
}
export interface TuringState {
  rulesVersion: 1;
  status: TuringStatus;
  players: Record<string, TuringPlayer>;
  private: Record<string, TuringPrivateInfo>;
  round: number;
  targetRounds: 5;
  integrity: number;
  maxIntegrity: number;
  examinerID: string;
  question: TuringQuestion | null;
  answers: Record<string, string>;
  revealed: TuringRevealed[];
  epoch: number;
  options: TuringOptions;
  winner: TuringWinner | null;
  winReason: TuringWinReason | null;
  log: TuringEvent[];
  /** Server only, omitted from every view including god and completed games. */
  secretQuestionQueue?: TuringQuestion[];
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
  G.winReason = won ? 'calibrated' : 'integrity-lost';
  transition(G, 'finished');
  G.log.push({ type: 'finish', round: G.round, integrity: G.integrity, winner: G.winner, reason: G.winReason });
}
function beginRound(G: TuringState, random: RandomAPI): void {
  const question = G.secretQuestionQueue?.shift();
  if (!question) throw new Error('本局題目快照不足，無法開始下一輪。');
  G.question = { ...question };
  G.private = {};
  G.answers = {};
  G.revealed = [];
  const numbers = random.Shuffle(Array.from({ length: 10 }, (_, index) => index + 1));
  const answeringIDs = Object.keys(G.players).filter(id => id !== G.examinerID);
  answeringIDs.forEach((id, index) => { G.private[id] = { number: numbers[index] }; });
  for (const player of Object.values(G.players)) player.answered = false;
  transition(G, 'briefing');
  G.log.push({ type: 'round-start', round: G.round, examinerID: G.examinerID, question: { ...question }, integrity: G.integrity });
}
function beginGame(G: TuringState, random: RandomAPI): void {
  G.round = 1;
  G.examinerID = random.Shuffle(Object.keys(G.players))[0];
  G.secretQuestionQueue = random.Shuffle(turingQuestionPool(G.options)).slice(0, TURING_ROUNDS);
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
  if (G.status !== 'answering' || !validToken(G, playerID, epoch)
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
function revealAnswer({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  if (G.status !== 'sorting' || !validToken(G, playerID, epoch) || playerID !== G.examinerID
    || !isSeat(G, targetID) || targetID === G.examinerID
    || G.revealed.some(entry => entry.playerID === targetID)) return INVALID_MOVE;
  const number = G.private[targetID].number;
  const previous = G.revealed.at(-1)?.number;
  const error = previous !== undefined && number < previous;
  if (error) G.integrity -= 1;
  G.revealed.push({ playerID: targetID, number, error });
  G.epoch += 1;
  G.log.push({ type: 'reveal', round: G.round, actorID: playerID, targetID, number, error, integrity: G.integrity });
  if (G.integrity === 0) { finish(G, false); return; }
  if (G.revealed.length !== Object.keys(G.players).length - 1) return;
  G.log.push({ type: 'round-complete', round: G.round, integrity: G.integrity });
  if (G.round === TURING_ROUNDS) finish(G, true);
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
    ...(entry.number === undefined ? {} : { number: entry.number }),
    ...(entry.error === undefined ? {} : { error: entry.error }),
    ...(entry.integrity === undefined ? {} : { integrity: entry.integrity }),
    ...(entry.winner === undefined ? {} : { winner: entry.winner }),
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
  };
}
function copyPrivate(info: TuringPrivateInfo): TuringPrivateInfo {
  return { number: info.number, ...(info.answer === undefined ? {} : { answer: info.answer }) };
}
/** All views are reconstructed, so added server secrets are private by default. */
export function turingPlayerView({ G, playerID }: { G: TuringState; playerID: string | null }): TuringState {
  const privateInfo: TuringState['private'] = {};
  for (const id of Object.keys(G.players)) {
    if (G.private[id] && (G.status === 'finished' || id === playerID)) privateInfo[id] = copyPrivate(G.private[id]);
  }
  return {
    rulesVersion: 1, status: G.status,
    players: Object.fromEntries(Object.entries(G.players).map(([id, player]) => [id, {
      ready: player.ready, acknowledged: player.acknowledged, answered: player.answered,
    }])),
    private: privateInfo, round: G.round, targetRounds: G.targetRounds,
    integrity: G.integrity, maxIntegrity: G.maxIntegrity, examinerID: G.examinerID,
    question: G.question ? copyQuestion(G.question) : null,
    answers: { ...G.answers }, revealed: G.revealed.map(({ playerID, number, error }) => ({ playerID, number, error })),
    epoch: G.epoch, options: { deck: G.options.deck, customQuestions: G.options.customQuestions.map(({ prompt, low, high }) => ({ prompt, low, high })) },
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
  name: 'turing-test', minPlayers: 4, maxPlayers: 9,
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
    const G: TuringState = {
      rulesVersion: 1, status: 'lobby',
      players: Object.fromEntries(ids.map(id => [id, { ready: data?.startImmediately === true, acknowledged: false, answered: false }])),
      private: {}, round: 0, targetRounds: 5, integrity: Math.min(ctx.numPlayers, 8), maxIntegrity: Math.min(ctx.numPlayers, 8),
      examinerID: '', question: null, answers: {}, revealed: [], epoch: 0,
      options: normalizeTuringOptions(data?.options), winner: null, winReason: null, log: [],
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
