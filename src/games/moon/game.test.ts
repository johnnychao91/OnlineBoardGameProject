import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { CreateGameReducer, createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { MoonGame, advanceMoonClock, moonObserverView, moonPlayerView, type MoonState } from './game';
import { DEFAULT_MOON_OPTIONS, MOON_ROLES, moonRoleCounts, moonRoleDeck, normalizeMoonOptions, validateMoonOptions, type MoonOptions, type MoonRole } from './rules';

let now = 1_800_000_000_000;
beforeEach(() => {
  now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
function makeClient(count = 8, options: Partial<MoonOptions> = {}, ids?: string[], seed = 'moon-test') {
  const game = { ...MoonGame, seed };
  const client = Client({ game, numPlayers: count, playerID: ids?.[0] ?? '0', debug: false });
  const match = createMatch({ game, numPlayers: count, setupData: { startImmediately: true, options: normalizeMoonOptions(options), participantIDs: ids }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  return client;
}
type TestClient = ReturnType<typeof makeClient>;
const raw = (client: TestClient) => client.store.getState().G as MoonState;
function act(client: TestClient, id: string, move: string, ...args: unknown[]) {
  client.updatePlayerID(id); client.moves[move](...args);
}
function patch(client: TestClient, change: (G: MoonState) => void) {
  // The local boardgame.io client retains plugin API functions after INVALID_MOVE;
  // server storage serializes only data before the clock scheduler reads it.
  const state = JSON.parse(JSON.stringify(client.store.getState())) as State<MoonState>;
  change(state.G);
  if (state.G.status === 'finished') state.ctx.gameover = { winner: state.G.winner, reason: state.G.winReason };
  client.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function ackAll(client: TestClient) {
  const epoch = raw(client).epoch;
  for (const id of Object.keys(raw(client).players).filter(id => raw(client).players[id].alive)) act(client, id, 'acknowledge', epoch);
}
function tick(client: TestClient, advance = 0) {
  expect(raw(client).deadline).not.toBeNull();
  now = raw(client).deadline! + advance;
  patch(client, G => expect(advanceMoonClock(G, now)).toBe(true));
}
const roleID = (client: TestClient, role: MoonRole) => Object.keys(raw(client).private).find(id => raw(client).private[id].role === role)!;
const wolves = (client: TestClient) => Object.keys(raw(client).private).filter(id => raw(client).private[id].role === 'wolf');
const villagers = (client: TestClient) => Object.keys(raw(client).private).filter(id => raw(client).private[id].role === 'villager');
function toNight(client: TestClient) { ackAll(client); expect(raw(client).status).toBe('night'); }
function nextNightStep(client: TestClient, step: number) {
  while (raw(client).status === 'night' && raw(client).nightStep < step) tick(client);
  expect(raw(client).status).toBe('night'); expect(raw(client).nightStep).toBe(step);
}
function wolfAttack(client: TestClient, target: string | null) {
  nextNightStep(client, 1);
  for (const id of wolves(client).filter(id => raw(client).players[id].alive)) act(client, id, 'wolfVote', target, raw(client).epoch);
}
function finishNight(client: TestClient) { while (raw(client).status === 'night') tick(client); }
function toVote(client: TestClient) {
  if (raw(client).status === 'dawn') ackAll(client);
  while (raw(client).status === 'speaking') act(client, raw(client).speakerID!, 'finishSpeech', raw(client).epoch);
  expect(raw(client).status).toBe('voting');
}
function voteAll(client: TestClient, target: string | null) {
  const epoch = raw(client).epoch;
  for (const id of Object.keys(raw(client).players).filter(id => raw(client).players[id].alive)) act(client, id, 'exileVote', target, epoch);
}
function sheriffSignup(client: TestClient, candidates: string[]) {
  toNight(client); finishNight(client); ackAll(client);
  expect(raw(client).status).toBe('sheriff-signup');
  for (const id of candidates) act(client, id, 'standForSheriff', true, raw(client).epoch);
  tick(client);
}
function finishElectionSpeeches(client: TestClient) {
  while (raw(client).status === 'sheriff-speech') act(client, raw(client).speakerID!, 'finishSpeech', raw(client).epoch);
}
function electionVotes(client: TestClient, selections: (string | null)[]) {
  const G = raw(client), epoch = G.epoch;
  const voters = Object.keys(G.players).filter(id => G.players[id].alive && !G.sheriffCandidates.includes(id));
  expect(selections).toHaveLength(voters.length);
  voters.forEach((id, index) => act(client, id, 'sheriffVote', selections[index], epoch));
}

describe('銀月列車設定與發牌', () => {
  it.each([6, 7, 8, 9, 10, 11, 12])('%i 人具有完整角色配置和僅自己的情報', count => {
    const client = makeClient(count), G = raw(client), counts = moonRoleCounts(count);
    expect(moonRoleDeck(count)).toHaveLength(count);
    expect(Object.values(G.private)).toHaveLength(count);
    expect(wolves(client)).toHaveLength(counts.wolf);
    expect(counts.villager).toBeGreaterThanOrEqual(2);
    for (const [id, info] of Object.entries(G.private)) {
      expect(info.faction).toBe(MOON_ROLES[info.role].faction);
      expect(info.knownWolves).toEqual(info.role === 'wolf' ? wolves(client).filter(other => other !== id) : []);
      expect(Object.keys(moonPlayerView({ G, playerID: id }).private)).toEqual([id]);
    }
    expect(G.status).toBe('briefing'); expect(G.deadline).toBeNull();
  });
  it('設定嚴格驗證型別、上下限、角色人數和高席位', () => {
    expect(normalizeMoonOptions(undefined)).toEqual(DEFAULT_MOON_OPTIONS);
    for (const bad of [null, [], 'x', { mode: 'judge' }, { sheriff: 'yes' }, { speechSeconds: 14 }, { speechSeconds: 301 }, { speechSeconds: 45.5 }, { nightSeconds: 121 }, { voteSeconds: 0 }, { hidden: true }]) expect(() => normalizeMoonOptions(bad)).toThrow();
    expect(normalizeMoonOptions({ mode: 'assisted', sheriff: true, speechSeconds: 15, nightSeconds: 120, voteSeconds: 120 }).sheriff).toBe(true);
    expect(validateMoonOptions(DEFAULT_MOON_OPTIONS, 5)).toContain('6～12');
    expect(validateMoonOptions(DEFAULT_MOON_OPTIONS, 13)).toContain('6～12');
    const ids = ['1', '3', '5', '8', '10', '11'];
    const client = makeClient(6, {}, ids);
    expect(Object.keys(raw(client).players)).toEqual(ids);
    toNight(client); finishNight(client); ackAll(client);
    expect(raw(client).speakerID).toBe('1');
    const invalid = createMatch({ game: MoonGame, numPlayers: 6, setupData: { participantIDs: ['0', '1', '2', '3', '4', '12'] }, unlisted: true });
    expect(invalid).toHaveProperty('setupDataError');
  });
  it('等待室需全員準備且由首席開始；開局不設定時間到全員看完身分', () => {
    const client = Client({ game: MoonGame, numPlayers: 6, playerID: '0', debug: false });
    act(client, '0', 'startGame'); expect(raw(client).status).toBe('lobby');
    for (const id of Object.keys(raw(client).players)) act(client, id, 'setReady', true);
    act(client, '1', 'startGame'); expect(raw(client).status).toBe('lobby');
    act(client, '0', 'startGame'); expect(raw(client).status).toBe('briefing');
    act(client, '0', 'acknowledge', raw(client).epoch);
    expect(raw(client).deadline).toBeNull();
    ackAll(client); expect(raw(client).deadline).toBe(now + 30000);
  });
});

describe('夜間計時、技能與秘密資訊', () => {
  it.each(['online', 'assisted'] as const)('%s 模式四段夜晚固定長度，缺少或死亡神職也不跳過', mode => {
    const client = makeClient(6, { mode, nightSeconds: 17 }); toNight(client);
    const G = structuredClone(raw(client));
    expect(advanceMoonClock(G, now + 16999)).toBe(false);
    expect(advanceMoonClock(G, Number.NaN)).toBe(false);
    for (let step = 0; step < 4; step++) {
      expect(raw(client).nightStep).toBe(step);
      expect(raw(client).deadline).toBe(now + 17000);
      tick(client, step === 1 ? 3_600_000 : 0);
    }
    expect(raw(client).status).toBe('dawn'); expect(raw(client).dawnDeaths).toEqual([]);
    expect(raw(client).deadline).toBeNull();
    expect(raw(client).log.map(e => e.type)).toEqual(['start', 'night', 'dawn']);
  });
  it('狼人可修改密票並相認；同票或全棄權不襲擊，不得選狼人', () => {
    const client = makeClient(); toNight(client); nextNightStep(client, 1);
    const [wolfA, wolfB] = wolves(client), [a, b] = villagers(client);
    act(client, wolfA, 'wolfVote', wolfB, raw(client).epoch);
    expect(raw(client).private[wolfA].nightSubmitted).toBe(false);
    act(client, wolfA, 'wolfVote', a, raw(client).epoch);
    act(client, wolfB, 'wolfVote', b, raw(client).epoch);
    expect(moonPlayerView({ G: raw(client), playerID: wolfB }).private[wolfB].wolfVotes).toEqual({ [wolfA]: a, [wolfB]: b });
    expect(moonObserverView(raw(client), 'blind').private).toEqual({});
    act(client, wolfA, 'wolfVote', null, raw(client).epoch);
    act(client, wolfA, 'wolfVote', a, raw(client).epoch);
    finishNight(client);
    expect(raw(client).dawnDeaths).toEqual([]);
  });
  it('狼人票唯一最高者遇害；不公布原因或死者身分', () => {
    const client = makeClient(); toNight(client);
    const victim = villagers(client)[0]; wolfAttack(client, victim); finishNight(client);
    expect(raw(client).players[victim].alive).toBe(false);
    expect(raw(client).dawnDeaths).toEqual([victim]);
    expect(raw(client).players[victim].revealedRole).toBeUndefined();
    expect(moonObserverView(raw(client), 'blind').log.at(-1)).toEqual({ type: 'dawn', day: 1, deaths: [victim] });
    const before = structuredClone(raw(client)); act(client, victim, 'acknowledge', raw(client).epoch); expect(raw(client)).toEqual(before);
  });
  it('守衛可自守、不可連守、放棄一晚後可再次守相同人', () => {
    const client = makeClient(); toNight(client);
    const guardID = roleID(client, 'guard');
    act(client, guardID, 'guard', guardID, raw(client).epoch);
    wolfAttack(client, guardID); finishNight(client); expect(raw(client).players[guardID].alive).toBe(true);
    toVote(client); voteAll(client, null); ackAll(client);
    const before = structuredClone(raw(client)); act(client, guardID, 'guard', guardID, raw(client).epoch); expect(raw(client)).toEqual(before);
    act(client, guardID, 'guard', null, raw(client).epoch); finishNight(client);
    toVote(client); voteAll(client, null); ackAll(client);
    act(client, guardID, 'guard', guardID, raw(client).epoch); expect(raw(client).private[guardID].nightChoice).toBe(guardID);
  });
  it('預言家每晚只能查驗一次，資料不會傳給其他玩家', () => {
    const client = makeClient(); toNight(client); nextNightStep(client, 2);
    const seer = roleID(client, 'seer'), wolf = wolves(client)[0], villager = villagers(client)[0];
    act(client, villager, 'inspect', wolf, raw(client).epoch);
    act(client, seer, 'inspect', seer, raw(client).epoch);
    expect(raw(client).private[seer].checks).toEqual([]);
    act(client, seer, 'inspect', wolf, raw(client).epoch);
    act(client, seer, 'inspect', villager, raw(client).epoch);
    expect(raw(client).private[seer].checks).toEqual([{ day: 1, targetID: wolf, isWolf: true }]);
    expect(moonPlayerView({ G: raw(client), playerID: villager }).private[seer]).toBeUndefined();
    expect(moonObserverView(raw(client), 'god').private[seer].checks).toHaveLength(1);
  });
  it('女巫解藥一局一次、與守護疊加不致死；用後下一晚不再看見襲擊目標', () => {
    const client = makeClient(); toNight(client);
    const witch = roleID(client, 'witch'), guard = roleID(client, 'guard'), victim = villagers(client)[0];
    act(client, guard, 'guard', victim, raw(client).epoch); wolfAttack(client, victim); nextNightStep(client, 3);
    expect(raw(client).private[witch].attackedID).toBe(victim);
    act(client, witch, 'witch', 'save', victim, raw(client).epoch);
    act(client, witch, 'witch', 'poison', wolves(client)[0], raw(client).epoch);
    expect(raw(client).private[witch]).toMatchObject({ antidote: false, poison: true, witchChoice: 'save' });
    finishNight(client); expect(raw(client).dawnDeaths).toEqual([]);
    toVote(client); voteAll(client, null); ackAll(client); wolfAttack(client, victim); nextNightStep(client, 3);
    expect(raw(client).private[witch].attackedID).toBeNull();
    act(client, witch, 'witch', 'save', victim, raw(client).epoch); expect(raw(client).private[witch].nightSubmitted).toBe(false);
  });
  it('女巫只有第一晚能自救，不能自毒或同晚用兩藥', () => {
    const first = makeClient(); toNight(first); const witch = roleID(first, 'witch'); wolfAttack(first, witch); nextNightStep(first, 3);
    act(first, witch, 'witch', 'poison', witch, raw(first).epoch); expect(raw(first).private[witch].poison).toBe(true);
    act(first, witch, 'witch', 'save', witch, raw(first).epoch); finishNight(first); expect(raw(first).players[witch].alive).toBe(true);
    const second = makeClient(); toNight(second); patch(second, G => { G.day = 2; }); const witch2 = roleID(second, 'witch');
    wolfAttack(second, witch2); nextNightStep(second, 3);
    act(second, witch2, 'witch', 'save', witch2, raw(second).epoch); expect(raw(second).private[witch2].antidote).toBe(true);
    finishNight(second); expect(raw(second).players[witch2].alive).toBe(false);
  });
  it('毒藥穿透守護，獵人被毒死不能開槍，也不公開毒死原因', () => {
    const client = makeClient(); toNight(client);
    const hunter = roleID(client, 'hunter'), witch = roleID(client, 'witch'), guard = roleID(client, 'guard');
    act(client, guard, 'guard', hunter, raw(client).epoch); wolfAttack(client, hunter); nextNightStep(client, 3);
    act(client, witch, 'witch', 'poison', hunter, raw(client).epoch); finishNight(client);
    expect(raw(client).status).toBe('dawn'); expect(raw(client).hunterID).toBeNull();
    expect(raw(client).players[hunter]).toMatchObject({ alive: false }); expect(raw(client).players[hunter].revealedRole).toBeUndefined();
    expect(JSON.stringify(moonObserverView(raw(client), 'blind'))).not.toContain('poison');
  });
  it('技能截止時間包含等號；不能冒用其他職業、跨階段或舊epoch操作', () => {
    const client = makeClient(); toNight(client); const guard = roleID(client, 'guard'), other = villagers(client)[0];
    const before = structuredClone(raw(client));
    act(client, other, 'guard', other, raw(client).epoch); act(client, guard, 'guard', other, raw(client).epoch - 1);
    act(client, guard, 'wolfVote', other, raw(client).epoch); act(client, '99', 'guard', other, raw(client).epoch);
    now = raw(client).deadline!; act(client, guard, 'guard', other, raw(client).epoch);
    expect(raw(client)).toEqual(before);
  });
});

describe('發言、放逐、獵人與勝敗', () => {
  it('只有發言者可提前結束；計時到期推進一次且重啟不連跳', () => {
    const client = makeClient(6, { speechSeconds: 23 }); toNight(client); finishNight(client); ackAll(client);
    const speaker = raw(client).speakerID!, other = Object.keys(raw(client).players).find(id => id !== speaker)!;
    const before = structuredClone(raw(client)); act(client, other, 'finishSpeech', raw(client).epoch); expect(raw(client)).toEqual(before);
    act(client, speaker, 'finishSpeech', raw(client).epoch); expect(raw(client).speechIndex).toBe(1);
    tick(client, 1_000_000); expect(raw(client).speechIndex).toBe(2); expect(raw(client).deadline).toBe(now + 23000);
    toVote(client); expect(raw(client).speakerID).toBeNull();
  });
  it('表決密票全員提交後公開、不得重投，過期未投視為棄權', () => {
    const client = makeClient(); toNight(client); finishNight(client); toVote(client);
    const target = wolves(client)[0], ids = Object.keys(raw(client).players), epoch = raw(client).epoch;
    act(client, ids[0], 'exileVote', target, epoch); act(client, ids[0], 'exileVote', null, epoch);
    expect(raw(client).private[ids[0]].ownVote).toBe(target);
    expect(moonObserverView(raw(client), 'blind').lastVote).toBeNull();
    expect(moonPlayerView({ G: raw(client), playerID: ids[1] }).private[ids[0]]).toBeUndefined();
    tick(client); expect(raw(client).lastVote?.votes[ids[1]]).toBeNull();
    expect(raw(client).players[target].alive).toBe(false); expect(raw(client).status).toBe('vote-review');
  });
  it('同票僅加投一次，第二次仍同票不放逐，全棄權不進加投', () => {
    const client = makeClient(6); toNight(client); finishNight(client); toVote(client);
    const ids = Object.keys(raw(client).players), [a, b] = ids;
    let epoch = raw(client).epoch; ids.forEach((id, index) => act(client, id, 'exileVote', index < 3 ? a : b, epoch));
    expect(raw(client).lastVote?.tied).toEqual([a, b]); ackAll(client);
    expect(raw(client).voteRound).toBe(2); expect(raw(client).voteCandidates).toEqual([a, b]);
    act(client, ids[0], 'exileVote', ids[2], raw(client).epoch); expect(raw(client).private[ids[0]].voteSubmitted).toBe(false);
    epoch = raw(client).epoch; ids.forEach((id, index) => act(client, id, 'exileVote', index < 3 ? a : b, epoch));
    ackAll(client); expect(raw(client).status).toBe('night'); expect(raw(client).day).toBe(2);
    finishNight(client); toVote(client); voteAll(client, null); ackAll(client);
    expect(raw(client).status).toBe('night'); expect(raw(client).day).toBe(3);
  });
  it.each(['night', 'exile'] as const)('獵人%s死亡後可開槍，等待獵人完成才結算勝負', cause => {
    const client = makeClient(7); toNight(client); const hunter = roleID(client, 'hunter'), wolf = wolves(client)[0];
    if (cause === 'night') { wolfAttack(client, hunter); finishNight(client); }
    else { finishNight(client); toVote(client); voteAll(client, hunter); }
    expect(raw(client).status).toBe('hunter'); expect(raw(client).players[hunter].revealedRole).toBe('hunter');
    const before = structuredClone(raw(client)); act(client, wolf, 'hunterShoot', hunter, raw(client).epoch); expect(raw(client)).toEqual(before);
    act(client, hunter, 'hunterShoot', wolf, raw(client).epoch);
    expect(raw(client).players[wolf].alive).toBe(false); expect(raw(client).hunterID).toBeNull();
    expect(raw(client).status).toBe(cause === 'night' ? 'dawn' : 'vote-review');
  });
  it('獵人逾時視為放棄；狼全滅優先判好人，達人數優勢判狼人', () => {
    const hunterClient = makeClient(7); toNight(hunterClient); wolfAttack(hunterClient, roleID(hunterClient, 'hunter')); finishNight(hunterClient);
    tick(hunterClient); expect(raw(hunterClient).log.at(-1)?.targetID).toBeNull();
    const town = makeClient(6); toNight(town); finishNight(town); toVote(town);
    const [first, last] = wolves(town); patch(town, G => { G.players[first].alive = false; }); voteAll(town, last);
    expect(raw(town)).toMatchObject({ status: 'finished', winner: 'town', winReason: 'wolves-eliminated', deadline: null });
    expect(Object.values(moonObserverView(raw(town), 'blind').players).every(p => p.revealedRole)).toBe(true);
    const evil = makeClient(6); toNight(evil); const victims = Object.keys(raw(evil).players).filter(id => raw(evil).private[id].role !== 'wolf');
    patch(evil, G => { G.players[victims[0]].alive = false; }); wolfAttack(evil, victims[1]); finishNight(evil);
    expect(raw(evil)).toMatchObject({ status: 'finished', winner: 'wolves', winReason: 'wolves-dominate' });
  });
  it('狼人剛達人數優勢時仍先讓獵人開槍，獵人可改變裁定', () => {
    const client = makeClient(7); toNight(client);
    const hunter = roleID(client, 'hunter'), wolf = wolves(client)[0];
    patch(client, G => { for (const id of villagers(client)) G.players[id].alive = false; });
    wolfAttack(client, hunter); finishNight(client);
    expect(raw(client).status).toBe('hunter'); expect(raw(client).winner).toBeNull();
    act(client, hunter, 'hunterShoot', wolf, raw(client).epoch);
    expect(raw(client).status).toBe('dawn'); expect(raw(client).winner).toBeNull();
  });
});

describe('可選警長', () => {
  it('無人報名無警長，一人報名自動當選；非警長不能選發言順序', () => {
    const none = makeClient(6, { sheriff: true }); sheriffSignup(none, []);
    expect(raw(none).status).toBe('speaking'); expect(raw(none).sheriffID).toBeNull(); expect(raw(none).electionDone).toBe(true);
    const one = makeClient(6, { sheriff: true }); sheriffSignup(one, ['2']); expect(raw(one).sheriffID).toBe('2');
    expect(raw(one).status).toBe('sheriff-order');
    const before = structuredClone(raw(one)); act(one, '1', 'chooseOrder', '4', 'counterclockwise', raw(one).epoch); expect(raw(one)).toEqual(before);
    act(one, '2', 'chooseOrder', '4', 'counterclockwise', raw(one).epoch); expect(raw(one).speakingOrder).toEqual(['4', '3', '2', '1', '0', '5']);
  });
  it('警長可逾時採預設順序；候選人只能退出、不能投票', () => {
    const client = makeClient(6, { sheriff: true }); sheriffSignup(client, ['0', '1', '2']);
    act(client, '3', 'standForSheriff', true, raw(client).epoch); expect(raw(client).sheriffCandidates).toEqual(['0', '1', '2']);
    act(client, '0', 'standForSheriff', false, raw(client).epoch); expect(raw(client).speakerID).toBe('1');
    finishElectionSpeeches(client); expect(raw(client).status).toBe('sheriff-voting');
    act(client, '1', 'sheriffVote', '1', raw(client).epoch); expect(raw(client).private['1'].voteSubmitted).toBe(false);
    electionVotes(client, ['2', '2', '2', '2']); expect(raw(client).sheriffID).toBe('2');
    tick(client); expect(raw(client).speakingOrder).toEqual(['0', '1', '2', '3', '4', '5']);
  });
  it('警長首輪同票候選人再次發言，第二輪仍同票則無警長', () => {
    const client = makeClient(6, { sheriff: true }); sheriffSignup(client, ['0', '1']); finishElectionSpeeches(client);
    electionVotes(client, ['0', '0', '1', '1']); expect(raw(client).sheriffRound).toBe(2); expect(raw(client).status).toBe('sheriff-speech');
    finishElectionSpeeches(client); electionVotes(client, ['0', '0', '1', '1']);
    expect(raw(client).sheriffID).toBeNull(); expect(raw(client).status).toBe('speaking');
    expect(raw(client).log.filter(e => e.type === 'sheriff-election')).toHaveLength(2);
  });
  it('所有人競選沒有可投票者，不會卡住；退出至單人立即當選', () => {
    const all = makeClient(6, { sheriff: true }); sheriffSignup(all, ['0', '1', '2', '3', '4', '5']); finishElectionSpeeches(all);
    expect(raw(all).status).toBe('speaking'); expect(raw(all).sheriffID).toBeNull();
    const quit = makeClient(6, { sheriff: true }); sheriffSignup(quit, ['0', '1']);
    act(quit, '1', 'standForSheriff', false, raw(quit).epoch);
    expect(raw(quit).sheriffID).toBe('0'); expect(raw(quit).status).toBe('sheriff-order');
  });
  it('加選發言時退選至單人，結果記為新一輪直接當選', () => {
    const client = makeClient(6, { sheriff: true }); sheriffSignup(client, ['0', '1']); finishElectionSpeeches(client);
    electionVotes(client, ['0', '0', '1', '1']);
    act(client, '1', 'standForSheriff', false, raw(client).epoch);
    expect(raw(client).electionResult).toEqual({ round: 2, winnerID: '0', votes: {}, tied: [] });
    expect(raw(client).log.at(-1)).toMatchObject({ type: 'sheriff-election', round: 2, targetID: '0', votes: {}, tied: [] });
  });
  it('警長放逐票為1.5票，用整數半票精確打破同票', () => {
    const client = makeClient(8); toNight(client); finishNight(client); toVote(client);
    const [a, b] = wolves(client), ids = Object.keys(raw(client).players);
    patch(client, G => { G.sheriffID = ids[0]; });
    const epoch = raw(client).epoch;
    ids.forEach((id, index) => act(client, id, 'exileVote', index < 4 ? a : b, epoch));
    expect(raw(client).lastVote?.exiledID).toBe(a);
    expect(raw(client).lastVote?.weights[ids[0]]).toBe(3); expect(raw(client).lastVote?.weights[ids[1]]).toBe(2);
  });
  it('死亡獵人警長先開槍再交徽，非持徽者不可代轉；交徽後才裁定', () => {
    const client = makeClient(7); toNight(client); const hunter = roleID(client, 'hunter'), target = wolves(client)[0], recipient = villagers(client)[0];
    patch(client, G => { G.sheriffID = hunter; G.electionDone = true; G.options.sheriff = true; });
    wolfAttack(client, hunter); finishNight(client); expect(raw(client).status).toBe('hunter');
    act(client, hunter, 'hunterShoot', target, raw(client).epoch);
    expect(raw(client).status).toBe('sheriff-transfer'); expect(raw(client).sheriffTransferID).toBe(hunter);
    const before = structuredClone(raw(client)); act(client, recipient, 'transferBadge', recipient, raw(client).epoch); expect(raw(client)).toEqual(before);
    act(client, hunter, 'transferBadge', recipient, raw(client).epoch);
    expect(raw(client).sheriffID).toBe(recipient); expect(raw(client).status).toBe('dawn');
    ackAll(client); expect(raw(client).status).toBe('sheriff-order');
  });
  it('警長被獵人帶走也要交徽；逾時撕徽，不能交給死者', () => {
    const client = makeClient(7); toNight(client); const hunter = roleID(client, 'hunter'), sheriff = villagers(client)[0];
    patch(client, G => { G.sheriffID = sheriff; G.electionDone = true; G.options.sheriff = true; });
    wolfAttack(client, hunter); finishNight(client); act(client, hunter, 'hunterShoot', sheriff, raw(client).epoch);
    expect(raw(client).sheriffTransferID).toBe(sheriff);
    act(client, sheriff, 'transferBadge', hunter, raw(client).epoch); expect(raw(client).status).toBe('sheriff-transfer');
    tick(client); expect(raw(client).sheriffID).toBeNull(); expect(raw(client).status).toBe('dawn');
  });
});

describe('隔離、唯讀投影與框架防護', () => {
  it('投影採白名單，無跨人情報、秘密或意外新增欄位，且無共用參照', () => {
    const client = makeClient(), G = structuredClone(raw(client)), expected = structuredClone(G.private);
    Object.assign(G, { hiddenToken: 'hidden-root' }); Object.assign(G.options, { hidden: 'hidden-option' });
    Object.assign(G.players['0'], { hidden: 'hidden-player' }); Object.assign(G.private['0'], { hidden: 'hidden-private' });
    Object.assign(G.log[0], { hidden: 'hidden-log' }); G.private.unseated = { ...G.private['0'] };
    const before = structuredClone(G);
    for (const id of [null, 'unseated', 'constructor', '__proto__', '99']) expect(moonPlayerView({ G, playerID: id }).private).toEqual({});
    const own = moonPlayerView({ G, playerID: '0' }), god = moonObserverView(G, 'god'), blind = moonObserverView(G, 'blind');
    expect(own.private).toEqual({ '0': expected['0'] }); expect(god.private).toEqual(expected); expect(blind.private).toEqual({});
    for (const view of [own, god, blind]) expect(JSON.stringify(view)).not.toMatch(/hidden|unseated|secret/);
    own.options.mode = 'assisted'; god.private['0'].knownWolves.push('99'); blind.log[0].actorID = '99'; god.players['0'].alive = false;
    expect(G).toEqual(before);
    expect(JSON.stringify(client.getState()!.plugins.random)).not.toMatch(/seed|prngstate/);
  });
  it('多房間技能與時間互不影響，過期動作不能改新階段', () => {
    const a = makeClient(), b = makeClient(6, { mode: 'assisted' }, undefined, 'other-room');
    const beforeB = structuredClone(raw(b)); toNight(a); const epoch = raw(a).epoch; tick(a);
    expect(raw(b)).toEqual(beforeB);
    const beforeA = structuredClone(raw(a)); act(a, wolves(a)[0], 'wolfVote', villagers(a)[0], epoch); expect(raw(a)).toEqual(beforeA);
    toNight(b); tick(b); expect(raw(a)).toEqual(beforeA);
  });
  it('動作只由伺服器裁定，不能預測秘密、撤銷或任意結束遊戲', () => {
    for (const move of Object.values(MoonGame.moves!)) expect(move).toMatchObject({ client: false, undoable: false, redact: true });
    const client = makeClient(), state = structuredClone(client.store.getState());
    const projected = { ...state, G: moonPlayerView({ G: state.G, playerID: '0' }), plugins: { random: { data: {} } } };
    const reducer = CreateGameReducer({ game: MoonGame, isClient: true });
    const prediction = reducer(projected, { type: 'MAKE_MOVE', payload: { type: 'acknowledge', args: [state.G.epoch], playerID: '0' } });
    expect(prediction.G).toEqual(projected.G);
    toNight(client); expect(client.store.getState()._undo).toEqual([]);
    const before = structuredClone(raw(client)); client.undo(); expect(raw(client)).toEqual(before);
  });
  it.each(['endGame', 'endTurn', 'endPhase', 'setPhase', 'setStage', 'endStage', 'setActivePlayers', 'pass'])('拒絕直接%s框架事件', type => {
    const client = makeClient(), before = structuredClone(client.store.getState());
    client.store.dispatch({ type: 'GAME_EVENT', payload: { type, args: type === 'setActivePlayers' ? [{ currentPlayer: 'hacked' }] : [], playerID: '0' } });
    expect(raw(client)).toEqual(before.G); expect(client.store.getState().ctx).toEqual(before.ctx);
  });
});
