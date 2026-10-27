import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { STAR_CARDS, STAR_CARD_LIST, STAR_COLORS, STAR_GUARDIANS, STAR_GUARDIAN_LIST, STAR_RESERVE_LIMIT, STAR_TARGET_PRESTIGE,
  STAR_TIERS, STAR_TOKEN_LIMIT, STAR_TOKENS, starEmptyBonuses, starEmptyTokens, starTokenTotal,
  type StarBonuses, type StarColor, type StarTier, type StarTokenCounts } from './content';
import { normalizeStarOptions, validateStarOptions } from './rules';
import type { StarAction, StarLogEntry, StarReserveTarget, StarSetupData, StarState } from './types';
export * from './types';
export type { StarBonuses, StarColor, StarTier, StarToken, StarTokenCounts } from './content';

type MoveContext = FnContext<StarState> & { playerID: string };
const isSeat = (G: StarState, id: unknown): id is string => typeof id === 'string' && Object.hasOwn(G.players, id);
const isTurn = (G: StarState, id: unknown, token: unknown): id is string => G.status === 'turn' && isSeat(G, id)
  && G.activePlayer === id && Number.isInteger(token) && token === G.epoch;
const cardExists = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(STAR_CARDS, id);
const validCounts = (value: unknown): value is StarTokenCounts => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === STAR_TOKENS.length && STAR_TOKENS.every(color => Object.hasOwn(value, color)
    && Number.isSafeInteger((value as StarTokenCounts)[color]) && (value as StarTokenCounts)[color] >= 0);
function log(G: StarState, type: StarLogEntry['type'], message: string, extra: Partial<StarLogEntry> = {}) {
  G.log.push({ type, message, round: G.round, epoch: G.epoch, ...extra });
}
function updateDeckCounts(G: StarState) {
  for (const tier of STAR_TIERS) G.deckCounts[tier] = G.secret!.decks[tier].length;
}
function removeMarketCard(G: StarState, cardID: string) {
  const tier = STAR_CARDS[cardID].tier, slot = G.market[tier].indexOf(cardID);
  G.market[tier][slot] = G.secret!.decks[tier].shift() ?? null; updateDeckCounts(G);
}
function begin(G: StarState, random: FnContext<StarState>['random']) {
  G.epoch++; G.phaseEpoch = G.epoch; G.status = 'briefing'; G.round = 1; G.turnNumber = 0; G.activePlayer = null;
  const ordinary = G.turnOrder.length === 2 ? 4 : G.turnOrder.length === 3 ? 5 : 7;
  G.bank = { white: ordinary, blue: ordinary, green: ordinary, red: ordinary, black: ordinary, gold: 5 };
  const guardians = random.Shuffle(STAR_GUARDIAN_LIST.map(guardian => guardian.id));
  G.guardians = guardians.slice(0, G.turnOrder.length + 1);
  G.secret = { decks: { 1: [], 2: [], 3: [] }, unusedGuardians: guardians.slice(G.turnOrder.length + 1) };
  for (const tier of STAR_TIERS) {
    G.secret.decks[tier] = random.Shuffle(STAR_CARD_LIST.filter(card => card.tier === tier).map(card => card.id));
    G.market[tier] = G.secret.decks[tier].splice(0, 4);
  }
  updateDeckCounts(G);
  for (const id of G.turnOrder) {
    G.players[id] = { ready: true, acknowledged: false, tokens: starEmptyTokens(), bonuses: starEmptyBonuses(), purchased: [], guardians: [], prestige: 0, reserved: [] };
    G.private[id] = { reserved: [] };
  }
  log(G, 'start', '星材與作品已就位，所有星匠確認後開始打造。');
}

