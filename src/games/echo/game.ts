import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { echoUsedWordKeys, echoWord, echoWordKey, ECHO_REVIEW_SECONDS, normalizeEchoOptions, validateEchoOptions, type EchoOptions } from './rules';

export type EchoResult = 'same-word' | 'same-meaning' | 'round-limit';
export interface EchoRound { number: number; words: Record<string, string>; timedOut: boolean }
export interface EchoState {
  rulesVersion: 1 | 2;
  status: 'lobby' | 'writing' | 'review' | 'finished';
  options: EchoOptions;
  players: Record<string, { ready: boolean; sealed: boolean; reviewed: boolean }>;
  round: number;
  epoch: number;
  phaseEpoch: number;
  deadline: number | null;
  clues: string[];
  history: EchoRound[];
  result: EchoResult | null;
  private: Record<string, { word?: string; draft?: string; agrees?: boolean }>;
}
interface EchoSetup { startImmediately?: boolean; participantIDs?: string[]; options?: EchoOptions }
type EchoMove = FnContext<EchoState> & { playerID: string };
const ids = (G: EchoState) => Object.keys(G.players);
const latestRound = (G: EchoState) => G.history.at(-1);
export function echoCanAgree(G: EchoState) {
  const round = latestRound(G);
  return !!round && !round.timedOut && Object.keys(round.words).length === ids(G).length
    && (G.status === 'review' || (G.rulesVersion === 2 && G.status === 'writing' && round.number === G.round - 1));
}
export const echoWinner = (result: EchoResult) => result === 'round-limit' ? 'unmatched' : 'guests';

function clearPrivate(G: EchoState) {
  G.private = {};
  for (const player of Object.values(G.players)) { player.sealed = false; player.reviewed = false; }
}
function transition(G: EchoState, status: EchoState['status'], deadline: number | null) {
  G.status = status;
  G.deadline = deadline;
  G.phaseEpoch = ++G.epoch;
}
const writingDeadline = (seconds: EchoOptions['seconds'], now: number) => seconds === 0 ? null : now + seconds * 1000;
function beginRound(G: EchoState, now: number) {
  clearPrivate(G);
  G.round++;
  G.options = normalizeEchoOptions(G.options);
  transition(G, 'writing', writingDeadline(G.options.seconds, now));
}
function finish(G: EchoState, result: EchoResult) {
  clearPrivate(G);
  G.result = result;
  transition(G, 'finished', null);
}
function repeatsWord(G: EchoState, word: string) {
  return G.options.allowRepeats === false && echoUsedWordKeys(G.history).has(echoWordKey(word));
}

function reveal(G: EchoState, now: number, timedOut: boolean) {
  const words = Object.fromEntries(ids(G).flatMap(id => {
    const entry = G.private[id];
    const word = timedOut && (!G.players[id].sealed || G.options.allowChanges) ? entry?.draft ?? entry?.word : entry?.word;
    return word ? [[id, word]] : [];
  }));
  G.history.push({ number: G.round, words, timedOut });
  const submitted = Object.values(words);
  if (submitted.length === ids(G).length && new Set(submitted.map(echoWordKey)).size === 1) {
    finish(G, 'same-word');
    return;
  }
  if (timedOut) { nextAfterReveal(G, now); return; }
  if (G.rulesVersion === 2 && G.round < G.options.roundLimit) { nextAfterReveal(G, now); return; }
  clearPrivate(G);
  transition(G, 'review', now + ECHO_REVIEW_SECONDS * 1000);
}
function endReview(G: EchoState, now: number) {
  if (echoCanAgree(G) && ids(G).every(id => G.private[id]?.agrees === true)) {
    G.round = latestRound(G)!.number;
    finish(G, 'same-meaning');
    return;
  }
  nextAfterReveal(G, now);
}
function nextAfterReveal(G: EchoState, now: number) {
  if (G.round >= G.options.roundLimit) { finish(G, 'round-limit'); return; }
  const words = Object.values(latestRound(G)!.words);
  if (words.length >= 2) G.clues = [...new Map(words.map(word => [echoWordKey(word), word])).values()];
  beginRound(G, now);
}

export function advanceEchoClock(G: EchoState, now: number): boolean {
  if (G.deadline === null || now < G.deadline) return false;
  if (G.status === 'writing') reveal(G, now, true);
  else if (G.status === 'review') endReview(G, now);
  else return false;
  return true;
}

/** Called only after host authorization inside the room queue. */
export function updateLiveEchoOptions(G: EchoState, options: EchoOptions, now: number) {
  if (G.status === 'writing' && options.seconds !== G.options.seconds) {
    G.deadline = writingDeadline(options.seconds, now);
  }
  G.options = options;
  G.epoch++;
}

