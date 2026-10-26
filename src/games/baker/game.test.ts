import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { BakerGame, bakerCanAccuse, bakerObserverView, bakerPlayerView, legalBakerActions, type BakerState } from './game';
import { BAKER_DECKS, BAKER_SCENES, type BakerSpecialEffect } from './content';
import { BAKER_ERAS, normalizeBakerOptions, validateBakerOptions, resolveBakerRoleSet, type BakerOptions } from './rules';

function makeClient(n = 6, options: Partial<BakerOptions> = {}, participantIDs?: string[], seed = 'baker-engine') {
  const game = { ...BakerGame, seed }, client = Client({ game, numPlayers: n, playerID: participantIDs?.[0] ?? '0', debug: false });
  const match = createMatch({ game, numPlayers: n, setupData: { startImmediately: true, options: normalizeBakerOptions({ holmesID: participantIDs?.[0] ?? '0', ...options }), participantIDs }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  return client;
}
type TestClient = ReturnType<typeof makeClient>;
const raw = (client: TestClient): BakerState => client.store.getState().G as BakerState;
const seatWith = (G: BakerState, role: string) => Object.keys(G.private).find(id => G.private[id].role === role)!;
const seats = (G: BakerState) => Object.keys(G.players);
function act(client: TestClient, actor: string, move: string, ...args: unknown[]) { client.updatePlayerID(actor); client.moves[move](...args); }
function patch(client: TestClient, update: (G: BakerState) => void) {
  // Match persisted JSON state; a rejected local move can leave transient plugin APIs.
  const state = JSON.parse(JSON.stringify(client.store.getState())) as State<BakerState>; update(state.G);
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function unchanged(client: TestClient, action: () => void) {
  const snapshot = () => ({ G: raw(client), ctx: client.store.getState().ctx, version: client.store.getState()._stateID });
  const before = structuredClone(snapshot()); action(); expect(snapshot()).toEqual(before);
}
function ackAll(client: TestClient) {
  const epoch = raw(client).epoch; for (const id of seats(raw(client))) act(client, id, 'acknowledge', epoch);
}
function chooseCrime(client: TestClient) {
  const G = raw(client), murderer = seatWith(G, 'murderer');
  act(client, murderer, 'chooseCrime', G.players[murderer].means[0].id, G.players[murderer].clues[0].id, G.epoch);
}
function openScene(client: TestClient) {
  act(client, raw(client).holmesID!, 'chooseLocation', BAKER_SCENES.find(tile => tile.kind === 'location')!.id, raw(client).epoch);
}
function investigation(n = 6, options: Partial<BakerOptions> = {}) {
  const client = makeClient(n, options); ackAll(client); chooseCrime(client); openScene(client); return client;
}
function markAll(client: TestClient) {
  for (const id of raw(client).scenes.filter(slot => !slot.marks.length).map(slot => slot.tile.id)) act(client, raw(client).holmesID!, 'markScene', id, 0, raw(client).epoch);
}
function firstMark(client: TestClient) { act(client, raw(client).holmesID!, 'markScene', raw(client).scenes[0].tile.id, 0, raw(client).epoch); }
function speeches(client: TestClient) {
  act(client, raw(client).holmesID!, 'startPresentations', raw(client).epoch);
  while (raw(client).status === 'presentation') act(client, raw(client).speakerID!, 'finishSpeech', raw(client).epoch);
}
function accuseAnswer(client: TestClient) {
  const G = raw(client), solution = G.secret!.solution!, actor = seats(G).find(id => id !== G.holmesID && id !== solution.murdererID)!;
  act(client, actor, 'accuse', solution.murdererID, solution.meansID, solution.clueID, G.epoch); return actor;
}
function forceSpecial(client: TestClient, effect: BakerSpecialEffect, restore = false) {
  patch(client, G => {
    const tile = BAKER_SCENES.find(item => item.effect === effect)!;
    G.secret!.sceneDeck.unshift(structuredClone(tile)); G.secret!.specialChecked = true;
    if (restore) G.players[seats(G).find(id => id !== G.holmesID)!].badge = false;
  });
  markAll(client); speeches(client);
}
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('貝克街年代、配置與開局', () => {
  it.each([4, 5, 6, 7, 8, 9, 10, 11, 12])('%i 人自動配置與公開配牌皆符合席位', n => {
    const G = raw(makeClient(n)), roles = Object.values(G.private).map(info => info.role);
    expect(roles.filter(role => role === 'holmes')).toHaveLength(1); expect(roles.filter(role => role === 'murderer')).toHaveLength(1);
    expect(roles.includes('watson')).toBe(n >= 6); expect(roles.includes('accomplice')).toBe(n >= 6);
    expect(Object.values(G.players).filter(player => player.badge)).toHaveLength(n - 1);
    const cards = Object.values(G.players).flatMap(player => [...player.means, ...player.clues]);
    expect(cards).toHaveLength((n - 1) * 8); expect(new Set(cards.map(card => card.id)).size).toBe(cards.length);
    expect(G.players[G.holmesID!].means).toEqual([]); expect(G.players[G.holmesID!].clues).toEqual([]);
    expect(Object.values(G.players).filter(player => player.revealedRole)).toHaveLength(1);
  });
  it.each(Object.keys(BAKER_ERAS) as BakerOptions['era'][])('%s 年代只使用該年代的完整牌庫，保存公開年份', era => {
    const G = raw(makeClient(12, { era, cardsPerType: 5 }));
    expect(G.options.year).toBe(BAKER_ERAS[era].defaultYear);
    for (const player of Object.values(G.players)) for (const card of [...player.means, ...player.clues]) {
      expect(card.era).toBe(era); expect([...BAKER_DECKS[era].means, ...BAKER_DECKS[era].clues].some(item => item.id === card.id)).toBe(true);
    }
  });
  it.each([3, 4, 5] as const)('每類 %i 張牌與身份配置可以獨立設定', cardsPerType => {
    const G = raw(makeClient(6, { cardsPerType, roleSet: 'basic' }));
    expect(Object.values(G.private).filter(info => info.role === 'investigator')).toHaveLength(4);
    for (const [id, player] of Object.entries(G.players)) expect(player.means.length).toBe(id === G.holmesID ? 0 : cardsPerType);
  });
  it('設定正規化拒絕額外欄位、偽造年份、無效角色與席位', () => {
    for (const options of [null, [], { nope: true }, { era: '__proto__' }, { era: 'modern', year: 2027 }, { year: 1890.5 }, { year: '1890' },
      { year: NaN }, { cardsPerType: 2 }, { roleSet: null }, { specialScenes: 'yes' }, { holmesID: '__proto__' }, { holmesID: '12' }]) expect(() => normalizeBakerOptions(options)).toThrow();
    expect(validateBakerOptions({ roleSet: 'all' }, 5)).toMatch(/至少 6/);
    expect(validateBakerOptions({ roleSet: 'accomplice' }, 4)).toMatch(/至少 6/);
    expect(validateBakerOptions({}, 3)).toMatch(/4～12/); expect(validateBakerOptions({}, 13)).toMatch(/4～12/);
    expect(validateBakerOptions({ holmesID: '10' }, 4, ['0', '3', '5', '11'])).toMatch(/參與名單/);
    expect(resolveBakerRoleSet(normalizeBakerOptions({}), 6)).toBe('all');
    expect(normalizeBakerOptions({ era: 'industrial' }).year).toBe(1800);
  });
  it('非連續席位、指定福爾摩斯與發言順序皆不依賴 0 起算', () => {
    const client = makeClient(4, { holmesID: '8' }, ['1', '3', '8', '11']), G = raw(client);
    expect(G.holmesID).toBe('8'); expect(G.turnOrder).toEqual(['11', '1', '3']);
    ackAll(client); chooseCrime(client); openScene(client); markAll(client);
    act(client, '8', 'startPresentations', raw(client).epoch); expect(raw(client).speakerID).toBe('11');
  });
  it('等待室先保存配置，不把容量當作開局人數，開局重新驗證指定席位', () => {
    const game = { ...BakerGame, seed: 'lobby' };
    const waiting = createMatch({ game, numPlayers: 12, setupData: { options: normalizeBakerOptions({ holmesID: '11', roleSet: 'all' }) }, unlisted: true });
    expect('setupDataError' in waiting).toBe(false);
    if ('initialState' in waiting) expect(waiting.initialState.G.status).toBe('lobby');
    expect(() => makeClient(4, { holmesID: '11' })).toThrow(/參與名單/);
    for (const participantIDs of [['0', '0', '2', '3'], ['0', '1', '2'], ['0', '1', '2', '__proto__']]) {
      const result = createMatch({ game, numPlayers: 4, setupData: { participantIDs }, unlisted: true }); expect('setupDataError' in result).toBe(true);
    }
  });
  it('所有人可用同一版本確認，重複與跨階段舊確認無效', () => {
    const client = makeClient(), epoch = raw(client).epoch;
    act(client, '0', 'acknowledge', epoch); unchanged(client, () => act(client, '0', 'acknowledge', epoch));
    for (const id of seats(raw(client)).slice(1)) act(client, id, 'acknowledge', epoch);
    expect(raw(client).status).toBe('crime'); expect(raw(client).epoch).toBe(epoch + 1);
    unchanged(client, () => act(client, '1', 'acknowledge', epoch));
  });
  it('封鎖直接框架事件與撤銷，全部動作由伺服器裁定並遮蔽參數', () => {
    const client = makeClient();
    for (const [name, args] of [['endGame', [{ winner: 'criminals' }]], ['endTurn', []], ['endPhase', []], ['setPhase', ['crime']], ['setStage', ['hidden']], ['setActivePlayers', [{ all: 'foo' }]]] as const) {
      unchanged(client, () => client.store.dispatch({ type: 'GAME_EVENT', payload: { type: name, args, playerID: '0' } }));
    }
    expect(BakerGame.disableUndo).toBe(true);
    for (const move of Object.values(BakerGame.moves!)) expect(move).toMatchObject({ client: false, redact: true, undoable: false });
  });
});

describe('貝克街秘密情報與唯讀投影', () => {
  it('華生僅看到無序涉案二人，普通警察看不到身份與答案', () => {
    const client = makeClient(), G = raw(client), holmes = G.holmesID!, murderer = seatWith(G, 'murderer'), accomplice = seatWith(G, 'accomplice'), watson = seatWith(G, 'watson'), investigator = seatWith(G, 'investigator');
    expect(G.private[watson].knownCriminals).toEqual([murderer, accomplice].sort((a, b) => Number(a) - Number(b)));
    expect(G.private[watson].knownWitnessID).toBeUndefined(); expect(G.private[watson].solution).toBeNull();
    expect(G.private[investigator].knownCriminals).toEqual([]); expect(G.private[holmes].knownWitnessID).toBe(watson);
    const view = bakerPlayerView({ G, playerID: watson }); expect(Object.keys(view.private)).toEqual([watson]);
    expect(view.players[murderer].revealedRole).toBeUndefined(); expect(view.secret).toBeUndefined();
  });
  it('執行者秘密選牌只更新獲授權者；不同答案對未授權席位產生相同公開結果', () => {
    const first = makeClient(), second = makeClient(); ackAll(first); ackAll(second);
    const murderer = seatWith(raw(first), 'murderer'), watson = seatWith(raw(first), 'watson');
    chooseCrime(first);
    act(second, murderer, 'chooseCrime', raw(second).players[murderer].means[1].id, raw(second).players[murderer].clues[1].id, raw(second).epoch);
    expect(bakerPlayerView({ G: raw(first), playerID: watson })).toEqual(bakerPlayerView({ G: raw(second), playerID: watson }));
    expect(bakerObserverView(raw(first), 'blind')).toEqual(bakerObserverView(raw(second), 'blind'));
    for (const role of ['holmes', 'murderer', 'accomplice']) expect(raw(first).private[seatWith(raw(first), role)].solution).toEqual(raw(first).secret!.solution);
    expect(raw(first).private[watson].solution).toBeNull();
  });
  it('上帝視角不含未來圖板；從上帝快照切回盲視角會再次剝除秘密', () => {
    const client = investigation(), G = raw(client), god = bakerObserverView(G, 'god'), blind = bakerObserverView(god, 'blind');
    expect(Object.keys(god.private)).toHaveLength(6); expect(god.secret).toBeUndefined(); expect(blind.private).toEqual({}); expect(blind.secret).toBeUndefined();
    expect(blind).toEqual(bakerObserverView(G, 'blind'));
    expect(bakerPlayerView({ G, playerID: '__proto__' }).private).toEqual({});
    const own = bakerPlayerView({ G, playerID: '1' }); own.players['1'].means[0].name = 'changed'; expect(G.players['1'].means[0].name).not.toBe('changed');
  });
  it('無法以別人的牌、錯誤類型、偽造席位或舊版本建立答案', () => {
    const client = makeClient(); ackAll(client); const G = raw(client), murderer = seatWith(G, 'murderer'), other = seats(G).find(id => id !== murderer && id !== G.holmesID)!;
    const means = G.players[murderer].means[0].id, clue = G.players[murderer].clues[0].id;
    unchanged(client, () => act(client, other, 'chooseCrime', means, clue, G.epoch));
    unchanged(client, () => act(client, murderer, 'chooseCrime', G.players[other].means[0].id, clue, G.epoch));
    unchanged(client, () => act(client, murderer, 'chooseCrime', clue, means, G.epoch));
    unchanged(client, () => act(client, murderer, 'chooseCrime', means, clue, G.epoch - 1));
    unchanged(client, () => act(client, '__proto__', 'chooseCrime', means, clue, G.epoch));
    chooseCrime(client); unchanged(client, () => act(client, murderer, 'chooseCrime', means, clue, raw(client).epoch));
  });
});

describe('鑑證、輪流發言與破案判定', () => {
  it('只能由福爾摩斯選地點與逐一放置六枚標記；已放標記不能任意更改', () => {
    const client = makeClient(4); ackAll(client); chooseCrime(client); const G = raw(client), location = BAKER_SCENES.find(tile => tile.kind === 'location')!;
    unchanged(client, () => act(client, '1', 'chooseLocation', location.id, G.epoch));
    unchanged(client, () => act(client, '0', 'chooseLocation', BAKER_SCENES.find(tile => tile.kind === 'scene')!.id, G.epoch));
    openScene(client); expect(raw(client).scenes).toHaveLength(6); expect(new Set(raw(client).scenes.map(slot => slot.tile.id)).size).toBe(6);
    unchanged(client, () => act(client, '0', 'startPresentations', raw(client).epoch));
    const slot = raw(client).scenes[0];
    for (const option of [-1, 6, 0.5, null, '0']) unchanged(client, () => act(client, '0', 'markScene', slot.tile.id, option, raw(client).epoch));
    unchanged(client, () => act(client, '1', 'markScene', slot.tile.id, 0, raw(client).epoch));
    firstMark(client); unchanged(client, () => act(client, '0', 'markScene', slot.tile.id, 1, raw(client).epoch));
    markAll(client); expect(raw(client).status).toBe('discussion');
  });
  it('三輪只更換一般圖板，發言順序固定；最後發言結束立即結案', () => {
    const client = investigation(4), initialFixed = structuredClone(raw(client).scenes.slice(0, 2)); markAll(client);
    initialFixed.forEach(slot => slot.marks = [0]);
    for (let round = 1; round <= 3; round++) {
      expect(raw(client).round).toBe(round); expect(raw(client).scenes.slice(0, 2)).toEqual(initialFixed);
      const before = raw(client).scenes.map(slot => slot.tile.id); speeches(client);
      if (round < 3) {
        expect(raw(client).status).toBe('replacement');
        const next = raw(client).nextScene!;
        unchanged(client, () => act(client, '0', 'replaceScene', raw(client).scenes[0].tile.id, 0, raw(client).epoch));
        act(client, '0', 'replaceScene', raw(client).scenes[2].tile.id, 2, raw(client).epoch);
        expect(raw(client).scenes[2]).toMatchObject({ tile: next, marks: [2] });
        expect(raw(client).scenes.filter(slot => !before.includes(slot.tile.id))).toHaveLength(1);
      }
    }
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'criminals', winReason: 'investigation-expired' });
    expect(client.store.getState().ctx.gameover).toEqual({ winner: 'criminals', reason: 'investigation-expired' });
    expect(raw(client).solution).toEqual(raw(client).secret!.solution);
  });
  it('發言只能本人或福爾摩斯結束，失去警徽者仍參與每輪發言', () => {
    const client = investigation(4); markAll(client); act(client, '0', 'startPresentations', raw(client).epoch);
    const speaker = raw(client).speakerID!, other = seats(raw(client)).find(id => id !== '0' && id !== speaker)!;
    unchanged(client, () => act(client, other, 'finishSpeech', raw(client).epoch));
    patch(client, G => { G.players[speaker].badge = false; });
    act(client, speaker, 'finishSpeech', raw(client).epoch); expect(raw(client).speakerID).not.toBe(speaker);
    act(client, '0', 'finishSpeech', raw(client).epoch); expect(raw(client).speakerIndex).toBe(2);
  });
  it('第一枚提示前不可猜；不能猜自己、福爾摩斯或混用兩人牌面', () => {
    const client = investigation(4), G = raw(client), target = seatWith(G, 'murderer'), actor = seats(G).find(id => id !== '0' && id !== target)!, third = seats(G).find(id => id !== '0' && id !== target && id !== actor)!;
    const means = G.players[target].means[0].id, clue = G.players[target].clues[0].id;
    unchanged(client, () => act(client, actor, 'accuse', target, means, clue, raw(client).epoch)); firstMark(client);
    unchanged(client, () => act(client, '0', 'accuse', target, means, clue, raw(client).epoch));
    unchanged(client, () => act(client, actor, 'accuse', actor, G.players[actor].means[0].id, G.players[actor].clues[0].id, raw(client).epoch));
    unchanged(client, () => act(client, actor, 'accuse', target, means, G.players[third].clues[0].id, raw(client).epoch));
    unchanged(client, () => act(client, actor, 'accuse', '__proto__', means, clue, raw(client).epoch));
    unchanged(client, () => act(client, actor, 'accuse', '0', means, clue, raw(client).epoch));
  });
  it('只猜對其中一張仍失去警徽，公開紀錄不透露哪一張正確', () => {
    const client = investigation(4); firstMark(client); const G = raw(client), answer = G.secret!.solution!, actor = seats(G).find(id => id !== '0' && id !== answer.murdererID)!;
    act(client, actor, 'accuse', answer.murdererID, answer.meansID, G.players[answer.murdererID].clues[1].id, G.epoch);
    expect(raw(client).players[actor].badge).toBe(false);
    expect(raw(client).log.at(-1)).toMatchObject({ type: 'accusation', message: '推論不成立。', correct: false });
    expect(Object.keys(raw(client).log.at(-1)!)).not.toContain('correctMeans');
    unchanged(client, () => act(client, actor, 'accuse', answer.murdererID, answer.meansID, answer.clueID, raw(client).epoch));
  });
  it.each(['evidence', 'discussion', 'presentation', 'replacement'] as const)('%s 階段可以正式破案，中斷後不再接受遲到操作', phase => {
    const client = investigation(4); firstMark(client);
    if (phase !== 'evidence') markAll(client);
    if (phase === 'presentation') act(client, '0', 'startPresentations', raw(client).epoch);
    if (phase === 'replacement') speeches(client);
    expect(raw(client).status).toBe(phase); const previousEpoch = raw(client).epoch;
    accuseAnswer(client); expect(raw(client)).toMatchObject({ status: 'finished', winner: 'police', winReason: 'crime-solved' });
    unchanged(client, () => act(client, '0', 'finishSpeech', previousEpoch));
    expect(Object.values(raw(client).players).every(player => player.revealedRole && player.revealedFaction)).toBe(true);
    expect(bakerObserverView(raw(client), 'blind').solution).toEqual(raw(client).secret!.solution);
  });
  it('全部警徽耗盡立即落敗；執行者也能提交一次錯誤推論', () => {
    const client = investigation(4); firstMark(client);
    for (const actor of seats(raw(client)).filter(id => id !== '0')) {
      const G = raw(client), target = seats(G).find(id => id !== '0' && id !== actor)!;
      act(client, actor, 'accuse', target, G.players[target].means[1].id, G.players[target].clues[1].id, G.epoch);
    }
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'criminals', winReason: 'badges-exhausted' });
  });
  it('有內應但無華生時正確推論直接獲勝', () => {
    const client = investigation(6, { roleSet: 'accomplice' }); firstMark(client); accuseAnswer(client);
    expect(raw(client).winner).toBe('police'); expect(raw(client).winReason).toBe('crime-solved');
  });
  it.each([true, false])('華生反轉：指認正確=%s，僅執行者能提交', found => {
    const client = investigation(); firstMark(client); accuseAnswer(client);
    const G = raw(client), murderer = seatWith(G, 'murderer'), accomplice = seatWith(G, 'accomplice'), watson = seatWith(G, 'watson');
    expect(G.status).toBe('witness-hunt'); expect(G.players[murderer].revealedRole).toBe('murderer');
    expect(G.players[watson].revealedRole).toBeUndefined(); expect(G.players[accomplice].revealedRole).toBeUndefined();
    unchanged(client, () => act(client, accomplice, 'identifyWitness', watson, G.epoch));
    unchanged(client, () => act(client, murderer, 'identifyWitness', '0', G.epoch));
    unchanged(client, () => act(client, murderer, 'identifyWitness', '__proto__', G.epoch));
    act(client, murderer, 'identifyWitness', found ? watson : accomplice, G.epoch);
    expect(raw(client)).toMatchObject({ winner: found ? 'criminals' : 'police', winReason: found ? 'witness-found' : 'witness-protected' });
  });
});

