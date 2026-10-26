import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import {
  MAIL_CARDS, mailWinningScore, normalizeMailOptions, resolveMailMode, validateMailOptions,
  type MailMode, type MailOptions, type MailRole,
} from './rules';
export type { MailMode, MailOptions, MailRole } from './rules';

export interface MailCard { id: string; role: MailRole }
export interface MailPlayer {
  ready: boolean; acknowledged: boolean; eliminated: boolean; protected: boolean;
  cardCount: number; discards: MailCard[]; score: number; power: number;
}
export interface MailIntel { round: number; label: string; text: string; playerID?: string; card?: MailCard }
export interface MailPrivate { cards: MailCard[]; intel: MailIntel[] }
export interface MailChoice { id: string; label: string; playerID?: string; cardID?: string }
export interface MailPending {
  actorID: string; title: string; kind: string; choices?: MailChoice[];
  minimum?: number; maximum?: number; ordered?: boolean; requiredIDs?: string[];
}
export interface MailLogEntry {
  type: string; round: number; actorID?: string; targetID?: string; card?: MailCard;
  message: string; winnerIDs?: string[];
}
export interface MailRoundResult { winnerIDs: string[]; reason: string; hands: Record<string, MailCard[]> }
interface Effect {
  role: MailRole; actorID: string; stage: string; forcedTarget?: string | null;
  targetID?: string; targets?: string[]; firstTarget?: string; remaining?: number;
  cards?: MailCard[]; copyDepth?: number;
}
export interface MailState {
  rulesVersion: 1; status: 'lobby' | 'briefing' | 'playing' | 'round-review' | 'finished';
  mode: MailMode; options: MailOptions; round: number; epoch: number; activePlayer: string | null;
  players: Record<string, MailPlayer>; private: Record<string, MailPrivate>;
  pending: MailPending | null; roundResult: MailRoundResult | null;
  directorID: string | null; directorLife: number; courierLife: number;
  maxDirectorLife: number; maxCourierLife: number; deckCount: number; directorDeckCount: number;
  winner: 'delivery' | 'couriers' | 'director' | null; winReason: string | null; winnerIDs: string[];
  forcedTarget: string | null; predictions: Record<string, string>; contenderIDs: string[] | null;
  turnOrder: string[]; turnIndex: number; log: MailLogEntry[];
  /** Future draws, undealt reserve and resolving effects never leave the server. */
  secret?: { deck: MailCard[]; directorDeck: MailCard[]; reserve: MailCard | null; effect: Effect | null };
}
export interface MailSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: MailOptions }
export interface MailAction { move: 'playCard' | 'choose' | 'acknowledge' | 'seal'; args: unknown[] }
type MoveContext = FnContext<MailState> & { playerID: string };
type RandomAPI = FnContext<MailState>['random'];
const ids = (G: MailState) => Object.keys(G.players);
const value = (card: MailCard) => MAIL_CARDS[card.role].value;
const isSeat = (G: MailState, id: unknown): id is string => typeof id === 'string' && Object.hasOwn(G.players, id);
const validToken = (G: MailState, id: unknown, epoch: unknown): id is string => isSeat(G, id) && Number.isInteger(epoch) && epoch === G.epoch;
const living = (G: MailState) => ids(G).filter(id => !G.players[id].eliminated);
const cloneCard = (card: MailCard): MailCard => ({ id: card.id, role: card.role });

