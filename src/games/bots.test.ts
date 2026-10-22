import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateGameReducer, createMatch } from 'boardgame.io/internal';
import type { Game, State } from 'boardgame.io';
import { chooseBotAction, supportedBotGames, type BotAction } from './bots';
import { gameCatalog } from './catalog';
import { StationGame, stationPlayerView } from './station/game';
import { CipherGame, cipherPlayerView } from './cipher/game';
import { FogGame, fogPlayerView } from './fog/game';
import { normalizeFogOptions } from './fog/rules';
import { MoonGame, advanceMoonClock, moonPlayerView } from './moon/game';
import { MOON_PRESETS, normalizeMoonOptions } from './moon/rules';

let now = 1_800_000_000_000;
beforeEach(() => { now = 1_800_000_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now); });
afterEach(() => vi.restoreAllMocks());
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function match(game: Game<any>, count: number, options?: unknown, seed = 'bot-rules', ids?: string[], startImmediately = true) {
  const definition = { ...game, seed };
  const result = createMatch({ game: definition, numPlayers: count, setupData: { startImmediately, options, participantIDs: ids }, unlisted: true });
  if ('setupDataError' in result) throw new Error(result.setupDataError);
  let state = clone(result.initialState);
  const reducer = CreateGameReducer({ game: definition, isClient: false });
  return {
    get state() { return state; },
    set state(value: State) { state = value; },
    move(id: string, move: BotAction) {
      const next = reducer(state, { type: 'MAKE_MOVE', payload: { type: move.move, args: move.args, playerID: id } });
      expect(next._stateID, `${game.name}: ${move.move} rejected at ${state.G.status}`).toBe(state._stateID + 1);
      state = clone(next);
    },
    clock() {
      expect(state.G.deadline).not.toBeNull();
      now = state.G.deadline;
      const next = clone(state);
      expect(advanceMoonClock(next.G, now)).toBe(true);
      if (next.G.status === 'finished') next.ctx.gameover = { winner: next.G.winner, reason: next.G.winReason };
      next._stateID += 1;
      state = next;
    },
  };
}

