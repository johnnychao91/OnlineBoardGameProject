import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import type { Game, State } from 'boardgame.io';
import { StationGame, stationObserverView, stationPlayerView } from './game';
import type { CardKind, Composition, StationSetupData, StationState } from './game';
import { getGameDefinition, publicGameDefinitions } from '../registry';
import { getCardSlots, repairClaimMaximum } from './view-model';

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
  if ((raw(client).rulesVersion === 2 || raw(client).rulesVersion === 3)) {
    expect(raw(client).status).toBe('claiming');
    for (const id of Object.keys(raw(client).players)) act(client, id, 'declareRepairs', 0, raw(client).round);
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
    const slot = cards.findIndex((kind, index) =>
      ((G.rulesVersion !== 2 && G.rulesVersion !== 3) || G.publicCards?.[targetID]?.[index] === null) && predicate(kind));
    if (slot >= 0) return { targetID, slot, kind: cards[slot] };
  }
  return undefined;
}

function revealChoice(client: TestClient, choice: ReturnType<typeof choose>) {
  if (!choice) throw new Error('Test could not find a legal target.');
  const actorID = raw(client).activePlayer!;
  if ((raw(client).rulesVersion === 2 || raw(client).rulesVersion === 3)) {
    act(client, actorID, 'selectCard', choice.targetID, choice.slot);
    act(client, actorID, 'reveal', choice.targetID, choice.slot, raw(client).pendingReveal?.selectionID);
  } else {
    act(client, actorID, 'reveal', choice.targetID, choice.slot);
  }
}

function assertConservation(G: StationState, n: number) {
  const unexposed = Object.fromEntries(Object.entries(G.secret!.cards).map(([id, cards]) => [
    id, (G.rulesVersion === 2 || G.rulesVersion === 3) ? cards.filter((_, slot) => G.publicCards?.[id]?.[slot] === null) : cards,
  ]));
  const remaining = Object.values(unexposed).flat();
  const all = counts([...remaining, ...G.log.map((entry) => entry.kind)]);
  expect(all).toEqual({ stable: 4 * n - 1, repair: n, hazard: 1 });
  expect(G.repairsFound).toBe(G.log.filter((entry) => entry.kind === 'repair').length);
  for (const [id, cards] of Object.entries(unexposed)) {
    expect(G.players[id].cardCount).toBe(cards.length);
    expect(G.private[id].composition).toEqual(counts(cards));
  }
}

/** Simulates loading a persisted match written before the new rules existed. */
function restoreLegacy(client: TestClient) {
  const state = structuredClone(client.store.getState()) as State<StationState>;
  delete state.G.rulesVersion;
  delete state.G.publicCards;
  delete state.G.pendingReveal;
  delete state.G.selectionSequence;
  for (const player of Object.values(state.G.players)) {
    delete player.claim;
    delete player.reviewAcknowledged;
  }
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}

/** Persisted V2 matches must keep automatic round transitions. */
function restoreV2(client: TestClient) {
  const state = structuredClone(client.store.getState()) as State<StationState>;
  state.G.rulesVersion = 2;
  for (const player of Object.values(state.G.players)) delete player.reviewAcknowledged;
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}