/** Cost and the representative payment use only public discounts and this seat's tokens. */
export function starDiscountedCost(G: StarState, playerID: string, cardID: string): StarBonuses | null {
  if (!isSeat(G, playerID) || !cardExists(cardID)) return null;
  return Object.fromEntries(STAR_COLORS.map(color => [color, Math.max(0, STAR_CARDS[cardID].cost[color] - G.players[playerID].bonuses[color])])) as StarBonuses;
}
export function starDefaultPayment(G: StarState, playerID: string, cardID: string): StarTokenCounts | null {
  const cost = starDiscountedCost(G, playerID, cardID); if (!cost) return null;
  const owned = G.players[playerID].tokens, payment = starEmptyTokens();
  for (const color of STAR_COLORS) { payment[color] = Math.min(cost[color], owned[color]); payment.gold += cost[color] - payment[color]; }
  return payment.gold <= owned.gold ? payment : null;
}
export function starValidPayment(G: StarState, playerID: string, cardID: string, payment: unknown): payment is StarTokenCounts {
  const cost = starDiscountedCost(G, playerID, cardID);
  if (!cost || !validCounts(payment) || STAR_TOKENS.some(color => payment[color] > G.players[playerID].tokens[color])) return false;
  return STAR_COLORS.every(color => payment[color] <= cost[color])
    && payment.gold === STAR_COLORS.reduce((sum, color) => sum + cost[color] - payment[color], 0);
}
export function starEligibleGuardians(G: StarState, playerID: string): string[] {
  if (!isSeat(G, playerID)) return [];
  return G.guardians.filter(id => STAR_COLORS.every(color => G.players[playerID].bonuses[color] >= STAR_GUARDIANS[id].requirements[color]));
}
export function legalStarTokenChoices(G: StarState): StarColor[][] {
  const available = STAR_COLORS.filter(color => G.bank[color] > 0), choices: StarColor[][] = [];
  function choose(start: number, count: number, selected: StarColor[]) {
    if (selected.length === count) { choices.push(selected); return; }
    for (let index = start; index < available.length; index++) choose(index + 1, count, [...selected, available[index]]);
  }
  if (available.length >= 3) choose(0, 3, []);
  else for (let count = 1; count <= available.length; count++) choose(0, count, []);
  for (const color of STAR_COLORS) if (G.bank[color] >= 4) choices.push([color, color]);
  return choices;
}
export function legalStarReserveTargets(G: StarState, playerID: string): StarReserveTarget[] {
  if (!isSeat(G, playerID) || G.players[playerID].reserved.length >= STAR_RESERVE_LIMIT) return [];
  return [...STAR_TIERS.flatMap(tier => G.market[tier].filter((id): id is string => id !== null).map(cardID => ({ kind: 'market' as const, cardID }))),
    ...STAR_TIERS.filter(tier => G.deckCounts[tier] > 0).map(tier => ({ kind: 'deck' as const, tier }))];
}
function finish(G: StarState, reason: 'completed-round' | 'stalemate' = 'completed-round') {
  G.status = 'finished'; G.activePlayer = null; G.pending = null; G.phaseEpoch = G.epoch;
  G.finalScores = Object.fromEntries(G.turnOrder.map(id => [id, G.players[id].prestige]));
  const prestige = Math.max(...Object.values(G.finalScores));
  const candidates = G.turnOrder.filter(id => G.finalScores[id] === prestige), count = Math.min(...candidates.map(id => G.players[id].purchased.length));
  G.winnerIDs = candidates.filter(id => G.players[id].purchased.length === count);
  G.winner = 'prestige'; G.winReason = reason;
  log(G, 'finish', reason === 'stalemate' ? '所有星匠連續無可用行動，以當前聲望與已購作品數結算。' : '本桌輪已完成，以最高聲望、最少已購作品決出星匠。');
}
function completeTurn(G: StarState, playerID: string, forcedPass = false) {
  G.pending = null; G.turnNumber++;
  G.forcedPasses = forcedPass ? [...G.forcedPasses, playerID] : [];
  if (G.endTriggeredBy === null && G.players[playerID].prestige >= STAR_TARGET_PRESTIGE) {
    G.endTriggeredBy = playerID; log(G, 'final-round', '有人達到十五點聲望，本桌輪結束時揭曉最終結果。', { actor: playerID });
  }
  const index = G.turnOrder.indexOf(playerID);
  if (G.endTriggeredBy !== null && index === G.turnOrder.length - 1) { finish(G); return; }
  if (G.forcedPasses.length === G.turnOrder.length) { finish(G, 'stalemate'); return; }
  if (index === G.turnOrder.length - 1) G.round++;
  G.activePlayer = G.turnOrder[(index + 1) % G.turnOrder.length]; G.status = 'turn'; G.phaseEpoch = G.epoch;
}
function awardGuardian(G: StarState, playerID: string, guardianID: string) {
  G.guardians = G.guardians.filter(id => id !== guardianID); G.players[playerID].guardians.push(guardianID);
  G.players[playerID].prestige += STAR_GUARDIANS[guardianID].prestige;
  log(G, 'guardian', '星座守護者帶來委託，增加三點聲望。', { actor: playerID, guardianID });
}
function resolveGuardians(G: StarState, playerID: string, forcedPass = false) {
  const eligible = starEligibleGuardians(G, playerID);
  if (eligible.length > 1) {
    G.pending = { playerID, returnCount: 0, guardianIDs: eligible, ...(forcedPass ? { forcedPass: true } : {}) }; G.status = 'choose-guardian'; G.phaseEpoch = G.epoch; return;
  }
  if (eligible.length === 1) awardGuardian(G, playerID, eligible[0]);
  completeTurn(G, playerID, forcedPass && eligible.length === 0);
}
function afterMainAction(G: StarState, playerID: string) {
  G.forcedPasses = [];
  const excess = starTokenTotal(G.players[playerID].tokens) - STAR_TOKEN_LIMIT;
  if (excess > 0) {
    G.pending = { playerID, returnCount: excess, guardianIDs: [] }; G.status = 'return-tokens'; G.phaseEpoch = G.epoch; return;
  }
  resolveGuardians(G, playerID);
}
function acknowledge({ G, playerID }: MoveContext, token: unknown) {
  if (G.status !== 'briefing' || !isSeat(G, playerID) || !Number.isInteger(token) || token !== G.phaseEpoch || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.epoch++; G.players[playerID].acknowledged = true;
  if (G.turnOrder.every(id => G.players[id].acknowledged)) { G.status = 'turn'; G.activePlayer = G.starter; G.phaseEpoch = G.epoch; }
}
function takeTokens({ G, playerID }: MoveContext, colors: unknown, token: unknown) {
  if (!isTurn(G, playerID, token) || !Array.isArray(colors) || !colors.length || colors.length > 3 || colors.some(color => !STAR_COLORS.includes(color))) return INVALID_MOVE;
  const selected = [...colors].sort().join(',');
  if (!legalStarTokenChoices(G).some(choice => [...choice].sort().join(',') === selected)) return INVALID_MOVE;
  G.epoch++; const gained = starEmptyTokens();
  for (const color of colors as StarColor[]) { G.bank[color]--; G.players[playerID].tokens[color]++; gained[color]++; }
  log(G, 'take', '從供應區取得星材。', { actor: playerID, tokens: gained }); afterMainAction(G, playerID);
}
function reserveCard({ G, playerID }: MoveContext, target: unknown, token: unknown) {
  if (!isTurn(G, playerID, token) || !target || typeof target !== 'object' || Array.isArray(target)) return INVALID_MOVE;
  const selected = legalStarReserveTargets(G, playerID).find(candidate => Object.keys(target).length === Object.keys(candidate).length
    && Object.entries(candidate).every(([key, value]) => (target as Record<string, unknown>)[key] === value));
  if (!selected) return INVALID_MOVE;
  G.epoch++;
  const cardID = selected.kind === 'market' ? selected.cardID : G.secret!.decks[selected.tier].shift()!;
  const card = STAR_CARDS[cardID], reservationID = `reserve-${G.nextReservationID++}`;
  if (selected.kind === 'market') removeMarketCard(G, cardID); else updateDeckCounts(G);
  G.players[playerID].reserved.push({ id: reservationID, tier: card.tier, knownCardID: selected.kind === 'market' ? cardID : null });
  G.private[playerID].reserved.push({ id: reservationID, cardID });
  const gained = starEmptyTokens();
  if (G.bank.gold > 0) { G.bank.gold--; G.players[playerID].tokens.gold++; gained.gold = 1; }
  log(G, 'reserve', selected.kind === 'market' ? '預留一件公開作品。' : '從牌堆秘密預留一件作品。',
    { actor: playerID, tier: card.tier, reservationID, tokens: gained, ...(selected.kind === 'market' ? { cardID } : {}) });
  afterMainAction(G, playerID);
}
function buyCard({ G, playerID }: MoveContext, cardID: unknown, payment: unknown, token: unknown) {
  if (!isTurn(G, playerID, token) || !cardExists(cardID)) return INVALID_MOVE;
  const inMarket = G.market[STAR_CARDS[cardID].tier].includes(cardID), reserve = G.private[playerID].reserved.find(entry => entry.cardID === cardID);
  if ((!inMarket && !reserve) || !starValidPayment(G, playerID, cardID, payment)) return INVALID_MOVE;
  G.epoch++;
  for (const color of STAR_TOKENS) { G.players[playerID].tokens[color] -= payment[color]; G.bank[color] += payment[color]; }
  if (inMarket) removeMarketCard(G, cardID);
  else {
    G.players[playerID].reserved = G.players[playerID].reserved.filter(entry => entry.id !== reserve!.id);
    G.private[playerID].reserved = G.private[playerID].reserved.filter(entry => entry.id !== reserve!.id);
  }
  const card = STAR_CARDS[cardID]; G.players[playerID].purchased.push(cardID); G.players[playerID].bonuses[card.bonus]++; G.players[playerID].prestige += card.prestige;
  log(G, 'purchase', '打造完成一件作品，獲得其永久星材折抵與聲望。', { actor: playerID, cardID, payment: { ...payment } }); afterMainAction(G, playerID);
}
function returnTokens({ G, playerID }: MoveContext, returned: unknown, token: unknown) {
  if (G.status !== 'return-tokens' || !isSeat(G, playerID) || G.activePlayer !== playerID || G.pending?.playerID !== playerID
    || !Number.isInteger(token) || token !== G.epoch || !validCounts(returned) || starTokenTotal(returned) !== G.pending.returnCount
    || STAR_TOKENS.some(color => returned[color] > G.players[playerID].tokens[color])) return INVALID_MOVE;
  G.epoch++; for (const color of STAR_TOKENS) { G.players[playerID].tokens[color] -= returned[color]; G.bank[color] += returned[color]; }
  log(G, 'return', '歸還超出的星材，保留十枚。', { actor: playerID, tokens: { ...returned } }); G.pending = null; resolveGuardians(G, playerID);
}
function chooseGuardian({ G, playerID }: MoveContext, guardianID: unknown, token: unknown) {
  if (G.status !== 'choose-guardian' || !isSeat(G, playerID) || G.activePlayer !== playerID || G.pending?.playerID !== playerID
    || !Number.isInteger(token) || token !== G.epoch || typeof guardianID !== 'string' || !G.pending.guardianIDs.includes(guardianID)
    || !starEligibleGuardians(G, playerID).includes(guardianID)) return INVALID_MOVE;
  G.epoch++; awardGuardian(G, playerID, guardianID); completeTurn(G, playerID);
}
function forcedPass({ G, playerID }: MoveContext, token: unknown) {
  if (!isTurn(G, playerID, token) || legalStarActions(G, playerID).some(action => action.move !== 'forcedPass')) return INVALID_MOVE;
  G.epoch++; log(G, 'forced-pass', '沒有可取得的星材、可保留或可購買的作品，本回合被迫跳過主動作。', { actor: playerID });
  resolveGuardians(G, playerID, true);
}
function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== G.turnOrder[0] || !G.turnOrder.every(id => G.players[id].ready)) return INVALID_MOVE;
  begin(G, random);
}

