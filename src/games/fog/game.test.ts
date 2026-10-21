import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { CreateGameReducer, createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import {
  FogGame, fogAllowedQuestCards, fogObserverView, fogPlayerView, type FogQuestCard, type FogState,
} from './game';
import {
  DEFAULT_FOG_OPTIONS, FOG_ROLES, fogFactionCounts, fogRoleDeck, fogTeamSizes, normalizeFogOptions,
  validateFogOptions, type FogOptions, type FogRole,
} from './rules';

function makeClient(n = 5, options: Partial<FogOptions> = {}, ids?: string[], seed = 'fog-test') {
  const game = { ...FogGame, seed };
  const client = Client({ game, numPlayers: n, playerID: ids?.[0] ?? '0', debug: false });
  const match = createMatch({
    game, numPlayers: n, setupData: { startImmediately: true, participantIDs: ids, options: normalizeFogOptions(options) }, unlisted: true,
  });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  return client;
}
type TestClient = ReturnType<typeof makeClient>;
function raw(client: TestClient): FogState { return client.store.getState().G as FogState; }
function act(client: TestClient, id: string, move: string, ...args: unknown[]) {
  client.updatePlayerID(id);
  client.moves[move](...args);
}
function patch(client: TestClient, update: (G: FogState) => void) {
  const state = structuredClone(client.store.getState()) as State<FogState>;
  update(state.G);
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function ackAll(client: TestClient) {
  const epoch = raw(client).epoch;
  for (const id of Object.keys(raw(client).players)) act(client, id, 'acknowledge', epoch);
}
function roleID(client: TestClient, role: FogRole): string {
  return Object.keys(raw(client).private).find((id) => raw(client).private[id].role === role)!;
}
function propose(client: TestClient, team?: string[]) {
  const G = raw(client);
  const selected = team ?? Object.keys(G.players).slice(0, fogTeamSizes(Object.keys(G.players).length)[G.quest - 1]);
  act(client, G.leaderID!, 'selectTeam', selected, G.epoch);
  act(client, G.leaderID!, 'confirmTeam', raw(client).epoch);
  expect(raw(client).status).toBe('voting');
}
function voteAll(client: TestClient, approve = true) {
  const epoch = raw(client).epoch;
  for (const id of Object.keys(raw(client).players)) act(client, id, 'vote', approve, epoch);
  expect(raw(client).status).toBe('vote-review');
}
function quest(client: TestClient, failCount = 0) {
  const G = raw(client);
  const size = fogTeamSizes(Object.keys(G.players).length)[G.quest - 1];
  const evil = Object.keys(G.players).filter((id) => G.private[id].faction === 'apostles');
  const chosen = [...evil.slice(0, failCount)];
  for (const id of Object.keys(G.players)) if (!chosen.includes(id) && chosen.length < size) chosen.push(id);
  propose(client, chosen);
  voteAll(client);
  ackAll(client);
  expect(raw(client).status).toBe('quest');
  const epoch = raw(client).epoch;
  chosen.forEach((id, index) => act(client, id, 'submitQuest', index < failCount ? 'fail' : 'success', epoch));
  expect(raw(client).status).toBe('quest-review');
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('黑霧襲城設定與夜間情報', () => {
  it.each([5, 6, 7, 8, 9, 10])('%i 人發牌完整且陣營、任務人數正確', (n) => {
    const client = makeClient(n);
    const G = raw(client);
    const counts = fogFactionCounts(n);
    expect(G.status).toBe('briefing');
    expect(Object.values(G.private).filter((info) => info.faction === 'knights')).toHaveLength(counts.knights);
    expect(Object.values(G.private).filter((info) => info.faction === 'apostles')).toHaveLength(counts.apostles);
    expect(fogRoleDeck(n, DEFAULT_FOG_OPTIONS)).toHaveLength(n);
    expect(fogTeamSizes(n)).toHaveLength(5);
    expect(Object.keys(G.players)).toContain(G.leaderID);
    expect(G.bellHistory).toEqual([]);
    expect(G.secret!.bellDeck.filter((card) => card === 'switch')).toHaveLength(2);
    expect(G.secret!.bellDeck.filter((card) => card === 'quiet')).toHaveLength(4);
    const own = fogPlayerView({ G, playerID: '0' });
    expect(Object.keys(own.private)).toEqual(['0']);
    ackAll(client);
    expect(raw(client).status).toBe('nomination');
    expect(raw(client).bellHistory).toHaveLength(1);
    expect(raw(client).secret!.bellDeck).toHaveLength(5);
  });

  it('設定不會默默移除溢出的角色，並驗證席位與角色搭配', () => {
    expect(normalizeFogOptions(undefined)).toEqual(DEFAULT_FOG_OPTIONS);
    for (const bad of [null, [], 'x', { lancelotMode: 'third' }, { percival: 'yes' }, { extra: true }]) {
      expect(() => normalizeFogOptions(bad)).toThrow();
    }
    expect(validateFogOptions({ ...DEFAULT_FOG_OPTIONS, morgana: true }, 7)).toContain('派西維爾');
    expect(validateFogOptions({ ...DEFAULT_FOG_OPTIONS, percival: true, morgana: true }, 5)).toContain('超過');
    expect(validateFogOptions({ ...DEFAULT_FOG_OPTIONS, percival: true, morgana: true }, 7)).toBeUndefined();
    expect(() => fogRoleDeck(4, DEFAULT_FOG_OPTIONS)).toThrow();
    expect(() => fogTeamSizes(11)).toThrow();
    for (const participantIDs of [['0', '0', '1', '2', '3'], ['0', '1', '2', '3', '__proto__'], ['0', '1']]) {
      expect(FogGame.validateSetupData!({ participantIDs }, 5)).toBeTruthy();
    }
    expect(FogGame.validateSetupData!({ participantIDs: ['1', '3', '5', '8', '9'] }, 5)).toBeUndefined();
    const client = makeClient(5, {}, ['1', '3', '5', '8', '9']);
    expect(Object.keys(raw(client).players)).toEqual(['1', '3', '5', '8', '9']);
    ackAll(client);
    propose(client);
    voteAll(client);
    expect(Object.keys(raw(client).lastVote!.votes)).toEqual(['1', '3', '5', '8', '9']);
  });

  it('梅林看不見莫德雷德；派西維爾無法區分梅林與莫甘娜；奧伯倫隔離於邪方情報', () => {
    const client = makeClient(10, { lancelotMode: 'off', percival: true, morgana: true, mordred: true, oberon: true });
    const G = raw(client);
    const merlin = roleID(client, 'merlin');
    const percival = roleID(client, 'percival');
    const assassin = roleID(client, 'assassin');
    const morgana = roleID(client, 'morgana');
    const mordred = roleID(client, 'mordred');
    const oberon = roleID(client, 'oberon');
    expect(G.private[merlin].knownEvil).toEqual(expect.arrayContaining([assassin, morgana, oberon]));
    expect(G.private[merlin].knownEvil).not.toContain(mordred);
    expect([...G.private[percival].merlinCandidates].sort()).toEqual([merlin, morgana].sort());
    expect([...G.private[assassin].knownEvil].sort()).toEqual([morgana, mordred].sort());
    expect(G.private[oberon].knownEvil).toEqual([]);
    for (const id of Object.keys(G.players)) {
      if (FOG_ROLES[G.private[id].role].faction === 'knights' && id !== merlin) expect(G.private[id].knownEvil).toEqual([]);
    }
    const noMorgana = makeClient(5, { lancelotMode: 'off', percival: true });
    expect(raw(noMorgana).private[roleID(noMorgana, 'percival')].merlinCandidates).toEqual([roleID(noMorgana, 'merlin')]);
  });

  it('蘭斯洛特互不相認，邪蘭斯洛特不認識使徒而使徒認得他，轉換後保留初始情報', () => {
    const client = makeClient();
    const good = roleID(client, 'good-lancelot');
    const evil = roleID(client, 'evil-lancelot');
    const merlin = roleID(client, 'merlin');
    const assassin = roleID(client, 'assassin');
    expect(raw(client).private[good].knownEvil).toEqual([]);
    expect(raw(client).private[evil].knownEvil).toEqual([]);
    expect(raw(client).private[assassin].knownEvil).toContain(evil);
    expect(raw(client).private[merlin].knownEvil).toContain(evil);
    const night = structuredClone(raw(client).private);
    patch(client, (G) => { G.secret!.bellDeck = ['switch', 'quiet', 'switch', 'quiet', 'quiet', 'quiet']; });
    ackAll(client);
    expect(raw(client).private[good]).toMatchObject({ role: 'good-lancelot', faction: 'apostles' });
    expect(raw(client).private[evil]).toMatchObject({ role: 'evil-lancelot', faction: 'knights' });
    for (const id of Object.keys(night)) expect(raw(client).private[id].knownEvil).toEqual(night[id].knownEvil);
    quest(client); ackAll(client);
    expect(raw(client).private[good].faction).toBe('apostles');
    quest(client); ackAll(client);
    expect(raw(client).private[good].faction).toBe('knights');
    expect(raw(client).bellHistory.map((entry) => entry.card)).toEqual(['switch', 'quiet', 'switch']);
  });
});

describe('提名與秘密表決', () => {
  it('輪流領隊、即時提名、表決全員交齊才公開，平票否決且重提名不抽鐘', () => {
    const client = makeClient(6);
    ackAll(client);
    const leader = raw(client).leaderID!;
    const ids = Object.keys(raw(client).players);
    const notLeader = ids.find((id) => id !== leader)!;
    const before = structuredClone(raw(client));
    act(client, notLeader, 'selectTeam', ids.slice(0, 2), before.epoch);
    expect(raw(client)).toEqual(before);
    for (const bad of [ids.slice(0, 3), ['0', '0'], ['99'], '0']) {
      act(client, leader, 'selectTeam', bad, before.epoch);
      expect(raw(client)).toEqual(before);
    }
    act(client, leader, 'confirmTeam', before.epoch);
    expect(raw(client)).toEqual(before);
    propose(client);
    const epoch = raw(client).epoch;
    act(client, '0', 'vote', true, epoch);
    expect(raw(client).players['0'].voteSubmitted).toBe(true);
    expect(fogPlayerView({ G: raw(client), playerID: '0' }).private['0'].ownVote).toBe(true);
    expect(fogPlayerView({ G: raw(client), playerID: '1' }).private['1'].ownVote).toBeNull();
    expect(fogObserverView(raw(client), 'blind')).toMatchObject({ lastVote: null, private: {} });
    expect(raw(client).log.some((entry) => entry.type === 'vote')).toBe(false);
    act(client, '0', 'vote', false, epoch);
    expect(raw(client).secret!.votes['0']).toBe(true);
    ids.slice(1).forEach((id) => act(client, id, 'vote', Number(id) < 3, epoch));
    expect(raw(client)).toMatchObject({ status: 'vote-review', rejections: 1, lastVote: { approved: false } });
    expect(raw(client).lastVote!.votes).toEqual({ '0': true, '1': true, '2': true, '3': false, '4': false, '5': false });
    expect(raw(client).secret!.votes).toEqual({});
    act(client, leader, 'selectTeam', ['0', '1'], raw(client).epoch);
    expect(raw(client).status).toBe('vote-review');
    ackAll(client);
    expect(raw(client).leaderID).toBe(ids[(ids.indexOf(leader) + 1) % ids.length]);
    expect(raw(client).bellHistory).toHaveLength(1);
    expect(raw(client).team).toEqual([]);
  });

  it('連續五次否決須先看完表決，再結算黑霧使徒勝利', () => {
    const client = makeClient();
    ackAll(client);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      propose(client); voteAll(client, false);
      expect(raw(client).rejections).toBe(attempt);
      expect(raw(client).winner).toBeNull();
      ackAll(client);
    }
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'apostles', winReason: 'five-rejections' });
    expect(client.store.getState().ctx.gameover).toEqual({ winner: 'apostles', reason: 'five-rejections' });
    expect(Object.values(raw(client).players).every((player) => player.revealedFaction && player.revealedRole)).toBe(true);
  });
});

