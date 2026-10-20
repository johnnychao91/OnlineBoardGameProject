import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { CreateGameReducer, createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { CipherGame, cipherObserverView, cipherPlayerView, type CipherSetupData, type CipherState } from './game';

function makeClient(n = 2, ids?: string[], seed = 'cipher-test') {
  const game = { ...CipherGame, seed };
  const client = Client({ game, numPlayers: n, playerID: ids?.[0] ?? '0', debug: false });
  const match = createMatch({
    game, numPlayers: n, setupData: { startImmediately: true, participantIDs: ids }, unlisted: true,
  });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  return client;
}
type TestClient = ReturnType<typeof makeClient>;
function raw(client: TestClient): CipherState {
  return client.store.getState().G as CipherState;
}
function act(client: TestClient, id: string, move: string, ...args: unknown[]) {
  client.updatePlayerID(id);
  client.moves[move](...args);
}
function token(client: TestClient): [number, number] {
  return [raw(client).level, raw(client).epoch];
}
function syncAll(client: TestClient) {
  const args = token(client);
  expect(raw(client).status).toBe('syncing');
  for (const id of Object.keys(raw(client).players)) act(client, id, 'readySync', ...args);
  expect(raw(client).status).toBe('playing');
}
function nextLevel(client: TestClient) {
  expect(raw(client).status).toBe('intermission');
  const args = token(client);
  for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledgeLevel', ...args);
  expect(raw(client).status).toBe('syncing');
}
function lowest(client: TestClient) {
  return Object.entries(raw(client).private)
    .filter(([, info]) => info.cards.length)
    .map(([id, info]) => ({ id, card: info.cards[0] }))
    .sort((a, b) => a.card - b.card)[0];
}
function fixture(client: TestClient, hands: Record<string, number[]>, patch: Partial<CipherState> = {}) {
  const state = structuredClone(client.store.getState()) as State<CipherState>;
  Object.assign(state.G, {
    status: 'playing', level: 2, epoch: state.G.epoch + 1, transmitted: [], discarded: [], log: [],
  }, patch);
  for (const [id, cards] of Object.entries(hands)) {
    state.G.private[id].cards = [...cards];
    state.G.players[id].cardCount = cards.length;
  }
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function transmitAll(client: TestClient) {
  while (raw(client).status === 'playing') {
    const next = lowest(client);
    if (!next) throw new Error('Playing state must have outstanding cards.');
    act(client, next.id, 'playCard', next.card, ...token(client));
  }
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('加密通話設定與完整通關', () => {
  it.each([[2, 12], [3, 10], [4, 8]])('%i 人依序通過 %i 關，正確發牌、補給與結算', (n, targetLevel) => {
    const client = makeClient(n);
    expect(raw(client)).toMatchObject({ status: 'syncing', level: 1, targetLevel, cover: n, pulses: 1 });
    for (let level = 1; level <= targetLevel; level += 1) {
      const G = raw(client);
      const cards = Object.values(G.private).flatMap((info) => info.cards);
      expect(cards).toHaveLength(n * level);
      expect(new Set(cards).size).toBe(cards.length);
      expect(cards.every((card) => card >= 1 && card <= 100)).toBe(true);
      expect(G.transmitted).toEqual([]);
      expect(G.discarded).toEqual([]);
      for (const [id, info] of Object.entries(G.private)) {
        expect(info.cards).toEqual([...info.cards].sort((a, b) => a - b));
        expect(G.players[id].cardCount).toBe(level);
      }
      syncAll(client);
      transmitAll(client);
      expect(raw(client).transmitted).toEqual([...cards].sort((a, b) => a - b));
      expect(Object.values(raw(client).players).every((player) => player.cardCount === 0)).toBe(true);
      expect(raw(client).cover).toBe(Math.min(6, n + [3, 6, 9].filter((reward) => reward <= level).length));
      expect(raw(client).pulses).toBe(Math.min(3, 1 + [2, 5, 8].filter((reward) => reward <= level).length));
      if (level < targetLevel) nextLevel(client);
    }
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'agents', winReason: 'all-levels' });
    expect(client.store.getState().ctx.gameover).toEqual({ winner: 'agents', reason: 'all-levels' });
    expect(raw(client).log.filter((event) => event.type === 'level-complete')).toHaveLength(targetLevel);
  });

  it('等待室只能由第一個實際席位於全員準備後開始', () => {
    const client = Client({ game: CipherGame, numPlayers: 2, playerID: '0', debug: false });
    act(client, '0', 'startGame');
    expect(raw(client).status).toBe('lobby');
    act(client, '0', 'setReady', true);
    act(client, '1', 'startGame');
    expect(raw(client).status).toBe('lobby');
    act(client, '1', 'setReady', true);
    act(client, '0', 'startGame');
    expect(raw(client).status).toBe('syncing');
    const before = structuredClone(raw(client));
    act(client, '0', 'setReady', false);
    act(client, '0', 'startGame');
    expect(raw(client)).toEqual(before);
  });

  it('保留非連續席位且不依賴座位 0，未入座者不能行動', () => {
    const client = makeClient(2, ['1', '3']);
    expect(Object.keys(raw(client).players)).toEqual(['1', '3']);
    expect(client.store.getState().ctx.currentPlayer).toBe('1');
    const before = structuredClone(raw(client));
    act(client, '0', 'readySync', ...token(client));
    expect(raw(client)).toEqual(before);
    syncAll(client);
    transmitAll(client);
    nextLevel(client);
    expect(raw(client).level).toBe(2);
  });

  it.each([0, 1, 5, 8, 2.5, NaN])('拒絕無效人數 %s', (n) => {
    expect(CipherGame.validateSetupData!(undefined, n)).toBeTypeOf('string');
  });

  it('拒絕錯誤開始資料、重複席位、越界與原型名稱', () => {
    for (const setup of [null, [], true, { startImmediately: 'true' },
      { participantIDs: ['0'] }, { participantIDs: ['0', '0'] },
      { participantIDs: ['0', '4'] }, { participantIDs: ['__proto__', '1'] },
      { participantIDs: [0, 1] }]) {
      expect(CipherGame.validateSetupData!(setup as CipherSetupData, 2)).toBeTypeOf('string');
      const match = createMatch({ game: CipherGame, numPlayers: 2, setupData: setup, unlisted: true });
      expect(match).toHaveProperty('setupDataError');
      expect(match).not.toHaveProperty('initialState');
    }
  });
});

describe('傳送、追蹤與再次同步', () => {
  it('只能傳送自己的最小牌，不能跳牌、代打或傳送錯誤型別', () => {
    const client = makeClient();
    fixture(client, { '0': [10, 30], '1': [20, 40] });
    const before = structuredClone(raw(client));
    for (const card of [30, 20, 0, 101, 1.5, '10', null, {}, NaN]) {
      act(client, '0', 'playCard', card, ...token(client));
      expect(raw(client)).toEqual(before);
    }
    act(client, '0', 'playCard', 10, ...token(client));
    expect(raw(client).transmitted).toEqual([10]);
    expect(raw(client).private['0'].cards).toEqual([30]);
  });

  it('一次失誤丟掉所有較小未出牌，無論張數只扣一點掩護並要求同步', () => {
    const client = makeClient(4);
    fixture(client, { '0': [30, 80], '1': [1, 10, 90], '2': [2, 20, 99], '3': [50, 70] });
    const oldToken = token(client);
    act(client, '0', 'playCard', 30, ...oldToken);
    expect(raw(client)).toMatchObject({ status: 'syncing', cover: 3, transmitted: [30] });
    expect(raw(client).discarded).toEqual([
      { playerID: '1', card: 1 }, { playerID: '2', card: 2 },
      { playerID: '1', card: 10 }, { playerID: '2', card: 20 },
    ]);
    expect(raw(client).private['1'].cards).toEqual([90]);
    expect(raw(client).private['2'].cards).toEqual([99]);
    expect(raw(client).log.filter((event) => event.type === 'breach')).toHaveLength(1);
    const before = structuredClone(raw(client));
    act(client, '3', 'playCard', 50, ...oldToken);
    expect(raw(client)).toEqual(before);
    syncAll(client);
    act(client, '3', 'playCard', 50, ...token(client));
    expect(raw(client).transmitted).toEqual([30, 50]);
  });

  it('零掩護立即失敗，即使最後一張牌同時清關也無法領補給', () => {
    const client = makeClient();
    fixture(client, { '0': [20], '1': [10] }, { cover: 1, level: 3 });
    act(client, '0', 'playCard', 20, ...token(client));
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'intercepted', winReason: 'cover-blown', cover: 0 });
    expect(raw(client).log.some((event) => event.type === 'level-complete')).toBe(false);
  });

  it('失誤後仍有掩護，清完本關即可領補給並進入關卡結算', () => {
    const client = makeClient();
    fixture(client, { '0': [20], '1': [10] }, { cover: 2, level: 3 });
    act(client, '0', 'playCard', 20, ...token(client));
    expect(raw(client)).toMatchObject({ status: 'intermission', cover: 2, level: 3 });
    const before = structuredClone(raw(client));
    act(client, '0', 'playCard', 20, ...token(client));
    expect(raw(client)).toEqual(before);
  });

  it('任何人可暫停同步；舊確認、舊牌與前關操作不能穿越同步邊界', () => {
    const client = makeClient();
    fixture(client, { '0': [10, 30], '1': [20, 40] });
    const old = token(client);
    act(client, '1', 'requestSync', ...old);
    expect(raw(client).status).toBe('syncing');
    const before = structuredClone(raw(client));
    act(client, '0', 'readySync', ...old);
    act(client, '0', 'playCard', 10, ...old);
    expect(raw(client)).toEqual(before);
    const syncToken = token(client);
    act(client, '0', 'readySync', ...syncToken);
    const once = structuredClone(raw(client));
    act(client, '0', 'readySync', ...syncToken);
    expect(raw(client)).toEqual(once);
    act(client, '1', 'readySync', ...syncToken);
    expect(raw(client).status).toBe('playing');
    act(client, '0', 'playCard', 10, ...old);
    expect(raw(client).transmitted).toEqual([]);
    act(client, '0', 'playCard', 10, ...token(client));
    const after = structuredClone(raw(client));
    act(client, '1', 'playCard', 20, raw(client).level - 1, raw(client).epoch);
    expect(raw(client)).toEqual(after);
  });

  it('同一 epoch 依伺服器接收順序處理相鄰玩家出牌，重送不會再出下一張', () => {
    const client = makeClient();
    fixture(client, { '0': [10, 30], '1': [20, 40] });
    const args = token(client);
    act(client, '0', 'playCard', 10, ...args);
    act(client, '1', 'playCard', 20, ...args);
    expect(raw(client).transmitted).toEqual([10, 20]);
    const before = structuredClone(raw(client));
    act(client, '0', 'playCard', 10, ...args);
    act(client, '1', 'playCard', 20, ...args);
    expect(raw(client)).toEqual(before);
    act(client, '0', 'playCard', 30, ...args);
    expect(raw(client).transmitted).toEqual([10, 20, 30]);
  });

  it('關卡結算需全員確認，重複與前關確認不能誤啟下一關', () => {
    const client = makeClient();
    fixture(client, { '0': [10], '1': [20] });
    transmitAll(client);
    const previous = token(client);
    act(client, '0', 'acknowledgeLevel', ...previous);
    const once = structuredClone(raw(client));
    act(client, '0', 'acknowledgeLevel', ...previous);
    expect(raw(client)).toEqual(once);
    act(client, '1', 'acknowledgeLevel', ...previous);
    expect(raw(client)).toMatchObject({ level: 3, status: 'syncing' });
    const next = structuredClone(raw(client));
    act(client, '1', 'acknowledgeLevel', ...previous);
    act(client, '1', 'readySync', ...previous);
    expect(raw(client)).toEqual(next);
  });

  it('先收到高牌則以一次失誤結算，稍後低牌封包不會再次扣掩護', () => {
    const client = makeClient();
    fixture(client, { '0': [10, 30], '1': [20, 40] });
    const args = token(client);
    act(client, '1', 'playCard', 20, ...args);
    const before = structuredClone(raw(client));
    act(client, '0', 'playCard', 10, ...args);
    expect(raw(client)).toEqual(before);
    expect(raw(client)).toMatchObject({ status: 'syncing', cover: 1, transmitted: [20] });
  });
});