function reviewAll(client: TestClient) {
  expect(raw(client).status).toBe('round-review');
  const round = raw(client).round;
  for (const id of Object.keys(raw(client).players)) {
    if (!raw(client).players[id].reviewAcknowledged) act(client, id, 'acknowledgeRound', round);
  }
  expect(raw(client)).toMatchObject({ status: 'briefing', round: round + 1 });
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
    expect(G).toMatchObject({ status: 'briefing', round: 1, repairsRequired: n });
    expect(Object.keys(G.players)).toContain(G.activePlayer);
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

  it('原房主離席後，以實際入座者開始新局，不依賴座位 0', () => {
    const match = createMatch({
      game: { ...StationGame, seed: 'rematch-without-zero' }, numPlayers: 4,
      setupData: { startImmediately: true, participantIDs: ['1', '3', '4', '7'] },
      unlisted: true,
    });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    const client = makeClient();
    client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
    expect(Object.keys(raw(client).players)).toEqual(['1', '3', '4', '7']);
    expect(['1', '3', '4', '7']).toContain(raw(client).activePlayer);
    acknowledgeAll(client);
    revealChoice(client, choose(client, kind => kind === 'stable'));
    expect(raw(client).log).toHaveLength(1);
    assertConservation(raw(client), 4);
    for (const ids of [['1', '1', '3', '4'], ['1', '3', '4', '8'], ['1', '3', '4']]) {
      expect(StationGame.validateSetupData!({ startImmediately: true, participantIDs: ids }, 4)).toBeTypeOf('string');
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

describe('首位檢修員的伺服器抽選', () => {
  function started(seed: string, participantIDs: string[]) {
    const match = createMatch({
      game: { ...StationGame, seed }, numPlayers: participantIDs.length,
      setupData: { startImmediately: true, participantIDs }, unlisted: true,
    });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    return match.initialState as State<StationState>;
  }

  it.each([4, 5, 6, 7, 8])('%i 人局依種子可重現，跨多個種子會抽到不同參與者', (n) => {
    const ids = Array.from({ length: n }, (_, index) => String(index));
    const openers = new Set<string>();
    for (let index = 0; index < 32; index += 1) {
      const first = started(`opening-${n}-${index}`, ids);
      const repeated = started(`opening-${n}-${index}`, ids);
      expect(first.G).toEqual(repeated.G);
      expect(first.plugins.random).toEqual(repeated.plugins.random);
      expect(ids).toContain(first.G.activePlayer);
      openers.add(first.G.activePlayer!);
    }
    expect(openers.size).toBeGreaterThan(1);
    expect([...openers].some(id => id !== ids[0])).toBe(true);
  });

  it('有空席時只抽實際參與者，房主原座位與未加入的席位都不會被抽到', () => {
    const participants = ['1', '3', '4', '7'];
    const openers = new Set<string>();
    for (let index = 0; index < 32; index += 1) {
      const state = started(`sparse-opening-${index}`, participants);
      expect(participants).toContain(state.G.activePlayer);
      expect(['0', '2', '5', '6']).not.toContain(state.G.activePlayer);
      openers.add(state.G.activePlayer!);
    }
    expect(openers.size).toBeGreaterThan(1);
    expect(participants).toEqual(['1', '3', '4', '7']);
  });

  it('已開局存檔重載不重抽，下一輪延續上一輪最後被檢修者', () => {
    const initial = started('restore-random-opener', ['1', '3', '4', '7']);
    const client = makeClient();
    const persisted = JSON.parse(JSON.stringify(initial)) as State<StationState>;
    client.store.dispatch({ type: 'UPDATE', state: persisted, deltalog: [], clientOnly: true });
    const saved = structuredClone(client.store.getState());
    expect(raw(client).activePlayer).toBe(initial.G.activePlayer);
    act(client, initial.G.activePlayer!, 'startGame');
    expect(client.store.getState().G).toEqual(saved.G);
    expect(client.store.getState().plugins.random.data).toEqual(saved.plugins.random.data);
    acknowledgeAll(client);
    for (let i = 0; i < 4; i += 1) revealChoice(client, choose(client, kind => kind === 'stable'));
    const lastTarget = raw(client).log.at(-1)!.targetID;
    expect(raw(client).activePlayer).toBe(lastTarget);
    reviewAll(client);
    expect(raw(client).activePlayer).toBe(lastTarget);
    acknowledgeAll(client);
    expect(raw(client).activePlayer).toBe(lastTarget);
  });

  it.each(['legacy', 'v2'] as const)('%s 待開局存檔沿用原首位玩家，不更改歷史規則', (version) => {
    const client = makeClient(4, `old-opening-${version}`);
    if (version === 'legacy') restoreLegacy(client); else restoreV2(client);
    readyAndStart(client);
    expect(raw(client).activePlayer).toBe('0');
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
    expect(raw(client).status).toBe('claiming');
    for (const id of ['0', '1', '2', '3']) act(client, id, 'declareRepairs', 0, raw(client).round);
    expect(raw(client).status).toBe('playing');
  });

  it('拒絕錯誤行動者、自己、非法座位與非法牌位置，合法揭牌保留原位', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    const before = structuredClone(raw(client));
    const actorID = before.activePlayer!;
    const others = Object.keys(before.players).filter(id => id !== actorID);
    act(client, others[0], 'reveal', others[1], 0);
    for (const target of [actorID, '99', '__proto__', 'constructor', 1, null]) {
      act(client, actorID, 'reveal', target, 0);
    }
    for (const slot of [-1, 5, 0.5, NaN, Infinity, '0', null]) {
      act(client, actorID, 'reveal', others[0], slot);
    }
    expect(raw(client)).toEqual(before);
    const choice = choose(client, (kind) => kind === 'stable')!;
    revealChoice(client, choice);
    expect(raw(client).log).toHaveLength(1);
    expect(raw(client).activePlayer).toBe(choice.targetID);
    expect(raw(client).players[choice.targetID].cardCount).toBe(4);
    expect(raw(client).secret!.cards[choice.targetID]).toEqual(before.secret!.cards[choice.targetID]);
    expect(raw(client).publicCards![choice.targetID]).toHaveLength(5);
    expect(raw(client).publicCards![choice.targetID][choice.slot]).toBe(choice.kind);
    expect(raw(client).log[0]).toEqual({ round: 1, actorID, ...choice });
    const after = structuredClone(raw(client));
    act(client, actorID, 'reveal', choice.targetID, choice.slot);
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

describe('每輪公開宣稱與兩階段剪線', () => {
  it.each([4, 5, 6, 7, 8])('%i 人必須全部確認並宣稱後才能選牌，宣稱可以說謊', (n) => {
    const client = makeClient(n, `claim-${n}`);
    readyAndStart(client);
    expect(raw(client).rulesVersion).toBe(3);
    const briefing = structuredClone(raw(client));
    act(client, '0', 'declareRepairs', 0, raw(client).round);
    act(client, '0', 'selectCard', '1', 0);
    expect(raw(client)).toEqual(briefing);
    for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge');
    expect(raw(client).status).toBe('claiming');
    for (const id of Object.keys(raw(client).players)) {
      const before = structuredClone(raw(client));
      act(client, raw(client).activePlayer!, 'selectCard', '1', 0);
      act(client, raw(client).activePlayer!, 'reveal', '1', 0, 1);
      expect(raw(client)).toEqual(before);
      // Every statement differs from the actual private repair-card count.
      const claim = (raw(client).private[id].composition.repair + 1) % (repairClaimMaximum(raw(client), id) + 1);
      act(client, id, 'declareRepairs', claim, raw(client).round);
      expect(raw(client).players[id].claim).toBe(claim);
      expect(stationObserverView(raw(client), 'blind').players[id].claim).toBe(claim);
      const after = structuredClone(raw(client));
      act(client, id, 'declareRepairs', (claim + 1) % (repairClaimMaximum(raw(client), id) + 1), raw(client).round);
      expect(raw(client)).toEqual(after);
    }
    expect(raw(client).status).toBe('playing');
    revealChoice(client, choose(client, (kind) => kind === 'stable'));
    expect(raw(client).log).toHaveLength(1);
  });

  it('宣稱拒絕錯誤席位、非整數、負數與超過全場剩餘數，接受 0 與上限', () => {
    const client = makeClient();
    readyAndStart(client);
    for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge');
    const before = structuredClone(raw(client));
    for (const value of [-1, 5, 6, 1.5, '2', null, undefined, NaN, Infinity, {}, true]) {
      act(client, '0', 'declareRepairs', value, raw(client).round);
    }
    for (const id of ['99', '__proto__', 'constructor']) act(client, id, 'declareRepairs', 0, raw(client).round);
    expect(raw(client)).toEqual(before);
    act(client, '0', 'declareRepairs', 0, raw(client).round);
    act(client, '1', 'declareRepairs', 4, raw(client).round);
    expect(raw(client).players['0'].claim).toBe(0);
    expect(raw(client).players['1'].claim).toBe(4);
    expect(raw(client).status).toBe('claiming');
  });

  it('宣稱必須帶有效當輪編號，沒有編號或其他輪次不會消耗提交機會', () => {
    const client = makeClient();
    readyAndStart(client);
    for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge');
    const before = structuredClone(raw(client));
    for (const round of [undefined, null, '1', 0, 2, -1, 1.5, NaN, Infinity, {}, true]) {
      act(client, '0', 'declareRepairs', 0, round);
    }
    expect(raw(client)).toEqual(before);
    act(client, '0', 'declareRepairs', 0, 1);
    expect(raw(client).players['0'].claim).toBe(0);
  });

  it.each([2, 3] as const)('V%i 以全場未揭開維修數限制宣稱，仍允許各人獨立說謊', (version) => {
    const client = makeClient(4, `remaining-claim-${version}`);
    if (version === 2) restoreV2(client);
    readyAndStart(client);
    // A conserved first-round deck guarantees exactly three repair reveals
    // before the next claim phase, independent of shuffled test identities.
    const prepared = structuredClone(client.store.getState()) as State<StationState>;
    for (const id of Object.keys(prepared.G.players)) {
      prepared.G.secret!.cards[id] = ['repair', 'stable', 'stable', 'stable', id === '3' ? 'hazard' : 'stable'];
      prepared.G.private[id].composition = counts(prepared.G.secret!.cards[id]);
    }
    client.store.dispatch({ type: 'UPDATE', state: prepared, deltalog: [], clientOnly: true });
    acknowledgeAll(client);
    for (const targetID of Object.keys(prepared.G.players).filter(id => id !== prepared.G.activePlayer)) {
      revealChoice(client, { targetID, slot: 0, kind: 'repair' });
    }
    revealChoice(client, { targetID: prepared.G.activePlayer!, slot: 1, kind: 'stable' });
    if (version === 3) reviewAll(client);
    for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge');
    const claiming = structuredClone(raw(client));
    expect(claiming).toMatchObject({ status: 'claiming', round: 2, repairsRequired: 4, repairsFound: 3 });
    expect(Object.values(claiming.players).every(player => player.cardCount === 4)).toBe(true);
    for (const id of Object.keys(claiming.players)) {
      act(client, id, 'declareRepairs', 2, 2);
      act(client, id, 'declareRepairs', 4, 2);
    }
    expect(raw(client)).toEqual(claiming);
    for (const id of Object.keys(claiming.players)) act(client, id, 'declareRepairs', 1, 2);
    expect(raw(client).status).toBe('playing');
    expect(Object.values(raw(client).players).every(player => player.claim === 1)).toBe(true);
    expect(Object.values(raw(client).private).filter(player => player.composition.repair === 0)).toHaveLength(3);
    assertConservation(raw(client), 4);
  });

  it.each([2, 3] as const)('V%i 宣稱同時受當輪手牌上限限制，不只檢查全場維修數', (version) => {
    const client = makeClient(8, `hand-claim-${version}`);
    if (version === 2) restoreV2(client);
    readyAndStart(client);
    acknowledgeAll(client);
    for (let i = 0; i < 8; i += 1) revealChoice(client, choose(client, kind => kind === 'stable'));
    if (version === 3) reviewAll(client);
    for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge');
    const claiming = structuredClone(raw(client));
    expect(claiming).toMatchObject({ status: 'claiming', round: 2, repairsRequired: 8, repairsFound: 0 });
    act(client, '0', 'declareRepairs', 5, 2);
    act(client, '0', 'declareRepairs', 8, 2);
    expect(raw(client)).toEqual(claiming);
    act(client, '0', 'declareRepairs', 4, 2);
    expect(raw(client).players['0'].claim).toBe(4);
    assertConservation(raw(client), 8);
  });

  it.each([2, 3] as const)('V%i 已保存的舊宣稱原樣保留在目前狀態與復盤投影', (version) => {
    const client = makeClient();
    if (version === 2) restoreV2(client);
    readyAndStart(client);
    for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge');
    const saved = structuredClone(client.store.getState()) as State<StationState>;
    saved.G.players['0'].claim = 5;
    client.store.dispatch({ type: 'UPDATE', state: saved, deltalog: [], clientOnly: true });
    expect(repairClaimMaximum(raw(client), '0')).toBe(4);
    expect(stationPlayerView({ G: raw(client), playerID: '0' }).players['0'].claim).toBe(5);
    expect(stationObserverView(raw(client), 'blind').players['0'].claim).toBe(5);
    expect(stationObserverView(raw(client), 'god').players['0'].claim).toBe(5);
    act(client, '0', 'declareRepairs', 4, 1);
    expect(raw(client).players['0'].claim).toBe(5);
    for (const id of ['1', '2', '3']) act(client, id, 'declareRepairs', 4, 1);
    expect(raw(client).status).toBe('playing');
    expect(raw(client).players['0'].claim).toBe(5);
  });

  it('選牌公開給所有視角但不先翻牌；視圖拷貝不洩漏額外資料也不改伺服器', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    const choice = choose(client, (kind) => kind === 'stable')!;
    const actorID = raw(client).activePlayer!;
    act(client, actorID, 'selectCard', choice.targetID, choice.slot);
    const G = structuredClone(raw(client));
    Object.assign(G.pendingReveal!, { secretKind: choice.kind, credentials: 'hidden-selection' });
    G.publicCards!.unseated = ['hazard'];
    Object.assign(G.publicCards![choice.targetID], { privateSeed: 'hidden-array-field' });
    Object.assign(G.players['0'], { hidden: 'hidden-claim-field' });
    const before = structuredClone(G);
    expect(G.log).toEqual([]);
    expect(G.players[choice.targetID].cardCount).toBe(5);
    for (const viewer of ['0', '1', '2', '3', null]) {
      const view = stationPlayerView({ G, playerID: viewer });
      expect(view.pendingReveal).toEqual({
        actorID, targetID: choice.targetID, slot: choice.slot, round: 1, selectionID: 1,
      });
      expect(view.publicCards![choice.targetID][choice.slot]).toBeNull();
      expect(view).not.toHaveProperty('secret');
      expect(JSON.stringify(view)).not.toMatch(/secretKind|credentials|hidden|unseated|privateSeed/);
      view.publicCards![choice.targetID][choice.slot] = 'hazard';
      view.pendingReveal!.slot = 99;
      view.players['0'].claim = 99;
      expect(G).toEqual(before);
    }
    expect(stationObserverView(G, 'god').secret!.cards[choice.targetID][choice.slot]).toBe(choice.kind);
  });

  it('只准剪線者選別人的暗牌，預選本身不能移走牌或改行動權', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    const before = structuredClone(raw(client));
    const actorID = before.activePlayer!;
    const others = Object.keys(before.players).filter(id => id !== actorID);
    act(client, others[0], 'selectCard', others[1], 0);
    for (const target of [actorID, '99', '__proto__', 'constructor', 1, null]) {
      act(client, actorID, 'selectCard', target, 0);
    }
    for (const slot of [-1, 5, 0.5, NaN, Infinity, '0', null]) {
      act(client, actorID, 'selectCard', others[0], slot);
    }
    act(client, actorID, 'reveal', others[0], 0);
    act(client, actorID, 'reveal', others[0], 0, 1);
    expect(raw(client)).toEqual(before);
    act(client, actorID, 'selectCard', others[0], 0);
    expect(raw(client)).toMatchObject({ activePlayer: actorID, selectionSequence: 1, log: [],
      pendingReveal: { actorID, targetID: others[0], slot: 0, round: 1, selectionID: 1 } });
    expect(raw(client).secret).toEqual(before.secret);
    expect(raw(client).publicCards).toEqual(before.publicCards);
    expect(raw(client).players).toEqual(before.players);
  });

  it('重選與取消會使舊確認失效，只有當前剪線者能確認最新預選', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    const choice = choose(client, (kind) => kind === 'stable')!;
    const actorID = raw(client).activePlayer!;
    const otherPlayerID = Object.keys(raw(client).players).find(id => id !== actorID)!;
    act(client, actorID, 'selectCard', choice.targetID, choice.slot);
    const firstID = raw(client).pendingReveal!.selectionID;
    const otherSlot = (choice.slot + 1) % 5;
    act(client, actorID, 'selectCard', choice.targetID, otherSlot);
    const secondID = raw(client).pendingReveal!.selectionID;
    expect(secondID).toBeGreaterThan(firstID);
    act(client, actorID, 'selectCard', choice.targetID, choice.slot);
    const thirdID = raw(client).pendingReveal!.selectionID;
    expect(thirdID).toBeGreaterThan(secondID);
    const pending = structuredClone(raw(client));
    for (const staleID of [undefined, firstID, secondID, 0, -1, '3', NaN, Infinity, 3.5]) {
      act(client, actorID, 'reveal', choice.targetID, choice.slot, staleID);
    }
    act(client, actorID, 'reveal', choice.targetID, otherSlot, thirdID);
    act(client, actorID, 'reveal', actorID, choice.slot, thirdID);
    act(client, otherPlayerID, 'reveal', choice.targetID, choice.slot, thirdID);
    act(client, otherPlayerID, 'clearSelection');
    expect(raw(client)).toEqual(pending);
    act(client, actorID, 'clearSelection');
    expect(raw(client).pendingReveal).toBeNull();
    const canceled = structuredClone(raw(client));
    act(client, actorID, 'reveal', choice.targetID, choice.slot, thirdID);
    expect(raw(client)).toEqual(canceled);
    act(client, actorID, 'selectCard', choice.targetID, choice.slot);
    const finalID = raw(client).pendingReveal!.selectionID;
    expect(finalID).toBeGreaterThan(thirdID);
    act(client, actorID, 'reveal', choice.targetID, choice.slot, finalID);
    expect(raw(client).pendingReveal).toBeNull();
    expect(raw(client).publicCards![choice.targetID][choice.slot]).toBe('stable');
    const after = structuredClone(raw(client));
    act(client, actorID, 'reveal', choice.targetID, choice.slot, finalID);
    expect(raw(client)).toEqual(after);
    revealChoice(client, choose(client, (kind) => kind === 'stable'));
    const next = structuredClone(raw(client));
    act(client, raw(client).activePlayer!, 'selectCard', choice.targetID, choice.slot);
    expect(raw(client)).toEqual(next);
  });

  it('V2 下一輪只重發尚未揭牌，重設宣稱與公開牌位，跨輪舊確認無效', () => {
    const client = makeClient();
    restoreV2(client);
    readyAndStart(client);
    acknowledgeAll(client);
    const revealed: CardKind[] = [];
    for (let i = 0; i < 4; i += 1) {
      const choice = choose(client, (kind) => kind === 'stable')!;
      revealed.push(choice.kind);
      revealChoice(client, choice);
    }
    const G = raw(client);
    expect(G).toMatchObject({ round: 2, status: 'briefing', pendingReveal: null, selectionSequence: 4 });
    expect(Object.values(G.publicCards!).every((cards) =>
      cards.length === 4 && cards.every((kind) => kind === null))).toBe(true);
    expect(Object.values(G.players).every((player) => player.claim === null && player.cardCount === 4)).toBe(true);
    expect(Object.values(G.secret!.cards).flat()).toHaveLength(16);
    expect(counts([...Object.values(G.secret!.cards).flat(), ...revealed])).toEqual({
      stable: 15, repair: 4, hazard: 1,
    });
    for (const id of Object.keys(G.players)) act(client, id, 'acknowledge');
    const before = structuredClone(raw(client));
    act(client, '0', 'declareRepairs', 5, raw(client).round);
    act(client, '0', 'declareRepairs', 4, 1);
    expect(raw(client)).toEqual(before);
    for (const id of Object.keys(G.players)) act(client, id, 'declareRepairs', 4, raw(client).round);
    const choice = choose(client, (kind) => kind === 'stable')!;
    const actor = raw(client).activePlayer!;
    act(client, actor, 'selectCard', choice.targetID, choice.slot);
    expect(raw(client).pendingReveal).toMatchObject({ selectionID: 5, round: 2 });
    const selected = structuredClone(raw(client));
    act(client, actor, 'reveal', choice.targetID, choice.slot, 4);
    expect(raw(client)).toEqual(selected);
    act(client, actor, 'reveal', choice.targetID, choice.slot, 5);
    expect(raw(client).log).toHaveLength(5);
    assertConservation(raw(client), 4);
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
      expect(Object.values(raw(client).players).every((p) => p.claim === null)).toBe(true);
      expect(Object.values(raw(client).publicCards!).every((cards) =>
        cards.length === 6 - round && cards.every((kind) => kind === null))).toBe(true);
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
          expect(raw(client)).toMatchObject({ status: 'round-review', round, revealsThisRound: n });
          reviewAll(client);
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
    expect(raw(client).pendingReveal).toBeNull();
    const last = raw(client).log.at(-1)!;
    expect(raw(client).publicCards![last.targetID][last.slot]).toBe('hazard');
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
      if (raw(client).status === 'round-review') reviewAll(client);
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
    state.G.publicCards!['1'] = [null];
    state.G.players['1'].cardCount = 1;
    state.G.private['1'].composition = { stable: 0, repair: 1, hazard: 0 };
    client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
    revealChoice(client, { targetID: '1', slot: 0, kind: 'repair' });
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'engineer', winReason: 'all-repairs', repairsFound: 4 });
  });
});

describe('既有房間與回放的規則相容', () => {
  it.each([4, 5, 6, 7, 8])('載入 V2 的 %i 人局仍自動進入下一輪，不加入新確認階段', (n) => {
    const client = makeClient(n, `v2-${n}`);
    restoreV2(client);
    readyAndStart(client);
    for (let round = 1; round <= 4; round += 1) {
      expect(raw(client)).toMatchObject({ status: 'briefing', round });
      acknowledgeAll(client);
      for (let i = 0; i < n; i += 1) {
        const G = raw(client);
        revealChoice(client, choose(client, kind => kind === 'stable')
          ?? choose(client, kind => kind === 'repair' && G.repairsFound < n - 1));
        assertConservation(raw(client), n);
      }
      expect(raw(client).status).toBe(round < 4 ? 'briefing' : 'finished');
      expect(Object.values(stationPlayerView({ G: raw(client), playerID: '0' }).players)
        .every(player => player.reviewAcknowledged === undefined)).toBe(true);
      const before = structuredClone(raw(client));
      act(client, '0', 'acknowledgeRound', round);
      expect(raw(client)).toEqual(before);
    }
  });

  it.each([4, 5, 6, 7, 8])('載入舊 %i 人局仍使用確認後直接剪線與原 compact 牌位', (n) => {
    const client = makeClient(n, `legacy-${n}`);
    restoreLegacy(client);
    readyAndStart(client);
    for (let round = 1; round <= 4; round += 1) {
      const briefing = structuredClone(raw(client));
      act(client, '0', 'declareRepairs', 0, raw(client).round);
      act(client, '0', 'selectCard', '1', 0);
      expect(raw(client)).toEqual(briefing);
      acknowledgeAll(client);
      expect(raw(client).status).toBe('playing');
      for (let i = 0; i < n; i += 1) {
        const G = raw(client);
        const choice = choose(client, (kind) => kind === 'stable')
          ?? choose(client, (kind) => kind === 'repair' && G.repairsFound < n - 1);
        if (!choice) throw new Error('Missing a legacy test target.');
        const hand = [...G.secret!.cards[choice.targetID]];
        revealChoice(client, choice);
        if (raw(client).round === round) {
          hand.splice(choice.slot, 1);
          expect(raw(client).secret!.cards[choice.targetID]).toEqual(hand);
          expect(getCardSlots(raw(client), choice.targetID)).toEqual(
            hand.map((_, slot) => ({ slot, kind: null })),
          );
        }
        assertConservation(raw(client), n);
        const view = stationObserverView(raw(client), 'blind');
        for (const key of ['rulesVersion', 'publicCards', 'pendingReveal', 'selectionSequence']) {
          expect(raw(client)).not.toHaveProperty(key);
          expect(view).not.toHaveProperty(key);
        }
        expect(Object.values(view.players).every((player) => !('claim' in player))).toBe(true);
      }
    }
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'saboteur', winReason: 'round-limit' });
  });

  it('舊回放保留原狀且 blind 與 god 視角維持原本資訊邊界', () => {
    const client = makeClient();
    restoreLegacy(client);
    readyAndStart(client);
    acknowledgeAll(client);
    revealChoice(client, choose(client, (kind) => kind === 'stable'));
    const snapshot = structuredClone(raw(client));
    const blind = stationObserverView(snapshot, 'blind');
    const god = stationObserverView(snapshot, 'god');
    expect(blind).not.toHaveProperty('secret');
    expect(blind).not.toHaveProperty('publicCards');
    expect(god.secret).toEqual({ cards: snapshot.secret!.cards });
    expect(god.log).toEqual(snapshot.log);
    expect(snapshot).toEqual(raw(client));
  });
});