function log(G: MailState, type: string, message: string, extra: Partial<MailLogEntry> = {}) {
  G.log.push({ type, round: G.round, message, ...extra });
}
function syncCounts(G: MailState) {
  for (const id of ids(G)) G.players[id].cardCount = G.private[id].cards.length;
  G.deckCount = G.secret!.deck.length;
  G.directorDeckCount = G.secret!.directorDeck.length;
}
function intel(G: MailState, id: string, targetID: string, card: MailCard, label = '查驗紀錄') {
  G.private[id].intel.push({ round: G.round, label, playerID: targetID, card: cloneCard(card),
    text: `${targetID} 號信使當時持有 ${MAIL_CARDS[card.role].name}（${value(card)}）。這是當時的資訊，之後可能換牌。` });
}
function showPending(G: MailState, actorID: string, stage: string, title: string, choices: MailChoice[], minimum = 1, maximum = minimum, ordered = false) {
  G.secret!.effect!.stage = stage;
  G.pending = { actorID, title, kind: stage, choices, minimum, maximum, ...(ordered ? { ordered: true } : {}),
    ...(stage === 'letter-target' && G.secret!.effect!.forcedTarget ? { requiredIDs: [G.secret!.effect!.forcedTarget!] } : {}) };
}
function playerChoices(playerIDs: string[]): MailChoice[] {
  return playerIDs.map(playerID => ({ id: playerID, playerID, label: `${playerID} 號信使` }));
}
function cardChoices(cards: MailCard[]): MailChoice[] {
  return cards.map(card => ({ id: card.id, cardID: card.id, label: `${MAIL_CARDS[card.role].name} · ${value(card)}` }));
}
function buildDeck(mode: MailMode, deck: 'letter' | 'courier' | 'director'): MailCard[] {
  return (Object.entries(MAIL_CARDS) as [MailRole, typeof MAIL_CARDS[MailRole]][]).flatMap(([role, definition]) => {
    if (definition.deck !== deck) return [];
    const count = mode === 'classic' ? definition.classicCount ?? 0 : definition.count;
    return Array.from({ length: count }, (_, i) => ({ id: `${role}:${i}`, role }));
  });
}
function finish(G: MailState, winner: NonNullable<MailState['winner']>, reason: string, winners: string[]) {
  G.status = 'finished'; G.epoch++; G.winner = winner; G.winReason = reason; G.winnerIDs = [...winners];
  G.pending = null; G.secret!.effect = null; G.activePlayer = null;
  log(G, 'finish', winner === 'delivery' ? '最終投遞冠軍已產生。' : winner === 'director' ? '黑函局長封鎖了午夜郵路。' : '午夜信使守住了郵路。', { winnerIDs: [...winners] });
}
function checkDeliveryChampion(G: MailState): boolean {
  const maximum = Math.max(...ids(G).map(id => G.players[id].score));
  if (maximum < mailWinningScore(ids(G).length)) return false;
  const leaders = ids(G).filter(id => G.players[id].score === maximum);
  if (leaders.length === 1) { finish(G, 'delivery', 'delivery-champion', leaders); return true; }
  return false;
}
function drawLetter(G: MailState): MailCard | undefined {
  return G.secret!.deck.shift() ?? (G.secret!.reserve ? (() => { const card = G.secret!.reserve!; G.secret!.reserve = null; return card; })() : undefined);
}
function eliminate(G: MailState, id: string) {
  if (G.players[id].eliminated) return;
  const constable = G.players[id].discards.some(card => card.role === 'constable');
  G.players[id].eliminated = true; G.players[id].protected = false;
  G.players[id].discards.push(...G.private[id].cards.splice(0));
  if (constable) { G.players[id].score++; log(G, 'score', '夜巡督察留下了一枚信任郵戳。', { actorID: id }); }
  log(G, 'eliminate', '一位信使退出本輪。', { targetID: id });
  syncCounts(G);
  // With one survivor, award the round as well before checking a potential
  // simultaneous four-token tie (the published Constable example).
  if (constable && living(G).length > 1) checkDeliveryChampion(G);
}
function replaceLetter(G: MailState, id: string) {
  if (G.status === 'finished') return;
  const card = G.private[id].cards.shift();
  if (card) {
    G.players[id].discards.push(card);
    log(G, 'discard', '手牌公開棄置。', { actorID: id, card });
    if (card.role === 'princess') { eliminate(G, id); return; }
  }
  const next = drawLetter(G); if (next) G.private[id].cards.push(next);
  syncCounts(G);
}
function roundStrength(G: MailState, id: string) {
  const card = G.private[id].cards[0];
  return value(card) + G.players[id].discards.filter(item => item.role === 'count').length;
}
function endDeliveryRound(G: MailState) {
  const survivors = living(G);
  let winners = [...survivors], reason = survivors.length === 1 ? 'last-courier' : 'highest-letter';
  if (survivors.length > 1) {
    // The published rule makes the Princess beat the Bishop despite 8 < 9.
    // Remove Bishop contenders when a Princess survives, then use ordinary
    // numeric Count bonuses. This deterministic online ruling is documented.
    const eligible = survivors.some(id => G.private[id].cards[0].role === 'princess')
      ? survivors.filter(id => G.private[id].cards[0].role !== 'bishop') : survivors;
    const maximum = Math.max(...eligible.map(id => roundStrength(G, id)));
    winners = eligible.filter(id => roundStrength(G, id) === maximum);
    if (winners.length > 1) {
      const discardValue = (id: string) => G.players[id].discards.reduce((sum, card) => sum + value(card), 0);
      const highDiscard = Math.max(...winners.map(discardValue));
      winners = winners.filter(id => discardValue(id) === highDiscard);
    }
  }
  for (const id of winners) G.players[id].score++;
  for (const [predictor, target] of Object.entries(G.predictions)) {
    if (winners.includes(target)) { G.players[predictor].score++; log(G, 'score', '夜鈴小丑預測成功。', { actorID: predictor, targetID: target }); }
  }
  G.roundResult = { winnerIDs: winners, reason, hands: Object.fromEntries(ids(G).map(id => [id, G.private[id].cards.map(cloneCard)])) };
  G.pending = null; G.secret!.effect = null; G.activePlayer = null;
  log(G, 'round', '本輪投遞完成，公開留下的密函。', { winnerIDs: [...winners] });
  if (checkDeliveryChampion(G)) return;
  const maximum = Math.max(...ids(G).map(id => G.players[id].score));
  G.contenderIDs = maximum >= mailWinningScore(ids(G).length) ? ids(G).filter(id => G.players[id].score === maximum) : null;
  G.status = 'round-review'; G.epoch++;
  for (const player of Object.values(G.players)) player.acknowledged = false;
}
function beginTurn(G: MailState, random: RandomAPI) {
  const id = G.turnOrder[G.turnIndex]; G.activePlayer = id; G.pending = null; G.secret!.effect = null;
  G.players[id].protected = false;
  if (G.mode === 'black-letter') {
    const card = drawBlack(G, id, random); if (card) G.private[id].cards.push(card);
    syncCounts(G);
    if (id === G.directorID && G.private[id].cards.every(card => card.role === 'director')) {
      directorEndWindow(G);
    }
  } else {
    if (!G.secret!.deck.length) { endDeliveryRound(G); return; }
    G.private[id].cards.push(G.secret!.deck.shift()!); syncCounts(G);
  }
}
function endTurn(G: MailState, random: RandomAPI) {
  G.pending = null; G.secret!.effect = null; syncCounts(G);
  if (G.status === 'finished') return;
  if (G.mode !== 'black-letter') {
    if (living(G).length <= 1 || !G.secret!.deck.length) { endDeliveryRound(G); return; }
    if (checkDeliveryChampion(G)) return;
  }
  do { G.turnIndex = (G.turnIndex + 1) % G.turnOrder.length; } while (G.players[G.turnOrder[G.turnIndex]].eliminated);
  beginTurn(G, random);
}
function sixSeals(G: MailState): boolean {
  if (!G.directorID) return false;
  const cards = [...G.private[G.directorID].cards, ...G.players[G.directorID].discards];
  return [1, 2, 3, 4, 5, 6].every(n => cards.some(card => card.role === `seal-${n}`));
}
function completeEffect(G: MailState, random: RandomAPI) {
  syncCounts(G);
  if (G.status === 'finished') return;
  if (G.mode === 'black-letter' && G.activePlayer === G.directorID) directorEndWindow(G);
  else endTurn(G, random);
}
function directorEndWindow(G: MailState) {
  const actorID = G.directorID!;
  G.secret!.effect = { actorID, role: 'director', stage: 'director-end' };
  // Every director turn has the same public boundary. Only the director's
  // authorized choices reveal whether their hidden hand completes six seals.
  const choices = [{ id: 'continue', label: '完成投遞，交給下一位信使' }];
  if (sixSeals(G)) choices.push({ id: 'seal', label: '宣告六封印' });
  showPending(G, actorID, 'director-end', '等待局長完成本次投遞', choices);
}
function startRound(G: MailState, random: RandomAPI) {
  G.round++; G.roundResult = null; G.predictions = {}; G.forcedTarget = null;
  const participants = G.contenderIDs ?? ids(G);
  for (const id of ids(G)) {
    G.players[id].eliminated = !participants.includes(id); G.players[id].protected = false;
    G.players[id].discards = []; G.players[id].power = 0; G.players[id].acknowledged = false;
    G.private[id] = { cards: [], intel: [] };
  }
  const deck = random.Shuffle(buildDeck(G.mode, 'letter'));
  G.secret = { deck, directorDeck: [], reserve: deck.shift()!, effect: null };
  for (const id of participants) G.private[id].cards.push(deck.shift()!);
  const winner = [...G.log].reverse().find(entry => entry.type === 'round')?.winnerIDs?.find(id => participants.includes(id));
  const starter = winner ?? participants[0];
  G.turnOrder = [...participants]; G.turnIndex = G.turnOrder.indexOf(starter);
  G.status = 'briefing'; G.activePlayer = starter; G.epoch++; syncCounts(G);
  log(G, 'deal', G.contenderIDs ? '並列信使進入決勝投遞。' : '新的午夜投遞開始。');
}
function beginGame(G: MailState, random: RandomAPI) {
  if (G.mode !== 'black-letter') { startRound(G, random); return; }
  const all = ids(G), chosen = G.options.directorID;
  G.directorID = chosen === 'random' ? random.Shuffle(all)[0] : chosen;
  G.round = 1; G.directorLife = ({ 2: 4, 3: 4, 4: 5, 5: 6, 6: 7 } as Record<number, number>)[all.length];
  G.courierLife = 6; G.maxDirectorLife = G.directorLife; G.maxCourierLife = G.courierLife;
  G.secret = { deck: random.Shuffle(buildDeck(G.mode, 'courier')), directorDeck: random.Shuffle(buildDeck(G.mode, 'director')), reserve: null, effect: null };
  for (const id of all) G.private[id] = { cards: [], intel: [] };
  for (const id of all) for (let i = 0; i < (id === G.directorID ? 2 : 1); i++) G.private[id].cards.push(drawBlack(G, id, random)!);
  const start = all.indexOf(G.directorID);
  G.turnOrder = [...all.slice(start), ...all.slice(0, start)];
  if (all.length === 2) G.turnOrder.push(G.turnOrder[1]);
  G.turnIndex = 0; G.activePlayer = G.directorID; G.status = 'briefing'; G.epoch++; syncCounts(G);
  log(G, 'deal', '黑函局長與午夜信使各自備妥密函。');
}