describe('靜默脈衝', () => {
  it('全員含空手者須同意；等待決議時禁止出牌、重複提案或再次投票', () => {
    const client = makeClient(3);
    fixture(client, { '0': [10, 11], '1': [50, 90], '2': [] });
    act(client, '0', 'proposePulse', ...token(client));
    expect(raw(client).pulse?.votes).toEqual({ '0': true, '1': null, '2': null });
    const proposalToken = token(client);
    const before = structuredClone(raw(client));
    act(client, '0', 'playCard', 10, ...proposalToken);
    act(client, '1', 'proposePulse', ...proposalToken);
    act(client, '0', 'votePulse', true, ...proposalToken);
    expect(raw(client)).toEqual(before);
    act(client, '1', 'votePulse', true, ...proposalToken);
    expect(raw(client)).toMatchObject({ status: 'pulse', pulses: 1 });
    act(client, '2', 'votePulse', true, ...proposalToken);
    expect(raw(client)).toMatchObject({ status: 'syncing', pulses: 0, cover: 3, transmitted: [] });
    expect(raw(client).private).toEqual({ '0': { cards: [11] }, '1': { cards: [90] }, '2': { cards: [] } });
    expect(raw(client).discarded).toEqual([{ playerID: '0', card: 10 }, { playerID: '1', card: 50 }]);
    // Discarding a high card through a pulse does not make lower remaining cards a mistake.
    syncAll(client);
    act(client, '0', 'playCard', 11, ...token(client));
    expect(raw(client)).toMatchObject({ cover: 3, transmitted: [11] });
  });

  it('任何人拒絕即取消，不消耗道具或卡片，舊投票不能套用到下次提案', () => {
    const client = makeClient(3);
    fixture(client, { '0': [10], '1': [20], '2': [30] });
    act(client, '0', 'proposePulse', ...token(client));
    const previous = token(client);
    act(client, '1', 'votePulse', false, ...previous);
    expect(raw(client)).toMatchObject({ status: 'syncing', pulses: 1, discarded: [], pulse: null });
    syncAll(client);
    act(client, '0', 'proposePulse', ...token(client));
    const before = structuredClone(raw(client));
    act(client, '2', 'votePulse', true, ...previous);
    act(client, '2', 'votePulse', 'true', ...token(client));
    expect(raw(client)).toEqual(before);
  });

  it('沒有道具時不能發起提案；脈衝可清關並領回本關補給', () => {
    const empty = makeClient();
    fixture(empty, { '0': [10], '1': [20] }, { pulses: 0 });
    const before = structuredClone(raw(empty));
    act(empty, '0', 'proposePulse', ...token(empty));
    expect(raw(empty)).toEqual(before);
    const client = makeClient();
    fixture(client, { '0': [10], '1': [20] }, { pulses: 1, level: 2 });
    act(client, '0', 'proposePulse', ...token(client));
    act(client, '1', 'votePulse', true, ...token(client));
    expect(raw(client)).toMatchObject({ status: 'intermission', pulses: 1, cover: 2 });
  });

  it('脈衝可完成最終關，且事後重送不會重複消耗或補給', () => {
    const client = makeClient(4);
    fixture(client, { '0': [10], '1': [20], '2': [30], '3': [40] }, { level: 8, pulses: 1 });
    act(client, '0', 'proposePulse', ...token(client));
    const args = token(client);
    for (const id of ['1', '2', '3']) act(client, id, 'votePulse', true, ...args);
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'agents', pulses: 1 });
    const before = structuredClone(raw(client));
    act(client, '3', 'votePulse', true, ...args);
    expect(raw(client)).toEqual(before);
  });
});

