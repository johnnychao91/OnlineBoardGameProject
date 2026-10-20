import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import type { Game, State } from 'boardgame.io';
import { StationGame, stationObserverView, stationPlayerView } from './game';
import type { CardKind, Composition, StationSetupData, StationState } from './game';
import { getGameDefinition, publicGameDefinitions } from '../registry';

function makeClient(numPlayers = 4, seed = 'station-test', game: Game<StationState> = StationGame) {
  // The non-networked reducer is the authoritative engine in these tests.
  // Only test helpers read its raw store; browser-facing getState applies playerView.
  return Client({ game: { ...game, seed }, numPlayers, playerID: '0', debug: false });
}
type TestClient = ReturnType<typeof makeClient>;

function raw(client: TestClient): StationState {
  return client.store.getState().G as StationState;
}

function act(client: TestClient, id: string, move: string, ...args: unknown[]) {
  client.updatePlayerID(id);
  client.moves[move](...args);
}

function readyAndStart(client: TestClient) {
  for (const id of Object.keys(raw(client).players)) act(client, id, 'setReady', true);
  act(client, '0', 'startGame');
  expect(raw(client).status).toBe('briefing');
}

function acknowledgeAll(client: TestClient) {
  for (const id of Object.keys(raw(client).players)) {
    if (!raw(client).players[id].acknowledged) act(client, id, 'acknowledge');
  }
  expect(raw(client).status).toBe('playing');
}

function counts(cards: CardKind[]): Composition {
  return cards.reduce((total, kind) => {
    total[kind] += 1;
    return total;
  }, { stable: 0, repair: 0, hazard: 0 });
}

function choose(client: TestClient, predicate: (kind: CardKind) => boolean) {
  const G = raw(client);
  for (const [targetID, cards] of Object.entries(G.secret!.cards)) {
    if (targetID === G.activePlayer) continue;
    const slot = cards.findIndex(predicate);
    if (slot >= 0) return { targetID, slot, kind: cards[slot] };
  }
  return undefined;
}

function revealChoice(client: TestClient, choice: ReturnType<typeof choose>) {
  if (!choice) throw new Error('Test could not find a legal target.');
  act(client, raw(client).activePlayer!, 'reveal', choice.targetID, choice.slot);
}

function assertConservation(G: StationState, n: number) {
  const remaining = Object.values(G.secret!.cards).flat();
  const all = counts([...remaining, ...G.log.map((entry) => entry.kind)]);
  expect(all).toEqual({ stable: 4 * n - 1, repair: n, hazard: 1 });
  expect(G.repairsFound).toBe(G.log.filter((entry) => entry.kind === 'repair').length);
  for (const [id, cards] of Object.entries(G.secret!.cards)) {
    expect(G.players[id].cardCount).toBe(cards.length);
    expect(G.private[id].composition).toEqual(counts(cards));
  }
}