describe('Test-room bot adapters', () => {
  it('requires an adapter for every registered game', () => {
    expect([...supportedBotGames].sort()).toEqual(Object.keys(gameCatalog).sort());
    expect(chooseBotAction('unknown', { G: { players: { '0': {} } } }, '0')).toBeNull();
  });

  it.each([StationGame, CipherGame, FogGame, MoonGame])('readies a %s seat once and leaves starting to the human host', game => {
    const f = match(game, game.minPlayers!, undefined, 'bot-ready', undefined, false);
    const move = chooseBotAction(game.name!, f.state, '0');
    expect(move).toEqual({ move: 'setReady', args: [true] });
    f.move('0', move!);
    expect(chooseBotAction(game.name!, f.state, '0')).toBeNull();
    expect(chooseBotAction(game.name!, f.state, '99')).toBeNull();
    expect(f.state.G.status).toBe('lobby');
  });

  const scenarios = [
    { game: StationGame, count: 4, options: undefined },
    { game: StationGame, count: 8, options: undefined },
    { game: CipherGame, count: 2, options: undefined },
    { game: CipherGame, count: 4, options: undefined },
    { game: FogGame, count: 5, options: normalizeFogOptions({ lancelotMode: 'off' }) },
    { game: FogGame, count: 10, options: normalizeFogOptions({ lancelotMode: 'forecast', percival: true, morgana: true, mordred: true }) },
    { game: MoonGame, count: 6, options: normalizeMoonOptions({ sheriff: false }) },
    { game: MoonGame, count: 12, options: normalizeMoonOptions({ sheriff: true, mode: 'assisted' }) },
  ];
  for (const { game, count, options } of scenarios) {
    it(`${game.name} completes ${count}-seat matches with only legal suggested moves`, () => {
      const moves = new Set<string>();
      for (const seed of [1, 27, 83]) {
        const ids = Array.from({ length: count }, (_, i) => String(12 - count + i));
        const f = match(game, count, options, `bot-${seed}`, ids);
        const random = seeded(seed);
        let steps = 0;
        while (f.state.G.status !== 'finished' && steps++ < 3000) {
          const start = Math.floor(random() * ids.length);
          let acted = false;
          for (let i = 0; i < ids.length; i += 1) {
            const id = ids[(start + i) % ids.length];
            const move = chooseBotAction(game.name!, f.state, id, random);
            if (move) { moves.add(move.move); f.move(id, move); acted = true; break; }
          }
          if (!acted && game.name === 'silver-moon') f.clock();
        }
        expect(f.state.G.status, `${game.name} stalled at ${f.state.G.status}`).toBe('finished');
        expect(f.state.ctx.gameover).toBeTruthy();
        expect(chooseBotAction(game.name!, f.state, ids[0], random)).toBeNull();
      }
      const expected = game.name === 'space-station' ? ['acknowledgeBriefing', 'declareRepairs', 'selectCard', 'reveal']
        : game.name === 'encrypted-call' ? ['readySync', 'playCard', 'acknowledgeLevel']
        : game.name === 'black-fog' ? ['acknowledge', 'selectTeam', 'confirmTeam', 'vote', 'submitQuest']
        : ['acknowledge', 'wolfVote', 'inspect', 'witch', 'finishSpeech', 'exileVote'];
      if (game.name === 'silver-moon' && count === 12) expected.push('guard', 'standForSheriff', 'sheriffVote', 'chooseOrder');
      for (const name of expected) expect(moves.has(name), `${game.name} did not exercise ${name}`).toBe(true);
    });
  }

  const presetScenarios = MOON_PRESETS.filter(preset => preset.count !== null).flatMap(preset =>
    (['online', 'assisted'] as const).map(mode => ({ preset, mode })));
  it.each(presetScenarios)('$preset.id / $mode finishes using legal moves from each bot’s own view', ({ preset, mode }) => {
    const count = preset.count!;
    const ids = Array.from({ length: count }, (_, i) => String(12 - count + i));
    const f = match(MoonGame, count, normalizeMoonOptions({ presetId: preset.id, mode }), `bot-preset-${preset.id}-${mode}`, ids);
    const random = seeded(mode === 'online' ? 271 : 819);
    let steps = 0;
    while (f.state.G.status !== 'finished' && steps++ < 3000) {
      const start = Math.floor(random() * ids.length);
      let acted = false;
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[(start + i) % ids.length];
        const salt = Math.floor(random() * 1_000_000);
        const move = chooseBotAction('silver-moon', f.state, id, seeded(salt));
        const view = { G: moonPlayerView({ G: f.state.G, playerID: id }), ctx: f.state.ctx };
        expect(chooseBotAction('silver-moon', view, id, seeded(salt))).toEqual(move);
        if (move) { f.move(id, move); acted = true; break; }
      }
      if (!acted) f.clock();
    }
    expect(f.state.G.status, `${preset.id} stalled at ${f.state.G.status}`).toBe('finished');
    expect(['town', 'wolves', 'draw']).toContain(f.state.G.winner);
    expect(f.state.ctx.gameover).toBeTruthy();
  });

  it('respects first-night peace, revealed-idiot voting restrictions and mandatory hunter shots', () => {
    const peaceful = match(MoonGame, 6, normalizeMoonOptions({ presetId: 'six-hunters' }));
    for (const id of Object.keys(peaceful.state.G.players)) peaceful.move(id, chooseBotAction('silver-moon', peaceful.state, id)!);
    expect(peaceful.state.G).toMatchObject({ status: 'night', nightStep: 1, day: 1 });
    for (const id of Object.keys(peaceful.state.G.private).filter(id => peaceful.state.G.private[id].faction === 'wolves')) {
      expect(chooseBotAction('silver-moon', peaceful.state, id, () => 0)).toBeNull();
    }
    const shotState = clone(peaceful.state);
    const hunter = Object.keys(shotState.G.private).find(id => shotState.G.private[id].role === 'hunter')!;
    shotState.G.players[hunter].alive = false;
    shotState.G.status = 'hunter'; shotState.G.hunterID = hunter;
    peaceful.state = shotState;
    const shot = chooseBotAction('silver-moon', peaceful.state, hunter, () => 0.999)!;
    expect(shot.move).toBe('hunterShoot'); expect(shot.args[0]).not.toBeNull();

    const f = match(MoonGame, 6, normalizeMoonOptions({ presetId: 'six-idiot', sheriff: true }));
    const state = clone(f.state);
    const idiot = Object.keys(state.G.private).find(id => state.G.private[id].role === 'idiot')!;
    state.G.players[idiot].voteDisabled = true;
    state.G.deadline = now + 30000;
    state.G.sheriffCandidates = ['0', '1'].filter(id => id !== idiot);
    for (const status of ['voting', 'sheriff-signup', 'sheriff-voting']) {
      state.G.status = status; f.state = clone(state);
      expect(chooseBotAction('silver-moon', f.state, idiot, () => 0)).toBeNull();
    }
    state.G.status = 'speaking'; state.G.speakerID = idiot; f.state = state;
    expect(chooseBotAction('silver-moon', f.state, idiot, () => 0)?.move).toBe('finishSpeech');
  });

  it('recognizes special wolves without requiring an ordinary wolf and never explodes a ghost rider', () => {
    const f = match(MoonGame, 8, normalizeMoonOptions({ presetId: 'eight-ragnarok' }));
    const state = clone(f.state);
    state.G.status = 'night'; state.G.nightStep = 1; state.G.deadline = now + 30000;
    f.state = state;
    const wolves = Object.keys(state.G.private).filter(id => state.G.private[id].faction === 'wolves');
    expect(wolves).toHaveLength(3);
    for (const id of wolves) {
      const move = chooseBotAction('silver-moon', f.state, id, () => 0)!;
      expect(move.move).toBe('wolfVote');
      expect(move.args[0]).not.toBeNull();
      expect(state.G.private[move.args[0] as string].role).not.toBe('ghost-rider');
    }
    state.G.status = 'speaking'; state.G.speakerID = Object.keys(state.G.private).find(id => state.G.private[id].faction === 'town');
    f.state = state;
    for (const id of wolves) {
      const move = chooseBotAction('silver-moon', f.state, id, () => 0);
      if (state.G.private[id].role === 'ghost-rider') expect(move).toBeNull();
      else {
        expect(move?.move).toBe('wolfExplode');
        expect(move?.args[0] === null).toBe(state.G.private[id].role === 'wolf-king');
      }
    }
  });

  it.each([
    { game: StationGame, project: stationPlayerView },
    { game: CipherGame, project: cipherPlayerView },
    { game: FogGame, project: fogPlayerView },
    { game: MoonGame, project: moonPlayerView },
  ])('$game.name decisions need only the same information as a real player', ({ game, project }) => {
    const f = match(game, game.minPlayers!);
    const ids = Object.keys(f.state.G.players);
    const random = seeded(811);
    // Check many states, including privately actionable ones, not just briefing.
    for (let step = 0; step < 450 && f.state.G.status !== 'finished'; step += 1) {
      let chosen: { id: string; move: BotAction } | undefined;
      for (const id of ids) {
        const before = clone(f.state);
        const projectPlayer = project as (input: { G: any; playerID: string }) => any;
        const visible = { G: projectPlayer({ G: f.state.G, playerID: id }), ctx: f.state.ctx };
        const salt = Math.floor(random() * 1000000);
        const move = chooseBotAction(game.name!, f.state, id, seeded(salt));
        expect(move).toEqual(chooseBotAction(game.name!, visible, id, seeded(salt)));
        expect(f.state).toEqual(before);
        if (!chosen && move) chosen = { id, move };
      }
      if (chosen) f.move(chosen.id, chosen.move);
      else if (game.name === 'silver-moon') f.clock();
    }
  });

  it('preserves the public selection step before a station bot reveals a card', () => {
    const f = match(StationGame, 4);
    for (const id of Object.keys(f.state.G.players)) f.move(id, chooseBotAction('space-station', f.state, id)!);
    for (const id of Object.keys(f.state.G.players)) f.move(id, chooseBotAction('space-station', f.state, id, () => 0)!);
    const actor = f.state.G.activePlayer;
    const selected = chooseBotAction('space-station', f.state, actor, () => 0)!;
    expect(selected.move).toBe('selectCard');
    f.move(actor, selected);
    expect(f.state.G.log).toHaveLength(0);
    const reveal = chooseBotAction('space-station', f.state, actor, () => 0)!;
    expect(reveal).toEqual({ move: 'reveal', args: [...selected.args, f.state.G.pendingReveal.selectionID] });
    f.move(actor, reveal);
    expect(f.state.G.log).toHaveLength(1);
  });

  it('supports cipher pulse consensus without repeatedly requesting a pause', () => {
    const f = match(CipherGame, 2);
    for (const id of Object.keys(f.state.G.players)) f.move(id, chooseBotAction('encrypted-call', f.state, id)!);
    const proposal = chooseBotAction('encrypted-call', f.state, '0', () => 0)!;
    expect(proposal.move).toBe('proposePulse');
    f.move('0', proposal);
    expect(chooseBotAction('encrypted-call', f.state, '0')).toBeNull();
    const vote = chooseBotAction('encrypted-call', f.state, '1', () => 0)!;
    expect(vote).toEqual({ move: 'votePulse', args: [true, f.state.G.level, f.state.G.epoch] });
    f.move('1', vote);
    expect(f.state.G.pulses).toBe(0);
    expect(f.state.G.log.some((entry: any) => entry.type === 'pulse')).toBe(true);
  });

  it('does not act again in a submitted moon night slot or during another speaker', () => {
    const f = match(MoonGame, 8);
    for (const id of Object.keys(f.state.G.players)) f.move(id, chooseBotAction('silver-moon', f.state, id)!);
    const guardID = Object.keys(f.state.G.private).find(id => f.state.G.private[id].role === 'guard')!;
    f.move(guardID, chooseBotAction('silver-moon', f.state, guardID, () => 0)!);
    expect(chooseBotAction('silver-moon', f.state, guardID)).toBeNull();
    while (f.state.G.status === 'night') f.clock();
    for (const id of Object.keys(f.state.G.players)) f.move(id, chooseBotAction('silver-moon', f.state, id)!);
    const speaker = f.state.G.speakerID;
    const other = Object.keys(f.state.G.players).find(id => id !== speaker)!;
    expect(chooseBotAction('silver-moon', f.state, other)).toBeNull();
    expect(chooseBotAction('silver-moon', f.state, speaker)?.move).toBe('finishSpeech');
    now = f.state.G.deadline;
    expect(chooseBotAction('silver-moon', f.state, speaker)).toBeNull();
  });

  it('lets a dead hunter and dead sheriff complete their exceptional actions', () => {
    const f = match(MoonGame, 8, normalizeMoonOptions({ sheriff: true }));
    const id = Object.keys(f.state.G.private).find(id => f.state.G.private[id].role === 'hunter')!;
    const state = clone(f.state);
    state.G.players[id].alive = false;
    state.G.status = 'hunter'; state.G.hunterID = id; state.G.deadline = now + 30000;
    state.G.secret.afterHunter = 'dawn';
    f.state = state;
    const shot = chooseBotAction('silver-moon', f.state, id, () => 0)!;
    expect(shot.move).toBe('hunterShoot');
    f.move(id, shot);
    const badge = clone(f.state);
    badge.G.status = 'sheriff-transfer'; badge.G.sheriffID = id; badge.G.sheriffTransferID = id;
    badge.G.deadline = now + 30000; badge.G.secret.afterTransfer = 'dawn';
    f.state = badge;
    const transfer = chooseBotAction('silver-moon', f.state, id, () => 0)!;
    expect(transfer.move).toBe('transferBadge');
    f.move(id, transfer);
    expect(f.state.G.sheriffID).toBe(transfer.args[0]);
  });
});
