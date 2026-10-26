import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { BanquetGame, banquetExchangeTargets, banquetObserverView, banquetPlayerView, legalBanquetActions, type BanquetRole, type BanquetState } from './game';
import { BANQUET_PRESETS, BANQUET_ROLES, BANQUET_ROLE_IDS } from './content';
import { banquetRoleSet, normalizeBanquetOptions, validateBanquetOptions, type BanquetOptions } from './rules';

function makeClient(n = 4, options: Partial<BanquetOptions> = {}, participantIDs?: string[]) {
  const game = { ...BanquetGame, seed: 'night-banquet' }, client = Client({ game, numPlayers: n, playerID: participantIDs?.[0] ?? '0', debug: false });
  const match = createMatch({ game, numPlayers: n, setupData: { startImmediately: true, options: normalizeBanquetOptions(options), participantIDs }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  return client;
}
type TestClient = ReturnType<typeof makeClient>;
const raw = (client: TestClient) => client.store.getState().G as BanquetState;
function act(client: TestClient, id: string, move: string, ...args: unknown[]) { client.updatePlayerID(id); client.moves[move](...args); }
function patch(client: TestClient, update: (G: BanquetState) => void) {
  const state = structuredClone(client.store.getState()) as State<BanquetState>; update(state.G);
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function ackAll(client: TestClient) { for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge', raw(client).epoch); }
function fixture(roles: BanquetRole[] = ['king', 'judge', 'empress', 'thief'], coins?: number[]) {
  const client = makeClient(roles.length);
  patch(client, G => {
    G.status = 'playing'; G.turnNumber = 5; G.initialTurnsRemaining = 0; G.activePlayer = '0';
    G.secret!.masks = [...roles]; G.secret!.center = []; G.centerCount = 0;
    G.inPlayRoles = [...BANQUET_ROLE_IDS, 'peasant'];
    G.initialLayout = roles.map((role, i) => ({ role, location: `seat:${i}`, playerID: String(i), source: 'initial', turn: 0, epoch: 0, uncertain: false }));
    for (const [i, id] of Object.keys(G.players).entries()) { G.players[id].coins = coins?.[i] ?? 6; G.private[id].memory = structuredClone(G.initialLayout); }
    G.secret!.observerMemory = structuredClone(G.initialLayout);
  });
  return client;
}
function announce(client: TestClient, role: BanquetRole, challengers: string[] = [], actorID = raw(client).activePlayer!) {
  act(client, actorID, 'announce', role, raw(client).epoch);
  const responders = [...raw(client).claim!.responderIDs];
  for (const id of responders) act(client, id, 'respondClaim', challengers.includes(id), raw(client).epoch);
}
function choose(client: TestClient, choices: string[], actorID = raw(client).pending!.actorID) { act(client, actorID, 'choose', choices, raw(client).epoch); }
function unchanged(client: TestClient, action: () => void) {
  const snapshot = () => ({ G: raw(client), ctx: client.store.getState().ctx, version: client.store.getState()._stateID });
  const before = structuredClone(snapshot()); action(); expect(snapshot()).toEqual(before);
}
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('百鬼夜宴 2021 配置與準備', () => {
  it('有16種能力、17張面具，並保存所有18個官方配置', () => {
    expect(BANQUET_ROLE_IDS).toHaveLength(16);
    expect(Object.values(BANQUET_ROLES).reduce((n, role) => n + role.count, 0)).toBe(17);
    for (let n = 4; n <= 12; n++) for (const scenario of ['A', 'B'] as const) {
      const client = makeClient(n, { scenario }), G = raw(client), cards = [...G.secret!.masks, ...G.secret!.center];
      expect(cards).toHaveLength(n <= 5 ? 6 : n); expect([...cards].sort()).toEqual([...BANQUET_PRESETS[n][scenario]].sort());
      expect(G.centerCount).toBe(n <= 5 ? 6 - n : 0); expect(G.initialLayout).toHaveLength(cards.length);
      expect(G.status).toBe('briefing'); expect(Object.values(G.players).every(p => p.coins === 6)).toBe(true);
      // The official 8A sheet has two bank-producing masks among eight.
      // Printed presets are authoritative; the one-third rule governs custom sets.
      if (n === 8 && scenario === 'A') expect(validateBanquetOptions({ scenario: 'custom', customRoles: cards }, n)).toMatch(/三分之一/);
      else expect(validateBanquetOptions({ scenario: 'custom', customRoles: cards }, n)).toBeUndefined();
    }
    expect(BANQUET_PRESETS[6].A).toEqual(['cheater', 'judge', 'patron', 'princess', 'sorceress', 'trickster']);
    expect(BANQUET_PRESETS[12].B).toHaveLength(12);
  });
  it('嚴格驗證配置形狀、牌數、農民成對、星號比例、人數與不同房間席位', () => {
    for (const value of [null, [], { extra: true }, { scenario: '__proto__' }, { scenario: null }, { customRoles: ['constructor'] }, { customRoles: null }, { customRoles: ['king', 'king'] }]) expect(() => normalizeBanquetOptions(value)).toThrow();
    expect(validateBanquetOptions({ scenario: 'custom', customRoles: ['king', 'empress', 'fool', 'widow', 'beggar', 'thief'] }, 4)).toMatch(/閻魔/);
    expect(validateBanquetOptions({ scenario: 'custom', customRoles: ['judge', 'peasant', 'empress', 'king', 'widow', 'fool'] }, 8)).toMatch(/兩張/);
    expect(validateBanquetOptions({ scenario: 'custom', customRoles: ['judge', 'king', 'spy', 'thief', 'sorceress', 'trickster'] }, 6)).toMatch(/三分之一/);
    expect(validateBanquetOptions({ scenario: 'custom', customRoles: [...BANQUET_PRESETS[4].A, 'widow'] }, 4)).toMatch(/6 張/);
    expect(validateBanquetOptions({ scenario: 'custom', customRoles: ['judge', 'king', 'empress', 'spy', 'thief', 'trickster'] }, 4)).toMatch(/6 位/);
    expect(validateBanquetOptions({}, 3)).toBeTruthy(); expect(validateBanquetOptions({}, 13)).toBeTruthy();
    const client = makeClient(4, {}, ['1', '3', '7', '11']);
    expect(Object.keys(raw(client).players)).toEqual(['1', '3', '7', '11']); expect(raw(client).activePlayer).toBe('1');
    expect(() => makeClient(4, {}, ['1', '1', '7', '11'])).toThrow(/席位/);
    expect(banquetRoleSet(normalizeBanquetOptions(undefined), 4)).toEqual(BANQUET_PRESETS[4].A);
  });
  it('自訂6人可加兩張中央面具，準備階段可先保存與等待室容量不同的配置', () => {
    const roles: BanquetRole[] = [...BANQUET_PRESETS[6].B, 'fool', 'sorceress'];
    const client = makeClient(6, { scenario: 'custom', customRoles: roles });
    expect(raw(client).centerCount).toBe(2);
    const match = createMatch({ game: BanquetGame, numPlayers: 12, setupData: { options: { scenario: 'custom', customRoles: BANQUET_PRESETS[4].A } }, unlisted: true });
    expect('setupDataError' in match).toBe(false);
  });
  it.each([4, 5, 8, 12])('%i人只強制前四位盲換，第五次即正常行動', n => {
    const client = makeClient(n); ackAll(client);
    for (let i = 0; i < 4; i++) {
      const G = raw(client); expect(G.activePlayer).toBe(String(i));
      expect(legalBanquetActions(banquetPlayerView({ G, playerID: String(i) }), String(i)).every(a => a.move === 'exchange')).toBe(true);
      unchanged(client, () => act(client, String(i), 'look', raw(client).epoch));
      unchanged(client, () => act(client, String(i), 'announce', 'king', raw(client).epoch));
      act(client, String(i), 'exchange', `seat:${(i + 1) % n}`, false, raw(client).epoch);
    }
    expect(raw(client).initialTurnsRemaining).toBe(0); expect(raw(client).activePlayer).toBe(String(4 % n)); expect(raw(client).turnNumber).toBe(5);
    expect(legalBanquetActions(banquetPlayerView({ G: raw(client), playerID: String(4 % n) }), String(4 % n)).some(a => a.move === 'look')).toBe(true);
  });
  it('確認與所有動作拒絕重送、舊版本、不合法目標及非當事人', () => {
    const client = makeClient(), epoch = raw(client).epoch;
    act(client, '0', 'acknowledge', epoch);
    unchanged(client, () => act(client, '0', 'acknowledge', raw(client).epoch));
    unchanged(client, () => act(client, '1', 'acknowledge', epoch));
    unchanged(client, () => act(client, '11', 'acknowledge', raw(client).epoch));
    for (const id of ['1', '2', '3']) act(client, id, 'acknowledge', raw(client).epoch);
    for (const args of [['seat:0', false], ['seat:4', false], ['center:2', false], ['seat:1', 1], ['seat:01', false]]) unchanged(client, () => act(client, '0', 'exchange', ...args, raw(client).epoch));
    unchanged(client, () => act(client, '1', 'exchange', 'seat:0', false, raw(client).epoch));
    act(client, '0', 'exchange', 'center:0', true, raw(client).epoch); expect(raw(client).activePlayer).toBe('1');
  });
});

describe('認領、多人質疑與即時終局', () => {
  it('無人質疑時允許以不持有的面具生效，而且不翻牌', () => {
    const client = fixture(); announce(client, 'empress');
    expect(raw(client).players['0'].coins).toBe(9); expect(raw(client).secret!.masks[0]).toBe('king');
    expect(raw(client).log.some(entry => entry.type === 'reveal')).toBe(false); expect(raw(client).activePlayer).toBe('1');
  });
  it('認領必須逐人依座次，全部表態前不能揭牌；真正持有者不在認領者中不能獲益', () => {
    const client = fixture(); act(client, '0', 'announce', 'empress', raw(client).epoch);
    unchanged(client, () => act(client, '2', 'respondClaim', true, raw(client).epoch));
    act(client, '1', 'respondClaim', true, raw(client).epoch);
    expect(raw(client).claim!.revealed).toEqual({}); expect(raw(client).secret!.masks[1]).toBe('judge');
    act(client, '2', 'respondClaim', false, raw(client).epoch);
    expect(raw(client).claim!.revealed).toEqual({});
    act(client, '3', 'respondClaim', true, raw(client).epoch);
    expect(Object.values(raw(client).players).map(p => p.coins)).toEqual([5, 5, 6, 5]); expect(raw(client).court).toBe(3);
  });
  it('真正認領者在他人回合用能力，錯誤認領者罰款，下一位被揭牌者禁止宣稱一回合', () => {
    const client = fixture(['thief', 'king', 'empress', 'judge']); announce(client, 'king', ['1', '2']);
    expect(Object.values(raw(client).players).map(p => p.coins)).toEqual([5, 8, 5, 6]); expect(raw(client).court).toBe(2);
    expect(raw(client).players['1'].cannotAnnounce).toBe(true);
    unchanged(client, () => act(client, '1', 'announce', 'empress', raw(client).epoch));
    act(client, '1', 'look', raw(client).epoch);
    expect(raw(client).players['2'].cannotAnnounce).toBe(false);
  });
  it('法官先收舊罰款，再加入本次錯誤認領罰款', () => {
    const client = fixture(); patch(client, G => { G.court = 3; }); announce(client, 'judge', ['1', '2']);
    expect(raw(client).players['1'].coins).toBe(9); expect(raw(client).court).toBe(2);
    expect(raw(client).players['0'].coins).toBe(5); expect(raw(client).players['2'].coins).toBe(5);
  });
  it('能力先使一人達13時終局，不再收取會使另一人破產的罰款', () => {
    const client = fixture(['thief', 'king', 'empress', 'judge'], [1, 11, 6, 6]); announce(client, 'king', ['1']);
    expect(raw(client).status).toBe('finished'); expect(raw(client).winnerIDs).toEqual(['1']);
    expect(raw(client).players['0'].coins).toBe(1); expect(raw(client).court).toBe(0);
  });
  it('所有錯誤認領者同批繳款，再依破產後財富共享勝利', () => {
    const client = fixture(['thief', 'king', 'empress', 'judge'], [1, 12, 11, 11]); announce(client, 'widow', ['1']);
    expect(raw(client).status).toBe('finished'); expect(raw(client).winReason).toBe('bankruptcy');
    expect(raw(client).court).toBe(2); expect(raw(client).winnerIDs).toEqual(['1', '2', '3']);
  });
  it.each([9, 10, 12])('騙徒在能力觸發時以%i金判斷，不是持有即獲勝', coins => {
    const client = fixture(['thief', 'cheater', 'empress', 'judge'], [6, coins, 6, 6]); announce(client, 'cheater', ['1']);
    expect(raw(client).status).toBe(coins >= 10 ? 'finished' : 'playing');
    expect(raw(client).players['0'].coins).toBe(coins >= 10 ? 6 : 5);
    if (coins >= 10) expect(raw(client).winnerIDs).toEqual(['1']);
  });
  it('無人質疑的騙徒吹牛仍可獲勝；單純持牌達10而未使用能力不能獲勝', () => {
    const bluff = fixture(undefined, [10, 6, 6, 6]); announce(bluff, 'cheater');
    expect(raw(bluff).winnerIDs).toEqual(['0']); expect(raw(bluff).secret!.masks[0]).toBe('king');
    const idle = fixture(['cheater', 'king', 'judge', 'empress'], [10, 6, 6, 6]); act(idle, '0', 'look', raw(idle).epoch);
    expect(raw(idle).status).toBe('playing'); expect(raw(idle).winnerIDs).toEqual([]);
  });
  it('兩農民必須都在本次揭牌認領集合，才各得2金', () => {
    const together = fixture(['peasant', 'peasant', 'judge', 'king']); announce(together, 'peasant', ['1', '2']);
    expect(Object.values(raw(together).players).map(p => p.coins)).toEqual([8, 8, 5, 6]);
    const alone = fixture(['peasant', 'peasant', 'judge', 'king']); announce(alone, 'peasant', ['2']);
    expect(raw(alone).players['0'].coins).toBe(7); expect(raw(alone).players['1'].coins).toBe(6);
    const nobody = fixture(['king', 'judge', 'peasant', 'peasant']); announce(nobody, 'peasant', ['1']);
    expect(raw(nobody).players['2'].coins).toBe(6); expect(raw(nobody).court).toBe(2);
  });
  it('兩農民同批達13共享勝利，即使其中一人達14', () => {
    const client = fixture(['peasant', 'peasant', 'judge', 'king'], [11, 12, 6, 6]); announce(client, 'peasant', ['1']);
    expect(raw(client).winnerIDs).toEqual(['0', '1']); expect(raw(client).winReason).toBe('thirteen-coins');
  });
});

describe('逐項特殊能力', () => {
  it.each([1, 6, 10, 12])('寡婦把%i補到10，但不減少原本較多的金幣', coins => {
    const client = fixture(undefined, [coins, 6, 6, 6]); announce(client, 'widow'); expect(raw(client).players['0'].coins).toBe(Math.max(10, coins));
  });
  it('乞丐依順時針逐位重新比較，不預先固定所有付款人', () => {
    const client = fixture(['beggar', 'king', 'judge', 'empress', 'thief', 'widow'], [4, 8, 1, 11, 7, 9]); announce(client, 'beggar');
    expect(Object.values(raw(client).players).map(p => p.coins)).toEqual([8, 7, 1, 10, 6, 8]);
    // At 6 coins after players 1 and 3, player 4's 7 is still strictly richer.
    const dynamic = fixture(['beggar', 'king', 'judge', 'empress'], [4, 8, 5, 6]); announce(dynamic, 'beggar');
    expect(Object.values(raw(dynamic).players).map(p => p.coins)).toEqual([6, 7, 5, 5]);
  });
  it('資助者與小偷以能力使用者的左右鄰裁定，同批付款', () => {
    const patron = fixture(); announce(patron, 'patron'); expect(Object.values(raw(patron).players).map(p => p.coins)).toEqual([9, 7, 6, 7]);
    const thief = fixture(['king', 'judge', 'thief', 'empress']); announce(thief, 'thief', ['2']);
    expect(Object.values(raw(thief).players).map(p => p.coins)).toEqual([5, 5, 8, 5]);
    const terminal = fixture(undefined, [11, 1, 12, 1]); announce(terminal, 'thief');
    expect(Object.values(raw(terminal).players).map(p => p.coins)).toEqual([13, 0, 12, 0]); expect(raw(terminal).winnerIDs).toEqual(['0']);
  });
  it('資助者同批使本人及鄰居達標時，共享勝利', () => {
    const client = fixture(undefined, [10, 12, 6, 12]); announce(client, 'patron'); expect(raw(client).winnerIDs).toEqual(['0', '1', '3']);
  });
  it('魔術師排除自己，強制最富對手並允許從並列中選人', () => {
    const client = fixture(undefined, [11, 7, 7, 5]); announce(client, 'trickster');
    expect(raw(client).pending!.choices!.map(c => c.id)).toEqual(['1', '2']);
    unchanged(client, () => choose(client, ['0'])); unchanged(client, () => choose(client, ['3'])); choose(client, ['2']);
    expect(raw(client).players['0'].coins).toBe(13); expect(raw(client).players['2'].coins).toBe(5);
  });
  it('宗師由目標自己猜角色，正確不付錢，錯誤付最多4且不足即破產', () => {
    const correct = fixture(); announce(correct, 'guru'); choose(correct, ['1']);
    expect(raw(correct).pending!.actorID).toBe('1'); unchanged(correct, () => choose(correct, ['judge'], '0'));
    choose(correct, ['judge']); expect(raw(correct).players['1'].coins).toBe(6); expect(raw(correct).players['1'].cannotAnnounce).toBe(true);
    const wrong = fixture(undefined, [6, 3, 6, 6]); announce(wrong, 'guru'); choose(wrong, ['1']); choose(wrong, ['king']);
    expect(raw(wrong).players['0'].coins).toBe(9); expect(raw(wrong).players['1'].coins).toBe(0); expect(raw(wrong).winReason).toBe('bankruptcy');
    const exact = fixture(undefined, [9, 4, 6, 6]); announce(exact, 'guru'); choose(exact, ['1']); choose(exact, ['king']);
    expect(raw(exact).players['0'].coins).toBe(13); expect(raw(exact).players['1'].coins).toBe(0); expect(raw(exact).winnerIDs).toEqual(['0']);
  });
  it('弄臣先得1金，再盲換其他兩張，不接受自己、中央、重複或錯誤數量', () => {
    const client = fixture(); announce(client, 'fool');
    expect(raw(client).players['0'].coins).toBe(7); expect(raw(client).pending!.choices!.map(c => c.id)).toEqual(['1', '2', '3']);
    for (const input of [['0', '1'], ['1', '1'], ['1'], ['1', 'center:0']]) unchanged(client, () => choose(client, input));
    choose(client, ['1', '2']); choose(client, ['swap']); expect(raw(client).secret!.masks).toEqual(['king', 'empress', 'judge', 'thief']);
    const finished = fixture(undefined, [12, 6, 6, 6]); announce(finished, 'fool'); expect(raw(finished).status).toBe('finished'); expect(raw(finished).pending).toBeNull();
  });
  it('間諜私看自己及對手後才選換不換，記憶追蹤結果，不讓他人知道', () => {
    const client = fixture(); announce(client, 'spy'); choose(client, ['1']);
    expect(raw(client).pending!.kind).toBe('swap'); expect(raw(client).private['0'].memory.slice(-2).map(m => m.role)).toEqual(['king', 'judge']);
    expect(raw(client).private['1'].memory).toHaveLength(4);
    choose(client, ['swap']); expect(raw(client).secret!.masks.slice(0, 2)).toEqual(['judge', 'king']);
    expect(raw(client).private['0'].memory.slice(-2).map(m => [m.role, m.uncertain])).toEqual([['judge', false], ['king', false]]);
    expect(raw(client).private['1'].memory.filter(m => ['seat:0', 'seat:1'].includes(m.location)).every(m => m.uncertain)).toBe(true);
  });
  it('女巫交換完財富才對原錯誤聲稱者罰款，也可選擇不交換', () => {
    const client = fixture(['king', 'sorceress', 'judge', 'empress'], [1, 10, 6, 6]); announce(client, 'sorceress', ['1']); choose(client, ['0']);
    expect(raw(client).players['0'].coins).toBe(9); expect(raw(client).players['1'].coins).toBe(1); expect(raw(client).status).toBe('playing');
    const skip = fixture(); announce(skip, 'sorceress'); choose(skip, ['skip']); expect(raw(skip).players['0'].coins).toBe(6);
  });
  it('操偶師交換遊戲內座次，錢牌留原位置，私人記憶與帳號不換，發起人新位置決定下一人', () => {
    const client = fixture(['king', 'empress', 'judge', 'puppeteer'], [4, 9, 6, 6]);
    announce(client, 'puppeteer', ['3']); const memory = structuredClone(raw(client).private['0'].memory);
    choose(client, ['0', '1']);
    expect(raw(client).turnOrder).toEqual(['1', '0', '2', '3']); expect(raw(client).activePlayer).toBe('2');
    expect(Object.keys(raw(client).players)).toEqual(['0', '1', '2', '3']);
    expect(Object.values(raw(client).players).map(p => p.coins)).toEqual([7, 3, 6, 8]);
    expect(banquetObserverView(raw(client), 'god').currentMasks!.players['0']).toBe('empress');
    expect(raw(client).private['0'].memory.map(m => ({ ...m, uncertain: false }))).toEqual(memory.map(m => ({ ...m, uncertain: false })));
    expect(raw(client).private['0'].memory[0]).toMatchObject({ playerID: '0', location: 'seat:0', role: 'king', uncertain: true });
  });
  it('操偶師付款造成終局就不再交換座位', () => {
    const client = fixture(undefined, [6, 1, 9, 6]); announce(client, 'puppeteer'); choose(client, ['1', '2']);
    expect(raw(client).status).toBe('finished'); expect(raw(client).turnOrder).toEqual(['0', '1', '2', '3']); expect(raw(client).winnerIDs).toEqual(['0', '2']);
  });
  it('公主先得2金，若已獲勝不再要求揭牌', () => {
    const client = fixture(undefined, [11, 6, 6, 6]); announce(client, 'princess'); expect(raw(client).status).toBe('finished'); expect(raw(client).pending).toBeNull();
  });
});

describe('秘密投影、歷史記憶及伺服器防護', () => {
  it('普通查看只增添本人當時記憶，不能持續得知真牌；投影永無secret/cardID/牌背metadata', () => {
    const client = fixture(); act(client, '0', 'look', raw(client).epoch);
    expect(raw(client).private['0'].memory.at(-1)).toMatchObject({ role: 'king', source: 'look', uncertain: false });
    act(client, '1', 'exchange', 'seat:0', true, raw(client).epoch);
    const view = banquetPlayerView({ G: raw(client), playerID: '0' });
    expect(Object.keys(view.private)).toEqual(['0']); expect(view.private['0'].memory.at(-1)).toMatchObject({ role: 'king', uncertain: true });
    expect(view.currentMasks).toBeUndefined(); expect(view.secret).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/cardID|cardId|backId|deck|"secret"/);
    const god = banquetObserverView(raw(client), 'god'); expect(god.currentMasks!.players['0']).toBe('judge'); expect(god.secret).toBeUndefined();
    expect(banquetObserverView(raw(client), 'blind').currentMasks).toBeUndefined();
  });
  it('真換與假換的整份玩家及盲視角投影完全相同，包含操作者自己的記憶不確定標記', () => {
    const swapped = fixture(), faked = fixture();
    act(swapped, '0', 'exchange', 'seat:1', true, raw(swapped).epoch);
    act(faked, '0', 'exchange', 'seat:1', false, raw(faked).epoch);
    for (const id of ['0', '1', '2', '3']) expect(banquetPlayerView({ G: raw(swapped), playerID: id })).toEqual(banquetPlayerView({ G: raw(faked), playerID: id }));
    expect(banquetObserverView(raw(swapped), 'blind')).toEqual(banquetObserverView(raw(faked), 'blind'));
    expect(banquetObserverView(raw(swapped), 'god').currentMasks).not.toEqual(banquetObserverView(raw(faked), 'god').currentMasks);
  });
  it('弄臣真換與假換不以公開選項、歷史或記憶標記洩密', () => {
    const swapped = fixture(), faked = fixture();
    for (const client of [swapped, faked]) { announce(client, 'fool'); choose(client, ['1', '2']); }
    choose(swapped, ['swap']); choose(faked, ['keep']);
    for (const id of ['0', '1', '2', '3']) expect(banquetPlayerView({ G: raw(swapped), playerID: id })).toEqual(banquetPlayerView({ G: raw(faked), playerID: id }));
  });
  it('間諜換與假換只有能力者的最後觀測不同，其他玩家及盲觀戰完全相同', () => {
    const swapped = fixture(), faked = fixture();
    for (const client of [swapped, faked]) { announce(client, 'spy'); choose(client, ['1']); }
    choose(swapped, ['swap']); choose(faked, ['keep']);
    expect(raw(faked).private['0'].memory.slice(-2).map(m => [m.role, m.uncertain])).toEqual([['king', false], ['judge', false]]);
    expect(banquetPlayerView({ G: raw(swapped), playerID: '0' })).not.toEqual(banquetPlayerView({ G: raw(faked), playerID: '0' }));
    for (const id of ['1', '2', '3']) expect(banquetPlayerView({ G: raw(swapped), playerID: id })).toEqual(banquetPlayerView({ G: raw(faked), playerID: id }));
    expect(banquetObserverView(raw(swapped), 'blind')).toEqual(banquetObserverView(raw(faked), 'blind'));
  });
  it('換位後下一回合的禁宣稱依原玩家揭牌紀錄，不依驗證ID或舊座位', () => {
    const client = fixture(['king', 'empress', 'judge', 'puppeteer']); announce(client, 'puppeteer', ['1', '3']);
    // Active initiator 0 moves to the old seat of 2, so the next seat is player 3.
    choose(client, ['0', '2']);
    expect(raw(client).turnOrder).toEqual(['2', '1', '0', '3']); expect(raw(client).activePlayer).toBe('3');
    expect(raw(client).players['3'].cannotAnnounce).toBe(true);
    expect(legalBanquetActions(banquetPlayerView({ G: raw(client), playerID: '3' }), '3').some(a => a.move === 'announce')).toBe(false);
    act(client, '3', 'exchange', 'seat:0', false, raw(client).epoch);
    expect(raw(client).activePlayer).toBe('2'); expect(raw(client).players['2'].cannotAnnounce).toBe(false);
  });
  it('公主被指定者看不到自己牌的新資訊，其他玩家及盲觀戰可以看到', () => {
    const first = fixture(), second = fixture(); patch(second, G => { G.secret!.masks[1] = 'widow'; });
    for (const client of [first, second]) { announce(client, 'princess'); choose(client, ['1']); }
    expect(banquetPlayerView({ G: raw(first), playerID: '1' })).toEqual(banquetPlayerView({ G: raw(second), playerID: '1' }));
    expect(raw(first).private['0'].memory.at(-1)).toMatchObject({ playerID: '1', role: 'judge', source: 'princess' });
    expect(raw(second).private['0'].memory.at(-1)).toMatchObject({ playerID: '1', role: 'widow', source: 'princess' });
    expect(banquetObserverView(raw(second), 'blind').observerMemory!.at(-1)).toMatchObject({ role: 'widow' });
    expect(raw(first).players['1'].cannotAnnounce).toBe(true);
    expect(raw(first).log).toEqual(raw(second).log);
  });
  it('公主也不透過claim.revealed混入指定者真牌，查驗紀錄只有本人可見', () => {
    const client = fixture(['princess', 'judge', 'thief', 'king']); announce(client, 'princess', ['2']); choose(client, ['1']);
    expect(raw(client).log.filter(entry => entry.revealed).every(entry => !Object.hasOwn(entry.revealed!, '1'))).toBe(true);
    for (const id of ['0', '1', '2', '3']) expect(Object.keys(banquetPlayerView({ G: raw(client), playerID: id }).private)).toEqual([id]);
  });
  it('所有合法動作僅由投影推導，篡改伺服器真身分不影響動作集合', () => {
    const client = fixture(), G = raw(client), changed = structuredClone(G);
    changed.secret!.masks.reverse();
    for (const id of ['0', '1', '2', '3']) {
      const view = banquetPlayerView({ G, playerID: id }), altered = banquetPlayerView({ G: changed, playerID: id });
      expect(view).toEqual(altered); expect(legalBanquetActions(view, id)).toEqual(legalBanquetActions(altered, id));
    }
    expect(banquetExchangeTargets(G, '0')).toEqual(['seat:1', 'seat:2', 'seat:3']);
    expect(legalBanquetActions(G, '11')).toEqual([]);
  });
  it('上帝快照重投影冪等，轉盲視角剝除真牌及私人查驗但保留公共觀測', () => {
    const client = fixture(); announce(client, 'spy'); choose(client, ['1']); choose(client, ['swap']);
    const G = raw(client), god = banquetObserverView(G, 'god'), blind = banquetObserverView(G, 'blind');
    expect(banquetObserverView(god, 'god')).toEqual(god);
    expect(banquetObserverView(god, 'blind')).toEqual(blind);
    expect(banquetObserverView(blind, 'blind')).toEqual(blind);
    expect(blind.observerMemory!.some(memory => memory.source === 'spy')).toBe(false);
    expect(blind.private).toEqual({}); expect(blind.currentMasks).toBeUndefined();
    announce(client, 'princess'); choose(client, ['2']);
    const next = banquetObserverView(raw(client), 'god');
    expect(banquetObserverView(next, 'blind').observerMemory!.at(-1)!.source).toBe('princess');
  });
  it('私人能力選項只給當事人，過期或偽造選擇不改狀態', () => {
    const client = fixture(); announce(client, 'spy'); const epoch = raw(client).epoch;
    expect(banquetPlayerView({ G: raw(client), playerID: '1' }).pending!.choices).toBeUndefined();
    unchanged(client, () => choose(client, ['1'], '2')); choose(client, ['1']);
    unchanged(client, () => act(client, '0', 'choose', ['swap'], epoch));
    unchanged(client, () => choose(client, ['swap', 'keep'])); unchanged(client, () => choose(client, ['invented']));
  });
  it('阻擋直接framework事件、undo與客戶端預測，所有動作redact', () => {
    const client = fixture();
    for (const [name, args] of [['endGame', [{ winner: 'wealth' }]], ['endPhase', []], ['endTurn', []], ['setPhase', ['invented']], ['setStage', ['invented']], ['setActivePlayers', [{ all: 'invented' }]]] as const) {
      const before = structuredClone(raw(client)), version = client.store.getState()._stateID;
      client.store.dispatch({ type: 'GAME_EVENT', payload: { type: name, args, playerID: '0' } });
      expect(raw(client)).toEqual(before); expect(client.store.getState()._stateID).toBe(version);
    }
    expect(BanquetGame.disableUndo).toBe(true);
    for (const move of Object.values(BanquetGame.moves!)) {
      expect(typeof move).toBe('object'); if (typeof move === 'function') continue;
      expect(move.client).toBe(false); expect(move.undoable).toBe(false); expect(move.redact).toBe(true);
    }
  });
  it.each([4, 6, 8, 12])('%i人完整對局可只依合法投影行動走到終局', n => {
    const client = makeClient(n); let iterations = 0;
    while (raw(client).status !== 'finished' && iterations++ < 250) {
      const G = raw(client), id = Object.keys(G.players).find(id => legalBanquetActions(banquetPlayerView({ G, playerID: id }), id).length)!;
      const actions = legalBanquetActions(banquetPlayerView({ G, playerID: id }), id);
      const best = actions.find(a => a.move === 'announce' && ['empress', 'king', 'patron', 'princess'].includes(a.args[0] as string))
        ?? actions.find(a => a.move === 'respondClaim' && a.args[0] === false) ?? actions[0];
      expect(best).toBeDefined(); act(client, id, best.move, ...best.args);
    }
    expect(raw(client).status).toBe('finished'); expect(raw(client).winnerIDs.length).toBeGreaterThan(0);
  });
});