function mayAct(G: EchoState, playerID: string, phase: unknown, status: EchoState['status'], now: number) {
  return G.status === status && Object.hasOwn(G.players, playerID) && phase === G.phaseEpoch
    && (G.deadline === null || now < G.deadline);
}
function sealWord({ G, playerID }: EchoMove, value: unknown, phase: unknown) {
  const now = Date.now(), word = echoWord(value);
  if (!word || !mayAct(G, playerID, phase, 'writing', now)
    || repeatsWord(G, word)
    || (G.players[playerID].sealed && (!G.options.allowChanges || word === G.private[playerID]?.word))) return INVALID_MOVE;
  G.players[playerID].sealed = true;
  G.private[playerID] = { ...G.private[playerID], word, draft: word };
  G.epoch++;
  if (ids(G).every(id => G.players[id].sealed)) reveal(G, now, false);
}
function saveDraft({ G, playerID }: EchoMove, value: unknown, phase: unknown) {
  if (!mayAct(G, playerID, phase, 'writing', Date.now()) || (G.players[playerID].sealed && !G.options.allowChanges)) return INVALID_MOVE;
  const word = typeof value === 'string' && value.trim() === '' ? '' : echoWord(value);
  const draft = word && repeatsWord(G, word) ? '' : word;
  const prior = G.private[playerID];
  if (draft === undefined || draft === (prior?.draft ?? '')) return INVALID_MOVE;
  G.private[playerID] = { ...prior, draft };
}
function reviewWords({ G, playerID }: EchoMove, agrees: unknown, phase: unknown) {
  const now = Date.now();
  const concurrent = G.rulesVersion === 2;
  if ((G.status !== 'review' && !(concurrent && G.status === 'writing'))
    || !mayAct(G, playerID, phase, G.status, now) || G.players[playerID].reviewed
    || typeof agrees !== 'boolean' || (agrees ? !echoCanAgree(G) : concurrent)) return INVALID_MOVE;
  G.players[playerID].reviewed = true;
  G.private[playerID] = { ...G.private[playerID], agrees };
  G.epoch++;
  if (ids(G).every(id => G.players[id].reviewed)) endReview(G, now);
}
function setReady({ G, playerID }: EchoMove, ready: unknown) {
  if (G.status !== 'lobby' || !Object.hasOwn(G.players, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID }: EchoMove) {
  if (G.status !== 'lobby' || playerID !== ids(G)[0] || !ids(G).every(id => G.players[id].ready)) return INVALID_MOVE;
  beginRound(G, Date.now());
}
export function echoPlayerView({ G, playerID }: { G: EchoState; playerID: string | null }): EchoState {
  const { private: secret, ...publicState } = G;
  return { ...publicState, private: playerID !== null && Object.hasOwn(secret, playerID) ? { [playerID]: secret[playerID] } : {} };
}
export const echoObserverView = (G: EchoState) => echoPlayerView({ G, playerID: null });

const serverMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const EchoGame: Game<EchoState, Record<string, unknown>, EchoSetup> = {
  name: 'cup-echo', minPlayers: 2, maxPlayers: 4,
  validateSetupData: (data, count) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data)
      || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '遊戲開始設定不正確。';
    const error = validateEchoOptions(data?.options, count);
    if (error) return error;
    const seats = data?.participantIDs;
    if (seats !== undefined && (!Array.isArray(seats) || seats.length !== count || seats.some(id => !isPlayerSeatID(id))
      || new Set(seats).size !== count)) return '參與玩家席位不正確。';
    return undefined;
  },
  setup: ({ ctx }, data) => {
    const seats = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, i) => String(i));
    const G: EchoState = {
      rulesVersion: 2, options: normalizeEchoOptions(data?.options), status: 'lobby', round: 0, epoch: 0, phaseEpoch: 0,
      deadline: null, clues: [], history: [], result: null, private: {},
      players: Object.fromEntries(seats.map(id => [id, { ready: data?.startImmediately === true, sealed: false, reviewed: false }])),
    };
    if (data?.startImmediately) beginRound(G, Date.now());
    return G;
  },
  turn: { order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => ids(G) }, activePlayers: ActivePlayers.ALL },
  moves: { setReady: { move: setReady, ...serverMove }, startGame: { move: startGame, ...serverMove }, sealWord: { move: sealWord, ...serverMove },
    saveDraft: { move: saveDraft, ...serverMove }, reviewWords: { move: reviewWords, ...serverMove } },
  disableUndo: true,
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: echoPlayerView,
  endIf: ({ G }) => G.result ? { winner: echoWinner(G.result), reason: G.result } : undefined,
};
