import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { createHeistBaseDeck, HEIST_ARTIFACTS, HEIST_ARTIFACT_IDS, HEIST_HAZARD_IDS, HEIST_ROUND_COUNT, type HeistArtifact, type HeistCard, type HeistHazard } from './content';
import { normalizeHeistOptions, validateHeistOptions, type HeistOptions } from './rules';
export type { HeistArtifact, HeistCard, HeistHazard } from './content';
export type HeistChoice = 'explore' | 'exit';
export type HeistStatus = 'lobby' | 'briefing' | 'decision' | 'review' | 'finished';
export interface HeistPlayer { ready: boolean; acknowledged: boolean; exploring: boolean; carried: number; artifacts: HeistArtifact[]; submitted: boolean }
export interface HeistPrivate { banked: number; choice: HeistChoice | null }
export interface HeistReturn { playerID: string; carried: number; pathShare: number; bankedDelta: number; artifacts: HeistArtifact[] }
export interface HeistDecision { round: number; step: number; choices: Record<string, HeistChoice>; exited: string[]; continued: string[]; returns: HeistReturn[] }
export interface HeistRoundResult {
  round: number; reason: 'all-exited' | 'hazard'; hazard: HeistHazard | null;
  escaped: string[]; lost: Record<string, number>; discardedArtifacts: HeistArtifact[]; discardedLeftovers: number;
}
export interface HeistScore { banked: number; artifactValue: number; artifactCount: number; total: number }
export interface HeistLogEntry {
  type: 'round-start' | 'reveal' | 'decision' | 'exit' | 'disaster' | 'round-end' | 'finish';
  round: number; step: number; message: string; card?: HeistCard; choices?: Record<string, HeistChoice>;
  returns?: HeistReturn[]; lost?: Record<string, number>; hazard?: HeistHazard; artifact?: HeistArtifact; winnerIDs?: string[];
}
interface HeistSecret { deck: HeistCard[]; recycle: HeistCard[] }
export interface HeistState {
  rulesVersion: 1; status: HeistStatus; options: HeistOptions;
  players: Record<string, HeistPlayer>; private: Record<string, HeistPrivate>; turnOrder: string[];
  round: number; targetRounds: number; step: number;
  /** Every accepted move changes epoch. A batch keeps phaseEpoch so simultaneous arrivals remain valid. */
  epoch: number; phaseEpoch: number;
  path: HeistCard[]; leftovers: number; availableArtifacts: HeistArtifact[]; deckCount: number;
  removedHazards: Record<HeistHazard, number>; discardedArtifacts: HeistArtifact[];
  lastDecision: HeistDecision | null; roundResult: HeistRoundResult | null; log: HeistLogEntry[];
  finalScores: Record<string, HeistScore>; winner: 'heist' | null; winnerIDs: string[]; winReason: 'score' | null;
  /** Never sent to any player or observer, including god mode. */
  secret?: HeistSecret;
}
export interface HeistSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: HeistOptions }
export interface HeistAction { move: 'acknowledge' | 'decide'; args: unknown[] }
type MoveContext = FnContext<HeistState> & { playerID: string };
type RandomAPI = FnContext<HeistState>['random'];
const ids = (G: HeistState) => Object.keys(G.players);
const isSeat = (G: HeistState, id: unknown): id is string => typeof id === 'string' && Object.hasOwn(G.players, id);
const tokenValid = (G: HeistState, id: unknown, token: unknown): id is string => isSeat(G, id) && Number.isInteger(token) && token === G.phaseEpoch;
const explorers = (G: HeistState) => G.turnOrder.filter(id => G.players[id].exploring);
function log(G: HeistState, type: HeistLogEntry['type'], message: string, extra: Partial<HeistLogEntry> = {}) {
  G.log.push({ type, round: G.round, step: G.step, message, ...extra });
}
function clearSubmissions(G: HeistState) {
  for (const id of ids(G)) { G.players[id].submitted = false; G.private[id].choice = null; }
}
function beginBriefing(G: HeistState) {
  G.status = 'briefing'; G.epoch++; G.phaseEpoch = G.epoch;
  for (const player of Object.values(G.players)) player.acknowledged = false;
}
function finish(G: HeistState) {
  G.finalScores = Object.fromEntries(ids(G).map(id => {
    const banked = G.private[id].banked, artifacts = G.players[id].artifacts;
    const artifactValue = artifacts.reduce((total, artifact) => total + HEIST_ARTIFACTS[artifact].value, 0);
    return [id, { banked, artifactValue, artifactCount: artifacts.length, total: banked + artifactValue }];
  }));
  const best = Math.max(...Object.values(G.finalScores).map(score => score.total));
  const tied = G.turnOrder.filter(id => G.finalScores[id].total === best);
  const mostArtifacts = Math.max(...tied.map(id => G.finalScores[id].artifactCount));
  G.winnerIDs = tied.filter(id => G.finalScores[id].artifactCount === mostArtifacts);
  G.winner = 'heist'; G.winReason = 'score'; G.status = 'finished'; G.phaseEpoch = G.epoch;
  clearSubmissions(G); log(G, 'finish', '五幕落下，保險箱與名品的總價值決定最後贏家。', { winnerIDs: [...G.winnerIDs] });
}
function endRound(G: HeistState, reason: HeistRoundResult['reason'], hazard: HeistHazard | null = null) {
  const lost: Record<string, number> = {}, escaped = G.turnOrder.filter(id => !G.players[id].exploring);
  if (reason === 'hazard') {
    for (const id of explorers(G)) { lost[id] = G.players[id].carried; G.players[id].carried = 0; G.players[id].exploring = false; }
    log(G, 'disaster', '同類危機第二次出現，仍在金庫內的人失去本幕攜帶的贓物。', { hazard: hazard!, lost: { ...lost } });
  }
  G.roundResult = { round: G.round, reason, hazard, escaped, lost, discardedArtifacts: [...G.availableArtifacts], discardedLeftovers: G.leftovers };
  G.discardedArtifacts.push(...G.availableArtifacts); G.availableArtifacts = []; G.leftovers = 0;
  G.status = 'review'; G.phaseEpoch = G.epoch; clearSubmissions(G);
  for (const player of Object.values(G.players)) player.acknowledged = false;
  log(G, 'round-end', reason === 'hazard' ? '本幕被迫謝幕。確認結果後，再準備下一幕。' : '所有人都已撤離，本幕落下。');
}
function revealNext(G: HeistState) {
  // With 15 hazards and only four prior removals, a valid five-round game cannot exhaust the deck before a repeat.
  const card = G.secret!.deck.shift(); if (!card) throw new Error('謝幕劫案牌庫不應在危機重複前耗盡。');
  G.path.push(card); G.step++; G.deckCount = G.secret!.deck.length;
  log(G, 'reveal', card.kind === 'loot' ? '發現贓物，由仍在場的人均分。' : card.kind === 'artifact' ? '名品留在路上，等待獨自撤離的人帶走。' : '一種危機出現在金庫通道。', { card: { ...card } });
  if (card.kind === 'loot') {
    const active = explorers(G), share = Math.floor(card.value / active.length);
    for (const id of active) G.players[id].carried += share;
    G.leftovers += card.value % active.length; G.secret!.recycle.push(card);
  } else if (card.kind === 'artifact') G.availableArtifacts.push(card.artifact);
  else {
    const seen = G.path.filter(c => c.kind === 'hazard' && c.hazard === card.hazard).length;
    if (seen === 2) { G.removedHazards[card.hazard]++; endRound(G, 'hazard', card.hazard); return; }
    G.secret!.recycle.push(card);
  }
  G.status = 'decision'; G.phaseEpoch = G.epoch; clearSubmissions(G);
}
function beginRound(G: HeistState, random: RandomAPI) {
  G.round++; G.step = 0; G.path = []; G.leftovers = 0; G.availableArtifacts = []; G.lastDecision = null; G.roundResult = null;
  for (const player of Object.values(G.players)) { player.exploring = true; player.carried = 0; player.acknowledged = false; }
  const artifact = HEIST_ARTIFACT_IDS[G.round - 1];
  G.secret!.deck = random.Shuffle([...G.secret!.deck, ...G.secret!.recycle, { kind: 'artifact' as const, artifact }]);
  G.secret!.recycle = []; G.deckCount = G.secret!.deck.length;
  log(G, 'round-start', `第 ${G.round} 幕開始，本幕的名品加入金庫。`, { artifact });
  revealNext(G);
}
function resolveDecision(G: HeistState) {
  const active = explorers(G), choices = Object.fromEntries(active.map(id => [id, G.private[id].choice!])) as Record<string, HeistChoice>;
  const exited = active.filter(id => choices[id] === 'exit'), continued = active.filter(id => choices[id] === 'explore');
  const returns: HeistReturn[] = [];
  log(G, 'decision', '所有密封選擇同時公開。', { choices: { ...choices } });
  if (exited.length) {
    const pathShare = Math.floor(G.leftovers / exited.length), artifacts = exited.length === 1 ? [...G.availableArtifacts] : [];
    G.leftovers %= exited.length;
    for (const id of exited) {
      const player = G.players[id], bankedDelta = player.carried + pathShare;
      returns.push({ playerID: id, carried: player.carried, pathShare, bankedDelta, artifacts: [...artifacts] });
      G.private[id].banked += bankedDelta; player.carried = 0; player.exploring = false; player.artifacts.push(...artifacts);
    }
    if (exited.length === 1) G.availableArtifacts = [];
    log(G, 'exit', exited.length === 1 ? '一人獨自撤離，帶走路上的餘額與所有名品。' : '撤離者均分路上餘額，名品仍留在金庫內。', { returns: returns.map(entry => ({ ...entry, artifacts: [...entry.artifacts] })) });
  }
  G.lastDecision = { round: G.round, step: G.step, choices, exited, continued, returns };
  clearSubmissions(G);
  if (!continued.length) endRound(G, 'all-exited'); else revealNext(G);
}
function acknowledge({ G, playerID, random }: MoveContext, token: unknown) {
  if (!tokenValid(G, playerID, token) || !['briefing', 'review'].includes(G.status) || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.epoch++; G.players[playerID].acknowledged = true;
  if (ids(G).every(id => G.players[id].acknowledged)) {
    if (G.status === 'review' && G.round === HEIST_ROUND_COUNT) finish(G); else beginRound(G, random);
  }
}
function decide({ G, playerID }: MoveContext, choice: unknown, token: unknown) {
  if (!tokenValid(G, playerID, token) || G.status !== 'decision' || !G.players[playerID].exploring || G.players[playerID].submitted
    || (choice !== 'explore' && choice !== 'exit')) return INVALID_MOVE;
  G.epoch++; G.private[playerID].choice = choice; G.players[playerID].submitted = true;
  if (explorers(G).every(id => G.players[id].submitted)) resolveDecision(G);
}
function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== ids(G)[0] || !ids(G).every(id => G.players[id].ready)) return INVALID_MOVE;
  beginBriefing(G);
}
export function legalHeistActions(view: HeistState, playerID: string): HeistAction[] {
  if (!isSeat(view, playerID)) return [];
  if ((view.status === 'briefing' || view.status === 'review') && !view.players[playerID].acknowledged) return [{ move: 'acknowledge', args: [view.phaseEpoch] }];
  if (view.status !== 'decision' || !view.players[playerID].exploring || view.players[playerID].submitted) return [];
  return ['explore', 'exit'].map(choice => ({ move: 'decide', args: [choice, view.phaseEpoch] }));
}
export function heistPlayerView({ G, playerID }: { G: HeistState; playerID: string | null }): HeistState {
  const { secret: _secret, private: _private, ...publicState } = G;
  return { ...structuredClone(publicState), private: playerID !== null && isSeat(G, playerID) && G.private[playerID] ? { [playerID]: structuredClone(G.private[playerID]) } : {} };
}
export function heistObserverView(G: HeistState, perspective: 'blind' | 'god'): HeistState {
  const view = heistPlayerView({ G, playerID: null });
  if (perspective === 'god') view.private = Object.fromEntries(Object.entries(G.private).map(([id, info]) => [id, { banked: info.banked, choice: null }]));
  return view;
}
const serverMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const HeistGame: Game<HeistState, Record<string, unknown>, HeistSetupData> = {
  name: 'curtain-heist', minPlayers: 3, maxPlayers: 8,
  validateSetupData: (data, count) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data) || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '遊戲開始設定不正確。';
    const error = validateHeistOptions(data?.options, count); if (error) return error;
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs) || data.participantIDs.length !== count || data.participantIDs.some(id => !isPlayerSeatID(id)) || new Set(data.participantIDs).size !== count)) return '參與玩家席位不正確。';
    return undefined;
  },
  setup: ({ ctx }, data) => {
    const participants = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, i) => String(i));
    const G: HeistState = {
      rulesVersion: 1, status: 'lobby', options: normalizeHeistOptions(data?.options),
      players: Object.fromEntries(participants.map(id => [id, { ready: data?.startImmediately === true, acknowledged: false, exploring: false, carried: 0, artifacts: [], submitted: false }])),
      private: Object.fromEntries(participants.map(id => [id, { banked: 0, choice: null }])), turnOrder: [...participants],
      round: 0, targetRounds: HEIST_ROUND_COUNT, step: 0, epoch: 0, phaseEpoch: 0, path: [], leftovers: 0, availableArtifacts: [], deckCount: 30,
      removedHazards: Object.fromEntries(HEIST_HAZARD_IDS.map(id => [id, 0])) as Record<HeistHazard, number>, discardedArtifacts: [],
      lastDecision: null, roundResult: null, log: [], finalScores: {}, winner: null, winnerIDs: [], winReason: null,
      secret: { deck: createHeistBaseDeck(), recycle: [] },
    };
    if (data?.startImmediately) beginBriefing(G); return G;
  },
  turn: { order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => ids(G) }, activePlayers: ActivePlayers.ALL },
  moves: { setReady: { move: setReady, ...serverMove }, startGame: { move: startGame, ...serverMove }, acknowledge: { move: acknowledge, ...serverMove }, decide: { move: decide, ...serverMove } },
  disableUndo: true,
  plugins: [{ name: 'heist-flow-guard', setup: () => ({}), isInvalid: ({ G, ctx }) => {
    if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason ? false : 'Game completion must follow the heist rules.';
    if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== ids(G)[0] || ctx.phase !== null || !ctx.activePlayers
      || Object.keys(ctx.activePlayers).length !== ids(G).length || ids(G).some(id => ctx.activePlayers![id] !== null)
      || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
      || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for this game.';
    return false;
  } }],
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: heistPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