beforeEach(() => {
  // Rejected adversarial moves deliberately trigger boardgame.io error logging.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('太空維修站設定與資訊邊界', () => {
  it.each([4, 5, 6, 7, 8])('HTTP 直接開始 %i 人局，分配結果與原準備流程一致', (n) => {
    const seed = `immediate-${n}`;
    const match = createMatch({
      game: { ...StationGame, seed }, numPlayers: n,
      setupData: { startImmediately: true }, unlisted: true,
    });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    const G = match.initialState.G as StationState;
    expect(G).toMatchObject({ status: 'briefing', round: 1, activePlayer: '0', repairsRequired: n });
    expect(Object.keys(G.players)).toHaveLength(n);
    expect(Object.keys(G.private)).toHaveLength(n);
    expect(Object.values(G.players).every((p) => p.ready && !p.acknowledged && p.cardCount === 5)).toBe(true);
    assertConservation(G, n);

    const legacy = makeClient(n, seed);
    readyAndStart(legacy);
    expect(G).toEqual(raw(legacy));
    const client = makeClient(n, seed);
    client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
    const before = structuredClone(raw(client));
    act(client, '0', 'startGame');
    act(client, '0', 'setReady', false);
    expect(raw(client)).toEqual(before);
    acknowledgeAll(client);
    revealChoice(client, choose(client, (kind) => kind === 'stable'));
    expect(raw(client).log).toHaveLength(1);
  });

  it('明確停用直接開始仍保留原等待室，無效設定會遭拒', () => {
    const match = createMatch({ game: StationGame, numPlayers: 4,
      setupData: { startImmediately: false }, unlisted: true });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    expect(match.initialState.G.status).toBe('lobby');
    expect(match.initialState.G.private).toEqual({});
    expect(match.initialState.G).not.toHaveProperty('secret');
    for (const setupData of [null, true, [], { startImmediately: 'true' }]) {
      expect(StationGame.validateSetupData!(setupData as StationSetupData, 4)).toBeTypeOf('string');
    }
  });

  it.each([4, 5, 6, 7, 8])('正確建立 %i 人局、牌組與隨機身份池', (n) => {
    const client = makeClient(n);
    expect(raw(client)).toMatchObject({ status: 'lobby', round: 0, private: {}, activePlayer: null });
    expect(raw(client)).not.toHaveProperty('secret');
    expect(Object.values(raw(client).players).every((p) => !p.ready && p.cardCount === 0)).toBe(true);
    readyAndStart(client);
    const G = raw(client);
    expect(G.repairsRequired).toBe(n);
    expect(Object.values(G.players).every((p) => p.cardCount === 5 && !p.acknowledged)).toBe(true);
    const roles = [...Object.values(G.private).map((p) => p.role), ...G.secret!.unusedRoles];
    expect(roles.filter((r) => r === 'engineer')).toHaveLength(n <= 5 ? 3 : n === 6 ? 4 : 5);
    expect(roles.filter((r) => r === 'saboteur')).toHaveLength(n <= 6 ? 2 : 3);
    expect(G.secret!.unusedRoles).toHaveLength(n === 4 || n === 7 ? 1 : 0);
    assertConservation(G, n);

    for (const id of Object.keys(G.players)) {
      client.updatePlayerID(id);
      const view = client.getState()!;
      expect(Object.keys(view.G.private)).toEqual([id]);
      expect(view.G.private[id]).toEqual(G.private[id]);
      expect(view.G).not.toHaveProperty('secret');
      expect(JSON.stringify(view)).not.toContain('unusedRoles');
      expect(JSON.stringify(view.plugins.random)).not.toContain('seed');
      expect(JSON.stringify(view.plugins.random)).not.toContain('prngstate');
      expect(view._undo).toEqual([]);
      expect(view._redo).toEqual([]);
      expect(Object.values(view.G.players).every((p) => !('revealedRole' in p))).toBe(true);
    }
    for (const playerID of [null, '99', '__proto__', 'constructor']) {
      const view = stationPlayerView({ G, playerID });
      expect(view.private).toEqual({});
      expect(view).not.toHaveProperty('secret');
    }
  });

  it('只發出組成統計，讀取或改動一份視圖不會改變真實牌序', () => {
    const client = makeClient();
    readyAndStart(client);
    const before = structuredClone(raw(client));
    const view = stationPlayerView({ G: raw(client), playerID: '0' });
    expect(Object.keys(view.private['0'])).toEqual(['role', 'composition']);
    view.private['0'].composition.hazard = 100;
    view.players['0'].ready = false;
    expect(raw(client)).toEqual(before);
  });

  it.each([0, 3, 9, 4.5])('拒絕不支援的人數 %s', (n) => {
    expect(StationGame.validateSetupData!(undefined, n)).toBeTypeOf('string');
  });
});