function availableTargets(G: MailState, actorID: string, includeSelf: boolean, forcedTarget: string | null | undefined, amount = 1): string[] {
  let possible = living(G).filter(id => (includeSelf || id !== actorID) && (!G.players[id].protected || id === actorID));
  if (forcedTarget && amount === 1) possible = possible.filter(id => id === forcedTarget);
  if (forcedTarget && !possible.includes(forcedTarget)) return [];
  return possible;
}
function letterEffect(G: MailState, role: MailRole, actorID: string, random: RandomAPI, forcedTarget: string | null) {
  const effect: Effect = { role, actorID, stage: '', forcedTarget }; G.secret!.effect = effect;
  if (role === 'handmaid') { G.players[actorID].protected = true; completeEffect(G, random); return; }
  if (role === 'princess') { eliminate(G, actorID); completeEffect(G, random); return; }
  if (['countess', 'count', 'constable', 'assassin'].includes(role)) { completeEffect(G, random); return; }
  const includeSelf = ['prince', 'cardinal', 'sycophant'].includes(role);
  const amount = role === 'cardinal' || role === 'baroness' ? 2 : 1;
  const targets = availableTargets(G, actorID, includeSelf, forcedTarget, amount);
  if (role === 'cardinal') {
    if (targets.length < 2) { completeEffect(G, random); return; }
    showPending(G, actorID, 'letter-target', '選擇兩位信使交換手牌', playerChoices(targets), 2, 2); return;
  }
  if (!targets.length) { log(G, 'no-target', '沒有符合限制的對象，密函效果落空。', { actorID }); completeEffect(G, random); return; }
  showPending(G, actorID, 'letter-target', role === 'baroness' ? '選擇一至兩位信使查驗' : '選擇密函對象', playerChoices(targets), 1, role === 'baroness' ? Math.min(2, targets.length) : 1);
}
function handleLetterChoice(G: MailState, chosen: string[], random: RandomAPI) {
  const effect = G.secret!.effect!, { role, actorID } = effect;
  if (effect.stage === 'letter-target') {
    if (effect.forcedTarget && !chosen.includes(effect.forcedTarget)) return false;
    const target = chosen[0]; effect.targetID = target;
    if (role === 'guard' || role === 'bishop') {
      const maximum = G.mode === 'classic' ? 8 : 9;
      const numbers = Array.from({ length: maximum + 1 }, (_, n) => n).filter(n => !(role === 'guard' && n === 1) && !(G.mode === 'classic' && n === 0));
      showPending(G, actorID, 'letter-guess', '選擇要指認的數字', numbers.map(n => ({ id: String(n), label: String(n) }))); return true;
    }
    if (role === 'priest' || role === 'baroness') {
      for (const id of chosen) intel(G, actorID, id, G.private[id].cards[0]);
      log(G, 'inspect', '私人查驗已完成。', { actorID });
    } else if (role === 'baron' || role === 'dowager') {
      const ownCard = G.private[actorID].cards[0], theirCard = G.private[target].cards[0];
      intel(G, actorID, target, theirCard, '比牌紀錄'); intel(G, target, actorID, ownCard, '比牌紀錄');
      if (value(ownCard) !== value(theirCard)) eliminate(G, (value(ownCard) < value(theirCard)) === (role === 'baron') ? actorID : target);
      log(G, 'compare', '私人比牌已完成。', { actorID, targetID: target });
    } else if (role === 'prince') replaceLetter(G, target);
    else if (role === 'king') {
      [G.private[actorID].cards, G.private[target].cards] = [G.private[target].cards, G.private[actorID].cards];
      log(G, 'exchange', '兩位信使交換了密函。', { actorID, targetID: target });
    } else if (role === 'cardinal') {
      [G.private[chosen[0]].cards, G.private[chosen[1]].cards] = [G.private[chosen[1]].cards, G.private[chosen[0]].cards];
      effect.targets = chosen;
      showPending(G, actorID, 'cardinal-look', '可私下查看一張交換後的密函', [{ id: 'skip', label: '不查看' }, ...playerChoices(chosen)]); return true;
    } else if (role === 'sycophant') { G.forcedTarget = target; log(G, 'redirect', '下一張密函須包含指定信使。', { actorID, targetID: target }); }
    else if (role === 'jester') { G.predictions[actorID] = target; log(G, 'prediction', '夜鈴小丑留下了預測。', { actorID, targetID: target }); }
    completeEffect(G, random); return true;
  }
  if (effect.stage === 'cardinal-look') {
    if (chosen[0] !== 'skip') intel(G, actorID, chosen[0], G.private[chosen[0]].cards[0], '調包後查驗');
    completeEffect(G, random); return true;
  }
  if (effect.stage === 'letter-guess') {
    const target = effect.targetID!, card = G.private[target].cards[0], guess = Number(chosen[0]);
    log(G, 'guess', `指認數字 ${guess}。`, { actorID, targetID: target });
    if (role === 'guard' && card.role === 'assassin') {
      eliminate(G, actorID); replaceLetter(G, target);
    } else if (value(card) === guess) {
      if (role === 'guard') eliminate(G, target);
      else {
        G.players[actorID].score++; log(G, 'score', '終宵大主事指認成功，獲得信任郵戳。', { actorID });
        if (checkDeliveryChampion(G)) return true;
        showPending(G, target, 'bishop-redraw', '指認成功，你可以更換手牌', [{ id: 'keep', label: '保留手牌' }, { id: 'redraw', label: '棄掉並補一張' }]); return true;
      }
    }
    completeEffect(G, random); return true;
  }
  if (effect.stage === 'bishop-redraw') {
    if (chosen[0] === 'redraw') replaceLetter(G, effect.targetID!);
    completeEffect(G, random); return true;
  }
  return false;
}

