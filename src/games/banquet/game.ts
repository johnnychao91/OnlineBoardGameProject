import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { BANQUET_ROLES, type BanquetRole } from './content';
import { banquetRoleSet, isBanquetRole, normalizeBanquetOptions, validateBanquetOptions, type BanquetOptions } from './rules';
export type { BanquetRole } from './content';
export type { BanquetOptions } from './rules';

export interface BanquetPlayer { ready: boolean; acknowledged: boolean; coins: number; cannotAnnounce: boolean }
export interface BanquetObservation {
  turn: number; epoch: number; source: 'initial' | 'look' | 'claim' | 'guru' | 'spy' | 'princess';
  location: string; playerID?: string; role: BanquetRole; uncertain: boolean;
}
export interface BanquetPrivate { memory: BanquetObservation[] }
export interface BanquetChoice { id: string; label: string; playerID?: string; role?: BanquetRole }
export interface BanquetPending {
  actorID: string; kind: 'fool-targets' | 'spy-target' | 'swap' | 'guru-target' | 'guru-guess' | 'princess-target' | 'puppeteer-targets' | 'sorceress-target' | 'trickster-target';
  title: string; choices?: BanquetChoice[]; minimum?: number; maximum?: number;
}
export interface BanquetClaim {
  actorID: string; role: BanquetRole; claimantIDs: string[];
  responderIDs: string[]; responseIndex: number; responses: Record<string, boolean>;
  revealed: Record<string, BanquetRole>;
}
export interface BanquetLogEntry {
  type: string; turn: number; actorID?: string; targetIDs?: string[]; role?: BanquetRole;
  message: string; revealed?: Record<string, BanquetRole>; amount?: number; winnerIDs?: string[];
}
interface BanquetEffect { role: BanquetRole; actorID: string; fines: string[]; targets?: string[] }
interface BanquetSecret {
  masks: BanquetRole[]; center: BanquetRole[]; effect: BanquetEffect | null;
  revealedThisTurn: string[]; observerMemory: BanquetObservation[];
}
export interface BanquetState {
  rulesVersion: 1; status: 'lobby' | 'briefing' | 'playing' | 'finished'; options: BanquetOptions;
  players: Record<string, BanquetPlayer>; private: Record<string, BanquetPrivate>;
  turnOrder: string[]; activePlayer: string | null; turnNumber: number; initialTurnsRemaining: number;
  epoch: number; court: number; centerCount: number; inPlayRoles: BanquetRole[];
  initialLayout: BanquetObservation[]; pending: BanquetPending | null; claim: BanquetClaim | null;
  log: BanquetLogEntry[]; winner: 'wealth' | null; winnerIDs: string[]; winReason: string | null;
  /** Present only in authorized observer projections; never a player hand. */
  currentMasks?: { players: Record<string, BanquetRole>; center: BanquetRole[] };
  observerMemory?: BanquetObservation[];
  /** Cards have no persistent ID, backing, or other client-trackable metadata. */
  secret?: BanquetSecret;
}
export interface BanquetSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: BanquetOptions }
export interface BanquetAction { move: 'acknowledge' | 'look' | 'exchange' | 'announce' | 'respondClaim' | 'choose'; args: unknown[] }
type MoveContext = FnContext<BanquetState> & { playerID: string };
type RandomAPI = FnContext<BanquetState>['random'];
const ids = (G: BanquetState) => Object.keys(G.players);
const isSeat = (G: BanquetState, id: unknown): id is string => typeof id === 'string' && Object.hasOwn(G.players, id);
const validToken = (G: BanquetState, id: unknown, epoch: unknown): id is string => isSeat(G, id) && Number.isInteger(epoch) && epoch === G.epoch;
const locationOf = (G: BanquetState, id: string) => `seat:${G.turnOrder.indexOf(id)}`;
const actualRole = (G: BanquetState, id: string) => G.secret!.masks[G.turnOrder.indexOf(id)];
const otherPlayers = (G: BanquetState, actorID: string) => G.turnOrder.filter(id => id !== actorID);
function clockwiseAfter(G: BanquetState, actorID: string): string[] {
  const i = G.turnOrder.indexOf(actorID);
  return [...G.turnOrder.slice(i + 1), ...G.turnOrder.slice(0, i)];
}
function neighbors(G: BanquetState, id: string): [string, string] {
  const i = G.turnOrder.indexOf(id), n = G.turnOrder.length;
  return [G.turnOrder[(i + 1) % n], G.turnOrder[(i + n - 1) % n]];
}
function log(G: BanquetState, type: string, message: string, extra: Partial<BanquetLogEntry> = {}) {
  G.log.push({ type, turn: G.turnNumber, message, ...extra });
}
function observation(G: BanquetState, playerID: string, source: BanquetObservation['source']): BanquetObservation {
  return { turn: G.turnNumber, epoch: G.epoch, source, location: locationOf(G, playerID), playerID, role: actualRole(G, playerID), uncertain: false };
}
function remember(G: BanquetState, viewerID: string, targetID: string, source: BanquetObservation['source']) {
  G.private[viewerID].memory.push(observation(G, targetID, source));
}
function reveal(G: BanquetState, targetID: string, source: 'claim' | 'guru' | 'princess', excludeTarget = false) {
  for (const viewer of ids(G)) if (!excludeTarget || viewer !== targetID) remember(G, viewer, targetID, source);
  G.secret!.observerMemory.push(observation(G, targetID, source));
  if (!G.secret!.revealedThisTurn.includes(targetID)) G.secret!.revealedThisTurn.push(targetID);
}
function obscureMemories(G: BanquetState, locations: string[]) {
  for (const info of Object.values(G.private)) for (const entry of info.memory) if (locations.includes(entry.location)) entry.uncertain = true;
  for (const entry of G.secret!.observerMemory) if (locations.includes(entry.location)) entry.uncertain = true;
}
function locationRole(G: BanquetState, key: string): BanquetRole {
  const [kind, number] = key.split(':');
  return (kind === 'seat' ? G.secret!.masks : G.secret!.center)[Number(number)];
}
function setLocationRole(G: BanquetState, key: string, role: BanquetRole) {
  const [kind, number] = key.split(':');
  (kind === 'seat' ? G.secret!.masks : G.secret!.center)[Number(number)] = role;
}
function exchangeLocations(G: BanquetState, first: string, second: string, swap: boolean) {
  // Identical public mutations for a genuine exchange and a feint.
  obscureMemories(G, [first, second]);
  if (swap) {
    const one = locationRole(G, first), two = locationRole(G, second);
    setLocationRole(G, first, two); setLocationRole(G, second, one);
  }
}
function finish(G: BanquetState, reason: string, winners: string[]) {
  G.status = 'finished'; G.winner = 'wealth'; G.winnerIDs = [...winners]; G.winReason = reason;
  G.pending = null; G.secret!.effect = null; G.activePlayer = null;
  log(G, 'finish', '夜宴結束，妖金勝者已揭曉。', { winnerIDs: [...winners] });
}
function checkEnd(G: BanquetState): boolean {
  const rich = ids(G).filter(id => G.players[id].coins >= 13);
  if (rich.length) { finish(G, 'thirteen-coins', rich); return true; }
  if (ids(G).some(id => G.players[id].coins === 0)) {
    const highest = Math.max(...ids(G).map(id => G.players[id].coins));
    finish(G, 'bankruptcy', ids(G).filter(id => G.players[id].coins === highest)); return true;
  }
  return false;
}
function bank(G: BanquetState, amounts: Record<string, number>) {
  for (const [id, amount] of Object.entries(amounts)) G.players[id].coins += amount;
  return checkEnd(G);
}
function takeCoins(G: BanquetState, actorID: string, targets: string[], amount: number) {
  for (const target of targets) {
    const paid = Math.min(amount, G.players[target].coins);
    G.players[target].coins -= paid; G.players[actorID].coins += paid;
  }
  return checkEnd(G);
}
function endTurn(G: BanquetState) {
  if (G.status === 'finished') return;
  const next = clockwiseAfter(G, G.activePlayer!)[0];
  for (const [id, player] of Object.entries(G.players)) player.cannotAnnounce = id === next && G.secret!.revealedThisTurn.includes(id);
  G.secret!.revealedThisTurn = []; G.secret!.effect = null; G.pending = null; G.claim = null;
  G.turnNumber++; G.activePlayer = next;
}
function completeEffect(G: BanquetState) {
  if (G.status === 'finished') return;
  const fines = G.secret!.effect?.fines ?? [];
  if (fines.length) {
    for (const id of fines) { G.players[id].coins--; G.court++; }
    log(G, 'fine', '錯誤認領的賓客各向裁決堂繳納 1 枚妖金。', { targetIDs: [...fines], amount: 1 });
    if (checkEnd(G)) return;
  }
  endTurn(G);
}
function playerChoices(playerIDs: string[]): BanquetChoice[] {
  return playerIDs.map(playerID => ({ id: playerID, playerID, label: `${playerID} 號賓客` }));
}
function pending(G: BanquetState, actorID: string, kind: BanquetPending['kind'], title: string, choices: BanquetChoice[], count = 1) {
  G.pending = { actorID, kind, title, choices, minimum: count, maximum: count };
}
function swapPrompt(G: BanquetState, actorID: string) {
  pending(G, actorID, 'swap', '私下決定交換或假換這兩張面具', [{ id: 'swap', label: '交換面具' }, { id: 'keep', label: '假裝交換' }]);
}
function runEffect(G: BanquetState, role: BanquetRole, actorID: string, fines: string[], secondPeasant?: string) {
  G.secret!.effect = { role, actorID, fines };
  log(G, 'power', `${BANQUET_ROLES[role].name}的能力生效。`, { actorID, role });
  if (role === 'cheater') {
    if (G.players[actorID].coins >= 10) { finish(G, 'cheater', [actorID]); return; }
  } else if (role === 'empress' || role === 'king' || role === 'widow' || role === 'peasant') {
    const amount = role === 'empress' ? 3 : role === 'king' ? 2 : role === 'widow' ? Math.max(0, 10 - G.players[actorID].coins) : secondPeasant ? 2 : 1;
    if (bank(G, { [actorID]: amount, ...(secondPeasant ? { [secondPeasant]: 2 } : {}) })) return;
  } else if (role === 'judge') {
    const amount = G.court; G.court = 0; if (bank(G, { [actorID]: amount })) return;
  } else if (role === 'patron') {
    const [left, right] = neighbors(G, actorID);
    if (bank(G, { [actorID]: 3, [left]: 1, [right]: 1 })) return;
  } else if (role === 'thief') {
    if (takeCoins(G, actorID, neighbors(G, actorID), 1)) return;
  } else if (role === 'beggar') {
    for (const target of clockwiseAfter(G, actorID)) {
      if (G.players[target].coins > G.players[actorID].coins) {
        log(G, 'beggar-payment', '較富有的賓客交出 1 枚妖金。', { actorID, targetIDs: [target], amount: 1 });
        if (takeCoins(G, actorID, [target], 1)) return;
      }
    }
  } else if (role === 'fool') {
    if (bank(G, { [actorID]: 1 })) return;
    pending(G, actorID, 'fool-targets', '選擇其他兩位賓客的面具', playerChoices(otherPlayers(G, actorID)), 2); return;
  } else if (role === 'princess') {
    if (bank(G, { [actorID]: 2 })) return;
    pending(G, actorID, 'princess-target', '選擇一位賓客，向其他人展示他的面具', playerChoices(otherPlayers(G, actorID))); return;
  } else if (role === 'spy') {
    pending(G, actorID, 'spy-target', '選擇一位賓客，私下查看你們的兩張面具', playerChoices(otherPlayers(G, actorID))); return;
  } else if (role === 'guru') {
    pending(G, actorID, 'guru-target', '選擇一位賓客猜自己的面具', playerChoices(otherPlayers(G, actorID))); return;
  } else if (role === 'puppeteer') {
    pending(G, actorID, 'puppeteer-targets', '選擇兩位賓客繳納妖金並交換座位', playerChoices(otherPlayers(G, actorID)), 2); return;
  } else if (role === 'sorceress') {
    pending(G, actorID, 'sorceress-target', '可以交換財富，或保留現有妖金', [{ id: 'skip', label: '不交換財富' }, ...playerChoices(otherPlayers(G, actorID))]); return;
  } else if (role === 'trickster') {
    const others = otherPlayers(G, actorID), highest = Math.max(...others.map(id => G.players[id].coins));
    pending(G, actorID, 'trickster-target', '選擇其他賓客中最富有的一人', playerChoices(others.filter(id => G.players[id].coins === highest))); return;
  }
  completeEffect(G);
}
function resolveClaim(G: BanquetState) {
  const claim = G.claim!;
  if (claim.claimantIDs.length === 1) { runEffect(G, claim.role, claim.actorID, []); return; }
  for (const id of claim.claimantIDs) {
    claim.revealed[id] = actualRole(G, id); reveal(G, id, 'claim');
  }
  log(G, 'reveal', '所有認領者同時亮出面具。', { revealed: { ...claim.revealed }, targetIDs: [...claim.claimantIDs] });
  const correct = claim.claimantIDs.filter(id => claim.revealed[id] === claim.role), wrong = claim.claimantIDs.filter(id => claim.revealed[id] !== claim.role);
  if (correct.length) runEffect(G, claim.role, correct[0], wrong, claim.role === 'peasant' ? correct[1] : undefined);
  else { G.secret!.effect = { role: claim.role, actorID: claim.actorID, fines: wrong }; completeEffect(G); }
}
function handleChoice(G: BanquetState, selected: string[]) {
  const effect = G.secret!.effect!, { actorID, role } = effect, kind = G.pending!.kind, targetID = selected[0];
  if (kind === 'fool-targets') { effect.targets = selected; swapPrompt(G, actorID); return; }
  if (kind === 'spy-target') {
    effect.targets = [actorID, targetID]; remember(G, actorID, actorID, 'spy'); remember(G, actorID, targetID, 'spy');
    log(G, 'inspect', '百目鬼私下查看了兩張面具。', { actorID, targetIDs: [targetID] }); swapPrompt(G, actorID); return;
  }
  if (kind === 'swap') {
    const [first, second] = effect.targets!;
    exchangeLocations(G, locationOf(G, first), locationOf(G, second), targetID === 'swap');
    if (role === 'spy') { remember(G, actorID, first, 'spy'); remember(G, actorID, second, 'spy'); }
    log(G, 'exchange', '兩張面具完成秘密交換或假換。', { actorID, targetIDs: [...effect.targets!] });
  } else if (kind === 'guru-target') {
    effect.targets = [targetID];
    pending(G, targetID, 'guru-guess', '白澤請你宣稱目前戴著的面具', [...new Set(G.inPlayRoles)].map(role => ({ id: role, role, label: BANQUET_ROLES[role].name }))); return;
  } else if (kind === 'guru-guess') {
    const victim = effect.targets![0], actual = actualRole(G, victim);
    log(G, 'guess', '受詢問的賓客宣稱自己的面具。', { actorID: victim, role: targetID as BanquetRole });
    reveal(G, victim, 'guru'); log(G, 'reveal', '白澤驗證了受詢問者的面具。', { targetIDs: [victim], revealed: { [victim]: actual } });
    if (actual !== targetID && takeCoins(G, actorID, [victim], 4)) return;
  } else if (kind === 'princess-target') {
    reveal(G, targetID, 'princess', true);
    // Never put the excluded target's mask in public logs or a shared lastReveal.
    log(G, 'princess-reveal', '青行燈照亮了一張面具，只有持有者本人看不到。', { actorID, targetIDs: [targetID] });
  } else if (kind === 'puppeteer-targets') {
    if (takeCoins(G, actorID, selected, 1)) return;
    const [one, two] = selected, first = G.turnOrder.indexOf(one), second = G.turnOrder.indexOf(two);
    obscureMemories(G, [`seat:${first}`, `seat:${second}`]);
    [G.turnOrder[first], G.turnOrder[second]] = [G.turnOrder[second], G.turnOrder[first]];
    [G.players[one].coins, G.players[two].coins] = [G.players[two].coins, G.players[one].coins];
    // Masks remain at their physical locations. Credentials and private memories stay with people.
    log(G, 'seats', '兩位賓客交換座位，面具與財富留在原位。', { actorID, targetIDs: [...selected] });
  } else if (kind === 'sorceress-target') {
    if (targetID !== 'skip') {
      [G.players[actorID].coins, G.players[targetID].coins] = [G.players[targetID].coins, G.players[actorID].coins];
      log(G, 'wealth-swap', '兩位賓客交換全部財富。', { actorID, targetIDs: [targetID] });
      if (checkEnd(G)) return;
    }
  } else if (kind === 'trickster-target') {
    if (takeCoins(G, actorID, [targetID], 2)) return;
  }
  completeEffect(G);
}
export function banquetExchangeTargets(G: BanquetState, playerID: string): string[] {
  return [...G.turnOrder.flatMap((id, i) => id === playerID ? [] : [`seat:${i}`]), ...Array.from({ length: G.centerCount }, (_, i) => `center:${i}`)];
}
function ordinaryTurn(G: BanquetState, playerID: string) {
  return G.status === 'playing' && G.activePlayer === playerID && !G.pending && !G.claim;
}
function look({ G, playerID }: MoveContext, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || !ordinaryTurn(G, playerID) || G.initialTurnsRemaining) return INVALID_MOVE;
  G.epoch++; remember(G, playerID, playerID, 'look'); log(G, 'look', '一位賓客私下查看了自己的面具。', { actorID: playerID }); endTurn(G);
}
function exchange({ G, playerID }: MoveContext, target: unknown, swap: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || !ordinaryTurn(G, playerID) || typeof target !== 'string' || typeof swap !== 'boolean'
    || !banquetExchangeTargets(G, playerID).includes(target)) return INVALID_MOVE;
  G.epoch++; exchangeLocations(G, locationOf(G, playerID), target, swap);
  log(G, 'exchange', '兩張面具完成秘密交換或假換。', { actorID: playerID, targetIDs: [target] });
  if (G.initialTurnsRemaining) G.initialTurnsRemaining--;
  endTurn(G);
}
function announce({ G, playerID }: MoveContext, role: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || !ordinaryTurn(G, playerID) || G.initialTurnsRemaining || G.players[playerID].cannotAnnounce
    || !isBanquetRole(role) || !G.inPlayRoles.includes(role)) return INVALID_MOVE;
  G.epoch++;
  G.claim = { actorID: playerID, role, claimantIDs: [playerID], responderIDs: clockwiseAfter(G, playerID), responseIndex: 0, responses: {}, revealed: {} };
  log(G, 'announce', `宣稱戴著${BANQUET_ROLES[role].name}的面具，等待其他賓客依座次認領。`, { actorID: playerID, role });
}
function respondClaim({ G, playerID }: MoveContext, challenge: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.status !== 'playing' || G.pending || !G.claim || typeof challenge !== 'boolean'
    || G.claim.responderIDs[G.claim.responseIndex] !== playerID) return INVALID_MOVE;
  G.epoch++; G.claim.responses[playerID] = challenge;
  if (challenge) G.claim.claimantIDs.push(playerID);
  log(G, 'claim-response', challenge ? '一位賓客也認領了這張面具。' : '一位賓客放棄本次認領。', { actorID: playerID });
  G.claim.responseIndex++;
  if (G.claim.responseIndex === G.claim.responderIDs.length) resolveClaim(G);
}
function choose({ G, playerID }: MoveContext, selected: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.status !== 'playing' || G.pending?.actorID !== playerID || !G.secret?.effect
    || !Array.isArray(selected) || selected.some(id => typeof id !== 'string') || new Set(selected).size !== selected.length) return INVALID_MOVE;
  const p = G.pending;
  if (selected.length < (p.minimum ?? 1) || selected.length > (p.maximum ?? 1) || selected.some(id => !p.choices?.some(choice => choice.id === id))) return INVALID_MOVE;
  G.epoch++; handleChoice(G, selected);
}
function acknowledge({ G, playerID }: MoveContext, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.status !== 'briefing' || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.epoch++; G.players[playerID].acknowledged = true;
  if (ids(G).every(id => G.players[id].acknowledged)) { G.status = 'playing'; G.turnNumber = 1; G.initialTurnsRemaining = 4; }
}
function beginGame(G: BanquetState, random: RandomAPI) {
  const roles = banquetRoleSet(G.options, ids(G).length), shuffled = random.Shuffle(roles);
  G.inPlayRoles = roles; G.turnOrder = ids(G); G.activePlayer = G.turnOrder[0]; G.centerCount = roles.length - ids(G).length;
  G.secret = { masks: shuffled.slice(0, ids(G).length), center: shuffled.slice(ids(G).length), effect: null, revealedThisTurn: [], observerMemory: [] };
  G.initialLayout = [...G.turnOrder.map(id => observation(G, id, 'initial')), ...G.secret.center.map((role, index) => ({ turn: 0, epoch: G.epoch, source: 'initial' as const, location: `center:${index}`, role, uncertain: false }))];
  for (const id of ids(G)) G.private[id].memory = structuredClone(G.initialLayout);
  G.secret.observerMemory = structuredClone(G.initialLayout);
  G.status = 'briefing'; G.epoch++;
  log(G, 'deal', '面具已公開分配。所有賓客記住開場位置後，開始四次盲換。');
}
function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== ids(G)[0] || !ids(G).every(id => G.players[id].ready) || validateBanquetOptions(G.options, ids(G).length)) return INVALID_MOVE;
  beginGame(G, random);
}