/** Representatives, not every possible payment/return vector. The reducer accepts all valid vectors. */
export function legalStarActions(G: StarState, playerID: string): StarAction[] {
  if (!isSeat(G, playerID)) return [];
  if (G.status === 'briefing' && !G.players[playerID].acknowledged) return [{ move: 'acknowledge', args: [G.phaseEpoch] }];
  if (G.activePlayer !== playerID) return [];
  if (G.status === 'choose-guardian' && G.pending?.playerID === playerID) return G.pending.guardianIDs.map(id => ({ move: 'chooseGuardian', args: [id, G.epoch] }));
  if (G.status === 'return-tokens' && G.pending?.playerID === playerID) {
    const returned = starEmptyTokens(); let remaining = G.pending.returnCount;
    for (const color of STAR_TOKENS) { returned[color] = Math.min(remaining, G.players[playerID].tokens[color]); remaining -= returned[color]; }
    return remaining === 0 ? [{ move: 'returnTokens', args: [returned, G.epoch] }] : [];
  }
  if (G.status !== 'turn' || !G.private[playerID]) return [];
  const actions: StarAction[] = legalStarTokenChoices(G).map(colors => ({ move: 'takeTokens', args: [colors, G.epoch] }));
  actions.push(...legalStarReserveTargets(G, playerID).map(target => ({ move: 'reserveCard' as const, args: [target, G.epoch] })));
  const cards = [...STAR_TIERS.flatMap(tier => G.market[tier].filter((id): id is string => id !== null)), ...G.private[playerID].reserved.map(entry => entry.cardID)];
  for (const cardID of cards) { const payment = starDefaultPayment(G, playerID, cardID); if (payment) actions.push({ move: 'buyCard', args: [cardID, payment, G.epoch] }); }
  return actions.length ? actions : [{ move: 'forcedPass', args: [G.epoch] }];
}
export function starPlayerView({ G, playerID }: { G: StarState; playerID: string | null }): StarState {
  const { secret: _secret, private: _private, ...publicState } = G;
  return { ...structuredClone(publicState), private: playerID !== null && isSeat(G, playerID) && G.private[playerID] ? { [playerID]: structuredClone(G.private[playerID]) } : {} };
}
export function starObserverView(G: StarState, perspective: 'blind' | 'god'): StarState {
  const view = starPlayerView({ G, playerID: null });
  if (perspective === 'god') view.private = structuredClone(G.private);
  return view;
}
const serverMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const StarGame: Game<StarState, Record<string, unknown>, StarSetupData> = {
  name: 'star-workshop', minPlayers: 2, maxPlayers: 4,
  validateSetupData: (data, count) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data) || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '遊戲開始設定不正確。';
    const error = validateStarOptions(data?.options, count); if (error) return error;
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs) || data.participantIDs.length !== count || data.participantIDs.some(id => !isPlayerSeatID(id)) || new Set(data.participantIDs).size !== count)) return '參與玩家席位不正確。';
    return undefined;
  },
  setup: ({ ctx, random }, data) => {
    const participants = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, index) => String(index));
    const G: StarState = { rulesVersion: 1, status: 'lobby', options: normalizeStarOptions(data?.options), epoch: 0, phaseEpoch: 0,
      turnOrder: [...participants], starter: participants[0], activePlayer: null, round: 0, turnNumber: 0,
      players: Object.fromEntries(participants.map(id => [id, { ready: data?.startImmediately === true, acknowledged: false, tokens: starEmptyTokens(), bonuses: starEmptyBonuses(), purchased: [], guardians: [], prestige: 0, reserved: [] }])),
      private: {}, bank: starEmptyTokens(), market: { 1: [], 2: [], 3: [] }, deckCounts: { 1: 0, 2: 0, 3: 0 }, guardians: [], pending: null,
      nextReservationID: 1, endTriggeredBy: null, forcedPasses: [], finalScores: {}, winner: null, winnerIDs: [], winReason: null, log: [] };
    if (data?.startImmediately) begin(G, random); return G;
  },
  turn: { order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => G.turnOrder }, activePlayers: ActivePlayers.ALL },
  moves: { setReady: { move: setReady, ...serverMove }, startGame: { move: startGame, ...serverMove }, acknowledge: { move: acknowledge, ...serverMove },
    takeTokens: { move: takeTokens, ...serverMove }, reserveCard: { move: reserveCard, ...serverMove }, buyCard: { move: buyCard, ...serverMove }, returnTokens: { move: returnTokens, ...serverMove }, chooseGuardian: { move: chooseGuardian, ...serverMove }, forcedPass: { move: forcedPass, ...serverMove } },
  disableUndo: true,
  plugins: [{ name: 'star-flow-guard', setup: () => ({}), isInvalid: ({ G, ctx }) => {
    if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason ? false : 'Game completion must follow the star workshop rules.';
    if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== G.turnOrder[0] || ctx.phase !== null || !ctx.activePlayers
      || Object.keys(ctx.activePlayers).length !== G.turnOrder.length || G.turnOrder.some(id => ctx.activePlayers![id] !== null)
      || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
      || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for this game.';
    return false;
  } }],
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: starPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