describe('旁觀、復盤與共用遊戲登錄介面', () => {
  it('盲看只含公開資訊，上帝視角僅包含參與者身份與暗牌且不暴露內部資料', () => {
    const client = makeClient();
    readyAndStart(client);
    const G = structuredClone(raw(client));
    const expectedPrivate = structuredClone(G.private);
    const expectedCards = structuredClone(G.secret!.cards);
    // Future server fields must not silently become part of either projection.
    Object.assign(G, { seed: 'internal-seed', plugins: { random: { secret: true } } });
    Object.assign(G.players['0'], { credentials: 'internal-credential' });
    Object.assign(G.private['0'], { seed: 'private-internal' });
    Object.assign(G.private['0'].composition, { credentials: 'nested-internal' });
    G.private.unseated = { role: 'saboteur', composition: { stable: 0, repair: 0, hazard: 1 } };
    G.secret!.cards.unseated = ['hazard'];
    Object.assign(G.secret!, { seed: 'secret-internal' });
    G.log.push(Object.assign({ round: 1, actorID: '0', targetID: '1', slot: 0, kind: 'stable' as const },
      { credentials: 'log-internal' }));
    const before = structuredClone(G);

    const blind = stationObserverView(G, 'blind');
    expect(blind).toEqual(stationPlayerView({ G, playerID: null }));
    expect(blind.private).toEqual({});
    expect(blind).not.toHaveProperty('secret');
    expect(stationObserverView(G, 'invalid' as 'blind')).toEqual(blind);

    const god = stationObserverView(G, 'god');
    expect(god.private).toEqual(expectedPrivate);
    expect(god.secret).toEqual({ cards: expectedCards });
    for (const view of [blind, god]) {
      expect(JSON.stringify(view)).not.toMatch(/seed|plugins|credentials|unusedRoles|unseated|internal/);
    }
    god.private['0'].composition.hazard = 99;
    god.secret!.cards['0'].pop();
    god.players['0'].ready = false;
    god.log[0].slot = 99;
    expect(G).toEqual(before);
  });

  it('尚未開始的上帝視角沒有虛構身份或暗牌', () => {
    const G = raw(makeClient());
    expect(stationObserverView(G, 'god')).toEqual(stationObserverView(G, 'blind'));
    expect(stationObserverView(G, 'god')).not.toHaveProperty('secret');
  });

  it('共用介面提供開始設定與觀戰投影，只在結束後產生獨立結果資料', () => {
    const definition = getGameDefinition('space-station')!;
    const client = makeClient();
    expect(definition.startSetupData(['0', '2', '3', '4'])).toEqual({
      startImmediately: true, participantIDs: ['0', '2', '3', '4'],
    });
    expect(definition.getOutcome(raw(client))).toBeNull();
    readyAndStart(client);
    expect(definition.getOutcome(raw(client))).toBeNull();
    expect(definition.observerView(raw(client), 'god')).toEqual(stationObserverView(raw(client), 'god'));
    acknowledgeAll(client);
    expect(definition.getOutcome(raw(client))).toBeNull();
    if (!choose(client, (kind) => kind === 'hazard')) {
      revealChoice(client, choose(client, (kind) => kind === 'stable'));
    }
    revealChoice(client, choose(client, (kind) => kind === 'hazard'));
    const before = structuredClone(raw(client));
    const outcome = definition.getOutcome(raw(client))!;
    expect(outcome).toEqual({ winner: 'saboteur', reason: 'hazard',
      roles: Object.fromEntries(Object.entries(before.private).map(([id, info]) => [id, info.role])),
    });
    expect(definition.getOutcome(stationObserverView(raw(client), 'blind'))).toEqual(outcome);
    outcome.roles['0'] = 'modified';
    expect(raw(client)).toEqual(before);
    expect(publicGameDefinitions()[0]).not.toHaveProperty('startSetupData');
    expect(publicGameDefinitions()[0]).not.toHaveProperty('observerView');
    expect(publicGameDefinitions()[0]).not.toHaveProperty('getOutcome');
  });
});