describe('十二塊原創特別圖板的六種裁定', () => {
  it.each(['additional-mark', 'replace-scene', 'retrace-mark', 'exclude-means', 'exclude-clue', 'restore-badge'] as BakerSpecialEffect[])('%s 正常執行後仍保留該輪標準換板', effect => {
    const client = investigation(6, { specialScenes: true }); forceSpecial(client, effect, effect === 'restore-badge');
    expect(raw(client).status).toBe('special'); const G = raw(client), legal = legalBakerActions(bakerPlayerView({ G, playerID: '0' }), '0');
    expect(legal.length).toBeGreaterThan(0); expect(legal.every(action => action.move === 'resolveSpecial')).toBe(true);
    const action = legal[0]; act(client, '0', action.move, ...action.args);
    expect(raw(client).status).toBe('replacement'); expect(raw(client).special).toBeNull(); expect(raw(client).nextScene?.kind).toBe('scene');
    act(client, '0', 'replaceScene', raw(client).scenes[2].tile.id, 0, raw(client).epoch);
    expect(raw(client).status).toBe('discussion'); expect(raw(client).round).toBe(2);
    expect(raw(client).secret!.solution).toEqual(G.secret!.solution);
  });
  it('無失去警徽者時恢復事件自動略過，不留下不可解的待處理狀態', () => {
    const client = investigation(6, { specialScenes: true }); forceSpecial(client, 'restore-badge');
    expect(raw(client).status).toBe('replacement'); expect(raw(client).log.some(entry => entry.type === 'special-skip')).toBe(true);
  });
  it.each(['additional-mark', 'retrace-mark', 'replace-scene'] as BakerSpecialEffect[])('%s 不可改動固定死因與地點，也不可由非福爾摩斯操作', effect => {
    const client = investigation(6, { specialScenes: true }); forceSpecial(client, effect);
    for (const slot of raw(client).scenes.slice(0, 2)) unchanged(client, () => act(client, '0', 'resolveSpecial', slot.tile.id, 1, raw(client).epoch));
    unchanged(client, () => act(client, '1', 'resolveSpecial', raw(client).scenes[2].tile.id, 1, raw(client).epoch));
    if (effect !== 'replace-scene') unchanged(client, () => act(client, '0', 'resolveSpecial', raw(client).scenes[2].tile.id, 0, raw(client).epoch));
  });
  it.each(['exclude-means', 'exclude-clue'] as const)('%s 不可排除答案、錯誤牌類或重複牌，排除後不能再提交該卡', effect => {
    const client = investigation(6, { specialScenes: true }); forceSpecial(client, effect);
    const G = raw(client), answer = G.secret!.solution!, targetAnswer = effect === 'exclude-means' ? answer.meansID : answer.clueID;
    unchanged(client, () => act(client, '0', 'resolveSpecial', targetAnswer, null, raw(client).epoch));
    const wrongKind = effect === 'exclude-means' ? G.players['1'].clues[0].id : G.players['1'].means[0].id;
    unchanged(client, () => act(client, '0', 'resolveSpecial', wrongKind, null, raw(client).epoch));
    const action = legalBakerActions(bakerPlayerView({ G, playerID: '0' }), '0')[0], excludedID = action.args[0] as string;
    act(client, '0', action.move, ...action.args); expect(raw(client).excludedCards).toContain(excludedID);
    const target = seats(raw(client)).find(id => [...raw(client).players[id].means, ...raw(client).players[id].clues].some(card => card.id === excludedID))!;
    const actor = seats(raw(client)).find(id => id !== '0' && id !== target)!;
    unchanged(client, () => act(client, actor, 'accuse', target,
      effect === 'exclude-means' ? excludedID : raw(client).players[target].means[0].id,
      effect === 'exclude-clue' ? excludedID : raw(client).players[target].clues[0].id, raw(client).epoch));
  });
  it('恢復警徽只適用已失去者，恢復後可再次正式破案', () => {
    const client = investigation(6, { specialScenes: true }); forceSpecial(client, 'restore-badge', true);
    const G = raw(client), lost = seats(G).find(id => id !== '0' && !G.players[id].badge)!, available = seats(G).find(id => id !== '0' && G.players[id].badge)!;
    unchanged(client, () => act(client, '0', 'resolveSpecial', '0', null, G.epoch));
    unchanged(client, () => act(client, '0', 'resolveSpecial', available, null, G.epoch));
    act(client, '0', 'resolveSpecial', lost, null, G.epoch); expect(bakerCanAccuse(raw(client), lost)).toBe(true);
  });
  it('每輪至多一塊特別圖板，後續仍有正常場景可標記', () => {
    const client = investigation(4, { specialScenes: true });
    patch(client, G => { G.secret!.sceneDeck.unshift(...BAKER_SCENES.filter(tile => tile.kind === 'special').map(tile => structuredClone(tile))); G.secret!.specialChecked = true; });
    markAll(client); speeches(client);
    if (raw(client).status === 'special') { const action = legalBakerActions(bakerPlayerView({ G: raw(client), playerID: '0' }), '0')[0]; act(client, '0', action.move, ...action.args); }
    expect(raw(client).status).toBe('replacement'); expect(raw(client).nextScene!.kind).toBe('scene');
    expect(raw(client).log.filter(entry => entry.type === 'special')).toHaveLength(1);
  });
  it('特別圖板處理中也能破案；結案使原待處理特效失效', () => {
    const client = investigation(4, { specialScenes: true }); forceSpecial(client, 'additional-mark');
    const action = legalBakerActions(bakerPlayerView({ G: raw(client), playerID: '0' }), '0')[0]; accuseAnswer(client);
    expect(raw(client).winner).toBe('police'); unchanged(client, () => act(client, '0', action.move, ...action.args));
  });
});

