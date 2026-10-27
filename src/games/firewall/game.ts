import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { createFirewallDeck, createFirewallRoles, FIREWALL_ACTIONS, FIREWALL_GOALS, FIREWALL_PATHS, FIREWALL_ROUND_COUNT,
  type FirewallCard, type FirewallColor, type FirewallGoalPathID, type FirewallRotation, type FirewallTool } from './content';
import { normalizeFirewallOptions, validateFirewallOptions } from './rules';
import { canPlaceFirewallPath, FIREWALL_DIRECTIONS, FIREWALL_OFFSETS, FIREWALL_OPPOSITE, firewallComponentKey,
  firewallPathPlacements, firewallReachableComponents, firewallTileTopology } from './topology';
import type { FirewallAction, FirewallActionTarget, FirewallEffect, FirewallLogEntry, FirewallRoundResult, FirewallSetupData, FirewallState, FirewallTile } from './types';
export * from './types';
export * from './topology';
export type { FirewallRole, FirewallCard, FirewallTool, FirewallPathID, FirewallRotation, FirewallActionID } from './content';

type MoveContext = FnContext<FirewallState> & { playerID: string };
type RandomAPI = FnContext<FirewallState>['random'];
const isSeat = (G: FirewallState, id: unknown): id is string => typeof id === 'string' && Object.hasOwn(G.players, id);
const isTurn = (G: FirewallState, id: unknown, epoch: unknown): id is string => G.status === 'turn' && isSeat(G, id) && G.activePlayer === id && Number.isInteger(epoch) && epoch === G.epoch;
const nextSeat = (G: FirewallState, id: string) => G.turnOrder[(G.turnOrder.indexOf(id) + 1) % G.turnOrder.length];
function log(G: FirewallState, type: FirewallLogEntry['type'], message: string, extra: Partial<FirewallLogEntry> = {}) {
  G.log.push({ type, round: G.round, epoch: G.epoch, message, ...extra });
}
function syncCounts(G: FirewallState) {
  for (const id of G.turnOrder) G.players[id].handCount = G.private[id].hand.length;
  G.deckCount = G.secret!.deck.length; G.discardCount = G.secret!.discard.length; G.roleDeckCount = G.secret!.roleDeck.length;
}
function draw(G: FirewallState, id: string, count: number) {
  G.private[id].hand.push(...G.secret!.deck.splice(0, count)); syncCounts(G);
}
function takeCards(G: FirewallState, id: string, cardIDs: string[]) {
  const hand = G.private[id].hand, taken = hand.filter(card => cardIDs.includes(card.id));
  G.private[id].hand = hand.filter(card => !cardIDs.includes(card.id)); return taken;
}
function validCardIDs(G: FirewallState, id: string, value: unknown, min: number, max: number): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && new Set(value).size === value.length
    && value.every(cardID => typeof cardID === 'string' && G.private[id].hand.some(card => card.id === cardID));
}
function currentEffects(G: FirewallState, id: string): FirewallEffect[] {
  const player = G.players[id];
  return [...player.broken, ...(player.trapped ? ['trapped' as const] : []), ...(player.theftOrder !== null ? ['theft' as const] : [])];
}
function removeEffect(G: FirewallState, id: string, effect: FirewallEffect) {
  const player = G.players[id];
  if (effect === 'trapped') player.trapped = false;
  else if (effect === 'theft') player.theftOrder = null;
  else player.broken = player.broken.filter(tool => tool !== effect);
  const card = G.secret!.effects[id]?.[effect];
  if (card) { G.secret!.discard.push(card); delete G.secret!.effects[id][effect]; }
}

function beginRound(G: FirewallState, random: RandomAPI) {
  G.round++; G.epoch++; G.phaseEpoch = G.epoch; G.status = 'briefing'; G.activePlayer = null; G.turnNumber = 0; G.roundResult = null;
  const roles = random.Shuffle(createFirewallRoles()), deck = random.Shuffle(createFirewallDeck());
  const goals = random.Shuffle<FirewallGoalPathID>(['goal_gold', 'goal_stone_ne', 'goal_stone_es']);
  G.secret = { deck: deck.slice(10), removed: deck.slice(0, 10), discard: [], effects: {}, roleDeck: [], goals: {}, theftQueue: [] };
  G.board = [{ id: 'start', kind: 'start', x: 0, y: 0, revealed: true, pathID: 'start', rotation: 0 },
    ...FIREWALL_GOALS.map((goal, index): FirewallTile => {
      G.secret!.goals[goal.id] = goals[index]; return { ...goal, kind: 'goal', revealed: false };
    })];
  for (const id of G.turnOrder) {
    const gold = G.private[id]?.gold ?? 0;
    G.private[id] = { role: roles.shift()!, hand: G.secret.deck.splice(0, 6), gold, goalMemory: [], roleMemory: [] };
    G.secret.effects[id] = {};
    Object.assign(G.players[id], { acknowledged: false, handCount: 6, broken: [], trapped: false, theftOrder: null, publicRole: null });
  }
  G.secret.roleDeck = roles; syncCounts(G);
  log(G, 'round-start', '新一輪身分與程式已重新分配，所有成員確認後開始滲透。');
}