describe('操作驗證', () => {
  it('必須全員準備且只有房主能開始，不能提前揭牌', () => {
    const client = makeClient();
    const initial = structuredClone(raw(client));
    act(client, '0', 'startGame');
    act(client, '0', 'acknowledge');
    act(client, '0', 'reveal', '1', 0);
    act(client, '0', 'setReady', 'true');
    act(client, '99', 'setReady', true);
    expect(raw(client)).toEqual(initial);
    for (const id of ['0', '1', '2', '3']) act(client, id, 'setReady', true);
    const ready = structuredClone(raw(client));
    act(client, '1', 'startGame');
    expect(raw(client)).toEqual(ready);
    act(client, '0', 'startGame');
    const briefing = structuredClone(raw(client));
    act(client, '0', 'setReady', false);
    act(client, '0', 'startGame');
    act(client, '0', 'reveal', '1', 0);
    expect(raw(client)).toEqual(briefing);
    for (const id of ['0', '1', '2']) act(client, id, 'acknowledge');
    expect(raw(client).status).toBe('briefing');
    const partial = structuredClone(raw(client));
    act(client, '2', 'acknowledge');
    expect(raw(client)).toEqual(partial);
    act(client, '3', 'acknowledge');
    expect(raw(client).status).toBe('playing');
  });

  it('拒絕錯誤行動者、自己、非法座位與非法牌位置，合法揭牌只移除一張', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    const before = structuredClone(raw(client));
    act(client, '1', 'reveal', '2', 0);
    for (const target of ['0', '99', '__proto__', 'constructor', 1, null]) {
      act(client, '0', 'reveal', target, 0);
    }
    for (const slot of [-1, 5, 0.5, NaN, Infinity, '0', null]) {
      act(client, '0', 'reveal', '1', slot);
    }
    expect(raw(client)).toEqual(before);
    const choice = choose(client, (kind) => kind === 'stable')!;
    revealChoice(client, choice);
    expect(raw(client).log).toHaveLength(1);
    expect(raw(client).activePlayer).toBe(choice.targetID);
    expect(raw(client).players[choice.targetID].cardCount).toBe(4);
    expect(raw(client).log[0]).toEqual({ round: 1, actorID: '0', ...choice });
    const after = structuredClone(raw(client));
    act(client, '0', 'reveal', choice.targetID, choice.slot);
    expect(raw(client)).toEqual(after);
    assertConservation(raw(client), 4);
  });

  it('禁用撤銷與重做，也不提供任意階段事件', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    revealChoice(client, choose(client, (kind) => kind === 'stable'));
    const before = structuredClone(raw(client));
    client.undo();
    client.redo();
    expect(raw(client)).toEqual(before);
    expect(client.events).toEqual({});
    expect(client.store.getState()._undo).toEqual([]);
    expect(client.store.getState()._redo).toEqual([]);
  });

  it('手工偽造框架事件也不能結束遊戲或更動行動權', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    const before = structuredClone(client.store.getState());
    const events: Array<[string, unknown[]]> = [
      ['endGame', [{ winner: 'saboteur' }]],
      ['endTurn', [{ next: '2' }]],
      ['endPhase', []],
      ['setPhase', ['other']],
      ['endStage', []],
      ['setStage', ['other']],
      ['pass', []],
      ['setActivePlayers', [{ all: null, maxMoves: 1 }]],
      ['setActivePlayers', [{ value: { '2': null } }]],
    ];
    for (const [type, args] of events) {
      client.store.dispatch({ type: 'GAME_EVENT', payload: { type, args, playerID: '0' } });
      expect(client.store.getState().G).toEqual(before.G);
      const ctx = client.store.getState().ctx;
      expect({ turn: ctx.turn, phase: ctx.phase, currentPlayer: ctx.currentPlayer,
        activePlayers: ctx.activePlayers, gameover: ctx.gameover }).toEqual({
        turn: before.ctx.turn, phase: before.ctx.phase, currentPlayer: before.ctx.currentPlayer,
        activePlayers: before.ctx.activePlayers, gameover: before.ctx.gameover,
      });
    }
  });
});

