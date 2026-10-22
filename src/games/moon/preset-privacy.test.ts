import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { MoonGame, advanceMoonClock, moonClockDeadline, moonObserverView, moonPlayerView, type MoonState } from './game';
import { MOON_PRESETS, MOON_ROLES, normalizeMoonOptions, type MoonRole } from './rules';

let now = 1_800_000_000_000;
beforeEach(() => { now = 1_800_000_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
function setup(presetId: string, count: number, mode: 'online' | 'assisted' = 'online') {
  const game = { ...MoonGame, seed: 'preset-privacy' };
  const participants = count === 6 ? ['1', '3', '5', '8', '10', '11'] : Array.from({ length: count }, (_, i) => String(i));
  const client = Client({ game, numPlayers: count, playerID: participants[0], debug: false });
  const match = createMatch({ game, numPlayers: count, setupData: { startImmediately: true, participantIDs: participants, options: normalizeMoonOptions({ presetId, mode }) }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  client.store.dispatch({ type: 'UPDATE', state: match.initialState, deltalog: [], clientOnly: true });
  return client;
}
type TestClient = ReturnType<typeof setup>;
const raw = (c: TestClient) => c.store.getState().G as MoonState;
const roleID = (c: TestClient, role: MoonRole) => Object.keys(raw(c).private).find(id => raw(c).private[id].role === role)!;
const living = (c: TestClient) => Object.keys(raw(c).players).filter(id => raw(c).players[id].alive);
function act(c: TestClient, actor: string, move: string, ...args: unknown[]) { c.updatePlayerID(actor); c.moves[move](...args); }
function patch(c: TestClient, mutate: (G: MoonState) => void) {
  const state = JSON.parse(JSON.stringify(c.store.getState())) as State<MoonState>; mutate(state.G);
  c.store.dispatch({ type: 'UPDATE', state, deltalog: [], clientOnly: true });
}
function ack(c: TestClient) { const epoch = raw(c).epoch; for (const actor of living(c)) act(c, actor, 'acknowledge', epoch); }
function tick(c: TestClient) { now = raw(c).deadline!; patch(c, G => expect(advanceMoonClock(G, now)).toBe(true)); }
function nightStep(c: TestClient, target: number) {
  if (raw(c).status === 'briefing') ack(c);
  for (let i = 0; i < 5 && raw(c).status === 'night' && raw(c).nightStep < target; i++) tick(c);
  expect(raw(c)).toMatchObject({ status: 'night', nightStep: target });
}
const cases = MOON_PRESETS.filter(p => p.count !== null).flatMap(p => (['online', 'assisted'] as const).map(mode => [p.id, p.count!, mode] as const));

describe('配置、私人投影與夜間資料邊界', () => {
  it.each(cases)('%s / %i 人 / %s 的各席位、盲視角與上帝視角使用獨立白名單', (presetId, count, mode) => {
    const c = setup(presetId, count, mode), G = structuredClone(raw(c));
    const seats = Object.keys(G.players), wolves = seats.filter(id => G.private[id].faction === 'wolves');
    const canary = 'private-field-must-not-leak';
    Object.assign(G, { unexpected: canary });
    Object.assign(G.options, { hiddenOptions: canary });
    Object.assign(G.configuration!, { seatAssignments: canary });
    Object.assign(G.log[0], { secretExplanation: canary });
    G.secret!.pendingShots = [seats[0]]; G.secret!.reflectionVictims = [seats[1]];
    G.secret!.deathCauses = { [seats[1]]: ['reflection'] };
    for (const id of seats) {
      Object.assign(G.players[id], { hiddenPlayer: canary });
      Object.assign(G.private[id], { hiddenPrivate: canary });
      expect(G.private[id].knownWolves).toEqual(G.private[id].faction === 'wolves' ? wolves.filter(w => w !== id) : []);
      expect(G.private[id].faction).toBe(MOON_ROLES[G.private[id].role].faction);
    }
    const before = structuredClone(G);
    const views = [
      ...seats.map(playerID => moonPlayerView({ G, playerID })),
      moonPlayerView({ G, playerID: 'missing' }), moonObserverView(G, 'blind'), moonObserverView(G, 'god'),
    ];
    for (const [index, view] of views.entries()) {
      expect(JSON.stringify(view)).not.toContain(canary);
      expect(view.secret).toBeUndefined();
      expect(view.configuration).toEqual(raw(c).configuration);
      expect(view.configuration).not.toBe(G.configuration);
      expect(view.configuration!.roles).not.toBe(G.configuration!.roles);
      expect(view.players).toEqual(raw(c).players);
      expect(Object.keys(view.private)).toEqual(index < seats.length ? [seats[index]] : index === views.length - 1 ? seats : []);
      if (index < seats.length && G.private[seats[index]].faction === 'town') expect(view.private[seats[index]].wolfTargets).toBeUndefined();
      view.configuration!.roles.length = 0;
      view.configuration!.victory = 'parity';
      view.players[seats[0]].alive = false;
      for (const info of Object.values(view.private)) { info.knownWolves.length = 0; info.wolfTargets?.splice(0); }
    }
    expect(G).toEqual(before);
  });

  it('反傷後只向當事人與授權上帝提供已知結果，隊友及盲視角不獲知反傷狀態', () => {
    const c = setup('seven-ghost-rider', 7), ghost = roleID(c, 'ghost-rider'), seer = roleID(c, 'seer'), wolf = roleID(c, 'wolf');
    nightStep(c, 2); act(c, seer, 'inspect', ghost, raw(c).epoch);
    const G = raw(c), own = moonPlayerView({ G, playerID: seer }), ghostView = moonPlayerView({ G, playerID: ghost });
    expect(own.private[seer].checks).toEqual([{ day: 1, targetID: ghost, isWolf: true }]);
    expect(ghostView.private[ghost].reflectionUsed).toBe(true);
    expect(moonObserverView(G, 'god').private[ghost].reflectionUsed).toBe(true);
    for (const view of [moonPlayerView({ G, playerID: wolf }), moonObserverView(G, 'blind')]) {
      expect(JSON.stringify(view)).not.toMatch(/reflectionUsed|reflectionVictims|deathCauses/);
      expect(view.players[seer].alive).toBe(true);
    }
    expect(own.secret).toBeUndefined();
    expect(own.private[ghost]).toBeUndefined();
  });

  it.each(['wolf-king', 'white-wolf-king', 'ghost-rider'] as const)('預言家查驗 %s 回報狼人，查驗後仍等待完整神職時段', role => {
    const c = setup('eight-ragnarok', 8), seer = roleID(c, 'seer'), target = roleID(c, role);
    nightStep(c, 2); const deadline = raw(c).deadline, epoch = raw(c).epoch;
    act(c, seer, 'inspect', target, epoch);
    expect(moonPlayerView({ G: raw(c), playerID: seer }).private[seer].checks).toContainEqual({ day: 1, targetID: target, isWolf: true });
    expect(moonClockDeadline(raw(c))).toBe(deadline);
    now += 3300; patch(c, G => expect(advanceMoonClock(G, now)).toBe(false));
    expect(raw(c)).toMatchObject({ epoch, deadline, status: 'night', nightStep: 2 });
  });

  it('全特殊狼配置保留共同狼時段，允許自刀與隊友目標，但所有狼都不能選惡靈', () => {
    const c = setup('eight-ragnarok', 8), ghost = roleID(c, 'ghost-rider'), king = roleID(c, 'wolf-king'), white = roleID(c, 'white-wolf-king');
    nightStep(c, 1); const epoch = raw(c).epoch;
    for (const actor of [ghost, king, white]) {
      const view = moonPlayerView({ G: raw(c), playerID: actor });
      expect(view.private[actor].wolfTargets).toContain(king);
      expect(view.private[actor].wolfTargets).toContain(white);
      expect(view.private[actor].wolfTargets).not.toContain(ghost);
      const before = structuredClone(raw(c)); act(c, actor, 'wolfVote', ghost, epoch); expect(raw(c)).toEqual(before);
      act(c, actor, 'wolfVote', king, epoch);
      expect(raw(c).secret!.wolfVotes[actor]).toBe(king);
    }
    expect(raw(c).secret!.nightAdvance).toMatchObject({ targetID: king, epoch });
    expect(moonClockDeadline(raw(c))).toBe(now + 3000);
    for (const perspective of ['blind', 'god'] as const) expect(JSON.stringify(moonObserverView(raw(c), perspective))).not.toMatch(/nightAdvance|attackTieOrder|shotOrders/);
    const originalDeadline = raw(c).deadline;
    act(c, white, 'wolfVote', white, epoch);
    expect(raw(c).secret!.nightAdvance).toBeUndefined();
    expect(raw(c).deadline).toBe(originalDeadline);
  });

  it.each(['six-simple', 'six-hunters', 'six-ghost-rider', 'six-gods'])('%s 首夜相認但不可襲擊，沒有私人 3 秒提前期限', presetId => {
    const c = setup(presetId, 6); nightStep(c, 1);
    const target = Object.keys(raw(c).private).find(id => raw(c).private[id].faction === 'town')!;
    const wolves = Object.keys(raw(c).private).filter(id => raw(c).private[id].faction === 'wolves');
    const original = structuredClone(raw(c));
    for (const wolf of wolves) {
      expect(moonPlayerView({ G: raw(c), playerID: wolf }).private[wolf].knownWolves).toEqual(wolves.filter(id => id !== wolf));
      expect(moonPlayerView({ G: raw(c), playerID: wolf }).private[wolf].wolfTargets).toEqual([]);
      act(c, wolf, 'wolfVote', target, raw(c).epoch);
      act(c, wolf, 'wolfVote', null, raw(c).epoch);
    }
    expect(raw(c)).toEqual(original);
    patch(c, G => { G.secret!.nightAdvance = { epoch: G.epoch, deadline: now + 3000, targetID: target }; });
    expect(moonClockDeadline(raw(c))).toBe(original.deadline);
    now += 3300; patch(c, G => expect(advanceMoonClock(G, now)).toBe(false));
    tick(c);
    expect(raw(c).secret!.attackTarget).toBeNull();
  });

  it('配置中的死亡神職仍保留完整四段；只有狼與獵人的配置只有狼時段', () => {
    const c = setup('seven-ghost-rider', 7);
    patch(c, G => { for (const [id, info] of Object.entries(G.private)) if (['guard', 'seer', 'witch'].includes(info.role)) G.players[id].alive = false; });
    ack(c);
    for (const step of [0, 1, 2, 3]) {
      expect(raw(c)).toMatchObject({ status: 'night', nightStep: step });
      const deadline = raw(c).deadline!;
      expect(deadline - now).toBe(raw(c).options.nightSeconds * 1000);
      now += 3300; patch(c, G => expect(advanceMoonClock(G, now)).toBe(false));
      tick(c);
    }
    expect(raw(c).status).toBe('dawn');
    const hunters = setup('six-hunters', 6); ack(hunters);
    expect(raw(hunters)).toMatchObject({ status: 'night', nightStep: 1 });
    tick(hunters); expect(raw(hunters).status).toBe('dawn');
  });

  it('本局快照決定夜序與同守同救，不受後續 options 值改動影響', () => {
    const c = setup('seven-ghost-rider', 7), configuration = structuredClone(raw(c).configuration), target = roleID(c, 'villager');
    patch(c, G => { G.options.presetId = 'six-hunters'; G.options.doubleProtection = 'survive'; });
    nightStep(c, 0); act(c, roleID(c, 'guard'), 'guard', target, raw(c).epoch);
    nightStep(c, 1);
    for (const actor of Object.keys(raw(c).private).filter(id => raw(c).private[id].faction === 'wolves')) act(c, actor, 'wolfVote', target, raw(c).epoch);
    nightStep(c, 3); act(c, roleID(c, 'witch'), 'witch', 'save', target, raw(c).epoch); tick(c);
    expect(raw(c).players[target].alive).toBe(false);
    expect(raw(c).configuration).toEqual(configuration);
    expect(raw(c).dawnDeaths).toEqual([target]);
  });

  it.each([1, 2] as const)('v%i 沒有新配置快照的存檔仍能投影、相認、推進既有夜序', rulesVersion => {
    const c = setup('classic', 6);
    patch(c, G => { G.rulesVersion = rulesVersion; delete G.configuration; delete G.options.presetId; delete G.options.doubleProtection; });
    const before = structuredClone(raw(c));
    for (const view of [moonPlayerView({ G: raw(c), playerID: Object.keys(raw(c).players)[0] }), moonObserverView(raw(c), 'blind'), moonObserverView(raw(c), 'god')]) {
      expect(view.configuration).toBeUndefined(); expect(view.rulesVersion).toBe(rulesVersion);
      expect(view.options).toEqual(before.options);
    }
    ack(c);
    for (const step of rulesVersion === 1 ? [0, 1, 2, 3] : [1, 2, 3]) {
      expect(raw(c)).toMatchObject({ status: 'night', nightStep: step });
      if (step === 1) {
        const wolves = Object.keys(raw(c).private).filter(id => raw(c).private[id].faction === 'wolves');
        for (const wolf of wolves) expect(moonPlayerView({ G: raw(c), playerID: wolf }).private[wolf].wolfTargets).not.toEqual(expect.arrayContaining(wolves));
      }
      tick(c);
    }
    expect(raw(c).status).toBe('dawn'); expect(raw(c).configuration).toBeUndefined();
  });
});