describe('V3 輪末共同確認', () => {
  function reachReview(n = 4, seed = `review-${n}`) {
    const client = makeClient(n, seed);
    readyAndStart(client);
    acknowledgeAll(client);
    for (let index = 0; index < n; index += 1) {
      revealChoice(client, choose(client, kind => kind === 'stable'));
    }
    expect(raw(client)).toMatchObject({ rulesVersion: 3, status: 'round-review', round: 1 });
    return client;
  }

  it.each([4, 5, 6, 7, 8])('%i 人保留最後一張與完整順序，所有參與者確認前不洗牌', (n) => {
    const client = reachReview(n);
    const review = structuredClone(client.store.getState()) as State<StationState>;
    const last = review.G.log.at(-1)!;
    expect(review.G).toMatchObject({ pendingReveal: null, activePlayer: last.targetID, revealsThisRound: n });
    expect(review.G.log).toHaveLength(n);
    expect(review.G.log.every(entry => entry.round === 1)).toBe(true);
    expect(review.G.publicCards![last.targetID][last.slot]).toBe(last.kind);
    expect(Object.values(review.G.players).every(player => player.reviewAcknowledged === false)).toBe(true);
    assertConservation(raw(client), n);
    const ids = Object.keys(review.G.players);
    for (const id of ids.slice(0, -1)) {
      act(client, id, 'acknowledgeRound', 1);
      expect(raw(client).status).toBe('round-review');
      expect(raw(client).round).toBe(1);
      expect(raw(client).publicCards).toEqual(review.G.publicCards);
      expect(raw(client).secret).toEqual(review.G.secret);
      expect(raw(client).private).toEqual(review.G.private);
      expect(raw(client).log).toEqual(review.G.log);
      expect(client.store.getState().plugins.random).toEqual(review.plugins.random);
    }
    act(client, ids.at(-1)!, 'acknowledgeRound', 1);
    expect(raw(client)).toMatchObject({ round: 2, status: 'briefing', activePlayer: last.targetID, revealsThisRound: 0 });
    expect(raw(client).log).toEqual(review.G.log);
    expect(Object.values(raw(client).players)
      .every(player => player.reviewAcknowledged === false && !player.acknowledged && player.claim === null)).toBe(true);
    expect(Object.values(raw(client).publicCards!)
      .every(cards => cards.length === 4 && cards.every(kind => kind === null))).toBe(true);
    assertConservation(raw(client), n);
  });

  it('拒絕觀戰者、重複、非當輪確認；非確認操作不能繞過輪末停留', () => {
    const client = reachReview();
    const before = structuredClone(raw(client));
    for (const id of ['99', '__proto__', 'constructor']) act(client, id, 'acknowledgeRound', 1);
    for (const round of [undefined, null, '1', 0, 2, -1, 1.5, NaN, Infinity, {}, true]) {
      act(client, '0', 'acknowledgeRound', round);
    }
    act(client, '0', 'acknowledge');
    act(client, '0', 'declareRepairs', 1, 1);
    act(client, '0', 'startGame');
    act(client, '0', 'setReady', false);
    act(client, raw(client).activePlayer!, 'selectCard', '1', 0);
    act(client, raw(client).activePlayer!, 'clearSelection');
    act(client, raw(client).activePlayer!, 'reveal', '1', 0, 4);
    expect(raw(client)).toEqual(before);
    act(client, '0', 'acknowledgeRound', 1);
    const partial = structuredClone(raw(client));
    act(client, '0', 'acknowledgeRound', 1);
    expect(raw(client)).toEqual(partial);
    reviewAll(client);
    acknowledgeAll(client);
    for (let i = 0; i < 4; i += 1) revealChoice(client, choose(client, kind => kind === 'stable'));
    const second = structuredClone(raw(client));
    expect(second).toMatchObject({ status: 'round-review', round: 2 });
    for (const id of Object.keys(second.players)) act(client, id, 'acknowledgeRound', 1);
    expect(raw(client)).toEqual(second);
    expect(StationGame.moves!.acknowledgeRound).toMatchObject({
      ignoreStaleStateID: true, client: false, undoable: false, redact: true,
    });
  });

  it('非連續席位只等待本局實際參與者確認，不會等待已離席的座位 0', () => {
    const match = createMatch({
      game: { ...StationGame, seed: 'sparse-review' }, numPlayers: 4,
      setupData: { startImmediately: true, participantIDs: ['1', '3', '4', '7'] },
      unlisted: true,
    });
    if ('setupDataError' in match) throw new Error(match.setupDataError);
    const client = makeClient();
    client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
    acknowledgeAll(client);
    for (let i = 0; i < 4; i += 1) revealChoice(client, choose(client, kind => kind === 'stable'));
    const review = structuredClone(raw(client));
    expect(review.status).toBe('round-review');
    act(client, '0', 'acknowledgeRound', 1);
    expect(raw(client)).toEqual(review);
    reviewAll(client);
    expect(Object.keys(raw(client).players)).toEqual(['1', '3', '4', '7']);
  });

  it('持久化一半確認後重啟可繼續，視圖只公開確認旗標且不洩漏秘密', () => {
    const client = reachReview();
    act(client, '0', 'acknowledgeRound', 1);
    act(client, '2', 'acknowledgeRound', 1);
    const persisted = JSON.parse(JSON.stringify(client.store.getState())) as State<StationState>;
    Object.assign(persisted.G.players['0'], { credential: 'hidden', reviewSecret: 'hidden' });
    const blind = stationObserverView(persisted.G, 'blind');
    const own = stationPlayerView({ G: persisted.G, playerID: '0' });
    const god = stationObserverView(persisted.G, 'god');
    for (const view of [blind, own, god]) {
      expect(view.players['0'].reviewAcknowledged).toBe(true);
      expect(view.players['1'].reviewAcknowledged).toBe(false);
      expect(JSON.stringify(view)).not.toMatch(/credential|reviewSecret|hidden|unusedRoles/);
      view.players['0'].reviewAcknowledged = false;
      expect(persisted.G.players['0'].reviewAcknowledged).toBe(true);
    }
    expect(blind.private).toEqual({});
    expect(blind).not.toHaveProperty('secret');
    expect(Object.keys(own.private)).toEqual(['0']);
    expect(own).not.toHaveProperty('secret');
    expect(god.secret).toEqual({ cards: persisted.G.secret!.cards });
    const restarted = makeClient(4, 'a-new-process-does-not-reseed-the-match');
    restarted.store.dispatch({ type: 'UPDATE', state: persisted, deltalog: [], clientOnly: true });
    act(restarted, '1', 'acknowledgeRound', 1);
    expect(raw(restarted).status).toBe('round-review');
    act(restarted, '3', 'acknowledgeRound', 1);
    act(client, '1', 'acknowledgeRound', 1);
    act(client, '3', 'acknowledgeRound', 1);
    expect(raw(restarted).secret).toEqual(raw(client).secret);
    expect(raw(restarted).log).toEqual(raw(client).log);
    expect(raw(restarted).round).toBe(2);
    expect(restarted.store.getState().plugins.random).toEqual(client.store.getState().plugins.random);
  });

  it.each(['hazard', 'repair'] as const)('最後一張 %s 造成勝負時直接結束，保留最終牌面', (kind) => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    const state = structuredClone(client.store.getState()) as State<StationState>;
    state.G.revealsThisRound = 3;
    state.G.repairsFound = 3;
    state.G.secret!.cards['1'][0] = kind;
    state.G.private['1'].composition = counts(state.G.secret!.cards['1']);
    client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
    revealChoice(client, { targetID: '1', slot: 0, kind });
    expect(raw(client)).toMatchObject({
      status: 'finished', round: 1, revealsThisRound: 4,
      winReason: kind === 'hazard' ? 'hazard' : 'all-repairs',
      pendingReveal: null,
    });
    expect(raw(client).publicCards!['1'][0]).toBe(kind);
    const finished = structuredClone(raw(client));
    for (const id of Object.keys(finished.players)) act(client, id, 'acknowledgeRound', 1);
    expect(raw(client)).toEqual(finished);
  });
});

