import type { FnContext, Game } from 'boardgame.io';
import { ActivePlayers, INVALID_MOVE } from 'boardgame.io/core';
import { isPlayerSeatID } from '../catalog';
import { BAKER_DECKS, BAKER_SCENES, type BakerCard, type BakerScene } from './content';
import { BAKER_ROLES, normalizeBakerOptions, resolveBakerRoleSet, validateBakerOptions, type BakerOptions, type BakerRole, type BakerFaction } from './rules';
export type { BakerOptions, BakerRole, BakerFaction } from './rules';

export interface BakerSolution { murdererID: string; meansID: string; clueID: string }
export interface BakerPlayer {
  ready: boolean; acknowledged: boolean; badge: boolean;
  means: BakerCard[]; clues: BakerCard[]; revealedRole?: BakerRole; revealedFaction?: BakerFaction;
}
export interface BakerPrivate {
  role: BakerRole | null; faction: BakerFaction | null; knownCriminals: string[];
  knownWitnessID?: string; solution: BakerSolution | null;
}
export interface BakerSceneSlot { tile: BakerScene; marks: number[] }
export interface BakerSpecialPending { tile: BakerScene; replacement?: BakerScene }
export interface BakerLogEntry {
  type: string; round: number; message: string; actorID?: string; targetID?: string;
  meansID?: string; clueID?: string; tileID?: string; option?: number; correct?: boolean;
}
export type BakerStatus = 'lobby' | 'briefing' | 'crime' | 'scene-setup' | 'evidence' | 'discussion' | 'presentation' | 'replacement' | 'special' | 'witness-hunt' | 'finished';
export interface BakerState {
  rulesVersion: 1; status: BakerStatus; options: BakerOptions; round: number; epoch: number;
  players: Record<string, BakerPlayer>; private: Record<string, BakerPrivate>;
  holmesID: string | null; turnOrder: string[]; speakerID: string | null; speakerIndex: number;
  scenes: BakerSceneSlot[]; nextScene: BakerScene | null; special: BakerSpecialPending | null;
  excludedCards: string[]; solution: BakerSolution | null; log: BakerLogEntry[];
  winner: BakerFaction | null; winReason: string | null;
  /** Every source deck and the authoritative answer remain server-only. */
  secret?: { sceneDeck: BakerScene[]; specialDeck: BakerScene[]; solution: BakerSolution | null; specialChecked: boolean };
}
export interface BakerSetupData { startImmediately?: boolean; participantIDs?: string[]; options?: BakerOptions }
export interface BakerAction { move: 'acknowledge' | 'chooseCrime' | 'chooseLocation' | 'markScene' | 'startPresentations' | 'finishSpeech' | 'replaceScene' | 'resolveSpecial' | 'accuse' | 'identifyWitness'; args: unknown[] }