/** Server scoring uses the revealed end-of-round roles. UI helpers never call this function. */
export function calculateFirewallRoundResult(G: FirewallState, completedBy: string | null, connected: boolean): FirewallRoundResult {
  const eligible = G.turnOrder.filter(id => !G.players[id].trapped), roles = Object.fromEntries(G.turnOrder.map(id => [id, G.private[id].role]));
  const goal = G.board.find(tile => tile.kind === 'goal' && tile.revealed && tile.pathID === 'goal_gold');
  const reachable = (color: FirewallColor) => !!goal && firewallReachableComponents(G.board, color).has(firewallComponentKey(goal.id, 0));
  let winningColors: FirewallColor[] = [];
  if (connected) {
    const completer = completedBy ? roles[completedBy] : undefined;
    if (completer === 'blue' || completer === 'green') {
      if (reachable(completer)) winningColors = [completer];
      else { const other = completer === 'blue' ? 'green' : 'blue'; if (reachable(other)) winningColors = [other]; }
    } else winningColors = (['blue', 'green'] as const).filter(reachable);
  }
  const winningIDs = eligible.filter(id => connected
    ? roles[id] === 'boss' || roles[id] === 'profiteer' || winningColors.includes(roles[id] as FirewallColor)
    : roles[id] === 'saboteur' || roles[id] === 'profiteer');
  const award = winningIDs.length === 1 ? 5 : winningIDs.length === 2 ? 4 : winningIDs.length === 3 ? 3 : winningIDs.length === 4 ? 2 : 1;
  const awards = Object.fromEntries(G.turnOrder.map(id => [id, 0]));
  for (const id of winningIDs) awards[id] = Math.max(0, award - (roles[id] === 'boss' ? 1 : roles[id] === 'profiteer' ? 2 : 0));
  const crystals = G.board.reduce((total, tile) => total + (firewallTileTopology(tile)?.crystals ?? 0), 0);
  const geologists = eligible.filter(id => roles[id] === 'geologist');
  for (const id of geologists) awards[id] = Math.floor(crystals / geologists.length);
  return { round: G.round, reason: connected ? 'connected' : 'exhausted', completedBy, winningColors, winningIDs, awards, roles, crystals, thefts: [] };
}
function beginReview(G: FirewallState) {
  G.status = 'review'; G.activePlayer = null; G.phaseEpoch = G.epoch;
  for (const player of Object.values(G.players)) player.acknowledged = false;
}
function endRound(G: FirewallState, connected: boolean) {
  G.roundResult = calculateFirewallRoundResult(G, connected ? G.lastActor : null, connected);
  for (const id of G.turnOrder) { G.private[id].gold += G.roundResult.awards[id]; G.players[id].publicRole = G.private[id].role; }
  log(G, 'round-end', connected ? '核心連線完成，公開本輪身分與分紅。' : '所有程式耗盡，公開本輪身分與分紅。');
  const thieves = G.turnOrder.filter(id => G.players[id].theftOrder !== null && !G.players[id].trapped);
  if (thieves.length) {
    const lastThief = thieves.reduce((last, id) => G.players[id].theftOrder! > G.players[last].theftOrder! ? id : last);
    const start = G.turnOrder.indexOf(lastThief);
    G.secret!.theftQueue = [...G.turnOrder.slice(start), ...G.turnOrder.slice(0, start)].filter(id => thieves.includes(id));
    G.status = 'theft'; G.activePlayer = G.secret!.theftQueue[0]; G.phaseEpoch = G.epoch;
  } else beginReview(G);
}
function finish(G: FirewallState) {
  G.finalScores = Object.fromEntries(G.turnOrder.map(id => [id, G.private[id].gold]));
  const highest = Math.max(...Object.values(G.finalScores));
  G.winnerIDs = G.turnOrder.filter(id => G.finalScores[id] === highest);
  G.winner = 'wealth'; G.winReason = 'three-rounds'; G.status = 'finished'; G.activePlayer = null; G.phaseEpoch = G.epoch;
  log(G, 'finish', '三輪滲透結束，公開累積資產，最高者共享勝利。');
}
function endTurn(G: FirewallState, actor: string, count = 1, recipient = actor) {
  G.lastActor = actor; G.turnNumber++; draw(G, recipient, count);
  if (G.turnOrder.every(id => G.private[id].hand.length === 0)) { endRound(G, false); return; }
  let next = nextSeat(G, actor); while (G.private[next].hand.length === 0) next = nextSeat(G, next);
  G.activePlayer = next;
}

