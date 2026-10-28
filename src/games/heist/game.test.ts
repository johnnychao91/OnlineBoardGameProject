import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { HeistGame, heistObserverView, heistPlayerView, legalHeistActions, type HeistCard, type HeistChoice, type HeistState } from './game';
import { createHeistBaseDeck, HEIST_ARTIFACTS, HEIST_ARTIFACT_IDS, HEIST_HAZARD_IDS, HEIST_LOOT_VALUES } from './content';
import { normalizeHeistOptions, validateHeistOptions, type HeistOptions } from './rules';

function makeClient(n = 3, participantIDs?: string[], seed = 'curtain-calls', options?: HeistOptions) {
  const game = { ...HeistGame, seed }, client = Client({ game, numPlayers: n, playerID: participantIDs?.[0] ?? '0', debug: false });
  const match = createMatch({ game, numPlayers: n, setupData: { startImmediately: true, participantIDs, options }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true }); return client;
}
type TestClient = ReturnType<typeof makeClient>;
const raw = (client: TestClient) => client.store.getState().G as HeistState;
function act(client: TestClient, id: string, move: string, ...args: unknown[]) { client.updatePlayerID(id); client.moves[move](...args); }
function patch(client: TestClient, update: (G: HeistState) => void) {
  const state = structuredClone(client.store.getState()) as State<HeistState>; update(state.G);
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function ackAll(client: TestClient) { const token = raw(client).phaseEpoch; for (const id of raw(client).turnOrder) act(client, id, 'acknowledge', token); }
function decideAll(client: TestClient, choices: Record<string, HeistChoice> = {}) {
  const G = raw(client), token = G.phaseEpoch, active = G.turnOrder.filter(id => G.players[id].exploring);
  for (const id of active) act(client, id, 'decide', choices[id] ?? 'explore', token);
}
function allExit(client: TestClient) { decideAll(client, Object.fromEntries(raw(client).turnOrder.map(id => [id, 'exit']))); }
const loot = (value: number): HeistCard => ({ kind: 'loot', value });
const hazard = (kind: typeof HEIST_HAZARD_IDS[number]): HeistCard => ({ kind: 'hazard', hazard: kind });
const artifact = (id: typeof HEIST_ARTIFACT_IDS[number]): HeistCard => ({ kind: 'artifact', artifact: id });
/** A controlled, partial room sequence; every tested transition still uses the real Immer reducer. */
function fixture(n: number, cards: HeistCard[], hazardLimit: 2 | 3 = 2) {
  const client = makeClient(n, undefined, 'curtain-calls', { hazardLimit }); ackAll(client);
  patch(client, G => {
    G.status = 'decision'; G.round = 1; G.step = 0; G.path = []; G.leftovers = 0; G.availableArtifacts = [];
    G.removedHazards = Object.fromEntries(HEIST_HAZARD_IDS.map(id => [id, 0])) as HeistState['removedHazards'];
    G.discardedArtifacts = []; G.lastDecision = null; G.roundResult = null; G.log = []; G.epoch++; G.phaseEpoch = G.epoch;
    G.secret = { ...G.secret!, deck: [...cards, hazard('alarm'), hazard('alarm')], recycle: [] }; G.deckCount = G.secret.deck.length;
    for (const id of G.turnOrder) { G.players[id] = { ready: true, acknowledged: false, exploring: true, carried: 0, artifacts: [], submitted: false }; G.private[id] = { banked: 0, choice: null }; }
  });
  decideAll(client); return client;
}
function unchanged(client: TestClient, fn: () => void) {
  const snapshot = () => ({ G: raw(client), ctx: client.store.getState().ctx, stateID: client.store.getState()._stateID });
  const before = structuredClone(snapshot()); fn(); expect(snapshot()).toEqual(before);
}
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('官方基本牌庫、設定與開幕', () => {
  it('15張贓物的精確數值為124，五種危機各三張，沒有擴充', () => {
    expect(HEIST_LOOT_VALUES).toEqual([1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17]);
    expect(HEIST_LOOT_VALUES.reduce((sum, n) => sum + n, 0)).toBe(124);
    const deck = createHeistBaseDeck(); expect(deck).toHaveLength(30);
    expect(deck.filter(card => card.kind === 'loot')).toHaveLength(15);
    for (const id of HEIST_HAZARD_IDS) expect(deck.filter(card => card.kind === 'hazard' && card.hazard === id)).toHaveLength(3);
    expect(deck.some(card => card.kind === 'artifact')).toBe(false);
  });
  it('名品逐幕加入，固定5、7、8、10、12，建立牌庫不共享可變物件', () => {
    expect(HEIST_ARTIFACT_IDS.map(id => HEIST_ARTIFACTS[id].value)).toEqual([5, 7, 8, 10, 12]);
    expect(HEIST_ARTIFACT_IDS.map(id => HEIST_ARTIFACTS[id].round)).toEqual([1, 2, 3, 4, 5]);
    const first = createHeistBaseDeck(); (first[0] as { value: number }).value = 999;
    expect(createHeistBaseDeck()[0]).toEqual(loot(1));
  });
  it('接受第2或第3張危機門檻與3–8人，舊空設定保留第2張，拒絕其他設定', () => {
    for (const input of [undefined, {}, { hazardLimit: 2 }]) expect(normalizeHeistOptions(input)).toEqual({ hazardLimit: 2 });
    expect(normalizeHeistOptions({ hazardLimit: 3 })).toEqual({ hazardLimit: 3 });
    for (const value of [null, [], 'base', { expansion: true }, { rounds: 3 }, ...[0, 1, 4, 2.5, '3', true, null].map(hazardLimit => ({ hazardLimit }))]) expect(validateHeistOptions(value)).toBeTruthy();
    for (const n of [2, 9, 3.5, NaN]) expect(validateHeistOptions({}, n)).toBeTruthy();
    for (const data of [null, [], { startImmediately: 1 }, { participantIDs: ['0', '0', '2'] }, { participantIDs: ['0', '1'] }, { participantIDs: ['0', '1', '__proto__'] }]) {
      const match = createMatch({ game: HeistGame, numPlayers: 3, setupData: data as any, unlisted: true }); expect('setupDataError' in match).toBe(true);
    }
  });
  it.each([3, 4, 5, 6, 7, 8])('%i人開幕確認使用同一個token，首張先翻開才密選', n => {
    const client = makeClient(n), token = raw(client).phaseEpoch;
    expect(raw(client).status).toBe('briefing'); expect(raw(client).round).toBe(0); expect(raw(client).path).toEqual([]);
    for (let i = 0; i < n - 1; i++) { act(client, String(i), 'acknowledge', token); expect(raw(client).phaseEpoch).toBe(token); expect(raw(client).status).toBe('briefing'); }
    act(client, String(n - 1), 'acknowledge', token);
    const G = raw(client); expect(G.round).toBe(1); expect(G.status).toBe('decision'); expect(G.path).toHaveLength(1); expect(G.step).toBe(1); expect(G.deckCount).toBe(30);
    expect([...G.path, ...G.secret!.deck].filter(card => card.kind === 'artifact')).toEqual([artifact('sapphire-eye')]);
    expect(G.phaseEpoch).toBeGreaterThan(token);
  });
  it('支援不連續認證席位與原本順序', () => {
    const client = makeClient(3, ['1', '4', '11']); ackAll(client);
    expect(raw(client).turnOrder).toEqual(['1', '4', '11']); expect(Object.keys(raw(client).private)).toEqual(['1', '4', '11']);
    const token = raw(client).phaseEpoch; for (const id of ['11', '1', '4']) act(client, id, 'decide', 'exit', token);
    expect(raw(client).status).toBe('review');
  });
});

describe('同波密封、揭露與版本界線', () => {
  it('每人同token可亂序同時提交，直到最後一人前都不翻牌或處理撤退', () => {
    const client = fixture(4, [loot(11), loot(7)]), token = raw(client).phaseEpoch, step = raw(client).step, epoch = raw(client).epoch;
    for (const id of ['2', '0', '3']) {
      act(client, id, 'decide', id === '0' ? 'exit' : 'explore', token);
      expect(raw(client).step).toBe(step); expect(raw(client).phaseEpoch).toBe(token); expect(raw(client).players['0'].exploring).toBe(true);
      expect(raw(client).private['0'].banked).toBe(0);
    }
    expect(raw(client).epoch).toBe(epoch + 3); act(client, '1', 'decide', 'explore', token);
    expect(raw(client).step).toBe(step + 1); expect(raw(client).lastDecision?.choices).toEqual({ '0': 'exit', '1': 'explore', '2': 'explore', '3': 'explore' });
    expect(raw(client).private['0'].banked).toBe(5); expect(raw(client).players['0'].exploring).toBe(false);
  });
  it('已密封不能修改，重送、舊批次、非法選擇與陌生席位均不改狀態', () => {
    const client = fixture(3, [loot(9), loot(7)]), old = raw(client).phaseEpoch;
    for (const args of [['go', old], [true, old], ['exit', old - 1], ['exit', String(old)]]) unchanged(client, () => act(client, '0', 'decide', ...args));
    unchanged(client, () => act(client, '9', 'decide', 'exit', old));
    act(client, '0', 'decide', 'exit', old); unchanged(client, () => act(client, '0', 'decide', 'explore', old));
    act(client, '1', 'decide', 'explore', old); act(client, '2', 'decide', 'explore', old);
    unchanged(client, () => act(client, '1', 'decide', 'exit', old));
    unchanged(client, () => act(client, '0', 'decide', 'exit', raw(client).phaseEpoch));
    unchanged(client, () => act(client, '1', 'acknowledge', raw(client).phaseEpoch));
  });
  it('輪末全員確認不會因其他人先確認而作廢，確認前不發下一幕', () => {
    const client = fixture(3, [loot(9)]); allExit(client); const token = raw(client).phaseEpoch;
    act(client, '2', 'acknowledge', token); expect(raw(client).round).toBe(1); expect(raw(client).status).toBe('review');
    unchanged(client, () => act(client, '2', 'acknowledge', token));
    unchanged(client, () => act(client, '0', 'decide', 'exit', token));
    act(client, '0', 'acknowledge', token); act(client, '1', 'acknowledge', token);
    expect(raw(client).round).toBe(2); expect(raw(client).status).toBe('decision'); expect(Object.values(raw(client).players).every(p => p.exploring && !p.submitted && !p.acknowledged)).toBe(true);
    unchanged(client, () => act(client, '0', 'acknowledge', token));
  });
});

describe('贓物、餘額、撤退與名品', () => {
  it('11除4每人2，餘3放通道；只分給仍在場的人', () => {
    const client = fixture(4, [loot(11), loot(11)]);
    expect(Object.values(raw(client).players).map(p => p.carried)).toEqual([2, 2, 2, 2]); expect(raw(client).leftovers).toBe(3);
    decideAll(client, { '0': 'exit' });
    expect(raw(client).private['0'].banked).toBe(5); expect(raw(client).players['0'].carried).toBe(0);
    expect(['1', '2', '3'].map(id => raw(client).players[id].carried)).toEqual([5, 5, 5]); expect(raw(client).leftovers).toBe(2);
  });
  it('把所有房間餘額加總再均分：7除2每人3，餘1留下且不領名品', () => {
    const client = fixture(4, [loot(7), loot(11), loot(1), artifact('sapphire-eye'), hazard('camera')]);
    decideAll(client); decideAll(client); decideAll(client);
    expect(raw(client).leftovers).toBe(7); decideAll(client, { '0': 'exit', '1': 'exit' });
    expect(raw(client).leftovers).toBe(1); expect(raw(client).private['0'].banked).toBe(6); expect(raw(client).private['1'].banked).toBe(6);
    expect(raw(client).players['0'].artifacts).toEqual([]); expect(raw(client).players['1'].artifacts).toEqual([]); expect(raw(client).availableArtifacts).toEqual(['sapphire-eye']);
  });
  it('唯一撤退者帶走全部餘額及所有已揭名品，名品不混進一般保險箱', () => {
    const client = fixture(3, [loot(7), artifact('sapphire-eye'), artifact('moon-watch'), hazard('camera')]);
    decideAll(client); decideAll(client); decideAll(client, { '1': 'exit' });
    const G = raw(client); expect(G.players['1'].artifacts).toEqual(['sapphire-eye', 'moon-watch']); expect(G.private['1'].banked).toBe(3); expect(G.leftovers).toBe(0); expect(G.availableArtifacts).toEqual([]);
    expect(G.lastDecision?.returns[0]).toEqual({ playerID: '1', carried: 2, pathShare: 1, bankedDelta: 3, artifacts: ['sapphire-eye', 'moon-watch'] });
  });
  it('兩人一起撤退不領名品；稍後獨自撤退者可領取', () => {
    const client = fixture(3, [artifact('sapphire-eye'), loot(5)]);
    decideAll(client, { '0': 'exit', '1': 'exit' });
    expect(raw(client).players['2'].carried).toBe(5); expect(raw(client).players['0'].artifacts).toEqual([]);
    act(client, '2', 'decide', 'exit', raw(client).phaseEpoch);
    expect(raw(client).players['2'].artifacts).toEqual(['sapphire-eye']); expect(raw(client).private['2'].banked).toBe(5); expect(raw(client).status).toBe('review');
  });
  it('最後一人仍可選深入，不會被自動撤退；撤退在下一張危機之前完成', () => {
    const client = fixture(3, [loot(9), hazard('camera'), hazard('camera')]);
    decideAll(client, { '0': 'exit', '1': 'exit' });
    expect(raw(client).players['2'].exploring).toBe(true); expect(raw(client).status).toBe('decision');
    expect(legalHeistActions(heistPlayerView({ G: raw(client), playerID: '2' }), '2').map(a => a.args[0])).toEqual(['explore', 'exit']);
    act(client, '2', 'decide', 'exit', raw(client).phaseEpoch);
    expect(raw(client).status).toBe('review'); expect(raw(client).roundResult?.reason).toBe('all-exited'); expect(raw(client).removedHazards.camera).toBe(0);
    expect(raw(client).secret!.deck[0]).toEqual(hazard('camera')); expect(raw(client).private['2'].banked).toBe(3);
  });
  it('所有人撤退只結算一次，未分完的餘額與未領名品離開本局', () => {
    const client = fixture(3, [loot(7), artifact('sapphire-eye'), loot(17)]); decideAll(client); allExit(client);
    const G = raw(client); expect(G.status).toBe('review'); expect(G.step).toBe(2); expect(G.leftovers).toBe(0); expect(G.roundResult?.discardedLeftovers).toBe(1);
    expect(G.discardedArtifacts).toEqual(['sapphire-eye']); expect(G.roundResult?.discardedArtifacts).toEqual(['sapphire-eye']); expect(Object.values(G.private).map(p => p.banked)).toEqual([2, 2, 2]);
    expect(G.secret!.deck[0]).toEqual(loot(17)); expect(G.availableArtifacts).toEqual([]);
  });
});

describe('危機、永久移除、跨幕牌庫', () => {
  it.each(HEIST_HAZARD_IDS)('%s第3張房規讓前兩張警告，第三張才封鎖，只移除一張並保護已入庫財富', kind => {
    const client = fixture(3, [loot(11), hazard(kind), hazard(kind), hazard(kind)], 3);
    patch(client, G => { G.private['0'].banked = 12; });
    decideAll(client, { '0': 'exit' }); decideAll(client);
    const second = raw(client);
    expect(second.status).toBe('decision'); expect(second.path.filter(card => card.kind === 'hazard' && card.hazard === kind)).toHaveLength(2);
    expect(second.removedHazards[kind]).toBe(0); expect(second.secret!.recycle.filter(card => card.kind === 'hazard' && card.hazard === kind)).toHaveLength(2);
    expect(second.players['1'].carried).toBe(3); expect(second.private['0'].banked).toBe(17);
    expect(heistPlayerView({ G: second, playerID: '1' }).options).toEqual({ hazardLimit: 3 });
    expect(heistObserverView(second, 'blind').options).toEqual({ hazardLimit: 3 });
    decideAll(client);
    const third = raw(client);
    expect(third.status).toBe('review'); expect(third.roundResult).toMatchObject({ reason: 'hazard', hazard: kind, escaped: ['0'], lost: { '1': 3, '2': 3 } });
    expect(third.removedHazards[kind]).toBe(1); expect(third.secret!.recycle.filter(card => card.kind === 'hazard' && card.hazard === kind)).toHaveLength(2);
    expect(third.private['0'].banked).toBe(17); expect(third.log.find(entry => entry.type === 'disaster')?.message).toContain('第 3 張');
    ackAll(client); expect(raw(client).options).toEqual({ hazardLimit: 3 }); expect(raw(client).removedHazards[kind]).toBe(1);
  });
  it('舊存檔未記錄門檻時仍在同類第2張封鎖', () => {
    const client = fixture(3, [hazard('camera'), hazard('camera')]);
    patch(client, G => { G.options = {} as HeistOptions; });
    decideAll(client); expect(raw(client).status).toBe('review'); expect(raw(client).removedHazards.camera).toBe(1);
  });
  it.each(HEIST_HAZARD_IDS)('%s第二次出現立即失敗，只永久移除觸發的第二張', kind => {
    const client = fixture(3, [loot(11), hazard(kind), hazard(kind), hazard(kind)]);
    patch(client, G => { G.private['0'].banked = 12; G.players['0'].artifacts = ['moon-watch']; });
    decideAll(client, { '0': 'exit' }); expect(raw(client).status).toBe('decision'); decideAll(client);
    const G = raw(client); expect(G.status).toBe('review'); expect(G.roundResult?.reason).toBe('hazard'); expect(G.roundResult?.hazard).toBe(kind);
    expect(G.roundResult?.lost).toEqual({ '1': 3, '2': 3 }); expect(G.roundResult?.escaped).toEqual(['0']);
    expect(G.players['1'].carried).toBe(0); expect(G.private['0'].banked).toBe(17); expect(G.players['0'].artifacts).toEqual(['moon-watch']);
    expect(G.removedHazards[kind]).toBe(1);
    expect([...G.secret!.deck, ...G.secret!.recycle].filter(c => c.kind === 'hazard' && c.hazard === kind)).toHaveLength(kind === 'alarm' ? 4 : 2);
    expect(G.secret!.recycle.filter(c => c.kind === 'hazard' && c.hazard === kind)).toHaveLength(1);
  });
  it('不同危機只警告，第二張同類才結束；已離場者不受損', () => {
    const client = fixture(3, [hazard('camera'), hazard('laser'), hazard('patrol'), hazard('lockdown'), loot(9), hazard('camera')]);
    for (let i = 0; i < 3; i++) { decideAll(client); expect(raw(client).status).toBe('decision'); }
    decideAll(client); decideAll(client, { '0': 'exit' });
    expect(raw(client).status).toBe('review'); expect(raw(client).private['0'].banked).toBe(3); expect(raw(client).roundResult?.lost).toEqual({ '1': 3, '2': 3 });
  });
  it('第3張房規不合併不同種類的危機，安全撤退不移除危機牌', () => {
    const client = fixture(3, [hazard('camera'), hazard('laser'), hazard('camera'), hazard('laser')], 3);
    for (let i = 0; i < 3; i++) decideAll(client);
    expect(raw(client).status).toBe('decision'); expect(raw(client).removedHazards.camera).toBe(0);
    allExit(client); expect(raw(client).roundResult?.reason).toBe('all-exited');
    expect(raw(client).secret!.recycle.filter(card => card.kind === 'hazard' && card.hazard === 'camera')).toHaveLength(2);
    expect(raw(client).secret!.recycle.filter(card => card.kind === 'hazard' && card.hazard === 'laser')).toHaveLength(2);
  });
  it('危機結束也移除所有已翻未領名品，未翻名品仍在牌庫', () => {
    const client = fixture(3, [artifact('sapphire-eye'), hazard('camera'), hazard('camera'), artifact('moon-watch')]); decideAll(client); decideAll(client);
    expect(raw(client).discardedArtifacts).toEqual(['sapphire-eye']); expect(raw(client).secret!.deck.some(c => c.kind === 'artifact' && c.artifact === 'moon-watch')).toBe(true);
    expect(raw(client).secret!.recycle.some(c => c.kind === 'artifact')).toBe(false);
  });
  it('下一幕洗回未翻牌與可回收的牌，僅加入該幕名品', () => {
    const client = fixture(3, [hazard('camera'), hazard('camera'), loot(17), artifact('sapphire-eye')]); decideAll(client);
    const before = [...raw(client).secret!.deck, ...raw(client).secret!.recycle]; ackAll(client);
    const G = raw(client), after = [...G.path, ...G.secret!.deck];
    const key = (c: HeistCard) => JSON.stringify(c);
    expect(after.map(key).sort()).toEqual([...before, artifact('moon-watch')].map(key).sort());
    expect(G.removedHazards.camera).toBe(1); expect(G.round).toBe(2); expect(G.step).toBe(1);
  });
  it('同一種危機可跨幕由3減到2再減到1，不把已移除的牌放回', () => {
    const client = makeClient(); ackAll(client);
    patch(client, G => { G.path = [hazard('camera')]; G.secret!.recycle = [hazard('camera')]; G.secret!.deck = [hazard('camera'), hazard('camera'), loot(17)]; });
    decideAll(client); expect(raw(client).removedHazards.camera).toBe(1); ackAll(client);
    patch(client, G => { G.path = [hazard('camera')]; G.secret!.recycle = [hazard('camera')]; G.secret!.deck = [hazard('camera'), loot(17)]; });
    decideAll(client); expect(raw(client).removedHazards.camera).toBe(2); ackAll(client);
    expect([...raw(client).path, ...raw(client).secret!.deck].filter(c => c.kind === 'hazard' && c.hazard === 'camera')).toHaveLength(1);
  });
});

describe('私人銀行、未揭選擇、觀戰與合法動作', () => {
  it('他人、盲觀戰及神觀戰在密封不同選擇後投影完全相同', () => {
    const a = fixture(3, [loot(9)]), b = fixture(3, [loot(9)]);
    act(a, '0', 'decide', 'exit', raw(a).phaseEpoch); act(b, '0', 'decide', 'explore', raw(b).phaseEpoch);
    expect(heistPlayerView({ G: raw(a), playerID: '1' })).toEqual(heistPlayerView({ G: raw(b), playerID: '1' }));
    for (const perspective of ['blind', 'god'] as const) expect(heistObserverView(raw(a), perspective)).toEqual(heistObserverView(raw(b), perspective));
    expect(heistPlayerView({ G: raw(a), playerID: '0' }).private['0'].choice).toBe('exit');
    expect(raw(a).log).toEqual(raw(b).log); expect(raw(a).players['0'].submitted).toBe(true);
  });
  it('銀行只送給本人及神觀戰，已領名品與攜帶額仍公開', () => {
    const client = fixture(3, [loot(9)]); patch(client, G => { G.private['0'].banked = 19; G.private['1'].banked = 23; G.players['0'].artifacts = ['sapphire-eye']; });
    const G = raw(client), own = heistPlayerView({ G, playerID: '0' }), other = heistPlayerView({ G, playerID: '1' }), blind = heistObserverView(G, 'blind'), god = heistObserverView(G, 'god');
    expect(Object.keys(own.private)).toEqual(['0']); expect(own.private['0'].banked).toBe(19); expect(Object.keys(other.private)).toEqual(['1']); expect(blind.private).toEqual({});
    expect(god.private['0'].banked).toBe(19); expect(blind.players['0'].artifacts).toEqual(['sapphire-eye']); expect(blind.players['0'].carried).toBe(3); expect(blind.finalScores).toEqual({});
    for (const v of [own, other, blind, god]) expect(v.secret).toBeUndefined();
  });
  it('不同未來牌序對全部玩家和觀戰投影、合法動作完全沒有影響', () => {
    const client = fixture(3, [loot(9), hazard('camera'), loot(17)]), a = structuredClone(raw(client)), b = structuredClone(a); b.secret!.deck.reverse();
    for (const id of a.turnOrder) {
      const av = heistPlayerView({ G: a, playerID: id }), bv = heistPlayerView({ G: b, playerID: id });
      expect(av).toEqual(bv); expect(legalHeistActions(av, id)).toEqual(legalHeistActions(bv, id));
    }
    for (const p of ['blind', 'god'] as const) expect(heistObserverView(a, p)).toEqual(heistObserverView(b, p));
  });
  it('神/盲投影可重複套用，神轉盲清掉所有私人銀行與密選', () => {
    const client = fixture(3, [loot(9)]); patch(client, G => { G.private['0'].banked = 22; }); act(client, '0', 'decide', 'exit', raw(client).phaseEpoch);
    const G = raw(client), god = heistObserverView(G, 'god'), blind = heistObserverView(G, 'blind');
    expect(heistObserverView(god, 'god')).toEqual(god); expect(heistObserverView(god, 'blind')).toEqual(blind); expect(heistObserverView(blind, 'blind')).toEqual(blind);
    expect(heistPlayerView({ G: blind, playerID: '0' }).private).toEqual({});
    expect(god.private['0'].choice).toBeNull(); god.private['0'].banked = 999; god.path.push(loot(999)); expect(G.private['0'].banked).toBe(22); expect(G.path).toHaveLength(1);
  });
  it('合法動作只依公開狀態枚舉；已提交、離場、review已確認與觀眾不能操作', () => {
    const client = fixture(3, [loot(9), loot(7)]), G = raw(client), view = heistPlayerView({ G, playerID: '0' });
    expect(legalHeistActions(view, '0')).toEqual([{ move: 'decide', args: ['explore', G.phaseEpoch] }, { move: 'decide', args: ['exit', G.phaseEpoch] }]);
    expect(legalHeistActions(view, '10')).toEqual([]); act(client, '0', 'decide', 'exit', G.phaseEpoch);
    expect(legalHeistActions(heistPlayerView({ G: raw(client), playerID: '0' }), '0')).toEqual([]);
    act(client, '1', 'decide', 'explore', G.phaseEpoch); act(client, '2', 'decide', 'explore', G.phaseEpoch);
    expect(legalHeistActions(heistPlayerView({ G: raw(client), playerID: '0' }), '0')).toEqual([]); allExit(client);
    expect(legalHeistActions(heistPlayerView({ G: raw(client), playerID: '0' }), '0')[0].move).toBe('acknowledge');
    act(client, '0', 'acknowledge', raw(client).phaseEpoch); expect(legalHeistActions(heistPlayerView({ G: raw(client), playerID: '0' }), '0')).toEqual([]);
  });
});

describe('五幕結束、排名及安全框架', () => {
  it.each(['hazard', 'all-exited'] as const)('第五幕%s仍停在review，全員確認才公開總分及結束', reason => {
    const client = fixture(3, reason === 'hazard' ? [hazard('camera'), hazard('camera')] : [loot(9)]);
    patch(client, G => { G.round = 5; G.private['0'].banked = 10; G.players['0'].artifacts = ['sapphire-eye']; });
    if (reason === 'hazard') decideAll(client); else allExit(client);
    expect(raw(client).status).toBe('review'); expect(raw(client).finalScores).toEqual({}); expect(client.store.getState().ctx.gameover).toBeUndefined();
    const token = raw(client).phaseEpoch; act(client, '0', 'acknowledge', token); act(client, '1', 'acknowledge', token); expect(raw(client).status).toBe('review');
    act(client, '2', 'acknowledge', token); expect(raw(client).status).toBe('finished'); expect(raw(client).round).toBe(5); expect(raw(client).winner).toBe('heist'); expect(raw(client).winnerIDs).toEqual(['0']);
    expect(raw(client).finalScores['0'].total).toBe(reason === 'hazard' ? 15 : 18); expect(client.store.getState().ctx.gameover).toEqual({ winner: 'heist', reason: 'score' });
    expect(heistObserverView(raw(client), 'blind').finalScores).toEqual(raw(client).finalScores);
  });
  it('同分以名品張數多者勝，名品價值本身不代替張數比較', () => {
    const client = fixture(3, [loot(9)]); allExit(client);
    patch(client, G => { G.round = 5; G.private['0'].banked = 8; G.players['0'].artifacts = ['prism-heart']; G.private['1'].banked = 8; G.players['1'].artifacts = ['sapphire-eye', 'moon-watch']; G.private['2'].banked = 19; });
    ackAll(client); expect(raw(client).finalScores['0'].total).toBe(20); expect(raw(client).finalScores['1'].total).toBe(20); expect(raw(client).winnerIDs).toEqual(['1']);
  });
  it('同分同名品張數共享勝利，即使銀行與名品價值的組合不同', () => {
    const client = fixture(3, [loot(9)]); allExit(client);
    patch(client, G => { G.round = 5; G.private['0'].banked = 15; G.players['0'].artifacts = ['sapphire-eye']; G.private['1'].banked = 13; G.players['1'].artifacts = ['moon-watch']; G.private['2'].banked = 19; });
    ackAll(client); expect(raw(client).winnerIDs).toEqual(['0', '1']);
  });
  it('較高總分優先於更多名品，未帶回的攜帶額不得計分', () => {
    const client = fixture(3, [loot(9)]); allExit(client);
    patch(client, G => { G.round = 5; G.private['0'].banked = 21; G.private['1'].banked = 0; G.players['1'].artifacts = ['sapphire-eye', 'moon-watch', 'ruby-mask']; G.private['2'].banked = 0; G.players['2'].carried = 99; });
    ackAll(client); expect(raw(client).winnerIDs).toEqual(['0']); expect(raw(client).finalScores['2'].total).toBe(0);
  });
  it.each([3, 4, 5, 6, 7, 8])('%i人真實牌庫、reducer與legal helper完整玩五幕', n => {
    const client = makeClient(n, undefined, `five-acts-${n}`); let guard = 0, highestRound = 0;
    while (raw(client).status !== 'finished' && guard++ < 1500) {
      const G = raw(client); highestRound = Math.max(highestRound, G.round);
      const id = G.turnOrder.find(id => legalHeistActions(heistPlayerView({ G, playerID: id }), id).length > 0)!; expect(id).toBeDefined();
      const actions = legalHeistActions(heistPlayerView({ G, playerID: id }), id);
      const action = actions.find(a => a.move === 'decide' && a.args[0] === (G.step >= 3 + Number(id) % 3 ? 'exit' : 'explore')) ?? actions[0];
      act(client, id, action.move, ...action.args);
      const updated = raw(client); expect(updated.round).toBeLessThanOrEqual(5); expect(Object.values(updated.private).every(p => p.banked >= 0)).toBe(true);
    }
    expect(raw(client).status).toBe('finished'); expect(highestRound).toBe(5); expect(raw(client).log.filter(e => e.type === 'round-start').map(e => e.artifact)).toEqual(HEIST_ARTIFACT_IDS);
    expect(raw(client).log.filter(e => e.type === 'round-end')).toHaveLength(5); expect(raw(client).winnerIDs.length).toBeGreaterThan(0);
    for (const id of raw(client).turnOrder) expect(legalHeistActions(heistPlayerView({ G: raw(client), playerID: id }), id)).toEqual([]);
  });
  it.each([3, 8])('%i人第3張房規持續深入，五幕都能結束且不會耗盡牌庫', n => {
    const client = makeClient(n, undefined, `third-warning-${n}`, { hazardLimit: 3 });
    let guard = 0;
    while (raw(client).status !== 'finished' && guard++ < 200) {
      if (raw(client).status === 'decision') decideAll(client); else ackAll(client);
    }
    const G = raw(client);
    expect(G.status).toBe('finished'); expect(G.round).toBe(5);
    expect(G.log.filter(entry => entry.type === 'disaster')).toHaveLength(5);
    expect(Object.values(G.removedHazards)).toEqual([1, 1, 1, 1, 1]);
    expect([...G.secret!.deck, ...G.secret!.recycle].filter(card => card.kind === 'hazard')).toHaveLength(10);
    expect([...G.secret!.deck, ...G.secret!.recycle].filter(card => card.kind === 'loot')).toHaveLength(15);
  });
  it('所有動作只由伺服器執行、禁止復原、遮蔽metadata且關閉所有框架事件', () => {
    expect(HeistGame.disableUndo).toBe(true);
    for (const move of Object.values(HeistGame.moves!)) expect(move).toMatchObject({ client: false, undoable: false, redact: true, ignoreStaleStateID: true });
    expect(Object.values(HeistGame.events!)).toEqual(Array(8).fill(false));
    const client = fixture(3, [loot(9)]);
    for (const [type, args] of [['endGame', [{ winner: 'heist', reason: 'score' }]], ['endTurn', []], ['setActivePlayers', [{ all: 'injected' }]], ['setPhase', ['evil']], ['setStage', ['evil']]] as [string, unknown[]][]) {
      // Upstream mutates its diagnostic stage move counter before a rejected local setStage event.
      // The server transport rejects GAME_EVENT packets; verify all actual game/flow state stays fixed.
      const snapshot = () => ({ G: raw(client), ctx: { ...client.store.getState().ctx, _activePlayersNumMoves: undefined }, stateID: client.store.getState()._stateID });
      const before = structuredClone(snapshot()); client.store.dispatch({ type: 'GAME_EVENT', payload: { type, args, playerID: '0' } }); expect(snapshot()).toEqual(before);
    }
    unchanged(client, () => client.store.dispatch({ type: 'UNDO', payload: { playerID: '0', type: 'undo', args: [] } }));
  });
  it('等待室支援準備與房主開局，非房主不能開始', () => {
    const client = Client({ game: HeistGame, numPlayers: 3, playerID: '0', debug: false });
    expect(raw(client).status).toBe('lobby'); for (const id of ['0', '1', '2']) act(client, id, 'setReady', true);
    unchanged(client, () => act(client, '1', 'startGame')); act(client, '0', 'startGame'); expect(raw(client).status).toBe('briefing');
    unchanged(client, () => act(client, '0', 'setReady', false));
  });
});