describe('私密資訊、多人房間隔離與框架防護', () => {
  it('玩家只見自己手牌；上帝視角只含已發牌，所有視圖均移除隱藏擴充資料', () => {
    const client = makeClient(3);
    const G = structuredClone(raw(client));
    const expectedPrivate = structuredClone(G.private);
    Object.assign(G, { seed: 'hidden-seed', deck: [100, 99], credentials: 'hidden-token' });
    Object.assign(G.players['0'], { secret: 'hidden-player' });
    Object.assign(G.private['0'], { secret: 'hidden-private' });
    G.private.unseated = { cards: [100] };
    G.log.push(Object.assign({ type: 'transmit' as const, level: 1, actorID: '0', card: 25 }, { secret: 'hidden-log' }));
    const before = structuredClone(G);
    const own = cipherPlayerView({ G, playerID: '0' });
    expect(own.private).toEqual({ '0': expectedPrivate['0'] });
    for (const id of [null, '99', '__proto__', 'constructor']) {
      expect(cipherPlayerView({ G, playerID: id }).private).toEqual({});
    }
    const blind = cipherObserverView(G, 'blind');
    const god = cipherObserverView(G, 'god');
    expect(blind.private).toEqual({});
    expect(god.private).toEqual(expectedPrivate);
    expect(cipherObserverView(G, 'invalid' as 'blind')).toEqual(blind);
    for (const view of [own, blind, god]) expect(JSON.stringify(view)).not.toMatch(/hidden|seed|deck|credentials|secret|unseated/);
    own.private['0'].cards.pop();
    god.private['1'].cards.push(100);
    god.players['0'].cardCount = 100;
    god.log[0].card = 99;
    expect(G).toEqual(before);
    expect(client.getState()!.plugins.random).not.toHaveProperty('seed');
    expect(JSON.stringify(client.getState()!.plugins.random)).not.toContain('prngstate');
  });

  it('結束後盲視角也不曝光剩餘手牌；未公開牌不能透過撤銷復原', () => {
    const client = makeClient();
    fixture(client, { '0': [20, 80], '1': [10, 90] }, { cover: 1 });
    act(client, '0', 'playCard', 20, ...token(client));
    expect(cipherObserverView(raw(client), 'blind').private).toEqual({});
    expect(cipherObserverView(raw(client), 'god').private).toEqual({ '0': { cards: [80] }, '1': { cards: [90] } });
    expect(client.store.getState()._undo).toEqual([]);
    expect(client.store.getState()._redo).toEqual([]);
    const before = structuredClone(raw(client));
    client.undo();
    expect(raw(client)).toEqual(before);
  });

  it('兩個同時遊玩的房間不共享手牌、同步確認、資源或記錄', () => {
    const a = makeClient(2, undefined, 'room-a');
    const b = makeClient(3, undefined, 'room-b');
    const bBefore = structuredClone(raw(b));
    syncAll(a);
    transmitAll(a);
    nextLevel(a);
    expect(raw(b)).toEqual(bBefore);
    const aBefore = structuredClone(raw(a));
    syncAll(b);
    act(b, '1', 'requestSync', ...token(b));
    expect(raw(a)).toEqual(aBefore);
  });

  it('所有含手牌操作使用刪隱記錄，並對同時行動保留獨立驗證', () => {
    for (const name of ['readySync', 'playCard', 'requestSync', 'proposePulse', 'votePulse', 'acknowledgeLevel']) {
      expect(CipherGame.moves![name]).toMatchObject({
        redact: true, undoable: false, client: false, ignoreStaleStateID: true,
      });
    }
  });

  it('客戶端只持有自己手牌時也不會預先裁定出牌成功或失敗', () => {
    const client = makeClient();
    fixture(client, { '0': [20, 80], '1': [10, 90] });
    const server = structuredClone(client.store.getState());
    const projected = {
      ...server,
      G: cipherPlayerView({ G: server.G as CipherState, playerID: '0' }),
      plugins: { random: { data: {} } },
    };
    const reducer = CreateGameReducer({ game: CipherGame, isClient: true });
    const result = reducer(projected, {
      type: 'MAKE_MOVE',
      payload: { type: 'playCard', args: [20, ...token(client)], playerID: '0' },
    });
    expect(result.G).toEqual(projected.G);
    expect(result.ctx).toEqual(projected.ctx);
    expect(result._stateID).toBe(projected._stateID);
    act(client, '0', 'playCard', 20, ...token(client));
    expect(raw(client)).toMatchObject({ cover: 1, status: 'syncing', transmitted: [20] });
  });

  it.each([
    ['endGame', [{ winner: 'agents' }]], ['endTurn', []], ['endPhase', []],
    ['setPhase', ['hacked']], ['setStage', ['hacked']], ['endStage', []],
    ['setActivePlayers', [{ currentPlayer: 'hacked' }]], ['pass', []],
  ])('拒絕繞過規則的框架事件 %s', (type, args) => {
    const client = makeClient();
    const before = structuredClone(client.store.getState());
    client.store.dispatch({ type: 'GAME_EVENT', payload: { type, args, playerID: '0' } });
    expect(raw(client)).toEqual(before.G);
    expect(client.store.getState().ctx).toEqual(before.ctx);
  });
});