/** Reveal only after a placement has passed the same public validation used by every client. */
function revealReachedGoals(G: FirewallState): boolean {
  for (;;) {
    const reachable = firewallReachableComponents(G.board);
    let revealedOne = false;
    for (const goal of [...G.board].filter(tile => tile.kind === 'goal' && !tile.revealed).sort((a, b) => a.y - b.y)) {
      const incoming = FIREWALL_DIRECTIONS.find(direction => {
        const [dx, dy] = FIREWALL_OFFSETS[direction], neighbor = G.board.find(tile => tile.x === goal.x + dx && tile.y === goal.y + dy);
        if (!neighbor) return false;
        return firewallTileTopology(neighbor)?.components.some((component, index) => component.includes(FIREWALL_OPPOSITE[direction]) && reachable.has(firewallComponentKey(neighbor.id, index)));
      });
      if (!incoming) continue;
      const pathID = G.secret!.goals[goal.id];
      const orientations = ([0, 180] as const).map(rotation => {
        const tile = { ...goal, revealed: true, pathID, rotation }, topology = firewallTileTopology(tile)!;
        const accepts = topology.components.some(component => component.includes(incoming));
        const matching = FIREWALL_DIRECTIONS.filter(direction => {
          const [dx, dy] = FIREWALL_OFFSETS[direction], neighbor = G.board.find(other => other.x === goal.x + dx && other.y === goal.y + dy);
          const other = neighbor && firewallTileTopology(neighbor); if (!other) return false;
          return topology.components.some(component => component.includes(direction)) === other.components.some(component => component.includes(FIREWALL_OPPOSITE[direction]));
        }).length;
        return { tile, accepts, matching };
      }).filter(option => option.accepts).sort((a, b) => b.matching - a.matching || a.tile.rotation - b.tile.rotation);
      Object.assign(goal, orientations[0].tile); revealedOne = true;
      log(G, 'goal-reveal', pathID === 'goal_gold' ? '找到真正的核心資料。' : '此處是空核心，繼續尋找。', { tile: { ...goal } });
      if (pathID === 'goal_gold') return true;
      break; // Recompute reachability after the newly exposed stone card.
    }
    if (!revealedOne) return false;
  }
}

export function legalFirewallPlacements(G: FirewallState, playerID: string, cardID: string) {
  if (G.status !== 'turn' || G.activePlayer !== playerID || !isSeat(G, playerID) || G.players[playerID].trapped || G.players[playerID].broken.length) return [];
  const card = G.private[playerID]?.hand.find(entry => entry.id === cardID);
  return card?.kind === 'path' ? firewallPathPlacements(G.board, card.pathID) : [];
}
export function legalFirewallActionTargets(G: FirewallState, playerID: string, card: FirewallCard): FirewallActionTarget[] {
  if (!isSeat(G, playerID) || card.kind !== 'action') return [];
  const otherIDs = G.turnOrder.filter(id => id !== playerID), action = card.action;
  if (action.startsWith('break_')) {
    const tool = FIREWALL_ACTIONS[action].tools[0] as FirewallTool;
    return otherIDs.filter(id => !G.players[id].broken.includes(tool)).map(id => ({ playerID: id }));
  }
  if (action.startsWith('repair_')) return G.turnOrder.flatMap(id => G.players[id].broken
    .filter(tool => (FIREWALL_ACTIONS[action].tools as readonly FirewallTool[]).includes(tool)).map(tool => ({ playerID: id, tool })));
  if (action === 'map') return G.board.filter(tile => tile.kind === 'goal' && !tile.revealed).map(tile => ({ goalID: tile.id }));
  if (action === 'rockfall') return G.board.filter(tile => tile.kind === 'path').map(tile => ({ tileID: tile.id }));
  if (action === 'theft') return G.players[playerID].theftOrder === null ? [{}] : [];
  if (action === 'hands_off') return G.turnOrder.filter(id => G.players[id].theftOrder !== null).map(id => ({ playerID: id }));
  if (action === 'trapped') return otherIDs.filter(id => !G.players[id].trapped).map(id => ({ playerID: id }));
  if (action === 'freedom') return G.turnOrder.filter(id => G.players[id].trapped).map(id => ({ playerID: id }));
  if (action === 'change_roles') return G.turnOrder.map(id => ({ playerID: id }));
  return otherIDs.map(id => ({ playerID: id })); // Inspection and hand exchange.
}
const targetEqual = (a: unknown, b: FirewallActionTarget) => !!a && typeof a === 'object' && !Array.isArray(a)
  && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, value]) => (a as Record<string, unknown>)[key] === value);