describe('燈塔任務、詛咒之鐘與結算', () => {
  it.each([5, 6, 7, 8, 9, 10])('%i 人第四任務正確採用失敗門檻，任務保持匿名', (n) => {
    const client = makeClient(n, { lancelotMode: 'off' });
    ackAll(client);
    patch(client, (G) => { G.quest = 4; });
    quest(client, 1);
    expect(raw(client).questResults[0]).toMatchObject({ quest: 4, fails: 1, succeeded: n >= 7 });
    expect(raw(client).secret!.questCards).toEqual({});
    expect(Object.values(raw(client).private).every((info) => info.ownQuestCard === null)).toBe(true);
    const publicResult = fogObserverView(raw(client), 'blind').questResults[0];
    expect(Object.keys(publicResult).sort()).toEqual(['fails', 'quest', 'succeeded', 'successes', 'team']);
    expect(raw(client).status).toBe('quest-review');
    const finalEpoch = raw(client).epoch;
    for (const id of Object.keys(raw(client).players).slice(0, -1)) act(client, id, 'acknowledge', finalEpoch);
    expect(raw(client).status).toBe('quest-review');
    expect(raw(client).quest).toBe(4);
  });

  it('七人第四任務兩張破壞仍會失敗', () => {
    const client = makeClient(7, { lancelotMode: 'off' });
    ackAll(client); patch(client, (G) => { G.quest = 4; }); quest(client, 2);
    expect(raw(client).questResults[0]).toMatchObject({ fails: 2, succeeded: false });
  });

  it('任務僅允許入隊者提交一次；守夜騎士不可破壞，秘密選擇直到結算仍不公開來源', () => {
    const client = makeClient(5, { lancelotMode: 'off' });
    ackAll(client);
    const evil = roleID(client, 'assassin');
    const good = roleID(client, 'merlin');
    propose(client, [evil, good]); voteAll(client); ackAll(client);
    const epoch = raw(client).epoch;
    const outsider = Object.keys(raw(client).players).find((id) => id !== evil && id !== good)!;
    const before = structuredClone(raw(client));
    act(client, outsider, 'submitQuest', 'success', epoch);
    act(client, good, 'submitQuest', 'fail', epoch);
    act(client, evil, 'submitQuest', 'invalid', epoch);
    expect(raw(client)).toEqual(before);
    act(client, evil, 'submitQuest', 'fail', epoch);
    expect(raw(client).players[evil].questSubmitted).toBe(true);
    expect(fogObserverView(raw(client), 'blind').private).toEqual({});
    expect(fogPlayerView({ G: raw(client), playerID: good }).private).not.toHaveProperty(evil);
    act(client, evil, 'submitQuest', 'success', epoch);
    expect(raw(client).secret!.questCards[evil]).toBe('fail');
    act(client, good, 'submitQuest', 'success', epoch);
    expect(raw(client).questResults[0]).toMatchObject({ successes: 1, fails: 1, succeeded: false });
    expect(raw(client).log.at(-1)).not.toHaveProperty('actorID');
  });

  it('預告模式公開五張排程、每輪套用且目前邪方的蘭斯洛特必須破壞', () => {
    const client = makeClient(5, { lancelotMode: 'forecast' });
    expect(raw(client).bellForecast).toHaveLength(5);
    expect(raw(client).bellForecast.filter((card) => card === 'switch').length).toBeLessThanOrEqual(2);
    expect(raw(client).secret!.bellDeck).toEqual([]);
    const good = roleID(client, 'good-lancelot');
    const evil = roleID(client, 'evil-lancelot');
    patch(client, (G) => { G.bellForecast = ['switch', 'quiet', 'quiet', 'switch', 'quiet']; });
    ackAll(client);
    expect(fogAllowedQuestCards(raw(client).private[good], raw(client).options)).toEqual(['fail']);
    expect(fogAllowedQuestCards(raw(client).private[evil], raw(client).options)).toEqual(['success']);
    expect(fogAllowedQuestCards(raw(client).private[good], { ...raw(client).options, lancelotMode: 'random' })).toEqual(['success', 'fail']);
    propose(client, [good, evil]); voteAll(client); ackAll(client);
    const epoch = raw(client).epoch;
    const before = structuredClone(raw(client));
    act(client, good, 'submitQuest', 'success', epoch);
    act(client, evil, 'submitQuest', 'fail', epoch);
    expect(raw(client)).toEqual(before);
    act(client, good, 'submitQuest', 'fail', epoch);
    act(client, evil, 'submitQuest', 'success', epoch);
    expect(raw(client).questResults[0].succeeded).toBe(false);
  });

  it.each([true, false])('三次成功後先保留任務，再由刺客指認，命中=%s', (hit) => {
    const client = makeClient(5, { lancelotMode: 'off' });
    ackAll(client);
    for (let round = 1; round <= 3; round += 1) {
      quest(client);
      expect(raw(client).winner).toBeNull();
      ackAll(client);
    }
    expect(raw(client).status).toBe('assassination');
    expect(Object.values(raw(client).players).every((player) => player.revealedRole === undefined)).toBe(true);
    const assassin = roleID(client, 'assassin');
    const target = hit ? roleID(client, 'merlin') : roleID(client, 'loyal-servant');
    const epoch = raw(client).epoch;
    const before = structuredClone(raw(client));
    act(client, target, 'assassinate', assassin, epoch);
    act(client, assassin, 'assassinate', '99', epoch);
    act(client, assassin, 'assassinate', assassin, epoch);
    expect(raw(client)).toEqual(before);
    act(client, assassin, 'assassinate', target, epoch);
    expect(raw(client)).toMatchObject({ status: 'finished', winner: hit ? 'apostles' : 'knights', winReason: hit ? 'merlin-found' : 'merlin-safe' });
    expect(fogObserverView(raw(client), 'blind').private).toEqual({});
    expect(Object.values(fogObserverView(raw(client), 'blind').players).every((player) => player.revealedRole !== undefined)).toBe(true);
  });

  it('三次失敗直接判使徒勝利，不進刺殺', () => {
    const client = makeClient(5, { lancelotMode: 'off' });
    ackAll(client);
    for (let round = 1; round <= 3; round += 1) { quest(client, 1); ackAll(client); }
    expect(raw(client)).toMatchObject({ status: 'finished', winner: 'apostles', winReason: 'three-fails', assassinationTarget: null });
  });

  it('鐘聲改變的陣營保留到結算，角色名稱與陣營分開揭露', () => {
    const client = makeClient();
    const good = roleID(client, 'good-lancelot');
    const evil = roleID(client, 'evil-lancelot');
    patch(client, (G) => { G.secret!.bellDeck = ['switch', 'quiet', 'quiet', 'quiet', 'quiet', 'switch']; });
    ackAll(client);
    for (let attempt = 0; attempt < 5; attempt += 1) { propose(client); voteAll(client, false); ackAll(client); }
    expect(raw(client).players[good]).toMatchObject({ revealedRole: 'good-lancelot', revealedFaction: 'apostles' });
    expect(raw(client).players[evil]).toMatchObject({ revealedRole: 'evil-lancelot', revealedFaction: 'knights' });
    expect(fogObserverView(raw(client), 'god').secret).toBeUndefined();
    expect(fogObserverView(raw(client), 'blind').bellHistory).toEqual([{ quest: 1, card: 'switch' }]);
  });
});