type MoveContext = FnContext<BakerState> & { playerID: string };
type RandomAPI = FnContext<BakerState>['random'];
const ids = (G: BakerState) => Object.keys(G.players);
const isSeat = (G: BakerState, id: unknown): id is string => typeof id === 'string' && Object.hasOwn(G.players, id);
const validToken = (G: BakerState, id: unknown, epoch: unknown): id is string => isSeat(G, id) && Number.isInteger(epoch) && epoch === G.epoch;
const copy = <T>(value: T): T => structuredClone(value);
const optionValid = (tile: BakerScene, option: unknown): option is number => typeof option === 'number' && Number.isInteger(option) && option >= 0 && option < tile.options.length;
const ordinarySlots = (G: BakerState) => G.scenes.filter(slot => slot.tile.kind === 'scene');
function tileForEra(tile: BakerScene, G: BakerState): BakerScene {
  const result = copy(tile); result.options = [...(tile.eraOptions?.[G.options.era] ?? tile.options)]; return result;
}
function log(G: BakerState, type: string, message: string, extra: Partial<BakerLogEntry> = {}) {
  G.log.push({ type, round: G.round, message, ...extra });
}
function finish(G: BakerState, winner: BakerFaction, reason: string) {
  G.status = 'finished'; G.winner = winner; G.winReason = reason; G.epoch++;
  G.speakerID = null; G.nextScene = null; G.special = null;
  // Moves run inside Immer; copy these primitive answer fields without trying
  // to structuredClone the draft proxy.
  G.solution = G.secret!.solution ? { ...G.secret!.solution } : null;
  for (const id of ids(G)) {
    const role = G.private[id].role!;
    G.players[id].revealedRole = role; G.players[id].revealedFaction = BAKER_ROLES[role].faction;
  }
  log(G, 'finish', winner === 'police' ? '真相大白，倫敦警察阻止了莫里亞蒂的計畫。' : '莫里亞蒂的計畫得逞，執行者逃過了定罪。');
}
function beginGame(G: BakerState, random: RandomAPI) {
  const participants = ids(G), roleSet = resolveBakerRoleSet(G.options, participants.length);
  const validation = validateBakerOptions(G.options, participants.length, participants); if (validation) throw new Error(validation);
  const holmes = G.options.holmesID === 'random' ? random.Shuffle(participants)[0] : G.options.holmesID;
  const roles: BakerRole[] = ['murderer'];
  if (roleSet !== 'basic') roles.push('accomplice');
  if (roleSet === 'all') roles.push('watson');
  while (roles.length < participants.length - 1) roles.push('investigator');
  const shuffledRoles = random.Shuffle(roles), others = participants.filter(id => id !== holmes);
  const means = random.Shuffle([...BAKER_DECKS[G.options.era].means]).map(copy);
  const clues = random.Shuffle([...BAKER_DECKS[G.options.era].clues]).map(copy);
  G.holmesID = holmes; G.status = 'briefing'; G.round = 0; G.epoch++;
  for (const id of participants) {
    const role: BakerRole = id === holmes ? 'holmes' : shuffledRoles[others.indexOf(id)];
    G.private[id] = { role, faction: BAKER_ROLES[role].faction, knownCriminals: [], solution: null };
    G.players[id].ready = true; G.players[id].acknowledged = false; G.players[id].badge = id !== holmes;
    if (id === holmes) { G.players[id].revealedRole = 'holmes'; G.players[id].revealedFaction = 'police'; }
    else { G.players[id].means = means.splice(0, G.options.cardsPerType); G.players[id].clues = clues.splice(0, G.options.cardsPerType); }
  }
  const criminals = participants.filter(id => G.private[id].faction === 'criminals');
  const witness = participants.find(id => G.private[id].role === 'watson');
  for (const id of participants) {
    if (G.private[id].role !== 'investigator') G.private[id].knownCriminals = [...criminals];
    if (id === holmes && witness) G.private[id].knownWitnessID = witness;
  }
  const holmesIndex = participants.indexOf(holmes);
  G.turnOrder = [...participants.slice(holmesIndex + 1), ...participants.slice(0, holmesIndex)];
  G.secret = {
    sceneDeck: random.Shuffle(BAKER_SCENES.filter(tile => tile.kind === 'scene')).map(tile => tileForEra(tile, G)),
    specialDeck: random.Shuffle(BAKER_SCENES.filter(tile => tile.kind === 'special')).map(tile => tileForEra(tile, G)),
    solution: null, specialChecked: false,
  };
  log(G, 'case', `${G.options.year} 年的案件卷宗已開啟。`);
}
function takeOrdinary(G: BakerState): BakerScene {
  const index = G.secret!.sceneDeck.findIndex(tile => tile.kind === 'scene');
  if (index < 0) throw new Error('案件圖板庫不足。');
  return G.secret!.sceneDeck.splice(index, 1)[0];
}
function queueReplacement(G: BakerState) {
  G.special = null; G.nextScene = takeOrdinary(G); G.status = 'replacement';
}
function beginNextRound(G: BakerState, random: RandomAPI) {
  G.round++; G.speakerID = null; G.speakerIndex = -1;
  if (G.options.specialScenes && !G.secret!.specialChecked) {
    G.secret!.sceneDeck = random.Shuffle([...G.secret!.sceneDeck, ...G.secret!.specialDeck]);
    G.secret!.specialDeck = []; G.secret!.specialChecked = true;
  }
  const next = G.secret!.sceneDeck.shift();
  if (!next) throw new Error('案件圖板庫不足。');
  if (next.kind !== 'special') { G.nextScene = next; G.status = 'replacement'; return; }
  G.status = 'special'; G.special = { tile: next };
  log(G, 'special', `特別圖板：${next.name}。`, { tileID: next.id });
  if (next.effect === 'replace-scene') G.special.replacement = takeOrdinary(G);
  if (next.effect === 'restore-badge' && !ids(G).some(id => id !== G.holmesID && !G.players[id].badge)) {
    log(G, 'special-skip', '所有調查成員都仍持有警徽，本次恢復不需執行。'); queueReplacement(G);
  }
}
function acknowledge({ G, playerID }: MoveContext, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.status !== 'briefing' || G.players[playerID].acknowledged) return INVALID_MOVE;
  G.players[playerID].acknowledged = true;
  if (Object.values(G.players).every(player => player.acknowledged)) { G.status = 'crime'; G.epoch++; }
}
function chooseCrime({ G, playerID }: MoveContext, meansID: unknown, clueID: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.status !== 'crime' || G.private[playerID].role !== 'murderer'
    || typeof meansID !== 'string' || typeof clueID !== 'string'
    || !G.players[playerID].means.some(card => card.id === meansID) || !G.players[playerID].clues.some(card => card.id === clueID)) return INVALID_MOVE;
  const answer = { murdererID: playerID, meansID, clueID };
  G.secret!.solution = answer;
  for (const id of ids(G)) if (G.private[id].role === 'holmes' || G.private[id].faction === 'criminals') G.private[id].solution = { ...answer };
  G.status = 'scene-setup'; G.round = 1; G.epoch++;
  log(G, 'investigation', '案情已確立，等待福爾摩斯選擇現場圖板。');
}
function chooseLocation({ G, playerID }: MoveContext, tileID: unknown, epoch: unknown) {
  const location = typeof tileID === 'string' ? BAKER_SCENES.find(tile => tile.id === tileID && tile.kind === 'location') : undefined;
  if (!validToken(G, playerID, epoch) || playerID !== G.holmesID || G.status !== 'scene-setup' || !location) return INVALID_MOVE;
  const cause = BAKER_SCENES.find(tile => tile.kind === 'cause')!;
  G.scenes = [tileForEra(cause, G), tileForEra(location, G), ...Array.from({ length: 4 }, () => takeOrdinary(G))].map(tile => ({ tile, marks: [] }));
  G.status = 'evidence'; G.epoch++;
  log(G, 'scene', '現場圖板已展開，福爾摩斯開始放置西洋棋標記。');
}
function markScene({ G, playerID }: MoveContext, tileID: unknown, option: unknown, epoch: unknown) {
  const slot = typeof tileID === 'string' ? G.scenes.find(item => item.tile.id === tileID) : undefined;
  if (!validToken(G, playerID, epoch) || playerID !== G.holmesID || G.status !== 'evidence' || !slot || slot.marks.length || !optionValid(slot.tile, option)) return INVALID_MOVE;
  slot.marks.push(option); G.epoch++;
  log(G, 'mark', `${slot.tile.name}：${slot.tile.options[option]}。`, { tileID: slot.tile.id, option });
  if (G.scenes.every(item => item.marks.length > 0)) G.status = 'discussion';
}
function startPresentations({ G, playerID }: MoveContext, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || playerID !== G.holmesID || G.status !== 'discussion') return INVALID_MOVE;
  G.status = 'presentation'; G.speakerIndex = 0; G.speakerID = G.turnOrder[0]; G.epoch++;
  log(G, 'presentation', `第 ${G.round} 輪開始依序發表推論。`);
}
function finishSpeech({ G, playerID, random }: MoveContext, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.status !== 'presentation' || (playerID !== G.speakerID && playerID !== G.holmesID)) return INVALID_MOVE;
  log(G, 'speech', '本位調查成員已完成發言。', { actorID: G.speakerID! }); G.epoch++;
  G.speakerIndex++;
  if (G.speakerIndex < G.turnOrder.length) { G.speakerID = G.turnOrder[G.speakerIndex]; return; }
  if (G.round === 3) finish(G, 'criminals', 'investigation-expired');
  else beginNextRound(G, random);
}
function replaceScene({ G, playerID }: MoveContext, oldTileID: unknown, option: unknown, epoch: unknown) {
  const slot = typeof oldTileID === 'string' ? ordinarySlots(G).find(item => item.tile.id === oldTileID) : undefined;
  if (!validToken(G, playerID, epoch) || playerID !== G.holmesID || G.status !== 'replacement' || !G.nextScene || !slot || !optionValid(G.nextScene, option)) return INVALID_MOVE;
  slot.tile = G.nextScene; slot.marks = [option]; G.nextScene = null; G.status = 'discussion'; G.epoch++;
  log(G, 'replace', `${slot.tile.name}：${slot.tile.options[option]}。`, { tileID: slot.tile.id, option });
}
function resolveSpecial({ G, playerID }: MoveContext, targetID: unknown, option: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || playerID !== G.holmesID || G.status !== 'special' || !G.special || typeof targetID !== 'string') return INVALID_MOVE;
  const pending = G.special, effect = pending.tile.effect;
  const slot = ordinarySlots(G).find(item => item.tile.id === targetID);
  if (effect === 'additional-mark' || effect === 'retrace-mark') {
    if (!slot || !optionValid(slot.tile, option) || slot.marks.includes(option) || (effect === 'retrace-mark' && slot.marks.length !== 1)) return INVALID_MOVE;
    if (effect === 'additional-mark') slot.marks.push(option); else slot.marks = [option];
    log(G, 'special-mark', `${slot.tile.name}：${slot.tile.options[option]}。`, { tileID: targetID, option });
  } else if (effect === 'replace-scene') {
    if (!slot || !pending.replacement || !optionValid(pending.replacement, option)) return INVALID_MOVE;
    slot.tile = pending.replacement; slot.marks = [option];
    log(G, 'special-replace', `${slot.tile.name}：${slot.tile.options[option]}。`, { tileID: slot.tile.id, option });
  } else if (effect === 'exclude-means' || effect === 'exclude-clue') {
    if (option !== null || G.excludedCards.includes(targetID)) return INVALID_MOVE;
    const field = effect === 'exclude-means' ? 'means' : 'clues';
    const answer = effect === 'exclude-means' ? G.secret!.solution!.meansID : G.secret!.solution!.clueID;
    const card = Object.values(G.players).flatMap(player => player[field]).find(item => item.id === targetID);
    if (!card || targetID === answer) return INVALID_MOVE;
    G.excludedCards.push(targetID);
    log(G, 'exclude', `${card.name} 已排除於本案答案。`, effect === 'exclude-means' ? { meansID: targetID } : { clueID: targetID });
  } else if (effect === 'restore-badge') {
    if (option !== null || !isSeat(G, targetID) || targetID === G.holmesID || G.players[targetID].badge) return INVALID_MOVE;
    G.players[targetID].badge = true;
    log(G, 'badge', '一位調查成員重新取得一次正式破案機會。', { targetID });
  } else return INVALID_MOVE;
  G.epoch++; queueReplacement(G);
}
export function bakerCanAccuse(G: BakerState, id: string): boolean {
  return isSeat(G, id) && id !== G.holmesID && G.players[id].badge
    && ['evidence', 'discussion', 'presentation', 'replacement', 'special'].includes(G.status)
    && G.scenes.some(slot => slot.marks.length > 0);
}
function accuse({ G, playerID }: MoveContext, targetID: unknown, meansID: unknown, clueID: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || !bakerCanAccuse(G, playerID) || !isSeat(G, targetID) || targetID === playerID || targetID === G.holmesID
    || typeof meansID !== 'string' || typeof clueID !== 'string' || G.excludedCards.includes(meansID) || G.excludedCards.includes(clueID)
    || !G.players[targetID].means.some(card => card.id === meansID) || !G.players[targetID].clues.some(card => card.id === clueID)) return INVALID_MOVE;
  const answer = G.secret!.solution!;
  const correct = targetID === answer.murdererID && meansID === answer.meansID && clueID === answer.clueID;
  G.players[playerID].badge = false; G.epoch++;
  log(G, 'accusation', correct ? '作案手段與關鍵物證均已確認。' : '推論不成立。', { actorID: playerID, targetID, meansID, clueID, correct });
  if (correct) {
    if (Object.values(G.private).some(info => info.role === 'watson')) {
      G.status = 'witness-hunt'; G.speakerID = null; G.nextScene = null; G.special = null;
      G.players[targetID].revealedRole = 'murderer'; G.players[targetID].revealedFaction = 'criminals';
      log(G, 'witness-hunt', '案情已被揭開；執行者有最後一次指認華生的機會。');
    } else finish(G, 'police', 'crime-solved');
  } else if (ids(G).filter(id => id !== G.holmesID).every(id => !G.players[id].badge)) finish(G, 'criminals', 'badges-exhausted');
}
function identifyWitness({ G, playerID }: MoveContext, targetID: unknown, epoch: unknown) {
  if (!validToken(G, playerID, epoch) || G.status !== 'witness-hunt' || G.private[playerID].role !== 'murderer'
    || !isSeat(G, targetID) || targetID === G.holmesID || targetID === playerID) return INVALID_MOVE;
  const found = G.private[targetID].role === 'watson';
  log(G, 'identify', found ? '華生被執行者識破，關鍵目擊證詞未能提交。' : '指認失敗，華生安全提交了目擊證詞。', { actorID: playerID, targetID });
  finish(G, found ? 'criminals' : 'police', found ? 'witness-found' : 'witness-protected');
}
function setReady({ G, playerID }: MoveContext, ready: unknown) {
  if (G.status !== 'lobby' || !isSeat(G, playerID) || typeof ready !== 'boolean') return INVALID_MOVE;
  G.players[playerID].ready = ready;
}
function startGame({ G, playerID, random }: MoveContext) {
  if (G.status !== 'lobby' || playerID !== ids(G)[0] || !Object.values(G.players).every(player => player.ready)
    || validateBakerOptions(G.options, ids(G).length, ids(G))) return INVALID_MOVE;
  beginGame(G, random);
}