function acknowledge({ G, playerID, random }: MoveContext, token: unknown) {
  if (!isSeat(G, playerID) || !Number.isInteger(token) || token !== G.phaseEpoch || !['briefing', 'review'].includes(G.status) || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.epoch++; G.players[playerID].acknowledged = true;
  if (G.turnOrder.every(id => G.players[id].acknowledged)) {
    if (G.status === 'briefing') { G.status = 'turn'; G.activePlayer = G.starter; G.phaseEpoch = G.epoch; }
    else if (G.round === FIREWALL_ROUND_COUNT) finish(G);
    else { G.starter = nextSeat(G, G.lastActor!); beginRound(G, random); }
  }
}
function placePath({ G, playerID }: MoveContext, cardID: unknown, x: unknown, y: unknown, rotation: unknown, token: unknown) {
  if (!isTurn(G, playerID, token) || typeof cardID !== 'string' || typeof x !== 'number' || typeof y !== 'number'
    || (rotation !== 0 && rotation !== 180) || G.players[playerID].trapped || G.players[playerID].broken.length) return INVALID_MOVE;
  const card = G.private[playerID].hand.find(entry => entry.id === cardID);
  if (card?.kind !== 'path' || !canPlaceFirewallPath(G.board, card.pathID, x, y, rotation)) return INVALID_MOVE;
  G.epoch++; takeCards(G, playerID, [cardID]);
  const tile: FirewallTile = { id: card.id, kind: 'path', revealed: true, pathID: card.pathID, x, y, rotation };
  G.board.push(tile); G.lastActor = playerID;
  log(G, 'path', '部署一張網路連線。', { actor: playerID, card: { ...card }, tile: { ...tile } });
  if (revealReachedGoals(G)) { G.turnNumber++; syncCounts(G); endRound(G, true); }
  else endTurn(G, playerID);
}
function playAction({ G, playerID }: MoveContext, cardID: unknown, target: unknown, token: unknown) {
  if (!isTurn(G, playerID, token) || typeof cardID !== 'string') return INVALID_MOVE;
  const card = G.private[playerID].hand.find(entry => entry.id === cardID);
  if (card?.kind !== 'action') return INVALID_MOVE;
  const selected = legalFirewallActionTargets(G, playerID, card).find(option => targetEqual(target, option)); if (!selected) return INVALID_MOVE;
  G.epoch++; takeCards(G, playerID, [cardID]);
  const action = card.action, targetID = selected.playerID;
  const persistent = action.startsWith('break_') || action === 'theft' || action === 'trapped';
  if (!persistent) G.secret!.discard.push(card);
  if (action.startsWith('break_')) {
    const tool = FIREWALL_ACTIONS[action].tools[0] as FirewallTool;
    G.players[targetID!].broken.push(tool); G.secret!.effects[targetID!][tool] = card;
  }
  else if (action.startsWith('repair_')) removeEffect(G, targetID!, selected.tool!);
  else if (action === 'map') G.private[playerID].goalMemory.push({ round: G.round, epoch: G.epoch, goalID: selected.goalID!, pathID: G.secret!.goals[selected.goalID!] });
  else if (action === 'rockfall') {
    const tile = G.board.find(entry => entry.id === selected.tileID)!;
    G.board = G.board.filter(entry => entry.id !== tile.id);
    G.secret!.discard.push({ id: tile.id, kind: 'path', pathID: tile.pathID! });
  } else if (action === 'theft') { G.players[playerID].theftOrder = G.epoch; G.secret!.effects[playerID].theft = card; }
  else if (action === 'hands_off') removeEffect(G, targetID!, 'theft');
  else if (action === 'trapped') { G.players[targetID!].trapped = true; G.secret!.effects[targetID!].trapped = card; }
  else if (action === 'freedom') removeEffect(G, targetID!, 'trapped');
  else if (action === 'inspection') G.private[playerID].roleMemory.push({ round: G.round, epoch: G.epoch, playerID: targetID!, role: G.private[targetID!].role });
  else if (action === 'change_roles') {
    const previous = G.private[targetID!].role; G.private[targetID!].role = G.secret!.roleDeck.shift()!; G.secret!.roleDeck.push(previous);
  } else if (action === 'swap_hands') {
    const previous = G.private[playerID].hand; G.private[playerID].hand = G.private[targetID!].hand; G.private[targetID!].hand = previous;
  }
  // Map identities and inspected roles remain private; the played action itself is public.
  log(G, 'action', FIREWALL_ACTIONS[action].name, { actor: playerID, action, card: { ...card }, ...(targetID ? { target: targetID } : {}) });
  endTurn(G, playerID, 1, action === 'swap_hands' ? targetID! : playerID);
}
function discard({ G, playerID }: MoveContext, cardIDs: unknown, token: unknown) {
  if (!isTurn(G, playerID, token) || !validCardIDs(G, playerID, cardIDs, 1, 3)) return INVALID_MOVE;
  G.epoch++; G.secret!.discard.push(...takeCards(G, playerID, cardIDs));
  log(G, 'discard', '暗棄程式並補充等量手牌。', { actor: playerID, count: cardIDs.length }); endTurn(G, playerID, cardIDs.length);
}
function clearEffect({ G, playerID }: MoveContext, cardIDs: unknown, effect: unknown, token: unknown) {
  if (!isTurn(G, playerID, token) || !validCardIDs(G, playerID, cardIDs, 2, 2) || !currentEffects(G, playerID).includes(effect as FirewallEffect)) return INVALID_MOVE;
  G.epoch++; G.secret!.discard.push(...takeCards(G, playerID, cardIDs)); removeEffect(G, playerID, effect as FirewallEffect);
  log(G, 'clear-effect', '暗棄兩張程式，解除一項自身狀態，補充一張。', { actor: playerID, count: 2, effect: effect as FirewallEffect }); endTurn(G, playerID);
}
function steal({ G, playerID }: MoveContext, targetID: unknown, token: unknown) {
  if (G.status !== 'theft' || !isSeat(G, playerID) || G.activePlayer !== playerID || !Number.isInteger(token) || token !== G.epoch
    || !isSeat(G, targetID) || targetID === playerID || G.players[playerID].trapped || G.players[playerID].theftOrder === null) return INVALID_MOVE;
  G.epoch++; const amount = Math.min(1, G.private[targetID].gold); G.private[targetID].gold -= amount; G.private[playerID].gold += amount;
  G.roundResult!.thefts.push({ playerID, targetID, amount });
  log(G, 'theft', amount ? '後門取得一點資產。' : '對方沒有可取的資產，後門本次未取得分紅。', { actor: playerID, target: targetID, amount });
  G.secret!.theftQueue.shift();
  if (G.secret!.theftQueue.length) G.activePlayer = G.secret!.theftQueue[0]; else beginReview(G);
}
function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== G.turnOrder[0] || !G.turnOrder.every(id => G.players[id].ready)) return INVALID_MOVE;
  beginRound(G, random);
}