describe('框架隔離、投影與不可繞過的階段', () => {
  it('等待室需全部準備，首個實際席位才能開始', () => {
    const client = Client({ game: FogGame, numPlayers: 5, playerID: '0', debug: false });
    act(client, '0', 'startGame'); expect(raw(client).status).toBe('lobby');
    for (const id of ['0', '1', '2', '3', '4']) act(client, id, 'setReady', true);
    act(client, '1', 'startGame'); expect(raw(client).status).toBe('lobby');
    act(client, '0', 'startGame'); expect(raw(client).status).toBe('briefing');
  });

  it('舊epoch、非席位、重複確認與跨階段命令不生效', () => {
    const client = makeClient();
    const epoch = raw(client).epoch;
    act(client, '0', 'acknowledge', epoch);
    act(client, '0', 'acknowledge', epoch);
    expect(Object.values(raw(client).players).filter((player) => player.acknowledged)).toHaveLength(1);
    const before = structuredClone(raw(client));
    act(client, '0', 'vote', true, epoch);
    act(client, '0', 'submitQuest', 'success', epoch);
    act(client, '0', 'acknowledge', epoch - 1);
    act(client, '9', 'acknowledge', epoch);
    expect(raw(client)).toEqual(before);
    ackAll(client);
    const nomination = structuredClone(raw(client));
    act(client, raw(client).leaderID!, 'selectTeam', ['0', '1'], epoch);
    act(client, '0', 'acknowledge', raw(client).epoch);
    expect(raw(client)).toEqual(nomination);
  });

  it('投影白名單排除未來鐘牌、任務來源、額外秘密，且不共用可變資料', () => {
    const client = makeClient();
    const G = structuredClone(raw(client));
    const expected = structuredClone(G.private);
    Object.assign(G, { credentials: 'hidden-token', future: 'hidden-future' });
    Object.assign(G.private['0'], { extraSecret: 'hidden-private' });
    Object.assign(G.players['0'], { extraSecret: 'hidden-player' });
    Object.assign(G.log[0], { extraSecret: 'hidden-log' });
    G.private.unseated = { ...G.private['0'] };
    const before = structuredClone(G);
    for (const id of [null, '99', 'constructor', '__proto__']) expect(fogPlayerView({ G, playerID: id }).private).toEqual({});
    const own = fogPlayerView({ G, playerID: '0' });
    const god = fogObserverView(G, 'god');
    expect(own.private).toEqual({ '0': expected['0'] });
    expect(god.private).toEqual(expected);
    for (const view of [own, god, fogObserverView(G, 'blind')]) expect(JSON.stringify(view)).not.toMatch(/hidden|credentials|secret|unseated|bellDeck/);
    god.private['0'].knownEvil.push('99');
    own.options.lancelotMode = 'off';
    god.players['0'].acknowledged = true;
    god.log[0].actorID = '99';
    expect(G).toEqual(before);
    expect(client.getState()!.plugins.random).not.toHaveProperty('seed');
    expect(JSON.stringify(client.getState()!.plugins.random)).not.toContain('prngstate');
  });

  it('兩間房間的投票、鐘牌、準備與任務互不影響', () => {
    const a = makeClient(5, {}, undefined, 'room-a');
    const b = makeClient(7, { lancelotMode: 'forecast' }, undefined, 'room-b');
    const beforeB = structuredClone(raw(b));
    ackAll(a); quest(a); ackAll(a);
    expect(raw(b)).toEqual(beforeB);
    const beforeA = structuredClone(raw(a));
    ackAll(b); propose(b); voteAll(b, false); ackAll(b);
    expect(raw(a)).toEqual(beforeA);
  });

  it('所有動作皆伺服器裁定、禁撤銷且隱去框架記錄中的參數', () => {
    for (const definition of Object.values(FogGame.moves!)) expect(definition).toMatchObject({ client: false, undoable: false, redact: true });
    const client = makeClient();
    const server = structuredClone(client.store.getState());
    const projected = { ...server, G: fogPlayerView({ G: server.G as FogState, playerID: '0' }), plugins: { random: { data: {} } } };
    const reducer = CreateGameReducer({ game: FogGame, isClient: true });
    const result = reducer(projected, { type: 'MAKE_MOVE', payload: { type: 'acknowledge', args: [raw(client).epoch], playerID: '0' } });
    expect(result.G).toEqual(projected.G);
    expect(result.ctx).toEqual(projected.ctx);
    expect(result._stateID).toBe(projected._stateID);
    ackAll(client); propose(client); voteAll(client);
    expect(client.store.getState()._undo).toEqual([]);
    const before = structuredClone(raw(client)); client.undo(); expect(raw(client)).toEqual(before);
  });

  it.each([
    ['endGame', [{ winner: 'knights' }]], ['endTurn', []], ['endPhase', []], ['setPhase', ['hacked']],
    ['setStage', ['hacked']], ['endStage', []], ['setActivePlayers', [{ currentPlayer: 'hacked' }]], ['pass', []],
  ])('拒絕繞過規則的框架事件 %s', (type, args) => {
    const client = makeClient();
    const before = structuredClone(client.store.getState());
    client.store.dispatch({ type: 'GAME_EVENT', payload: { type, args, playerID: '0' } });
    expect(raw(client)).toEqual(before.G);
    expect(client.store.getState().ctx).toEqual(before.ctx);
  });
});