function recycleCouriers(G: MailState, random: RandomAPI) {
  if (G.secret!.deck.length) return;
  const cards = ids(G).filter(id => id !== G.directorID).flatMap(id => G.players[id].discards.splice(0));
  if (cards.length) { G.secret!.deck = random.Shuffle(cards); log(G, 'reshuffle', '公開的信使棄牌重新洗成郵袋。'); }
}
function drawBlack(G: MailState, id: string, random: RandomAPI): MailCard | undefined {
  if (id === G.directorID) return G.secret!.directorDeck.shift();
  recycleCouriers(G, random);
  const card = G.secret!.deck.shift();
  recycleCouriers(G, random);
  return card;
}
function checkBlackLife(G: MailState): boolean {
  if (G.directorLife <= 0) { finish(G, 'couriers', 'director-defeated', ids(G).filter(id => id !== G.directorID)); return true; }
  if (G.courierLife <= 0) { finish(G, 'director', 'couriers-defeated', [G.directorID!]); return true; }
  return false;
}
function defeatBlack(G: MailState, targetID: string, cardID: string, random: RandomAPI) {
  const index = G.private[targetID].cards.findIndex(card => card.id === cardID);
  if (index < 0) return;
  const card = G.private[targetID].cards.splice(index, 1)[0];
  G.players[targetID].discards.push(card);
  if (targetID === G.directorID) G.directorLife--; else G.courierLife--;
  log(G, 'defeat', '密函被擊退，所屬一方失去 1 點生命。', { targetID, card });
  syncCounts(G);
  if (checkBlackLife(G)) return;
  const replacement = drawBlack(G, targetID, random);
  if (replacement) G.private[targetID].cards.push(replacement);
  if (targetID === G.directorID && (MAIL_CARDS[card.role].seal || card.role === 'director')) {
    G.players[targetID].discards = G.players[targetID].discards.filter(item => item.id !== card.id);
    G.secret!.directorDeck = random.Shuffle([...G.secret!.directorDeck, card]);
    log(G, 'return', '局長先補牌，再將被擊退的封印或局長牌洗回郵袋。', { targetID, card });
  }
  syncCounts(G);
}
function fight(G: MailState, courierID: string, directorCardID: string | null, random: RandomAPI) {
  const directorID = G.directorID!, courierCard = G.private[courierID].cards[0];
  const directorCards = G.private[directorID].cards;
  const directorCard = directorCardID ? directorCards.find(card => card.id === directorCardID) : random.Shuffle(directorCards)[0];
  if (!courierCard || !directorCard) return;
  intel(G, directorID, courierID, courierCard, '對決紀錄'); intel(G, courierID, directorID, directorCard, '對決紀錄');
  let courierValue = value(courierCard), directorValue = value(directorCard);
  if (G.players[courierID].power > 0) { G.players[courierID].power--; courierValue += 2; }
  if (G.players[directorID].power > 0) { G.players[directorID].power--; directorValue += 2; }
  log(G, 'fight', '秘密對決完成；雙方各自使用至多一枚既有火漆力量。', { actorID: G.activePlayer!, targetID: courierID });
  if (courierValue < directorValue) defeatBlack(G, courierID, courierCard.id, random);
  else if (directorValue < courierValue) defeatBlack(G, directorID, directorCard.id, random);
}
function blackEffect(G: MailState, role: MailRole, actorID: string, random: RandomAPI, copyDepth = 0) {
  const effect: Effect = { actorID, role, stage: '', copyDepth }; G.secret!.effect = effect;
  const couriers = ids(G).filter(id => id !== G.directorID);
  const finishOrTargets = (stage: string, title: string, choices: MailChoice[]) => {
    if (!choices.length) completeEffect(G, random); else showPending(G, actorID, stage, title, choices);
  };
  if (role === 'courier-1' || role === 'seal-1') {
    showPending(G, actorID, 'black-guess', '選擇要指認的數字', Array.from({ length: role === 'courier-1' ? 7 : 6 }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }))); return;
  }
  if (role === 'courier-2') {
    const others = couriers.filter(id => id !== actorID);
    if (!others.length) {
      const card = random.Shuffle(G.private[G.directorID!].cards)[0];
      if (card) intel(G, actorID, G.directorID!, card);
      completeEffect(G, random);
    } else showPending(G, actorID, 'black-inspect-recipient', '選擇一位其他信使接收私人查驗', playerChoices(others));
    return;
  }
  if (role === 'courier-3') {
    effect.targetID = actorID;
    showPending(G, actorID, 'courier-fight', '是否與黑函局長對決？', [{ id: 'fight', label: '對決' }, { id: 'skip', label: '略過對決' }]); return;
  }
  if (role === 'courier-4' || role === 'courier-6') {
    showPending(G, actorID, 'courier-target', role === 'courier-4' ? '選擇獲得火漆力量的信使' : '選擇可與局長對決的信使', playerChoices(couriers)); return;
  }
  if (role === 'courier-5') {
    const cards: MailCard[] = [];
    for (let i = 0; i < 3; i++) { const card = drawBlack(G, actorID, random); if (card) cards.push(card); }
    effect.cards = cards;
    if (cards.length) showPending(G, actorID, 'courier-reorder', '按下一次抽到的順序排列密函', cardChoices(cards), cards.length, cards.length, true);
    else completeEffect(G, random);
    syncCounts(G); return;
  }
  if (role === 'director-1' || role === 'director-2' || role === 'seal-2') {
    showPending(G, actorID, 'director-target', '選擇一位信使', playerChoices(couriers)); return;
  }
  if (role === 'director-3' || role === 'seal-3') {
    if (!G.private[actorID].cards.length) { completeEffect(G, random); return; }
    effect.remaining = role === 'seal-3' ? 2 : 1;
    showPending(G, actorID, 'director-fight-target', '選擇對決的信使，或略過', [{ id: 'skip', label: '略過對決' }, ...playerChoices(couriers)]); return;
  }
  if (role === 'director-4' || role === 'seal-4') {
    G.players[actorID].power += role === 'seal-4' ? 3 : 1;
    log(G, 'power', role === 'seal-4' ? '局長獲得 3 枚火漆力量。' : '局長獲得 1 枚火漆力量。', { actorID });
    completeEffect(G, random); return;
  }
  if (role === 'director-5' || role === 'seal-5') {
    const drawCount = Math.min(role === 'seal-5' ? 2 : 1, G.secret!.directorDeck.length);
    for (let i = 0; i < drawCount; i++) G.private[actorID].cards.push(G.secret!.directorDeck.shift()!);
    effect.remaining = drawCount; syncCounts(G);
    if (drawCount) showPending(G, actorID, 'director-bottom', '選擇放回郵袋底的密函，依由上到下排序', cardChoices(G.private[actorID].cards), drawCount, drawCount, true);
    else completeEffect(G, random);
    return;
  }
  if (role === 'seal-6' && copyDepth < 1) {
    finishOrTargets('director-copy', '選擇要複製的公開局長密函', cardChoices(G.players[actorID].discards.filter(card => card.role !== 'seal-6'))); return;
  }
  completeEffect(G, random);
}
function handleBlackChoice(G: MailState, chosen: string[], random: RandomAPI): boolean {
  const effect = G.secret!.effect!, { role, actorID, stage } = effect;
  if (stage === 'director-end') {
    if (chosen[0] === 'seal') {
      if (!sixSeals(G)) return false;
      finish(G, 'director', 'six-seals', [G.directorID!]);
    }
    else endTurn(G, random);
    return true;
  }
  if (stage === 'black-guess') {
    const guess = Number(chosen[0]);
    log(G, 'guess', `指認數字 ${guess}。`, { actorID, ...(effect.targetID ? { targetID: effect.targetID } : {}) });
    if (role === 'courier-1') {
      const matches = G.private[G.directorID!].cards.filter(card => value(card) === guess);
      if (matches.length) {
        // Always ask the director to select the defeated card on a successful
        // guess. The existence of this prompt must not reveal a duplicate pair.
        showPending(G, G.directorID!, 'director-defeat', '局長選擇被擊退的密函', cardChoices(matches)); return true;
      }
    } else if (role === 'seal-1') {
      const targets = [...new Set(G.turnOrder)].filter(id => id !== G.directorID && G.private[id].cards.some(card => value(card) === guess));
      for (const id of targets) { defeatBlack(G, id, G.private[id].cards[0].id, random); if (G.status === 'finished') return true; }
    } else {
      const target = effect.targetID!, card = G.private[target].cards[0];
      if (card && value(card) === guess) defeatBlack(G, target, card.id, random);
    }
    completeEffect(G, random); return true;
  }
  if (stage === 'director-defeat') { defeatBlack(G, G.directorID!, chosen[0], random); completeEffect(G, random); return true; }
  if (stage === 'black-inspect-recipient') {
    const card = random.Shuffle(G.private[G.directorID!].cards)[0];
    if (card) intel(G, chosen[0], G.directorID!, card);
    log(G, 'inspect', '指定信使收到了一份私人查驗。', { actorID, targetID: chosen[0] });
    completeEffect(G, random); return true;
  }
  if (stage === 'courier-target') {
    const target = chosen[0]; effect.targetID = target;
    if (role === 'courier-4') { G.players[target].power++; log(G, 'power', '一位信使獲得 1 枚火漆力量。', { actorID, targetID: target }); completeEffect(G, random); }
    else showPending(G, target, 'courier-fight', '你獲邀與黑函局長對決，是否接受？', [{ id: 'fight', label: '對決' }, { id: 'skip', label: '略過對決' }]);
    return true;
  }
  if (stage === 'courier-fight') {
    if (chosen[0] === 'fight') fight(G, effect.targetID!, null, random);
    completeEffect(G, random); return true;
  }
  if (stage === 'courier-reorder') {
    const ordered = chosen.map(id => effect.cards!.find(card => card.id === id)!);
    G.secret!.deck.unshift(...ordered); completeEffect(G, random); return true;
  }
  if (stage === 'director-target') {
    const target = chosen[0]; effect.targetID = target;
    if (role === 'director-1') showPending(G, actorID, 'black-guess', '選擇要指認的數字', Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), label: String(i + 1) })));
    else {
      const card = G.private[target].cards[0];
      if (card && (role === 'director-2' ? value(card) <= 3 : value(card) >= 3)) defeatBlack(G, target, card.id, random);
      completeEffect(G, random);
    }
    return true;
  }
  if (stage === 'director-fight-target') {
    if (chosen[0] === 'skip' || !G.private[actorID].cards.length) { completeEffect(G, random); return true; }
    effect.targetID = chosen[0];
    showPending(G, actorID, 'director-fight-card', '選擇本次對決使用的手牌', cardChoices(G.private[actorID].cards)); return true;
  }
  if (stage === 'director-fight-card') {
    fight(G, effect.targetID!, chosen[0], random);
    if (G.status === 'finished') return true;
    effect.remaining!--; effect.firstTarget = effect.targetID;
    if (effect.remaining! > 0 && G.private[actorID].cards.length > 0) {
      const candidates = ids(G).filter(id => id !== G.directorID && (ids(G).length === 2 || id !== effect.firstTarget));
      showPending(G, actorID, 'director-fight-target', '可以再選一位信使對決，或略過', [{ id: 'skip', label: '略過第二次對決' }, ...playerChoices(candidates)]);
    } else completeEffect(G, random);
    return true;
  }
  if (stage === 'director-bottom') {
    const selected = chosen.map(id => G.private[actorID].cards.find(card => card.id === id)!);
    G.private[actorID].cards = G.private[actorID].cards.filter(card => !chosen.includes(card.id));
    G.secret!.directorDeck.push(...selected); completeEffect(G, random); return true;
  }
  if (stage === 'director-copy') {
    const copied = G.players[actorID].discards.find(card => card.id === chosen[0]);
    if (!copied) return false;
    log(G, 'copy', '逆時封印複製了一張公開密函。', { actorID, card: copied });
    blackEffect(G, copied.role, actorID, random, (effect.copyDepth ?? 0) + 1); return true;
  }
  return false;
}