describe('合法動作與完整對局', () => {
  it.each([4, 5, 6, 7, 8, 9, 10, 11, 12])('%i 人只讀各自獲准視角即可完成全部階段', n => {
    const client = makeClient(n, { specialScenes: true }, undefined, `complete-${n}`);
    for (let step = 0; step < 160 && raw(client).status !== 'finished'; step++) {
      let actionTaken = false;
      for (const id of seats(raw(client))) {
        const view = bakerPlayerView({ G: raw(client), playerID: id });
        const actions = legalBakerActions(view, id).filter(action => action.move !== 'accuse');
        if (!actions.length) continue;
        const action = actions[step % actions.length], before = client.store.getState()._stateID;
        act(client, id, action.move, ...action.args); expect(client.store.getState()._stateID).toBeGreaterThan(before); actionTaken = true; break;
      }
      expect(actionTaken).toBe(true);
    }
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'criminals', round: 3 });
    expect(legalBakerActions(bakerPlayerView({ G: raw(client), playerID: '0' }), '0')).toEqual([]);
  });
  it('未授權觀戰快照無法列舉玩家的秘密操作', () => {
    const client = makeClient(), G = raw(client);
    for (const id of seats(G)) expect(legalBakerActions(bakerObserverView(G, 'blind'), id)).toEqual([]);
    expect(legalBakerActions(bakerObserverView(G, 'god'), '__proto__')).toEqual([]);
  });
});