/** Enumerate actions solely from an authorized player projection. */
export function legalBakerActions(view: BakerState, playerID: string): BakerAction[] {
  if (!isSeat(view, playerID) || !view.private[playerID]) return [];
  const own = view.private[playerID], epoch = view.epoch, actions: BakerAction[] = [];
  const add = (move: BakerAction['move'], ...args: unknown[]) => actions.push({ move, args: [...args, epoch] });
  if (view.status === 'briefing' && !view.players[playerID].acknowledged) add('acknowledge');
  if (view.status === 'crime' && own.role === 'murderer') for (const means of view.players[playerID].means) for (const clue of view.players[playerID].clues) add('chooseCrime', means.id, clue.id);
  if (view.status === 'scene-setup' && playerID === view.holmesID) for (const tile of BAKER_SCENES.filter(tile => tile.kind === 'location')) add('chooseLocation', tile.id);
  if (view.status === 'evidence' && playerID === view.holmesID) for (const slot of view.scenes.filter(slot => !slot.marks.length)) slot.tile.options.forEach((_, index) => add('markScene', slot.tile.id, index));
  if (view.status === 'discussion' && playerID === view.holmesID) add('startPresentations');
  if (view.status === 'presentation' && (playerID === view.speakerID || playerID === view.holmesID)) add('finishSpeech');
  if (view.status === 'replacement' && playerID === view.holmesID && view.nextScene) for (const slot of ordinarySlots(view)) view.nextScene.options.forEach((_, index) => add('replaceScene', slot.tile.id, index));
  if (view.status === 'special' && playerID === view.holmesID && view.special) {
    const effect = view.special.tile.effect;
    if (effect === 'additional-mark' || effect === 'retrace-mark') {
      for (const slot of ordinarySlots(view)) if (effect !== 'retrace-mark' || slot.marks.length === 1) slot.tile.options.forEach((_, index) => { if (!slot.marks.includes(index)) add('resolveSpecial', slot.tile.id, index); });
    } else if (effect === 'replace-scene' && view.special.replacement) {
      for (const slot of ordinarySlots(view)) view.special.replacement.options.forEach((_, index) => add('resolveSpecial', slot.tile.id, index));
    } else if (effect === 'exclude-means' || effect === 'exclude-clue') {
      const field = effect === 'exclude-means' ? 'means' : 'clues';
      const answer = effect === 'exclude-means' ? own.solution?.meansID : own.solution?.clueID;
      for (const card of Object.values(view.players).flatMap(player => player[field])) if (card.id !== answer && !view.excludedCards.includes(card.id)) add('resolveSpecial', card.id, null);
    } else if (effect === 'restore-badge') {
      for (const id of ids(view)) if (id !== view.holmesID && !view.players[id].badge) add('resolveSpecial', id, null);
    }
  }
  if (bakerCanAccuse(view, playerID)) for (const targetID of ids(view).filter(id => id !== playerID && id !== view.holmesID)) {
    for (const means of view.players[targetID].means.filter(card => !view.excludedCards.includes(card.id)))
      for (const clue of view.players[targetID].clues.filter(card => !view.excludedCards.includes(card.id))) add('accuse', targetID, means.id, clue.id);
  }
  if (view.status === 'witness-hunt' && own.role === 'murderer') for (const id of ids(view)) if (id !== playerID && id !== view.holmesID) add('identifyWitness', id);
  return actions;
}
export function bakerPlayerView({ G, playerID }: { G: BakerState; playerID: string | null }): BakerState {
  const { secret: _secret, private: _private, ...publicState } = G;
  const view = copy(publicState) as BakerState;
  view.private = playerID !== null && isSeat(G, playerID) && G.private[playerID] ? { [playerID]: copy(G.private[playerID]) } : {};
  return view;
}
export function bakerObserverView(G: BakerState, perspective: 'blind' | 'god'): BakerState {
  const view = bakerPlayerView({ G, playerID: null });
  if (perspective === 'god') for (const id of ids(G)) if (G.private[id]) view.private[id] = copy(G.private[id]);
  return view;
}

