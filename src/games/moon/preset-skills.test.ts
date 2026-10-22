import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { MoonGame, advanceMoonClock, moonClockDeadline, moonObserverView, type MoonState } from './game';
import { normalizeMoonOptions, type MoonOptions, type MoonRole } from './rules';

let now = 1_800_000_000_000;
beforeEach(() => { now = 1_800_000_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
function setup(presetId: string, count: number, options: Partial<MoonOptions> = {}) {
  const game = { ...MoonGame, seed: 'preset-skills' };
  const client = Client({ game, numPlayers: count, playerID: '0', debug: false });
  const match = createMatch({ game, numPlayers: count, setupData: { startImmediately: true, options: normalizeMoonOptions({ ...options, presetId }) }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  return client;
}
type TestClient = ReturnType<typeof setup>;
const raw = (c: TestClient) => c.store.getState().G as MoonState;
const ids = (c: TestClient, role: MoonRole) => Object.keys(raw(c).private).filter(id => raw(c).private[id].role === role);
const id = (c: TestClient, role: MoonRole) => ids(c, role)[0];
const alive = (c: TestClient) => Object.keys(raw(c).players).filter(id => raw(c).players[id].alive);
function act(c: TestClient, actor: string, move: string, ...args: unknown[]) { c.updatePlayerID(actor); c.moves[move](...args); }
function patch(c: TestClient, mutate: (G: MoonState) => void) {
  const state = JSON.parse(JSON.stringify(c.store.getState())) as State<MoonState>; mutate(state.G);
  if (state.G.status === 'finished') state.ctx.gameover = { winner: state.G.winner, reason: state.G.winReason };
  c.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function tick(c: TestClient) { now = moonClockDeadline(raw(c))!; patch(c, G => expect(advanceMoonClock(G, now)).toBe(true)); }
function ack(c: TestClient) { const epoch = raw(c).epoch; for (const actor of alive(c)) act(c, actor, 'acknowledge', epoch); }
function nightStep(c: TestClient, step: number) {
  if (raw(c).status === 'briefing') ack(c);
  for (let n = 0; n < 5 && raw(c).status === 'night' && raw(c).nightStep < step; n++) tick(c);
  expect(raw(c)).toMatchObject({ status: 'night', nightStep: step });
}
function finishNight(c: TestClient) { for (let n = 0; n < 5 && raw(c).status === 'night'; n++) tick(c); }
function attack(c: TestClient, target: string) {
  nightStep(c, 1); const epoch = raw(c).epoch;
  for (const actor of alive(c).filter(actor => raw(c).private[actor].faction === 'wolves')) act(c, actor, 'wolfVote', target, epoch);
}
function speak(c: TestClient) {
  if (raw(c).status === 'briefing') ack(c);
  finishNight(c);
  if (raw(c).status === 'dawn') ack(c);
  expect(raw(c).status).toBe('speaking');
}
function vote(c: TestClient, target: string) {
  if (raw(c).status === 'dawn') ack(c);
  for (let n = 0; n < 13 && raw(c).status === 'speaking'; n++) act(c, raw(c).speakerID!, 'finishSpeech', raw(c).epoch);
  expect(raw(c).status).toBe('voting'); const epoch = raw(c).epoch;
  for (const actor of alive(c).filter(actor => !raw(c).players[actor].voteDisabled)) act(c, actor, 'exileVote', target, epoch);
}

describe('特殊角色夜間結算', () => {
  it('同驗同毒只反傷先行預言家，守護及解藥無法抵銷，惡靈永久免毒', () => {
    const c = setup('seven-ghost-rider', 7), ghost = id(c, 'ghost-rider'), seer = id(c, 'seer'), witch = id(c, 'witch');
    nightStep(c, 0); act(c, id(c, 'guard'), 'guard', seer, raw(c).epoch);
    attack(c, seer); nightStep(c, 2); act(c, seer, 'inspect', ghost, raw(c).epoch);
    nightStep(c, 3); act(c, witch, 'witch', 'poison', ghost, raw(c).epoch); finishNight(c);
    expect(raw(c).dawnDeaths).toEqual([seer]); expect(raw(c).players[ghost].alive).toBe(true); expect(raw(c).players[witch].alive).toBe(true);
    expect(raw(c).private[ghost].reflectionUsed).toBe(true);
    expect(JSON.stringify(moonObserverView(raw(c), 'blind'))).not.toMatch(/reflectionUsed|reflectionVictims|deathCauses|poisonTarget/);
    const saved = setup('seven-ghost-rider', 7), gs = id(saved, 'ghost-rider'), ss = id(saved, 'seer');
    attack(saved, ss); nightStep(saved, 2); act(saved, ss, 'inspect', gs, raw(saved).epoch);
    nightStep(saved, 3); act(saved, id(saved, 'witch'), 'witch', 'save', ss, raw(saved).epoch); finishNight(saved);
    expect(raw(saved).players[ss].alive).toBe(false);
  });
  it('沒有先行查驗時女巫中反傷，反傷使用後不會再次發動', () => {
    const c = setup('seven-ghost-rider', 7), ghost = id(c, 'ghost-rider'), witch = id(c, 'witch');
    nightStep(c, 3); act(c, witch, 'witch', 'poison', ghost, raw(c).epoch); finishNight(c);
    expect(raw(c).dawnDeaths).toEqual([witch]); expect(raw(c).players[ghost].alive).toBe(true);
    const used = setup('seven-ghost-rider', 7), g = id(used, 'ghost-rider'); patch(used, G => { G.private[g].reflectionUsed = true; });
    nightStep(used, 2); act(used, id(used, 'seer'), 'inspect', g, raw(used).epoch);
    nightStep(used, 3); act(used, id(used, 'witch'), 'witch', 'poison', g, raw(used).epoch); finishNight(used);
    expect(raw(used).dawnDeaths).toEqual([]); expect(raw(used).private[id(used, 'witch')].poison).toBe(false);
  });
  it.each(['hunter', 'wolf-king'] as const)('同時中刀及中毒的 %s 不可開槍', role => {
    const c = setup('six-wolf-king', 6), target = id(c, role);
    attack(c, target); nightStep(c, 3); act(c, id(c, 'witch'), 'witch', 'poison', target, raw(c).epoch); finishNight(c);
    expect(raw(c).players[target].alive).toBe(false); expect(raw(c).hunterID).toBeNull(); expect(raw(c).status).toBe('dawn');
    const before = structuredClone(raw(c)); act(c, target, 'hunterShoot', id(c, 'seer'), raw(c).epoch); expect(raw(c)).toEqual(before);
  });
  it.each(['survive', 'die'] as const)('同守同救遵守本局 %s 房規', doubleProtection => {
    const c = setup('seven-ghost-rider', 7, { doubleProtection }), target = id(c, 'villager');
    nightStep(c, 0); act(c, id(c, 'guard'), 'guard', target, raw(c).epoch); attack(c, target);
    nightStep(c, 3); act(c, id(c, 'witch'), 'witch', 'save', target, raw(c).epoch); finishNight(c);
    expect(raw(c).players[target].alive).toBe(doubleProtection === 'survive');
  });
});

describe('死亡技能、白癡與勝負', () => {
  it('獵人射殺最後一狼仍先結算狼王槍，帶走最後好人形成平局', () => {
    const c = setup('six-wolf-king', 6), hunter = id(c, 'hunter'), king = id(c, 'wolf-king'), villager = id(c, 'villager');
    ack(c); finishNight(c); patch(c, G => { for (const actor of Object.keys(G.players)) G.players[actor].alive = [hunter, king, villager].includes(actor); }); ack(c);
    vote(c, hunter); expect(raw(c).hunterID).toBe(hunter);
    act(c, hunter, 'hunterShoot', king, raw(c).epoch); expect(raw(c)).toMatchObject({ status: 'hunter', hunterID: king, winner: null });
    act(c, king, 'hunterShoot', villager, raw(c).epoch);
    expect(raw(c)).toMatchObject({ status: 'finished', winner: 'draw', winReason: 'mutual-elimination' });
    expect(raw(c).log.filter(e => e.type === 'hunter').map(e => e.actorID)).toEqual([hunter, king]);
  });
  it('四獵人強制開槍、連續出局逐一處理，重複操作無效', () => {
    const c = setup('six-hunters', 6), hunters = ids(c, 'hunter'); speak(c); vote(c, hunters[0]);
    const before = structuredClone(raw(c)); act(c, hunters[0], 'hunterShoot', null, raw(c).epoch); expect(raw(c)).toEqual(before);
    for (let i = 0; i < 3; i++) {
      expect(raw(c).hunterID).toBe(hunters[i]); const epoch = raw(c).epoch;
      act(c, hunters[i], 'hunterShoot', hunters[i + 1], epoch);
      const next = structuredClone(raw(c)); act(c, hunters[i], 'hunterShoot', id(c, 'wolf'), epoch); expect(raw(c)).toEqual(next);
    }
    expect(raw(c).hunterID).toBe(hunters[3]); expect(raw(c).winner).toBeNull();
    act(c, hunters[3], 'hunterShoot', id(c, 'wolf'), raw(c).epoch); expect(raw(c).winner).toBe('wolves');
  });
  it('最後一狼射殺最後獵人時沒有合法目標，略過空射擊與空警徽交接直接平局', () => {
    const c = setup('six-wolf-king', 6, { sheriff: true }), hunter = id(c, 'hunter'), king = id(c, 'wolf-king');
    ack(c); finishNight(c);
    patch(c, G => { for (const actor of Object.keys(G.players)) G.players[actor].alive = [hunter, king].includes(actor); G.sheriffID = hunter; G.electionDone = true; });
    ack(c); act(c, hunter, 'chooseOrder', hunter, 'clockwise', raw(c).epoch); vote(c, king);
    expect(raw(c).hunterID).toBe(king); act(c, king, 'hunterShoot', hunter, raw(c).epoch);
    expect(raw(c)).toMatchObject({ status: 'finished', winner: 'draw', hunterID: null, sheriffID: null });
    expect(raw(c).log.filter(e => e.type === 'hunter')).toHaveLength(1);
  });
  it('強制開槍逾時採已保存隨機順序，重啟不重抽', () => {
    const c = setup('six-hunters', 6); speak(c); vote(c, id(c, 'hunter'));
    const a = JSON.parse(JSON.stringify(raw(c))) as MoonState, b = structuredClone(a);
    advanceMoonClock(a, a.deadline!); advanceMoonClock(b, b.deadline!);
    const shot = a.log.find(e => e.type === 'hunter')!;
    expect(shot.targetID).not.toBeNull(); expect(b).toEqual(a);
  });
  it('白狼王自爆帶走獵人時可開槍，再帶走惡靈；普通狼王自爆不能開槍', () => {
    const c = setup('eight-ragnarok', 8), white = id(c, 'white-wolf-king'), hunter = id(c, 'hunter'), ghost = id(c, 'ghost-rider');
    speak(c); act(c, white, 'wolfExplode', hunter, raw(c).epoch); expect(raw(c).hunterID).toBe(hunter);
    act(c, hunter, 'hunterShoot', ghost, raw(c).epoch); expect(raw(c).players[ghost].alive).toBe(false); expect(raw(c).status).toBe('vote-review');
    ack(c); expect(raw(c)).toMatchObject({ status: 'night', day: 2 });
    const k = setup('six-wolf-king', 6); speak(k); act(k, id(k, 'wolf-king'), 'wolfExplode', null, raw(k).epoch);
    expect(raw(k).hunterID).toBeNull(); expect(raw(k).status).toBe('vote-review');
  });
  it('白狼王被放逐沒有帶人，惡靈不能自爆且投票中禁止自爆', () => {
    const c = setup('eight-ragnarok', 8); speak(c);
    const before = structuredClone(raw(c)); act(c, id(c, 'ghost-rider'), 'wolfExplode', null, raw(c).epoch); expect(raw(c)).toEqual(before);
    for (let n = 0; n < 13 && raw(c).status === 'speaking'; n++) act(c, raw(c).speakerID!, 'finishSpeech', raw(c).epoch);
    const voting = structuredClone(raw(c)); act(c, id(c, 'white-wolf-king'), 'wolfExplode', id(c, 'seer'), raw(c).epoch); expect(raw(c)).toEqual(voting);
    vote(c, id(c, 'white-wolf-king')); expect(raw(c).hunterID).toBeNull(); expect(raw(c).players[id(c, 'seer')].alive).toBe(true);
  });
  it('白癡首次放逐免死、失去票權但仍發言，第二次放逐死亡', () => {
    const c = setup('six-idiot', 6), idiot = id(c, 'idiot'); speak(c); vote(c, idiot);
    expect(raw(c).players[idiot]).toMatchObject({ alive: true, voteDisabled: true, revealedRole: 'idiot' }); expect(raw(c).lastVote!.exiledID).toBeNull();
    ack(c); finishNight(c); ack(c); expect(raw(c).speakingOrder).toContain(idiot);
    for (let n = 0; n < 13 && raw(c).status === 'speaking'; n++) act(c, raw(c).speakerID!, 'finishSpeech', raw(c).epoch);
    const before = structuredClone(raw(c)); act(c, idiot, 'exileVote', id(c, 'wolf'), raw(c).epoch); expect(raw(c)).toEqual(before);
    vote(c, idiot); expect(raw(c).players[idiot].alive).toBe(false); expect(raw(c).lastVote!.votes).not.toHaveProperty(idiot);
  });
  it('白癡被狼刀直接死亡，不享有翻牌免死', () => {
    const c = setup('six-idiot', 6), idiot = id(c, 'idiot'); attack(c, idiot); finishNight(c);
    expect(raw(c).players[idiot]).toMatchObject({ alive: false }); expect(raw(c).players[idiot].voteDisabled).toBeUndefined();
  });
  it('白癡警長翻牌後交接，不能把警徽交回已失票白癡', () => {
    const c = setup('seven-idiot', 7, { sheriff: true }), idiot = id(c, 'idiot');
    ack(c); finishNight(c); patch(c, G => { G.sheriffID = idiot; G.electionDone = true; }); ack(c);
    act(c, idiot, 'chooseOrder', idiot, 'clockwise', raw(c).epoch); vote(c, idiot);
    expect(raw(c).status).toBe('sheriff-transfer'); const before = structuredClone(raw(c));
    act(c, idiot, 'transferBadge', idiot, raw(c).epoch); expect(raw(c)).toEqual(before);
    act(c, idiot, 'transferBadge', id(c, 'seer'), raw(c).epoch); expect(raw(c).sheriffID).toBe(id(c, 'seer'));
  });
  it('屠城不以人數壓制結束，屠邊在平民全部死亡時結束', () => {
    const city = setup('six-witch', 6); ack(city);
    patch(city, G => { const town = Object.keys(G.private).filter(actor => G.private[actor].faction === 'town'); for (const actor of town.slice(2)) G.players[actor].alive = false; });
    finishNight(city); expect(raw(city).status).toBe('dawn'); expect(raw(city).winner).toBeNull();
    const edge = setup('seven-survivor', 7); attack(edge, id(edge, 'villager')); finishNight(edge);
    expect(raw(edge)).toMatchObject({ status: 'finished', winner: 'wolves', winReason: 'villagers-eliminated' });
  });
  it.each([['six-open', true], ['six-hidden', false]] as const)('%s 只依明暗牌房規公開出局者', (preset, reveal) => {
    const c = setup(preset, 6), target = id(c, 'villager'); attack(c, target); finishNight(c);
    expect(moonObserverView(raw(c), 'blind').players[target].revealedRole).toBe(reveal ? 'villager' : undefined);
  });
});