describe('V3 同時確認任務資訊', () => {
  it.each([4, 5, 6, 7, 8])('%i 位參與者各確認一次即可前進，重複與錯誤輪次不會消耗確認', (n) => {
    const client = makeClient(n);
    readyAndStart(client);
    const before = structuredClone(raw(client));
    for (const round of [undefined, null, '1', 0, 2, -1, 1.5, NaN, Infinity, {}, true]) {
      act(client, '0', 'acknowledgeBriefing', round);
    }
    for (const id of ['99', '__proto__', 'constructor']) act(client, id, 'acknowledgeBriefing', 1);
    expect(raw(client)).toEqual(before);
    const ids = Object.keys(before.players);
    for (const id of ids) {
      act(client, id, 'acknowledgeBriefing', 1);
      expect(raw(client).players[id].acknowledged).toBe(true);
      const confirmed = structuredClone(raw(client));
      act(client, id, 'acknowledgeBriefing', 1);
      expect(raw(client)).toEqual(confirmed);
      expect(raw(client).status).toBe(id === ids.at(-1) ? 'claiming' : 'briefing');
    }
    expect(StationGame.moves!.acknowledgeBriefing).toMatchObject({
      ignoreStaleStateID: true, client: false, undoable: false, redact: true,
    });
    expect(StationGame.moves!.acknowledge).not.toHaveProperty('ignoreStaleStateID');
  });

  it('延遲的上一輪資訊確認不能誤確認下一輪，當輪確認仍可正常完成', () => {
    const client = makeClient();
    readyAndStart(client);
    acknowledgeAll(client);
    for (let i = 0; i < 4; i += 1) revealChoice(client, choose(client, kind => kind === 'stable'));
    reviewAll(client);
    const before = structuredClone(raw(client));
    for (const id of Object.keys(before.players)) act(client, id, 'acknowledgeBriefing', 1);
    expect(raw(client)).toEqual(before);
    for (const id of Object.keys(before.players)) act(client, id, 'acknowledgeBriefing', 2);
    expect(raw(client).status).toBe('claiming');
  });

  it.each(['legacy', 'v2'] as const)('%s 存檔不接受新的資訊確認操作，沿用原確認方式', (version) => {
    const client = makeClient();
    if (version === 'legacy') restoreLegacy(client); else restoreV2(client);
    readyAndStart(client);
    const before = structuredClone(raw(client));
    for (const id of Object.keys(before.players)) act(client, id, 'acknowledgeBriefing', 1);
    expect(raw(client)).toEqual(before);
    acknowledgeAll(client);
    expect(raw(client).status).toBe('playing');
  });
});