const serverMove = { ignoreStaleStateID: true, client: false, undoable: false, redact: true } as const;
export const BakerGame: Game<BakerState, Record<string, unknown>, BakerSetupData> = {
  name: 'baker-street', minPlayers: 4, maxPlayers: 12,
  validateSetupData: (data, count) => {
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data)
      || (data.startImmediately !== undefined && typeof data.startImmediately !== 'boolean'))) return '案件開始設定不正確。';
    if (!Number.isInteger(count) || count < 4 || count > 12) return '貝克街迷霧需要 4～12 位玩家。';
    const error = validateBakerOptions(data?.options, data?.startImmediately ? count : undefined); if (error) return error;
    if (data?.participantIDs !== undefined && (!Array.isArray(data.participantIDs) || data.participantIDs.length !== count
      || data.participantIDs.some(id => !isPlayerSeatID(id)) || new Set(data.participantIDs).size !== count)) return '參與玩家席位不正確。';
    const participants = data?.participantIDs ?? Array.from({ length: count }, (_, i) => String(i));
    return data?.startImmediately ? validateBakerOptions(data.options, count, participants) : undefined;
  },
  setup: ({ ctx, random }, data) => {
    const options = normalizeBakerOptions(data?.options), participants = data?.participantIDs ?? Array.from({ length: ctx.numPlayers }, (_, index) => String(index));
    const G: BakerState = {
      rulesVersion: 1, status: 'lobby', options, round: 0, epoch: 0,
      players: Object.fromEntries(participants.map(id => [id, { ready: false, acknowledged: false, badge: false, means: [], clues: [] }])),
      private: Object.fromEntries(participants.map(id => [id, { role: null, faction: null, knownCriminals: [], solution: null }])),
      holmesID: null, turnOrder: [], speakerID: null, speakerIndex: -1, scenes: [], nextScene: null, special: null,
      excludedCards: [], solution: null, log: [], winner: null, winReason: null,
      secret: { sceneDeck: [], specialDeck: [], solution: null, specialChecked: false },
    };
    if (data?.startImmediately) beginGame(G, random);
    return G;
  },
  turn: { order: { first: () => 0, next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.playOrder.length, playOrder: ({ G }) => ids(G) }, activePlayers: ActivePlayers.ALL },
  moves: {
    setReady: { move: setReady, ...serverMove }, startGame: { move: startGame, ...serverMove },
    acknowledge: { move: acknowledge, ...serverMove }, chooseCrime: { move: chooseCrime, ...serverMove },
    chooseLocation: { move: chooseLocation, ...serverMove }, markScene: { move: markScene, ...serverMove },
    startPresentations: { move: startPresentations, ...serverMove }, finishSpeech: { move: finishSpeech, ...serverMove },
    replaceScene: { move: replaceScene, ...serverMove }, resolveSpecial: { move: resolveSpecial, ...serverMove },
    accuse: { move: accuse, ...serverMove }, identifyWitness: { move: identifyWitness, ...serverMove },
  },
  disableUndo: true,
  plugins: [{ name: 'baker-flow-guard', setup: () => ({}), isInvalid: ({ G, ctx }) => {
    if (G.status === 'finished') return ctx.gameover?.winner === G.winner && ctx.gameover?.reason === G.winReason ? false : 'Game completion must follow the Baker Street rules.';
    if (ctx.gameover !== undefined || ctx.turn !== 1 || ctx.currentPlayer !== ids(G)[0] || ctx.phase !== null || !ctx.activePlayers
      || Object.keys(ctx.activePlayers).length !== ids(G).length || ids(G).some(id => ctx.activePlayers![id] !== null)
      || Object.keys(ctx._activePlayersMinMoves ?? {}).length > 0 || Object.keys(ctx._activePlayersMaxMoves ?? {}).length > 0
      || ctx._nextActivePlayers != null || (ctx._prevActivePlayers?.length ?? 0) > 0) return 'Direct framework events are disabled for this game.';
    return false;
  } }],
  events: { endGame: false, endPhase: false, endTurn: false, setPhase: false, endStage: false, setStage: false, pass: false, setActivePlayers: false },
  playerView: bakerPlayerView,
  endIf: ({ G }) => G.status === 'finished' ? { winner: G.winner, reason: G.winReason } : undefined,
};