/** Enumerates exclusively from the acting person's authorized view. */
export function legalBanquetActions(view: BanquetState, playerID: string): BanquetAction[] {
  if (!isSeat(view, playerID)) return [];
  if (view.status === 'briefing') return view.players[playerID].acknowledged ? [] : [{ move: 'acknowledge', args: [view.epoch] }];
  if (view.status !== 'playing') return [];
  if (view.pending) {
    if (view.pending.actorID !== playerID || !view.pending.choices) return [];
    const min = view.pending.minimum ?? 1, max = view.pending.maximum ?? min, choices = view.pending.choices;
    const selections: string[][] = [];
    const visit = (chosen: string[], start: number) => {
      if (chosen.length >= min) selections.push([...chosen]);
      if (chosen.length >= max) return;
      for (let i = start; i < choices.length; i++) visit([...chosen, choices[i].id], i + 1);
    };
    visit([], 0); return selections.map(selected => ({ move: 'choose', args: [selected, view.epoch] }));
  }
  if (view.claim) return view.claim.responderIDs[view.claim.responseIndex] === playerID
    ? [false, true].map(challenge => ({ move: 'respondClaim', args: [challenge, view.epoch] })) : [];
  if (view.activePlayer !== playerID) return [];
  const actions: BanquetAction[] = banquetExchangeTargets(view, playerID).flatMap(target => [false, true].map(swap => ({ move: 'exchange' as const, args: [target, swap, view.epoch] })));
  if (!view.initialTurnsRemaining) {
    actions.push({ move: 'look', args: [view.epoch] });
    if (!view.players[playerID].cannotAnnounce) for (const role of new Set(view.inPlayRoles)) actions.push({ move: 'announce', args: [role, view.epoch] });
  }
  return actions;
}
export function banquetPlayerView({ G, playerID }: { G: BanquetState; playerID: string | null }): BanquetState {
  const { secret: _secret, private: _private, currentMasks: _current, observerMemory: _memory, ...publicState } = G;
  const view = structuredClone(publicState) as BanquetState;
  view.private = playerID !== null && isSeat(G, playerID) ? { [playerID]: structuredClone(G.private[playerID]) } : {};
  if (view.pending && view.pending.actorID !== playerID) { delete view.pending.choices; delete view.pending.minimum; delete view.pending.maximum; }
  return view;
}
export function banquetObserverView(G: BanquetState, perspective: 'blind' | 'god'): BanquetState {
  const view = banquetPlayerView({ G, playerID: null });
  view.observerMemory = structuredClone(G.secret?.observerMemory ?? G.observerMemory ?? []);
  if (perspective === 'god') {
    if (G.secret?.masks.length) view.currentMasks = { players: Object.fromEntries(G.turnOrder.map((id, i) => [id, G.secret!.masks[i]])), center: [...G.secret.center] };
    else if (G.currentMasks) view.currentMasks = structuredClone(G.currentMasks);
    view.private = structuredClone(G.private);
  }
  return view;
}
const serverMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const BanquetGame: Game<BanquetState, Record<string, unknown>, BanquetSetupData> = {
  name: 'hundred-ghosts', minPlayers: 4, maxPlayers: 12,
  validateSetupData: (data, count) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data) || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '遊戲開始設定不正確。';
    if (!Number.isInteger(count) || count < 4 || count > 12) return '百鬼夜宴需要 4～12 位玩家。';
    const error = validateBanquetOptions(data?.options, data?.startImmediately ? count : undefined); if (error) return error;
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs) || data.participantIDs.length !== count || data.participantIDs.some(id => !isPlayerSeatID(id)) || new Set(data.participantIDs).size !== count)) return '參與玩家席位不正確。';
    return undefined;
  },
  setup: ({ ctx, random }, data) => {
    const options = normalizeBanquetOptions(data?.options), error = validateBanquetOptions(options, data?.startImmediately ? ctx.numPlayers : undefined); if (error) throw new Error(error);
    const participants = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, i) => String(i));
    const G: BanquetState = {
      rulesVersion: 1, status: 'lobby', options, players: Object.fromEntries(participants.map(id => [id, { ready: data?.startImmediately === true, acknowledged: false, coins: 6, cannotAnnounce: false }])),
      private: Object.fromEntries(participants.map(id => [id, { memory: [] }])), turnOrder: [...participants], activePlayer: null, turnNumber: 0, initialTurnsRemaining: 0,
      epoch: 0, court: 0, centerCount: 0, inPlayRoles: [], initialLayout: [], pending: null, claim: null, log: [], winner: null, winnerIDs: [], winReason: null,
      secret: { masks: [], center: [], effect: null, revealedThisTurn: [], observerMemory: [] },
    };
    if (data?.startImmediately) beginGame(G, random);
    return G;
  },
  turn: { order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => ids(G) }, activePlayers: ActivePlayers.ALL },
  moves: {
    setReady: { move: setReady, ...serverMove }, startGame: { move: startGame, ...serverMove }, acknowledge: { move: acknowledge, ...serverMove },
    look: { move: look, ...serverMove }, exchange: { move: exchange, ...serverMove }, announce: { move: announce, ...serverMove },
    respondClaim: { move: respondClaim, ...serverMove }, choose: { move: choose, ...serverMove },
  },
  disableUndo: true,
  plugins: [{ name: 'banquet-flow-guard', setup: () => ({}), isInvalid: ({ G, ctx }) => {
    if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason ? false : 'Game completion must follow the banquet rules.';
    if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== ids(G)[0] || ctx.phase !== null || !ctx.activePlayers
      || Object.keys(ctx.activePlayers).length !== ids(G).length || ids(G).some(id => ctx.activePlayers![id] !== null)
      || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
      || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for this game.';
    return false;
  } }],
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: banquetPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