describe('輪次與勝負', () => {
  it.each([4, 5, 6, 7, 8])('%i 人局四輪分牌守恆，第四輪超時才判干擾者勝', (n) => {
    const client = makeClient(n, `rounds-${n}`);
    readyAndStart(client);
    for (let round = 1; round <= 4; round += 1) {
      expect(raw(client).round).toBe(round);
      expect(raw(client).status).toBe('briefing');
      expect(Object.values(raw(client).players).every((p) => p.cardCount === 6 - round)).toBe(true);
      expect(Object.values(raw(client).players).every((p) => !p.acknowledged)).toBe(true);
      acknowledgeAll(client);
      for (let index = 0; index < n; index += 1) {
        const repairsFound = raw(client).repairsFound;
        const choice = choose(client, (kind) => kind === 'stable')
          ?? choose(client, (kind) => kind === 'repair' && repairsFound < n - 1);
        revealChoice(client, choice);
        assertConservation(raw(client), n);
        if (index < n - 1) expect(raw(client).status).toBe('playing');
        if (index === n - 1 && round < 4) {
          expect(raw(client).activePlayer).toBe(choice!.targetID);
          expect(raw(client).revealsThisRound).toBe(0);
        }
      }
    }
    expect(raw(client)).toMatchObject({
      status: 'finished', round: 4, revealsThisRound: n,
      winner: 'saboteur', winReason: 'round-limit', activePlayer: null,
    });
    expect(raw(client).log).toHaveLength(4 * n);
    expect(client.store.getState().ctx.gameover).toEqual({ winner: 'saboteur', reason: 'round-limit' });
  });

  it('揭開危機立即結束、公布身份，結束後不能操作或看暗牌', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    if (!choose(client, (kind) => kind === 'hazard')) {
      revealChoice(client, choose(client, (kind) => kind === 'stable'));
    }
    revealChoice(client, choose(client, (kind) => kind === 'hazard'));
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'saboteur', winReason: 'hazard' });
    for (const [id, player] of Object.entries(raw(client).players)) {
      expect(player.revealedRole).toBe(raw(client).private[id].role);
    }
    const before = structuredClone(raw(client));
    act(client, '0', 'reveal', '1', 0);
    act(client, '0', 'setReady', true);
    act(client, '0', 'startGame');
    act(client, '0', 'acknowledge');
    expect(raw(client)).toEqual(before);
    expect(client.getState()!.G).not.toHaveProperty('secret');
  });

  it.each([4, 5, 6, 7, 8])('%i 人局找完維修模組會立即獲勝', (n) => {
    const client = makeClient(n, `repair-win-${n}`);
    readyAndStart(client);
    for (let attempts = 0; raw(client).status !== 'finished' && attempts < 4 * n; attempts += 1) {
      if (raw(client).status === 'briefing') acknowledgeAll(client);
      revealChoice(client, choose(client, (kind) => kind === 'repair')
        ?? choose(client, (kind) => kind === 'stable'));
    }
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'engineer', winReason: 'all-repairs', repairsFound: n });
    expect(client.store.getState().ctx.gameover).toEqual({ winner: 'engineer', reason: 'all-repairs' });
    assertConservation(raw(client), n);
  });

  it('第四輪最後一次揭牌完成維修時，成功優先於超時', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    const state = structuredClone(client.store.getState()) as State<StationState>;
    // An explicit boundary fixture isolates the two simultaneous end conditions.
    state.G.round = 4;
    state.G.revealsThisRound = 3;
    state.G.repairsFound = 3;
    state.G.activePlayer = '0';
    state.G.secret!.cards['1'] = ['repair'];
    state.G.players['1'].cardCount = 1;
    state.G.private['1'].composition = { stable: 0, repair: 1, hazard: 0 };
    client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
    act(client, '0', 'reveal', '1', 0);
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'engineer', winReason: 'all-repairs', repairsFound: 4 });
  });
});
