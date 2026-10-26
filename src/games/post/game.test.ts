import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { legalMailActions, MailGame, mailObserverView, mailPlayableCards, mailPlayerView, type MailCard, type MailRole, type MailState } from './game';
import { MAIL_CARDS, mailWinningScore, normalizeMailOptions, resolveMailMode, validateMailOptions, type MailOptions } from './rules';

function makeClient(n = 3, options: Partial<MailOptions> = {}, participantIDs?: string[], seed = 'post-test') {
  const game = { ...MailGame, seed }, client = Client({ game, numPlayers: n, playerID: participantIDs?.[0] ?? '0', debug: false });
  const match = createMatch({ game, numPlayers: n, setupData: { startImmediately: true, options: normalizeMailOptions(options), participantIDs }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  return client;
}
type TestClient = ReturnType<typeof makeClient>;
const raw = (client: TestClient): MailState => client.store.getState().G as MailState;
function act(client: TestClient, id: string, move: string, ...args: unknown[]) { client.updatePlayerID(id); client.moves[move](...args); }
function patch(client: TestClient, update: (G: MailState) => void) {
  const state = structuredClone(client.store.getState()) as State<MailState>; update(state.G);
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function ackAll(client: TestClient) { const epoch = raw(client).epoch; for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge', epoch); }
let serial = 0;
const card = (role: MailRole): MailCard => ({ id: `fixture-${++serial}`, role });
function fixture(hands: MailRole[][], mode: MailOptions['mode'] = 'classic') {
  const client = makeClient(hands.length, { mode, ...(mode === 'black-letter' ? { directorID: '0' } : {}) });
  patch(client, G => {
    G.status = 'playing'; G.activePlayer = '0'; G.turnIndex = 0; G.pending = null;
    G.turnOrder = hands.map((_, i) => String(i)); if (mode === 'black-letter' && hands.length === 2) G.turnOrder.push('1');
    G.secret!.deck = Array.from({ length: 8 }, () => card(mode === 'black-letter' ? 'courier-4' : 'priest'));
    G.secret!.reserve = card('handmaid'); G.secret!.effect = null;
    G.secret!.directorDeck = Array.from({ length: 6 }, () => card('director-4'));
    for (const [i, roles] of hands.entries()) { G.private[String(i)].cards = roles.map(card); G.players[String(i)].cardCount = roles.length; }
    G.deckCount = G.secret!.deck.length; G.directorDeckCount = G.secret!.directorDeck.length;
  });
  return client;
}
function play(client: TestClient, role: MailRole, actor = '0') {
  act(client, actor, 'playCard', raw(client).private[actor].cards.find(item => item.role === role)!.id, raw(client).epoch);
}
function choose(client: TestClient, choices: string[], actor = raw(client).pending!.actorID) { act(client, actor, 'choose', choices, raw(client).epoch); }
function endDirector(client: TestClient) {
  expect(raw(client).pending!.kind).toBe('director-end'); choose(client, ['continue']);
}
function unchanged(client: TestClient, action: () => void) {
  const snapshot = () => ({ G: raw(client), ctx: client.store.getState().ctx, version: client.store.getState()._stateID });
  const before = structuredClone(snapshot()); action(); expect(snapshot()).toEqual(before);
}
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('午夜郵局設定、配牌與協定', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('%i 人 auto 保存具體玩法與正確牌數', n => {
    const client = makeClient(n), G = raw(client), mode = n === 2 ? 'black-letter' : n <= 4 ? 'classic' : 'premium';
    expect(G.mode).toBe(mode); expect(G.options.mode).toBe('auto'); expect(G.status).toBe('briefing');
    expect(Object.keys(G.private)).toHaveLength(n);
    const all = [...Object.values(G.private).flatMap(info => info.cards), ...G.secret!.deck, ...G.secret!.directorDeck, ...(G.secret!.reserve ? [G.secret!.reserve] : [])];
    expect(all).toHaveLength(mode === 'black-letter' ? 29 : mode === 'classic' ? 16 : 32);
    expect(new Set(all.map(item => item.id)).size).toBe(all.length);
    if (mode !== 'black-letter') expect(all.filter(item => item.role === 'guard')).toHaveLength(mode === 'classic' ? 5 : 8);
  });
  it('strictly validates option shapes, explicit player limits, selected director and non-contiguous seats', () => {
    for (const options of [null, [], { extra: true }, { mode: '__proto__' }, { mode: 3 }, { mode: null }, { directorID: null }, { directorID: 'secret' }]) expect(() => normalizeMailOptions(options)).toThrow();
    for (const [mode, n] of [['classic', 2], ['classic', 5], ['premium', 4], ['premium', 9], ['black-letter', 7]] as const) expect(validateMailOptions({ mode }, n)).toBeTruthy();
    expect(validateMailOptions({ mode: 'black-letter', directorID: '11' }, 3, ['1', '5', '9'])).toMatch(/參與名單/);
    expect(() => makeClient(3, { mode: 'black-letter', directorID: '11' }, ['1', '5', '9'])).toThrow(/參與名單/);
    const client = makeClient(3, { mode: 'black-letter', directorID: '11' }, ['1', '5', '11']);
    expect(raw(client).directorID).toBe('11'); expect(Object.keys(raw(client).players)).toEqual(['1', '5', '11']);
    expect(resolveMailMode(normalizeMailOptions({ mode: 'premium' }), 8)).toBe('premium');
    expect(mailWinningScore(3)).toBe(5); expect(mailWinningScore(4)).toBe(4); expect(mailWinningScore(8)).toBe(4);
  });
  it('requires every participant at briefing and rejects duplicate, stale and unauthorized actions', () => {
    const client = makeClient(), initial = structuredClone(raw(client)), epoch = raw(client).epoch;
    act(client, '0', 'acknowledge', epoch); unchanged(client, () => act(client, '0', 'acknowledge', epoch));
    expect(raw(client).status).toBe('briefing');
    act(client, '1', 'acknowledge', epoch); act(client, '2', 'acknowledge', epoch);
    expect(raw(client).status).toBe('playing'); expect(raw(client).private['0'].cards).toHaveLength(2);
    expect(raw(client).epoch).toBe(epoch + 1);
    unchanged(client, () => act(client, '0', 'playCard', raw(client).private['0'].cards[0].id, epoch));
    unchanged(client, () => act(client, '1', 'playCard', raw(client).private['1'].cards[0].id, raw(client).epoch));
    unchanged(client, () => act(client, '0', 'playCard', 'invented', raw(client).epoch));
    unchanged(client, () => act(client, '11', 'acknowledge', raw(client).epoch));
    expect(initial.secret!.deck).not.toHaveLength(raw(client).secret!.deck.length);
  });
  it('disables direct framework events, undo and client-side secrets', () => {
    const client = makeClient(); ackAll(client);
    for (const [name, args] of [['endGame', [{ winner: 'director' }]], ['endPhase', []], ['endTurn', []],
      ['setPhase', ['invented']], ['setStage', ['invented']], ['setActivePlayers', [{ all: 'invented' }]]] as const) {
      const before = structuredClone(raw(client)), beforeVersion = client.store.getState()._stateID;
      client.store.dispatch({ type: 'GAME_EVENT', payload: { type: name, args, playerID: '0' } });
      expect(raw(client)).toEqual(before); expect(client.store.getState()._stateID).toBe(beforeVersion);
      const ctx = client.store.getState().ctx;
      expect(ctx.gameover).toBeUndefined(); expect(ctx.turn).toBe(1); expect(ctx.currentPlayer).toBe('0'); expect(ctx.phase).toBeNull();
      expect(ctx.activePlayers).toEqual({ '0': null, '1': null, '2': null });
    }
    expect(MailGame.disableUndo).toBe(true);
    for (const move of Object.values(MailGame.moves!)) expect(typeof move === 'function' ? null : move.client).toBe(false);
  });
  it.each(['classic', 'premium', 'black-letter'] as const)('等待室可先選%s，不以容量8誤當實際開局人數', mode => {
    const match = createMatch({ game: MailGame, numPlayers: 8, setupData: { options: normalizeMailOptions({ mode, directorID: '11' }) }, unlisted: true });
    expect('setupDataError' in match).toBe(false);
    if ('initialState' in match) expect(match.initialState.G.status).toBe('lobby');
  });
});

describe('密函投遞與全城夜遞逐張裁定', () => {
  it.each(['prince', 'king'] as const)('緘默夫人與 %s 同持時必出，不能偽造打牌', role => {
    const client = fixture([['countess', role], ['priest'], ['princess']]);
    expect(mailPlayableCards(raw(client), '0').map(item => item.role)).toEqual(['countess']);
    unchanged(client, () => play(client, role)); play(client, 'countess');
    expect(raw(client).private['0'].cards[0].role).toBe(role); expect(raw(client).activePlayer).toBe('1');
  });
  it('零號收件人主動棄置立即退出，且公開手牌不觸發其他牌', () => {
    const client = fixture([['princess', 'constable'], ['priest'], ['king'], ['guard'], ['guard']], 'premium'); play(client, 'princess');
    expect(raw(client).players['0'].eliminated).toBe(true); expect(raw(client).players['0'].score).toBe(0);
    expect(raw(client).players['0'].discards.map(item => item.role)).toEqual(['princess', 'constable']);
  });
  it('巡街郵差只能猜非1，命中另一種同數字角色仍淘汰', () => {
    const client = fixture([['guard', 'king'], ['sycophant'], ['priest'], ['priest'], ['priest']], 'premium'); play(client, 'guard'); choose(client, ['1']);
    expect(raw(client).pending!.choices!.map(item => item.id)).not.toContain('1');
    unchanged(client, () => choose(client, ['1'])); choose(client, ['4']);
    expect(raw(client).players['1'].eliminated).toBe(true);
  });
  it('讀信師只給本人查驗紀錄，回合後換牌不會更新舊情報', () => {
    const client = fixture([['priest', 'king'], ['princess'], ['guard']]); play(client, 'priest'); choose(client, ['1']);
    const G = raw(client), cardID = G.private['1'].cards[0].id;
    expect(mailPlayerView({ G, playerID: '0' }).private['0'].intel[0].card!.id).toBe(cardID);
    expect(mailPlayerView({ G, playerID: '2' }).private['2'].intel).toEqual([]);
    expect(mailObserverView(G, 'blind').private).toEqual({});
    patch(client, state => { state.private['1'].cards = [card('baron')]; });
    expect(raw(client).private['0'].intel[0].card!.role).toBe('princess');
    expect(JSON.stringify(raw(client).log)).not.toContain(cardID);
  });
  it.each([['baron', 'priest', 'king', '0'], ['dowager', 'king', 'priest', '0'], ['baron', 'king', 'priest', '1'], ['dowager', 'priest', 'king', '1']] as const)('%s 的比較方向正確', (role, own, other, lost) => {
    const client = fixture([[role, own], [other], ['guard'], ['guard'], ['guard']], 'premium'); play(client, role); choose(client, ['1']);
    expect(raw(client).players[lost].eliminated).toBe(true);
    expect(raw(client).private['0'].intel[0].card!.role).toBe(other);
    expect(raw(client).private['1'].intel[0].card!.role).toBe(own);
  });
  it('同值比牌不淘汰，守燈保護只在本人下次回合開始消退', () => {
    const client = fixture([['baron', 'priest'], ['priest'], ['guard']]); play(client, 'baron'); choose(client, ['1']);
    expect(Object.values(raw(client).players).some(player => player.eliminated)).toBe(false);
    const protectedClient = fixture([['priest', 'king'], ['guard'], ['princess']]);
    patch(protectedClient, G => { G.players['1'].protected = true; }); play(protectedClient, 'priest');
    expect(raw(protectedClient).pending!.choices!.map(choice => choice.id)).toEqual(['2']);
    unchanged(protectedClient, () => choose(protectedClient, ['1'])); choose(protectedClient, ['2']);
    expect(raw(protectedClient).activePlayer).toBe('1'); expect(raw(protectedClient).players['1'].protected).toBe(false);
  });
  it('全員受保護時無合法他人效果落空；轉遞專員仍須選自己', () => {
    const client = fixture([['priest', 'king'], ['guard'], ['princess']]);
    patch(client, G => { G.players['1'].protected = G.players['2'].protected = true; }); play(client, 'priest');
    expect(raw(client).activePlayer).toBe('1'); expect(raw(client).pending).toBeNull();
    const prince = fixture([['prince', 'king'], ['guard'], ['princess']]);
    patch(prince, G => { G.players['1'].protected = G.players['2'].protected = true; }); play(prince, 'prince');
    expect(raw(prince).pending!.choices!.map(choice => choice.id)).toEqual(['0']); choose(prince, ['0']);
    expect(raw(prince).private['0'].cards[0].role).toBe('priest');
  });
  it('轉遞專員棄零號收件人不補牌，末張正常密函用完可抽備用牌', () => {
    const client = fixture([['prince', 'king'], ['princess'], ['guard']]); play(client, 'prince'); choose(client, ['1']);
    expect(raw(client).players['1'].eliminated).toBe(true); expect(raw(client).private['1'].cards).toEqual([]);
    const reserve = fixture([['prince', 'king'], ['baron'], ['guard']]);
    patch(reserve, G => { G.secret!.deck = []; }); play(reserve, 'prince'); choose(reserve, ['1']);
    expect(raw(reserve).private['1'].cards[0].role).toBe('handmaid'); expect(raw(reserve).secret!.reserve).toBeNull();
    expect(raw(reserve).status).toBe('round-review');
  });
  it('換袋總管只交換兩人手牌，不公開額外牌面', () => {
    const client = fixture([['king', 'baron'], ['princess'], ['guard']]); play(client, 'king'); choose(client, ['1']);
    expect(raw(client).private['0'].cards[0].role).toBe('princess'); expect(raw(client).private['1'].cards.some(item => item.role === 'baron')).toBe(true);
    expect(mailObserverView(raw(client), 'blind').private).toEqual({});
  });
  it.each(['0', '8'])('斷郵客反制任何郵差指認（猜%s），公開後換牌', guess => {
    const client = fixture([['guard', 'king'], ['assassin'], ['guard'], ['guard'], ['guard']], 'premium'); play(client, 'guard'); choose(client, ['1']); choose(client, [guess]);
    expect(raw(client).players['0'].eliminated).toBe(true); expect(raw(client).players['1'].eliminated).toBe(false);
    expect(raw(client).players['1'].discards[0].role).toBe('assassin'); expect(raw(client).private['1'].cards.some(item => item.role === 'assassin')).toBe(false);
  });
  it('紅印主事必須選兩人，可含自己，交換後選擇一張私看', () => {
    const client = fixture([['cardinal', 'king'], ['princess'], ['guard'], ['guard'], ['guard']], 'premium'); play(client, 'cardinal');
    unchanged(client, () => choose(client, ['1'])); unchanged(client, () => choose(client, ['1', '1'])); choose(client, ['0', '1']);
    expect(raw(client).private['0'].cards[0].role).toBe('princess');
    expect(raw(client).pending!.kind).toBe('cardinal-look'); choose(client, ['1']);
    expect(raw(client).private['0'].intel[0].card!.role).toBe('king');
  });
  it('紅印主事不足兩個合法對象時落空，雙窗窺信人可看一或兩人', () => {
    const client = fixture([['cardinal', 'king'], ['princess'], ['guard'], ['guard'], ['guard']], 'premium');
    patch(client, G => { for (const id of ['1', '2', '3', '4']) G.players[id].protected = true; }); play(client, 'cardinal');
    expect(raw(client).pending).toBeNull();
    const look = fixture([['baroness', 'king'], ['princess'], ['guard'], ['guard'], ['guard']], 'premium'); play(look, 'baroness'); choose(look, ['1', '2']);
    expect(raw(look).private['0'].intel.map(info => info.playerID)).toEqual(['1', '2']);
  });
  it('引路掮客下一張多目標牌必含指定者，無目標牌仍消耗限制', () => {
    const client = fixture([['cardinal', 'king'], ['princess'], ['guard'], ['guard'], ['guard']], 'premium');
    patch(client, G => { G.forcedTarget = '2'; }); play(client, 'cardinal');
    expect(raw(client).pending!.requiredIDs).toEqual(['2']);
    unchanged(client, () => choose(client, ['0', '1']));
    const view = mailPlayerView({ G: raw(client), playerID: '0' });
    expect(legalMailActions(view, '0').every(action => (action.args[0] as string[]).includes('2'))).toBe(true);
    choose(client, ['0', '2']); choose(client, ['skip']);
    const noTarget = fixture([['count', 'king'], ['princess'], ['guard'], ['guard'], ['guard']], 'premium');
    patch(noTarget, G => { G.forcedTarget = '2'; }); play(noTarget, 'count'); expect(raw(noTarget).forcedTarget).toBeNull();
  });
  it('終宵大主事猜中加分後由目標決定換牌，棄零號收件人仍淘汰', () => {
    const client = fixture([['bishop', 'king'], ['princess'], ['guard'], ['guard'], ['guard']], 'premium'); play(client, 'bishop'); choose(client, ['1']); choose(client, ['8']);
    expect(raw(client).players['0'].score).toBe(1); expect(raw(client).pending!.actorID).toBe('1');
    unchanged(client, () => choose(client, ['redraw'], '0')); choose(client, ['redraw']);
    expect(raw(client).players['1'].eliminated).toBe(true); expect(raw(client).private['1'].cards).toEqual([]);
  });
  it('終宵大主事取得第四郵戳立即勝利，無須等待目標換牌', () => {
    const client = fixture([['bishop', 'king'], ['guard'], ['guard'], ['guard'], ['guard']], 'premium'); patch(client, G => { G.players['0'].score = 3; });
    play(client, 'bishop'); choose(client, ['1']); choose(client, ['1']); expect(raw(client).status).toBe('finished'); expect(raw(client).winnerIDs).toEqual(['0']);
  });
  it('已打出的督察淘汰時加分；只手持督察被淘汰不加分', () => {
    const client = fixture([['guard', 'king'], ['priest'], ['guard'], ['guard'], ['guard']], 'premium');
    patch(client, G => { G.players['1'].discards = [card('constable')]; }); play(client, 'guard'); choose(client, ['1']); choose(client, ['2']);
    expect(raw(client).players['1'].score).toBe(1);
    const held = fixture([['guard', 'king'], ['constable'], ['guard'], ['guard'], ['guard']], 'premium'); play(held, 'guard'); choose(held, ['1']); choose(held, ['6']);
    expect(raw(held).players['1'].score).toBe(0);
  });
  it('督察取得決勝郵戳時立刻結束，不再完成斷郵客的後續補牌', () => {
    const client = fixture([['guard', 'king'], ['assassin'], ['guard'], ['guard'], ['guard']], 'premium');
    patch(client, G => { G.players['0'].score = 3; G.players['0'].discards = [card('constable')]; });
    play(client, 'guard'); choose(client, ['1']); const beforeDeck = raw(client).secret!.deck.length; choose(client, ['0']);
    expect(raw(client).status).toBe('finished'); expect(raw(client).winnerIDs).toEqual(['0']);
    expect(raw(client).secret!.deck).toHaveLength(beforeDeck); expect(raw(client).private['1'].cards[0].role).toBe('assassin');
  });
  it('輪末伯爵加成、9對8網站判定、棄牌總和與並列均完整裁定', () => {
    const finishHands = (hands: MailRole[][], update?: (G: MailState) => void) => {
      const client = fixture(hands, 'premium'); patch(client, G => { G.secret!.deck = []; update?.(G); }); play(client, hands[0][0]); return raw(client);
    };
    const princess = finishHands([['count', 'bishop'], ['princess'], ['king'], ['guard'], ['guard']]); expect(princess.roundResult!.winnerIDs).toEqual(['1']);
    const bishop = finishHands([['count', 'countess'], ['bishop'], ['king'], ['guard'], ['guard']]); expect(bishop.roundResult!.winnerIDs).toEqual(['1']);
    const boosted = finishHands([['count', 'countess'], ['princess'], ['king'], ['guard'], ['guard']], G => { G.players['0'].discards = [card('count')]; }); expect(boosted.roundResult!.winnerIDs).toEqual(['0']);
    const tie = finishHands([['assassin', 'king'], ['king'], ['guard'], ['guard'], ['guard']]); expect(tie.roundResult!.winnerIDs).toEqual(['0', '1']);
  });
  it('淘汰的小丑預測仍給郵戳，同時達四分只讓並列者參與決勝輪', () => {
    const client = fixture([['guard', 'king'], ['priest'], ['guard'], ['guard'], ['guard']], 'premium');
    patch(client, G => {
      G.players['0'].score = G.players['1'].score = 3; G.players['1'].discards = [card('constable')];
      for (const id of ['2', '3', '4']) G.players[id].eliminated = true;
      G.predictions = { '2': '0' };
    });
    play(client, 'guard'); choose(client, ['1']); choose(client, ['2']);
    expect(raw(client).status).toBe('round-review'); expect(raw(client).players['2'].score).toBe(1);
    expect(raw(client).contenderIDs).toEqual(['0', '1']); ackAll(client);
    expect(raw(client).status).toBe('briefing'); expect(raw(client).turnOrder).toEqual(['0', '1']);
    expect(raw(client).players['2'].eliminated).toBe(true); expect(raw(client).private['2'].cards).toEqual([]);
  });
});

describe('黑函局長完整對抗規則', () => {
  it.each([[2, 4], [3, 4], [4, 5], [5, 6], [6, 7]])('%i 人局長生命%i，信使共享6點，局長保留兩張', (n, life) => {
    const client = makeClient(n, { mode: 'black-letter', directorID: '0' }), G = raw(client);
    expect(G.directorLife).toBe(life); expect(G.courierLife).toBe(6); expect(G.private['0'].cards).toHaveLength(2);
    ackAll(client); expect(raw(client).private['0'].cards).toHaveLength(3);
    expect(raw(client).turnOrder).toEqual(n === 2 ? ['0', '1', '1'] : Array.from({ length: n }, (_, i) => String(i)));
  });
  it('雙人信使連續兩回合，局長本體不能主動打出', () => {
    const client = fixture([['director', 'director-4', 'director-4'], ['courier-4']], 'black-letter');
    unchanged(client, () => play(client, 'director')); play(client, 'director-4'); endDirector(client); expect(raw(client).activePlayer).toBe('1');
    play(client, 'courier-4', '1'); choose(client, ['1']); expect(raw(client).activePlayer).toBe('1');
    play(client, 'courier-4', '1'); choose(client, ['1']); expect(raw(client).activePlayer).toBe('0');
  });
  it('信使指認局長重複數字，由局長秘密選被擊退者，補牌先於封印回洗', () => {
    const client = fixture([['director-1', 'seal-1'], ['courier-1', 'courier-4']], 'black-letter');
    patch(client, G => { G.activePlayer = '1'; G.turnIndex = 1; G.secret!.directorDeck = [card('director-5')]; });
    play(client, 'courier-1', '1'); choose(client, ['1']); expect(raw(client).pending!.actorID).toBe('0');
    const beforeView = mailPlayerView({ G: raw(client), playerID: '1' }); expect(beforeView.pending!.choices).toBeUndefined();
    const sealCard = raw(client).pending!.choices!.find(choice => choice.label.includes('覘心'))!.id; choose(client, [sealCard]);
    expect(raw(client).directorLife).toBe(3); expect(raw(client).private['0'].cards.some(item => item.role === 'director-5')).toBe(true);
    expect(raw(client).secret!.directorDeck.some(item => item.role === 'seal-1')).toBe(true);
    expect(raw(client).players['0'].discards.some(item => item.role === 'seal-1')).toBe(false);
  });
  it('讀信師把局長隨機一張只交給指定同伴，雙人由自己看', () => {
    const client = fixture([['director', 'director-4'], ['courier-2', 'courier-4'], ['courier-3']], 'black-letter');
    patch(client, G => { G.activePlayer = '1'; G.turnIndex = 1; }); play(client, 'courier-2', '1');
    expect(raw(client).pending!.choices!.map(choice => choice.id)).toEqual(['2']); choose(client, ['2']);
    expect(raw(client).private['1'].intel).toEqual([]); expect(raw(client).private['2'].intel).toHaveLength(1);
    const two = fixture([['director', 'director-4'], ['courier-2', 'courier-4']], 'black-letter'); patch(two, G => { G.activePlayer = '1'; G.turnIndex = 1; });
    play(two, 'courier-2', '1'); expect(raw(two).private['1'].intel).toHaveLength(1);
  });
  it('對決強制各消一枚力量+2，同分雙方保牌且不公開', () => {
    const client = fixture([['director-3', 'director-2', 'director'], ['courier-4']], 'black-letter');
    patch(client, G => { G.players['0'].power = 2; G.players['1'].power = 1; }); play(client, 'director-3'); choose(client, ['1']);
    choose(client, [raw(client).private['0'].cards.find(item => item.role === 'director-2')!.id]);
    expect(raw(client).players['0'].power).toBe(1); expect(raw(client).players['1'].power).toBe(0);
    expect(raw(client).directorLife).toBe(3); expect(raw(client).courierLife).toBe(6);
    expect(raw(client).private['1'].intel[0].card!.role).toBe('director-2');
    const tie = fixture([['director-3', 'director-4', 'director'], ['courier-4']], 'black-letter');
    play(tie, 'director-3'); choose(tie, ['1']); choose(tie, [raw(tie).private['0'].cards.find(item => item.role === 'director-4')!.id]);
    expect(raw(tie).directorLife).toBe(4); expect(raw(tie).courierLife).toBe(6);
  });
  it.each([['director-2', 'courier-3', true], ['director-2', 'courier-4', false], ['seal-2', 'courier-3', true], ['seal-2', 'courier-2', false]] as const)('%s 的3點門檻對 %s 正確', (role, targetRole, hit) => {
    const client = fixture([[role, 'director-4', 'director'], [targetRole]], 'black-letter'); play(client, role); choose(client, ['1']); expect(raw(client).courierLife).toBe(hit ? 5 : 6);
  });
  it('覘心封印按原手牌同時命中多人，每人只擊退一次', () => {
    const client = fixture([['seal-1', 'director-4', 'director'], ['courier-4'], ['courier-4']], 'black-letter'); play(client, 'seal-1'); choose(client, ['4']);
    expect(raw(client).courierLife).toBe(4); expect(raw(client).log.filter(entry => entry.type === 'defeat')).toHaveLength(2);
  });
  it('局長不在首席時，覘心封印仍按局長後的實際出手順序補牌', () => {
    const client = fixture([['courier-4'], ['courier-4'], ['seal-1', 'director', 'director-4'], ['courier-4']], 'black-letter');
    patch(client, G => {
      G.directorID = '2'; G.activePlayer = '2'; G.turnOrder = ['2', '3', '0', '1']; G.turnIndex = 0;
      G.secret!.deck = [card('courier-1'), card('courier-2'), card('courier-3'), card('courier-4')];
    });
    play(client, 'seal-1', '2'); choose(client, ['4']);
    expect(raw(client).log.filter(entry => entry.type === 'defeat').map(entry => entry.targetID)).toEqual(['3', '0', '1']);
    expect(raw(client).private['3'].cards[0].role).toBe('courier-1');
    expect(raw(client).private['0'].cards[0].role).toBe('courier-2'); expect(raw(client).private['1'].cards[0].role).toBe('courier-3');
  });
  it.each(['director-3', 'seal-3'] as const)('局長只剩%s且無牌可補時，不產生空的對決選牌', role => {
    const client = fixture([[role], ['courier-4']], 'black-letter'); patch(client, G => { G.secret!.directorDeck = []; });
    play(client, role); endDirector(client); expect(raw(client).pending).toBeNull(); expect(raw(client).activePlayer).toBe('1');
  });
  it('折界首戰失去最後保留牌且補不到時，第二戰直接結束而不鎖死', () => {
    const client = fixture([['seal-3', 'director-1'], ['courier-4']], 'black-letter'); patch(client, G => { G.secret!.directorDeck = []; });
    play(client, 'seal-3'); choose(client, ['1']); choose(client, [raw(client).private['0'].cards[0].id]);
    expect(raw(client).private['0'].cards).toHaveLength(0); endDirector(client); expect(raw(client).pending).toBeNull(); expect(raw(client).activePlayer).toBe('1');
  });
  it('折界封印可依序對決兩個不同信使，每次局長重新選牌', () => {
    const client = fixture([['seal-3', 'director', 'director-4'], ['courier-4'], ['courier-3']], 'black-letter'); play(client, 'seal-3'); choose(client, ['1']); choose(client, [raw(client).private['0'].cards[0].id]);
    expect(raw(client).pending!.choices!.map(choice => choice.id)).not.toContain('1'); choose(client, ['2']); choose(client, [raw(client).private['0'].cards[0].id]);
    expect(raw(client).courierLife).toBe(4); endDirector(client); expect(raw(client).activePlayer).toBe('1');
  });
  it('雙人折界封印可連續對決同一人，第二次使用補牌後的牌', () => {
    const client = fixture([['seal-3', 'director', 'director-4'], ['courier-3']], 'black-letter'); play(client, 'seal-3'); choose(client, ['1']); choose(client, [raw(client).private['0'].cards[0].id]);
    expect(raw(client).private['1'].cards[0].role).toBe('courier-4'); choose(client, ['1']); choose(client, [raw(client).private['0'].cards[0].id]);
    expect(raw(client).courierLife).toBe(4);
  });
  it('總管邀請由被選同伴自己決定是否對決，原出牌者不能代答', () => {
    const client = fixture([['director', 'director-4'], ['courier-6', 'courier-4'], ['courier-3']], 'black-letter'); patch(client, G => { G.activePlayer = '1'; G.turnIndex = 1; });
    play(client, 'courier-6', '1'); choose(client, ['2']); expect(raw(client).pending!.actorID).toBe('2');
    unchanged(client, () => choose(client, ['fight'], '1')); choose(client, ['skip']); expect(raw(client).courierLife).toBe(6);
  });
  it('轉遞專員將頂三張私下重排，牌不足先重洗含剛打出的牌', () => {
    const client = fixture([['director', 'director-4'], ['courier-5', 'courier-4']], 'black-letter'); patch(client, G => {
      G.activePlayer = '1'; G.turnIndex = 1; G.secret!.deck = [card('courier-1')]; G.players['1'].discards = [card('courier-2'), card('courier-3')];
    }); play(client, 'courier-5', '1');
    expect(raw(client).pending!.choices).toHaveLength(3); expect(mailObserverView(raw(client), 'god').pending!.choices).toBeUndefined();
    const original = raw(client).pending!.choices!.map(choice => choice.id); choose(client, [...original].reverse());
    expect(raw(client).private['1'].cards[1].id).toBe(original[2]);
    expect(raw(client).log.some(entry => entry.type === 'reshuffle')).toBe(true);
  });
  it('幻真封印抽幾張就放回幾張、保留順序，效果途中不能宣告六封印', () => {
    const client = fixture([['seal-5', 'seal-1', 'seal-2'], ['courier-4']], 'black-letter'); patch(client, G => {
      G.secret!.directorDeck = [card('seal-6'), card('director')]; G.players['0'].discards = [card('seal-3'), card('seal-4')];
    }); play(client, 'seal-5'); expect(raw(client).pending!.minimum).toBe(2);
    unchanged(client, () => act(client, '0', 'seal', raw(client).epoch));
    const bottom = raw(client).private['0'].cards.filter(item => ['director', 'seal-1'].includes(item.role)).map(item => item.id); choose(client, bottom);
    expect(raw(client).secret!.directorDeck.map(item => item.id)).toEqual(bottom); expect(raw(client).private['0'].cards).toHaveLength(2);
  });
  it('逆時封印只複製自己公開局長牌，無可複製牌時落空', () => {
    const client = fixture([['seal-6', 'director', 'director-4'], ['courier-4']], 'black-letter'); patch(client, G => { G.players['0'].discards = [card('seal-4')]; });
    play(client, 'seal-6'); expect(raw(client).pending!.choices).toHaveLength(1); choose(client, [raw(client).pending!.choices![0].id]);
    expect(raw(client).players['0'].power).toBe(3);
    const empty = fixture([['seal-6', 'director', 'director-4'], ['courier-4']], 'black-letter'); play(empty, 'seal-6'); endDirector(empty); expect(raw(empty).pending).toBeNull(); expect(raw(empty).activePlayer).toBe('1');
  });
  it('六封印只計手上與已公開牌，只能在局長本人的完整操作界線宣告', () => {
    const client = fixture([['seal-1', 'seal-2', 'director'], ['courier-4']], 'black-letter'); patch(client, G => { G.players['0'].discards = [card('seal-3'), card('seal-4'), card('seal-5'), card('seal-6')]; });
    unchanged(client, () => act(client, '1', 'seal', raw(client).epoch)); act(client, '0', 'seal', raw(client).epoch);
    expect(raw(client).status).toBe('finished'); expect(raw(client).winner).toBe('director'); expect(raw(client).winReason).toBe('six-seals');
  });
  it('郵袋耗盡且只剩不能打出的局長牌時，仍保留六封印宣告機會', () => {
    const client = fixture([['director'], ['courier-4', 'courier-3']], 'black-letter');
    patch(client, G => {
      G.activePlayer = '1'; G.turnIndex = 2; G.secret!.directorDeck = [];
      G.players['0'].discards = [1, 2, 3, 4, 5, 6].map(n => card(`seal-${n}` as MailRole));
    });
    play(client, 'courier-4', '1'); choose(client, ['1']);
    expect(raw(client).activePlayer).toBe('0'); expect(raw(client).pending!.kind).toBe('director-end'); choose(client, ['seal']);
    expect(raw(client).winReason).toBe('six-seals');
  });
  it('最後一點生命立刻結束，黑函局長牌堆空時不憑空補牌', () => {
    const client = fixture([['director', 'director-4'], ['courier-1', 'courier-4']], 'black-letter'); patch(client, G => { G.activePlayer = '1'; G.turnIndex = 1; G.directorLife = 1; G.secret!.directorDeck = []; });
    play(client, 'courier-1', '1'); choose(client, ['7']); choose(client, [raw(client).pending!.choices![0].id]);
    expect(raw(client).winner).toBe('couriers'); expect(raw(client).directorLife).toBe(0); expect(raw(client).private['0'].cards).toHaveLength(1);
    const dry = fixture([['director-5', 'director-4', 'director'], ['courier-4']], 'black-letter'); patch(dry, G => { G.secret!.directorDeck = []; }); play(dry, 'director-5');
    expect(raw(dry).private['0'].cards).toHaveLength(2); endDirector(dry); expect(raw(dry).pending).toBeNull();
  });
});

describe('午夜郵局資訊投影與完整對局', () => {
  it('局長是否持有第六封印，不會透過結束回合提示洩漏給其他玩家或盲觀戰', () => {
    const complete = fixture([['director-4', 'seal-1', 'seal-6'], ['courier-4']], 'black-letter');
    patch(complete, G => { G.players['0'].discards = [card('seal-2'), card('seal-3'), card('seal-4'), card('seal-5')]; });
    const incomplete = makeClient(2, { mode: 'black-letter', directorID: '0' });
    const otherwiseIdentical = structuredClone(complete.store.getState()) as State<MailState>;
    otherwiseIdentical.G.private['0'].cards[2].role = 'director-2';
    incomplete.store.dispatch({ type: 'UPDATE', state: otherwiseIdentical, deltalog: [], clientOnly: true });
    play(complete, 'director-4'); play(incomplete, 'director-4');
    for (const client of [complete, incomplete]) {
      expect(raw(client).pending!.kind).toBe('director-end'); expect(raw(client).pending!.title).toBe('等待局長完成本次投遞');
    }
    expect(mailObserverView(raw(complete), 'blind')).toEqual(mailObserverView(raw(incomplete), 'blind'));
    expect(mailPlayerView({ G: raw(complete), playerID: '1' })).toEqual(mailPlayerView({ G: raw(incomplete), playerID: '1' }));
    expect(mailPlayerView({ G: raw(complete), playerID: '0' }).pending!.choices!.map(choice => choice.id)).toEqual(['continue', 'seal']);
    expect(mailPlayerView({ G: raw(incomplete), playerID: '0' }).pending!.choices!.map(choice => choice.id)).toEqual(['continue']);
    unchanged(incomplete, () => choose(incomplete, ['seal']));
    choose(complete, ['seal']); expect(raw(complete).winReason).toBe('six-seals');
    endDirector(incomplete); expect(raw(incomplete).activePlayer).toBe('1');
  });
  it('集齊封印也可以選擇繼續，後續局長回合仍可宣告；尚未集齊的空手回合也可推進', () => {
    const client = fixture([['director-4', 'seal-1', 'seal-6'], ['courier-4']], 'black-letter');
    patch(client, G => { G.players['0'].discards = [card('seal-2'), card('seal-3'), card('seal-4'), card('seal-5')]; });
    play(client, 'director-4'); endDirector(client); expect(raw(client).status).toBe('playing'); expect(raw(client).activePlayer).toBe('1');
    for (let turn = 0; turn < 2; turn++) { play(client, 'courier-4', '1'); choose(client, ['1']); }
    expect(raw(client).activePlayer).toBe('0'); act(client, '0', 'seal', raw(client).epoch);
    expect(raw(client).winReason).toBe('six-seals');
    const empty = fixture([['director'], ['courier-4', 'courier-3']], 'black-letter');
    patch(empty, G => { G.activePlayer = '1'; G.turnIndex = 2; G.secret!.directorDeck = []; });
    play(empty, 'courier-4', '1'); choose(empty, ['1']);
    expect(raw(empty).activePlayer).toBe('0'); expect(raw(empty).pending!.choices!.map(choice => choice.id)).toEqual(['continue']);
    endDirector(empty); expect(raw(empty).activePlayer).toBe('1');
  });
  it('所有投影都剝除牌堆/備用與pending私密選項，副本不會污染原始資料', () => {
    const client = fixture([['director', 'director-4'], ['courier-5', 'courier-4']], 'black-letter'); patch(client, G => { G.activePlayer = '1'; G.turnIndex = 1; }); play(client, 'courier-5', '1');
    const G = raw(client), own = mailPlayerView({ G, playerID: '1' }), stranger = mailPlayerView({ G, playerID: '11' }), blind = mailObserverView(G, 'blind'), god = mailObserverView(G, 'god');
    expect(Object.keys(own.private)).toEqual(['1']); expect(own.pending!.choices).toHaveLength(3);
    for (const view of [own, stranger, blind, god]) expect(view.secret).toBeUndefined();
    expect(stranger.private).toEqual({}); expect(blind.private).toEqual({}); expect(Object.keys(god.private)).toEqual(['0', '1']);
    expect(god.pending!.choices).toBeUndefined(); expect(god.pending!.minimum).toBeUndefined();
    own.private['1'].cards[0].role = 'director'; expect(raw(client).private['1'].cards[0].role).not.toBe('director');
    own.pending!.choices!.splice(0); expect(raw(client).pending!.choices).toHaveLength(3);
    unchanged(client, () => choose(client, ['unknown'])); unchanged(client, () => choose(client, ['__proto__']));
    const chosen = raw(client).pending!.choices!.map(choice => choice.id); const epoch = raw(client).epoch;
    choose(client, chosen); unchanged(client, () => act(client, '1', 'choose', chosen, epoch));
  });
  it.each([['classic', 3], ['classic', 4], ['premium', 5], ['premium', 6], ['premium', 7], ['premium', 8], ['black-letter', 2], ['black-letter', 3], ['black-letter', 4], ['black-letter', 5], ['black-letter', 6]] as const)('%s %i 人用有限視角合法動作可完成全局', (mode, n) => {
    const client = makeClient(n, { mode }, undefined, `complete-${mode}-${n}`); let steps = 0, randomState = n + 17;
    while (raw(client).status !== 'finished' && steps++ < 4000) {
      const G = raw(client); let progressed = false;
      for (const id of Object.keys(G.players)) {
        const actions = legalMailActions(mailPlayerView({ G: raw(client), playerID: id }), id);
        if (!actions.length) continue;
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        const action = actions[randomState % actions.length], before = raw(client).epoch;
        act(client, id, action.move, ...action.args);
        expect(raw(client).epoch !== before || ['briefing', 'round-review'].includes(raw(client).status)).toBe(true);
        progressed = true; break;
      }
      expect(progressed).toBe(true);
    }
    expect(raw(client).status).toBe('finished'); expect(raw(client).winnerIDs.length).toBeGreaterThan(0);
    expect(steps).toBeLessThan(4000); expect(client.store.getState().ctx.gameover.winner).toBe(raw(client).winner);
  });
});