/** The complete helper consumes only the caller's projected hand and public board/effects. */
export function legalFirewallActions(G: FirewallState, playerID: string): FirewallAction[] {
  if (!isSeat(G, playerID)) return [];
  if (['briefing', 'review'].includes(G.status) && !G.players[playerID].acknowledged) return [{ move: 'acknowledge', args: [G.phaseEpoch] }];
  if (G.status === 'theft' && G.activePlayer === playerID) return G.turnOrder.filter(id => id !== playerID).map(id => ({ move: 'steal', args: [id, G.epoch] }));
  if (G.status !== 'turn' || G.activePlayer !== playerID || !G.private[playerID]) return [];
  const hand = G.private[playerID].hand, actions: FirewallAction[] = [];
  for (const card of hand) {
    if (card.kind === 'path') for (const placement of legalFirewallPlacements(G, playerID, card.id)) actions.push({ move: 'placePath', args: [card.id, placement.x, placement.y, placement.rotation, G.epoch] });
    else for (const target of legalFirewallActionTargets(G, playerID, card)) actions.push({ move: 'playAction', args: [card.id, target, G.epoch] });
  }
  const combinations: string[][] = [];
  function choose(start: number, selected: string[]) {
    if (selected.length) combinations.push([...selected]); if (selected.length === 3) return;
    for (let index = start; index < hand.length; index++) choose(index + 1, [...selected, hand[index].id]);
  }
  choose(0, []);
  for (const cardIDs of combinations) {
    actions.push({ move: 'discard', args: [cardIDs, G.epoch] });
    if (cardIDs.length === 2) for (const effect of currentEffects(G, playerID)) actions.push({ move: 'clearEffect', args: [cardIDs, effect, G.epoch] });
  }
  return actions;
}
export function firewallPlayerView({ G, playerID }: { G: FirewallState; playerID: string | null }): FirewallState {
  const { secret: _secret, private: _private, ...publicState } = G;
  const projected = { ...structuredClone(publicState), private: playerID !== null && isSeat(G, playerID) && G.private[playerID] ? { [playerID]: structuredClone(G.private[playerID]) } : {} };
  projected.board = projected.board.map(tile => tile.kind === 'goal' && !tile.revealed ? { id: tile.id, kind: 'goal', x: tile.x, y: tile.y, revealed: false } : tile);
  return projected;
}
export function firewallObserverView(G: FirewallState, perspective: 'blind' | 'god'): FirewallState {
  const view = firewallPlayerView({ G, playerID: null });
  if (perspective === 'god') view.private = structuredClone(G.private);
  return view;
}
const serverMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const FirewallGame: Game<FirewallState, Record<string, unknown>, FirewallSetupData> = {
  name: 'firewall-breach', minPlayers: 2, maxPlayers: 12,
  validateSetupData: (data, count) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data) || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '遊戲開始設定不正確。';
    const error = validateFirewallOptions(data?.options, count); if (error) return error;
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs) || data.participantIDs.length !== count || data.participantIDs.some(id => !isPlayerSeatID(id)) || new Set(data.participantIDs).size !== count)) return '參與玩家席位不正確。';
    return undefined;
  },
  setup: ({ ctx, random }, data) => {
    const participants = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, index) => String(index));
    const G: FirewallState = {
      rulesVersion: 1, status: 'lobby', options: normalizeFirewallOptions(data?.options), round: 0, targetRounds: FIREWALL_ROUND_COUNT,
      epoch: 0, phaseEpoch: 0, turnNumber: 0, turnOrder: [...participants], activePlayer: null, starter: participants[0], lastActor: null,
      players: Object.fromEntries(participants.map(id => [id, { ready: data?.startImmediately === true, acknowledged: false, handCount: 0, broken: [], trapped: false, theftOrder: null, publicRole: null }])),
      private: {}, board: [], deckCount: 0, discardCount: 0, roleDeckCount: 15, log: [], roundResult: null,
      finalScores: {}, winner: null, winnerIDs: [], winReason: null,
    };
    if (data?.startImmediately) beginRound(G, random); return G;
  },
  turn: { order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => G.turnOrder }, activePlayers: ActivePlayers.ALL },
  moves: { setReady: { move: setReady, ...serverMove }, startGame: { move: startGame, ...serverMove }, acknowledge: { move: acknowledge, ...serverMove },
    placePath: { move: placePath, ...serverMove }, playAction: { move: playAction, ...serverMove }, discard: { move: discard, ...serverMove }, clearEffect: { move: clearEffect, ...serverMove }, steal: { move: steal, ...serverMove } },
  disableUndo: true,
  plugins: [{ name: 'firewall-flow-guard', setup: () => ({}), isInvalid: ({ G, ctx }) => {
    if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason ? false : 'Game completion must follow the firewall rules.';
    if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== G.turnOrder[0] || ctx.phase !== null || !ctx.activePlayers
      || Object.keys(ctx.activePlayers).length !== G.turnOrder.length || G.turnOrder.some(id => ctx.activePlayers![id] !== null)
      || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
      || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for this game.';
    return false;
  } }],
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: firewallPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