export function mailPlayableCards(G: MailState, playerID: string): MailCard[] {
  if (!isSeat(G, playerID) || G.status !== 'playing' || G.activePlayer !== playerID || G.pending) return [];
  const cards = G.private[playerID]?.cards ?? [];
  if (G.mode === 'black-letter') return cards.filter(card => card.role !== 'director');
  if (cards.some(card => card.role === 'countess') && cards.some(card => card.role === 'prince' || card.role === 'king')) return cards.filter(card => card.role === 'countess');
  return [...cards];
}
function playCard({ G, playerID, random }: MoveContext, cardID: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || typeof cardID !== 'string'
    || !mailPlayableCards(G, playerID).some(card => card.id === cardID)) return INVALID_MOVE;
  const index = G.private[playerID].cards.findIndex(card => card.id === cardID), card = G.private[playerID].cards.splice(index, 1)[0];
  G.players[playerID].discards.push(card); G.epoch++;
  log(G, 'play', '打出一張密函。', { actorID: playerID, card }); syncCounts(G);
  if (G.mode === 'black-letter') blackEffect(G, card.role, playerID, random);
  else {
    const forced = G.forcedTarget; G.forcedTarget = null;
    letterEffect(G, card.role, playerID, random, forced);
  }
}
function choose({ G, playerID, random }: MoveContext, selected: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.status !== 'playing' || G.pending?.actorID !== playerID
    || !Array.isArray(selected) || selected.some(item => typeof item !== 'string') || new Set(selected).size !== selected.length) return INVALID_MOVE;
  const pending = G.pending;
  if (selected.length < (pending.minimum ?? 1) || selected.length > (pending.maximum ?? 1)
    || selected.some(id => !pending.choices?.some(choice => choice.id === id))) return INVALID_MOVE;
  const effect = G.secret?.effect;
  if (!effect) return INVALID_MOVE;
  if (G.mode !== 'black-letter' && effect.stage === 'letter-target' && effect.forcedTarget && !selected.includes(effect.forcedTarget)) return INVALID_MOVE;
  G.epoch++;
  if (!(G.mode === 'black-letter' ? handleBlackChoice(G, selected, random) : handleLetterChoice(G, selected, random))) return INVALID_MOVE;
}
function acknowledge({ G, playerID, random }: MoveContext, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || !['briefing', 'round-review'].includes(G.status) || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.players[playerID].acknowledged = true;
  if (!Object.values(G.players).every(player => player.acknowledged)) return;
  if (G.status === 'round-review') startRound(G, random);
  else { G.status = 'playing'; G.epoch++; beginTurn(G, random); }
}
function seal({ G, playerID }: MoveContext, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.mode !== 'black-letter' || G.status !== 'playing'
    || G.activePlayer !== playerID || playerID !== G.directorID
    || (G.pending && (G.pending.actorID !== playerID || G.pending.kind !== 'director-end')) || !sixSeals(G)) return INVALID_MOVE;
  finish(G, 'director', 'six-seals', [playerID]);
}
function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== ids(G)[0] || !Object.values(G.players).every(player => player.ready)) return INVALID_MOVE;
  beginGame(G, random);
}

/** Action enumeration uses only the acting seat's authorized projection. It
 * does not read opponents' hands, future draws or the resolving secret. */
export function legalMailActions(view: MailState, playerID: string): MailAction[] {
  if (!isSeat(view, playerID)) return [];
  if (['briefing', 'round-review'].includes(view.status)) return view.players[playerID].acknowledged ? [] : [{ move: 'acknowledge', args: [view.epoch] }];
  if (view.status !== 'playing') return [];
  if (view.pending) {
    if (view.pending.actorID !== playerID || !view.pending.choices) return [];
    const min = view.pending.minimum ?? 1, max = view.pending.maximum ?? min, choices = view.pending.choices;
    const selections: string[][] = [];
    const visit = (path: string[], start: number) => {
      if (path.length >= min) {
        if ((view.pending!.requiredIDs ?? []).every(id => path.includes(id))) selections.push([...path]);
      }
      if (path.length >= max) return;
      for (let i = view.pending!.ordered ? 0 : start; i < choices.length; i++) {
        if (!path.includes(choices[i].id)) visit([...path, choices[i].id], i + 1);
      }
    };
    visit([], 0);
    return selections.map(choice => ({ move: 'choose', args: [choice, view.epoch] }));
  }
  const result: MailAction[] = mailPlayableCards(view, playerID).map(card => ({ move: 'playCard', args: [card.id, view.epoch] }));
  if (view.mode === 'black-letter' && view.activePlayer === playerID && view.directorID === playerID && sixSeals(view)) result.unshift({ move: 'seal', args: [view.epoch] });
  return result;
}

function copyPrivate(info: MailPrivate): MailPrivate {
  return { cards: info.cards.map(cloneCard), intel: info.intel.map(entry => ({ ...entry, ...(entry.card ? { card: cloneCard(entry.card) } : {}) })) };
}
export function mailPlayerView({ G, playerID }: { G: MailState; playerID: string | null }): MailState {
  const { secret: _secret, private: _private, ...publicState } = G;
  const view = structuredClone(publicState) as MailState;
  view.private = playerID !== null && isSeat(G, playerID) && G.private[playerID] ? { [playerID]: copyPrivate(G.private[playerID]) } : {};
  if (view.pending && view.pending.actorID !== playerID) {
    delete view.pending.choices; delete view.pending.minimum; delete view.pending.maximum; delete view.pending.ordered; delete view.pending.requiredIDs;
  }
  return view;
}
export function mailObserverView(G: MailState, perspective: 'blind' | 'god'): MailState {
  const view = mailPlayerView({ G, playerID: null });
  if (perspective === 'god') for (const id of ids(G)) view.private[id] = copyPrivate(G.private[id]);
  // God observers see current hands, but not future draws, a transient reorder
  // buffer or private pending choices that would expose a deck's next cards.
  return view;
}
const serverMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const MailGame: Game<MailState, Record<string, unknown>, MailSetupData> = {
  name: 'midnight-post', minPlayers: 2, maxPlayers: 8,
  validateSetupData: (data, count) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data)
      || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '遊戲開始設定不正確。';
    if (!Number.isInteger(count) || count < 2 || count > 8) return '午夜郵局需要 2～8 位玩家。';
    const error = validateMailOptions(data?.options, data?.startImmediately ? count : undefined); if (error) return error;
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs) || data.participantIDs.length !== count
      || data.participantIDs.some(id => !isPlayerSeatID(id)) || new Set(data.participantIDs).size !== count)) return '參與玩家席位不正確。';
    const options = normalizeMailOptions(data?.options), participantIDs = data?.participantIDs ?? Array.from({ length: count }, (_, i) => String(i));
    if (data?.startImmediately && resolveMailMode(options, count) === 'black-letter' && options.directorID !== 'random' && !participantIDs.includes(options.directorID)) return '黑函局長必須在本局參與名單中。';
    return undefined;
  },
  setup: ({ ctx, random }, data) => {
    const options = normalizeMailOptions(data?.options);
    const error = validateMailOptions(options, data?.startImmediately ? ctx.numPlayers : undefined); if (error) throw new Error(error);
    const participants = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, i) => String(i));
    const G: MailState = {
      rulesVersion: 1, status: 'lobby', mode: resolveMailMode(options, ctx.numPlayers), options, round: 0, epoch: 0,
      activePlayer: null, players: Object.fromEntries(participants.map(id => [id, {
        ready: data?.startImmediately === true, acknowledged: false, eliminated: false, protected: false,
        cardCount: 0, discards: [], score: 0, power: 0,
      }])), private: Object.fromEntries(participants.map(id => [id, { cards: [], intel: [] }])),
      pending: null, roundResult: null, directorID: null, directorLife: 0, courierLife: 0,
      maxDirectorLife: 0, maxCourierLife: 0, deckCount: 0, directorDeckCount: 0,
      winner: null, winReason: null, winnerIDs: [], forcedTarget: null, predictions: {}, contenderIDs: null,
      turnOrder: [], turnIndex: 0, log: [], secret: { deck: [], directorDeck: [], reserve: null, effect: null },
    };
    if (data?.startImmediately) beginGame(G, random);
    return G;
  },
  turn: { order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => ids(G) }, activePlayers: ActivePlayers.ALL },
  moves: {
    setReady: { move: setReady, ...serverMove }, startGame: { move: startGame, ...serverMove },
    playCard: { move: playCard, ...serverMove }, choose: { move: choose, ...serverMove },
    acknowledge: { move: acknowledge, ...serverMove }, seal: { move: seal, ...serverMove },
  },
  disableUndo: true,
  plugins: [{ name: 'mail-flow-guard', setup: () => ({}), isInvalid: ({ G, ctx }) => {
    if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason ? false : 'Game completion must follow the mail rules.';
    if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== ids(G)[0] || ctx.phase !== null || !ctx.activePlayers
      || Object.keys(ctx.activePlayers).length !== ids(G).length || ids(G).some(id => ctx.activePlayers![id] !== null)
      || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
      || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for this game.';
    return false;
  } }],
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: mailPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
