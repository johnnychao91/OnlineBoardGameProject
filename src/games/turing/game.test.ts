import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateGameReducer, createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { TuringGame, turingCards, turingCardNumber, turingObserverView, turingPlayerView, type TuringState } from './game';
import { normalizeTuringOptions, validateTuringOptions, type TuringOptions } from './rules';
import { turingQuestionPool } from './questions';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const customQuestions = Array.from({ length: 6 }, (_, index) => ({
  prompt: `請替第 ${index + 1} 段測試對話寫一句情境回應。`, low: '從容不迫', high: '緊張得說不出話',
}));
function match(count = 4, setup: { participantIDs?: string[]; options?: TuringOptions; startImmediately?: boolean } = {}, seed = 'turing-tests', legacy = false) {
  const game = { ...TuringGame, seed };
  const created = createMatch({ game, numPlayers: count, setupData: { startImmediately: true, ...setup }, unlisted: true });
  if ('setupDataError' in created) throw new Error(created.setupDataError);
  let state = clone(created.initialState) as State<TuringState>;
  if (legacy) {
    // A serialized v1 match retains its preselected question snapshots, text
    // answers and original lives instead of inheriting the new setup defaults.
    state.G.rulesVersion = 1;
    delete state.G.cards; delete state.G.completedRounds; delete state.G.secretDrawIDs;
    state.G.options = { deck: state.G.options.deck, customQuestions: state.G.options.customQuestions };
    state.G.private = Object.fromEntries(Object.entries(state.G.private).map(([id, info]) => [id, { number: info.number }]));
    state.G.secretQuestionQueue = turingQuestionPool(state.G.options).filter(item => item.id !== state.G.question?.id).slice(0, 4);
  }
  const reducer = CreateGameReducer({ game, isClient: false });
  return {
    get G() { return state.G; }, get state() { return state; },
    patch(patch: Partial<TuringState>) { state = clone({ ...state, G: { ...state.G, ...patch } }); },
    reload() { state = JSON.parse(JSON.stringify(state)); },
    act(id: string, move: string, ...args: unknown[]) {
      const previousID = state._stateID;
      state = clone(reducer(state, { type: 'MAKE_MOVE', payload: { type: move, args, playerID: id } })) as State<TuringState>;
      return state._stateID > previousID;
    },
    event(id: string, event: string, ...args: unknown[]) {
      const before = clone(state);
      state = clone(reducer(state, { type: 'GAME_EVENT', payload: { type: event, args, playerID: id } })) as State<TuringState>;
      expect(state.G).toEqual(before.G);
      expect(state.ctx).toEqual(before.ctx);
    },
  };
}
type Fixture = ReturnType<typeof match>;
function acknowledgeAll(f: Fixture) {
  const epoch = f.G.epoch;
  for (const id of Object.keys(f.G.players)) expect(f.act(id, 'acknowledge', epoch)).toBe(true);
}
function answerAll(f: Fixture) {
  const epoch = f.G.epoch;
  if (f.G.rulesVersion === 1) for (const id of Object.keys(f.G.private)) expect(f.act(id, 'submitAnswer', `玩家 ${id} 的回答`, epoch)).toBe(true);
  else for (const [cardID, card] of Object.entries(turingCards(f.G))) expect(f.act(card.playerID, 'confirmSpoken', cardID, epoch)).toBe(true);
  expect(f.G.status).toBe('sorting');
}
function sortedReveal(f: Fixture) {
  const ids = Object.keys(turingCards(f.G)).sort((a, b) => turingCardNumber(f.G, a)! - turingCardNumber(f.G, b)!);
  for (const id of ids) expect(f.act(f.G.examinerID, 'revealAnswer', id, f.G.epoch)).toBe(true);
}
function replaceNumbers(f: Fixture, numbers: number[]) {
  return Object.fromEntries(Object.entries(f.G.private).map(([id, info], index) => [id, {
    ...info, number: numbers[index], ...(info.cards ? { cards: info.cards.map(card => ({ ...card, number: numbers[index] })) } : {}),
  }]));
}
function sortingFixture() {
  const f = match();
  acknowledgeAll(f); answerAll(f);
  const ids = Object.keys(f.G.private);
  f.patch({ private: replaceNumbers(f, [9, 2, 3]) });
  return { f, ids };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('圖靈測試合作流程與快照', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9])('%i 人隨機開場、輪換檢測員、五輪通關且題目不重複', count => {
    const ids = Array.from({ length: count }, (_, index) => String(12 - count + index));
    const f = match(count, { participantIDs: ids });
    const firstExaminer = f.G.examinerID;
    const questions = new Set<string>();
    for (let round = 1; round <= 5; round += 1) {
      expect(f.G).toMatchObject({ rulesVersion: 2, status: 'briefing', round, completedRounds: round - 1, integrity: Math.max(3, Math.min(count, 8)), targetRounds: 5 });
      expect(f.G.examinerID).toBe(ids[(ids.indexOf(firstExaminer) + round - 1) % ids.length]);
      expect(f.G.private[f.G.examinerID]).toBeUndefined();
      expect(f.G.secretQuestionQueue).toBeUndefined();
      expect(f.G.secretDrawIDs).toHaveLength(round);
      const perPlayer = count <= 3 ? 2 : 1;
      const numbers = Object.values(f.G.private).flatMap(info => info.cards!.map(card => card.number));
      expect(new Set(numbers).size).toBe((count - 1) * perPlayer);
      expect(Object.keys(turingCards(f.G))).toHaveLength((count - 1) * perPlayer);
      for (const id of Object.keys(f.G.private)) {
        expect(f.G.private[id].cards).toHaveLength(perPlayer);
        expect(f.G.private[id].cards!.map(card => card.id)).toEqual(perPlayer === 1 ? [id] : [`${id}-a`, `${id}-b`]);
      }
      expect(numbers.every(number => Number.isInteger(number) && number >= 1 && number <= 10)).toBe(true);
      expect(f.G.answers).toEqual({}); expect(f.G.revealed).toEqual([]);
      questions.add(f.G.question!.id);
      acknowledgeAll(f); answerAll(f); sortedReveal(f);
      if (round < 5) { expect(f.G.status).toBe('round-review'); f.reload(); acknowledgeAll(f); }
    }
    expect(questions.size).toBe(5);
    expect(f.G).toMatchObject({ status: 'finished', completedRounds: 5, winner: 'humans', winReason: 'calibrated' });
    expect(f.state.ctx.gameover).toEqual({ winner: 'humans', reason: 'calibrated' });
    expect(f.G.log.filter(entry => entry.type === 'round-complete')).toHaveLength(5);
  });
  it('draws the first examiner from more than one seat and keeps room snapshots independent', () => {
    const starts = new Set(Array.from({ length: 12 }, (_, index) => match(4, {}, `first-${index}`).G.examinerID));
    expect(starts.size).toBeGreaterThan(1);
    const options = normalizeTuringOptions({ deck: 'custom', customQuestions });
    const a = match(4, { options }), b = match(4, { options }, 'another-room');
    const before = clone(b.G);
    options.customQuestions[0].prompt = '房外已被修改的題目';
    acknowledgeAll(a); answerAll(a); sortedReveal(a); acknowledgeAll(a);
    expect(b.G).toEqual(before);
    expect(a.G.log.filter(entry => entry.type === 'round-start').map(entry => entry.question!.prompt)).not.toContain('房外已被修改的題目');
  });
  it('requires all lobby seats to be ready and only the first seat may start locally', () => {
    const f = match(4, { startImmediately: false, participantIDs: ['2', '4', '8', '11'] });
    expect(f.G.status).toBe('lobby');
    expect(f.act('2', 'startGame')).toBe(false);
    expect(f.act('99', 'setReady', true)).toBe(false);
    expect(f.act('2', 'setReady', 'yes')).toBe(false);
    for (const id of Object.keys(f.G.players)) expect(f.act(id, 'setReady', true)).toBe(true);
    expect(f.act('4', 'startGame')).toBe(false);
    expect(f.act('2', 'startGame')).toBe(true);
    expect(f.act('2', 'setReady', false)).toBe(false);
  });
  it('charges a descent against the immediately previous card, not the running maximum', () => {
    const { f, ids } = sortingFixture();
    for (const id of ids) expect(f.act(f.G.examinerID, 'revealAnswer', id, f.G.epoch)).toBe(true);
    expect(f.G.integrity).toBe(3);
    expect(f.G.revealed.map(entry => entry.error)).toEqual([false, true, false]);
    expect(f.G.status).toBe('round-review');
    expect(f.G.log.filter(entry => entry.type === 'reveal').map(entry => entry.integrity)).toEqual([4, 3, 3]);
  });
  it('fails immediately on zero integrity, even before the last answer, and opens current numbers only', () => {
    const { f, ids } = sortingFixture();
    f.patch({ integrity: 1 });
    expect(f.act(f.G.examinerID, 'revealAnswer', ids[0], f.G.epoch)).toBe(true);
    expect(f.act(f.G.examinerID, 'revealAnswer', ids[1], f.G.epoch)).toBe(true);
    expect(f.G).toMatchObject({ integrity: 0, status: 'finished', winner: 'system', winReason: 'integrity-lost' });
    expect(f.G.revealed).toHaveLength(2);
    expect(f.state.ctx.gameover).toEqual({ winner: 'system', reason: 'integrity-lost' });
    const blind = turingObserverView(f.G, 'blind');
    expect(Object.keys(blind.private)).toHaveLength(3);
    expect(blind.private[ids[2]].number).toBe(3);
    expect(blind).not.toHaveProperty('secretQuestionQueue');
    expect(f.act(f.G.examinerID, 'revealAnswer', ids[2], f.G.epoch)).toBe(false);
  });
  it('gives zero-integrity failure priority over completing the final round', () => {
    const { f, ids } = sortingFixture();
    f.patch({ round: 5, integrity: 1, private: replaceNumbers(f, [2, 9, 3]) });
    for (const id of ids) expect(f.act(f.G.examinerID, 'revealAnswer', id, f.G.epoch)).toBe(true);
    expect(f.G).toMatchObject({ status: 'finished', integrity: 0, winner: 'system' });
    expect(f.G.log.at(-1)?.type).toBe('finish');
    expect(f.G.log.filter(entry => entry.type === 'round-complete')).toHaveLength(0);
  });
});

describe('圖靈測試權限、時序與私人投影', () => {
  it.each([2, 3])('%i-person voice play confirms each owned A/B slot without text and seals numbers', count => {
    const f = match(count);
    const initialEpoch = f.G.epoch;
    acknowledgeAll(f);
    const cards = Object.entries(turingCards(f.G)), [firstID, first] = cards[0], epoch = f.G.epoch;
    const otherID = cards.find(([, card]) => card.playerID !== first.playerID)?.[1].playerID ?? f.G.examinerID;
    expect(f.act(first.playerID, 'submitAnswer', '新局不收文字', epoch)).toBe(false);
    for (const invalid of [null, 1, {}, '__proto__', f.G.examinerID, `${first.playerID}-c`]) {
      expect(f.act(first.playerID, 'confirmSpoken', invalid, epoch)).toBe(false);
    }
    expect(f.act(first.playerID, 'confirmSpoken', firstID, initialEpoch)).toBe(false);
    expect(f.act(otherID, 'confirmSpoken', firstID, epoch)).toBe(false);
    expect(f.act('99', 'confirmSpoken', firstID, epoch)).toBe(false);
    expect(f.act(first.playerID, 'confirmSpoken', firstID, epoch)).toBe(true);
    expect(f.G.players[first.playerID].answered).toBe(false);
    expect(f.G.cards![firstID].spoken).toBe(true);
    expect(f.act(first.playerID, 'confirmSpoken', firstID, epoch)).toBe(false);
    expect(f.G.status).toBe('answering');
    const blind = turingObserverView(f.G, 'blind'), own = turingPlayerView({ G: f.G, playerID: first.playerID });
    expect(blind.cards).toEqual(f.G.cards);
    expect(turingCardNumber(blind, firstID)).toBeUndefined();
    expect(turingCardNumber(own, firstID)).toBe(f.G.private[first.playerID].cards![0].number);
    expect(Object.keys(own.private)).toEqual([first.playerID]);
    expect(Object.values(own.private)[0].cards).toHaveLength(2);
    for (const [id, card] of cards.slice(1)) expect(f.act(card.playerID, 'confirmSpoken', id, epoch)).toBe(true);
    expect(f.G.status).toBe('sorting');
    expect(f.G.answers).toEqual({});
    expect(Object.values(f.G.private).every(info => info.answer === undefined)).toBe(true);
    expect(f.G.log.at(-1)).toEqual({ type: 'spoken', round: 1 });
    expect(f.act(first.playerID, 'confirmSpoken', firstID, f.G.epoch)).toBe(false);
    expect(f.act(f.G.examinerID, 'revealAnswer', first.playerID, f.G.epoch)).toBe(false);
    expect(f.act(f.G.examinerID, 'revealAnswer', firstID, f.G.epoch)).toBe(true);
    expect(f.G.revealed[0]).toMatchObject({ playerID: first.playerID, cardID: firstID, slot: 'A', error: false });
    expect(f.G.log.at(-1)).toMatchObject({ targetID: first.playerID, cardID: firstID, slot: 'A' });
    expect(f.act(f.G.examinerID, 'revealAnswer', firstID, f.G.epoch)).toBe(false);
  });
  it('publishes answers together only after all participants have submitted and keeps own text private beforehand', () => {
    const f = match(4, {}, 'legacy-sealed', true); acknowledgeAll(f);
    const ids = Object.keys(f.G.private), epoch = f.G.epoch;
    const answer = '<img src=x onerror=alert(1)> 只當成文字';
    expect(f.act(ids[0], 'submitAnswer', `  ${answer}  `, epoch)).toBe(true);
    expect(f.G.answers).toEqual({});
    expect(f.G.log.some(entry => entry.type === 'answers')).toBe(false);
    expect(turingPlayerView({ G: f.G, playerID: ids[0] }).private[ids[0]].answer).toBe(answer);
    for (const view of [turingPlayerView({ G: f.G, playerID: f.G.examinerID }), turingObserverView(f.G, 'blind')]) {
      expect(view.private).toEqual({});
      expect(JSON.stringify(view)).not.toContain(answer);
    }
    expect(turingObserverView(f.G, 'god').private[ids[0]].answer).toBe(answer);
    for (const id of ids.slice(1)) expect(f.act(id, 'submitAnswer', `回答 ${id}`, epoch)).toBe(true);
    expect(f.G.status).toBe('sorting');
    expect(turingObserverView(f.G, 'blind').answers[ids[0]]).toBe(answer);
    expect(f.G.log.at(-1)?.answers).toEqual(f.G.answers);
    expect(f.state.deltalog?.at(-1)?.redact).toBe(true);
    expect(f.G.log.some(entry => entry.number !== undefined)).toBe(false);
  });
  it('strips future questions and unlisted server fields for player, blind and god views without mutating the match', () => {
    const f = match(), id = Object.keys(f.G.private)[0];
    const source = clone(f.G) as TuringState & { serverOnly: string; _random: unknown };
    source.serverOnly = 'private-server-sentinel'; source._random = { seed: 'hidden-seed' };
    const original = clone(source);
    const own = turingPlayerView({ G: source, playerID: id });
    expect(Object.keys(own.private)).toEqual([id]);
    expect(turingPlayerView({ G: source, playerID: '99' }).private).toEqual({});
    for (const view of [own, turingObserverView(source, 'blind'), turingObserverView(source, 'god')]) {
      expect(view).not.toHaveProperty('secretQuestionQueue');
      expect(view).not.toHaveProperty('secretDrawIDs');
      expect(view).not.toHaveProperty('_random'); expect(view).not.toHaveProperty('serverOnly');
      view.question!.prompt = 'mutated view'; view.log[0].question!.prompt = 'mutated log';
      view.players[id].ready = false;
      if (view.private[id]) view.private[id].number = -1;
      if (view.private[id]?.cards) view.private[id].cards![0].number = -2;
      if (view.cards) view.cards[Object.keys(view.cards)[0]].spoken = true;
    }
    expect(source).toEqual(original);
  });
  it('rejects duplicate, old and malformed confirmations or answers', () => {
    const f = match(4, {}, 'legacy-validation', true), ids = Object.keys(f.G.players), initialEpoch = f.G.epoch;
    expect(f.act('99', 'acknowledge', initialEpoch)).toBe(false);
    expect(f.act(ids[0], 'acknowledge', String(initialEpoch))).toBe(false);
    expect(f.act(ids[0], 'acknowledge', initialEpoch)).toBe(true);
    expect(f.act(ids[0], 'acknowledge', initialEpoch)).toBe(false);
    for (const id of ids.slice(1)) expect(f.act(id, 'acknowledge', initialEpoch)).toBe(true);
    const answeringID = Object.keys(f.G.private)[0], epoch = f.G.epoch;
    expect(f.act(f.G.examinerID, 'submitAnswer', '檢測員不能回答', epoch)).toBe(false);
    expect(f.act(answeringID, 'submitAnswer', '舊畫面回答', initialEpoch)).toBe(false);
    for (const input of ['', '  ', null, {}, 5, 'x'.repeat(161), 'hello\u0000world', '含有\u202e控制符']) {
      expect(f.act(answeringID, 'submitAnswer', input, epoch), String(input)).toBe(false);
    }
    expect(f.act(answeringID, 'submitAnswer', 'x'.repeat(160), epoch)).toBe(true);
    expect(f.act(answeringID, 'submitAnswer', '第二次回答', epoch)).toBe(false);
  });
  it('accepts simultaneous valid responses at one epoch but guards every reveal individually', () => {
    const f = match(); acknowledgeAll(f); answerAll(f);
    const ids = Object.keys(f.G.private), examiner = f.G.examinerID, epoch = f.G.epoch;
    expect(f.act(ids[0], 'revealAnswer', ids[1], epoch)).toBe(false);
    for (const target of ['99', '__proto__', examiner, null, 0]) expect(f.act(examiner, 'revealAnswer', target, epoch)).toBe(false);
    expect(f.act(examiner, 'revealAnswer', ids[0], epoch)).toBe(true);
    expect(f.act(examiner, 'revealAnswer', ids[1], epoch)).toBe(false);
    expect(f.act(examiner, 'revealAnswer', ids[0], f.G.epoch)).toBe(false);
    expect(f.act(examiner, 'revealAnswer', ids[1], f.G.epoch)).toBe(true);
  });
  it('blocks direct framework events from bypassing the rules', () => {
    const f = match();
    for (const [event, args] of [
      ['endGame', [{ winner: 'humans' }]], ['endTurn', []], ['setActivePlayers', [{ all: 'sorting' }]],
      ['setStage', ['sorting']], ['setPhase', ['finished']],
    ] as [string, unknown[]][]) f.event(Object.keys(f.G.players)[0], event, ...args);
    expect(f.G.status).toBe('briefing');
  });
});

describe('圖靈測試有限生命無盡挑戰與舊局相容', () => {
  it('continues beyond five rounds, cycles custom questions without adjacent repeats and records only completed rounds', () => {
    const options = normalizeTuringOptions({ deck: 'custom', customQuestions: customQuestions.slice(0, 5), mode: 'endless', lives: 2 });
    const f = match(2, { options });
    const questionIDs: string[] = [];
    for (let round = 1; round <= 13; round += 1) {
      expect(f.G).toMatchObject({ round, completedRounds: round - 1, targetRounds: null, maxIntegrity: 2, status: 'briefing' });
      expect(f.G.secretQuestionQueue).toBeUndefined();
      expect(f.G.secretDrawIDs!.every(id => typeof id === 'string')).toBe(true);
      expect(f.G.secretDrawIDs!.length).toBeLessThanOrEqual(5);
      questionIDs.push(f.G.question!.id);
      acknowledgeAll(f); answerAll(f);
      const cards = Object.keys(turingCards(f.G)).sort((a, b) => turingCardNumber(f.G, a)! - turingCardNumber(f.G, b)!);
      if (round === 1 || round === 13) cards.reverse();
      for (const id of cards) expect(f.act(f.G.examinerID, 'revealAnswer', id, f.G.epoch)).toBe(true);
      if (round === 13) break;
      expect(f.G).toMatchObject({ status: 'round-review', completedRounds: round, integrity: 1 });
      f.reload(); acknowledgeAll(f);
    }
    expect(questionIDs.every((id, index) => index === 0 || id !== questionIDs[index - 1])).toBe(true);
    expect(new Set(questionIDs.slice(0, 5)).size).toBe(5);
    expect(new Set(questionIDs.slice(5, 10)).size).toBe(5);
    expect(f.G).toMatchObject({ round: 13, completedRounds: 12, integrity: 0, status: 'finished', winner: 'system', winReason: 'endless-exhausted' });
    expect(f.G.log.filter(entry => entry.type === 'round-complete')).toHaveLength(12);
    expect(f.G.log.filter(entry => entry.type === 'round-start')).toHaveLength(13);
    expect(f.state.ctx.gameover).toEqual({ winner: 'system', reason: 'endless-exhausted' });
    const god = turingObserverView(f.G, 'god');
    expect(god.completedRounds).toBe(12);
    expect(god).not.toHaveProperty('secretDrawIDs');
    expect(god).not.toHaveProperty('secretQuestionQueue');
  });
  it('stores only selected question snapshots and compact draw IDs, not the entire built-in pool', () => {
    const f = match(3, { options: normalizeTuringOptions({ deck: 'mixed', mode: 'endless', lives: 5 }) });
    expect(f.G.secretDrawIDs).toEqual([f.G.question!.id]);
    expect(f.G.secretQuestionQueue).toBeUndefined();
    expect(JSON.stringify(f.G).length).toBeLessThan(6000);
    expect(f.G.log[0].question).toEqual(f.G.question);
    for (const perspective of ['blind', 'god'] as const) expect(turingObserverView(f.G, perspective)).not.toHaveProperty('secretDrawIDs');
  });
  it.each([[1, 1], [20, 20], [0, 1], [-5, 1], [21, 20]] as const)('bounds endless lives %i to %i while five-round mode keeps player-count lives', (input, expected) => {
    const options = normalizeTuringOptions({ mode: 'endless', lives: input });
    expect(options.lives).toBe(expected);
    expect(match(3, { options }).G).toMatchObject({ integrity: expected, maxIntegrity: expected, targetRounds: null });
    expect(match(3, { options: { ...options, mode: 'standard' } }).G).toMatchObject({ integrity: 3, maxIntegrity: 3, targetRounds: 5 });
  });
  it('resumes a serialized text-based v1 game for all five rounds without changing its snapshots, lives or cards', () => {
    const f = match(4, {}, 'legacy-resume', true);
    const future = clone(f.G.secretQuestionQueue!);
    const firstQuestion = f.G.question!.prompt;
    for (let round = 1; round <= 5; round += 1) {
      expect(f.G.rulesVersion).toBe(1);
      expect(f.G.integrity).toBe(4);
      expect(f.G.cards).toBeUndefined();
      expect(f.G.private[Object.keys(f.G.private)[0]].cards).toBeUndefined();
      expect(f.G.question!.prompt).toBe(round === 1 ? firstQuestion : future[round - 2].prompt);
      acknowledgeAll(f);
      const id = Object.keys(f.G.private)[0];
      expect(f.act(id, 'confirmSpoken', id, f.G.epoch)).toBe(false);
      f.reload(); answerAll(f); sortedReveal(f);
      if (round < 5) { f.reload(); acknowledgeAll(f); }
    }
    expect(f.G).toMatchObject({ status: 'finished', winner: 'humans', winReason: 'calibrated', targetRounds: 5 });
    expect(f.G.completedRounds).toBeUndefined();
    expect(f.G.log.filter(entry => entry.type === 'answers')).toHaveLength(5);
    expect(f.G.log.some(entry => entry.type === 'spoken')).toBe(false);
    expect(turingObserverView(f.G, 'god')).not.toHaveProperty('secretQuestionQueue');
  });
});

describe('圖靈測試公開房規驗證', () => {
  it('normalizes independent defaults and trimmed custom cards without truncation', () => {
    const a = normalizeTuringOptions(undefined), b = normalizeTuringOptions(undefined);
    a.customQuestions.push(customQuestions[0]);
    expect(b).toEqual({ deck: 'standard', customQuestions: [], mode: 'standard', lives: 5 });
    expect(normalizeTuringOptions({ customQuestions: [{ prompt: '  請說一句歡迎詞。  ', low: ' 冷淡 ', high: ' 熱情 ' }] })).toEqual({
      deck: 'standard', customQuestions: [{ prompt: '請說一句歡迎詞。', low: '冷淡', high: '熱情' }], mode: 'standard', lives: 5,
    });
    expect(validateTuringOptions({ deck: 'custom', customQuestions: customQuestions.slice(0, 5) }, 4)).toBeUndefined();
    expect(validateTuringOptions({ deck: 'custom', customQuestions: customQuestions.slice(0, 4) }, 4)).toContain('至少');
  });
  it.each([
    null, [], 'custom', 10, { unknown: true }, { deck: '__proto__' }, { deck: null }, { deck: true },
    { mode: 'unknown' }, { mode: null }, { lives: '5' }, { lives: NaN }, { lives: Infinity }, { lives: 1.5 },
    { customQuestions: null }, { customQuestions: {} }, { customQuestions: [null] },
    { customQuestions: [{ ...customQuestions[0], id: 'injected' }] },
    { customQuestions: [{ ...customQuestions[0], prompt: '短' }] },
    { customQuestions: [{ ...customQuestions[0], prompt: 'x'.repeat(201) }] },
    { customQuestions: [{ ...customQuestions[0], high: 'x'.repeat(51) }] },
    { customQuestions: [{ ...customQuestions[0], low: '' }] },
    { customQuestions: [{ ...customQuestions[0], low: ' SAME ', high: 'same' }] },
    { customQuestions: [{ ...customQuestions[0], low: 'a\u0000b' }] },
    { customQuestions: [customQuestions[0], customQuestions[0]] },
    { customQuestions: Array.from({ length: 51 }, (_, i) => ({ ...customQuestions[0], prompt: `第 ${i} 個測試用題目` })) },
  ])('rejects malformed or oversized settings: %j', input => {
    expect(() => normalizeTuringOptions(input)).toThrow();
    expect(validateTuringOptions(input)).toBeTypeOf('string');
  });
  it('rejects inherited settings, invalid counts and malformed seat lists', () => {
    expect(() => normalizeTuringOptions(Object.create({ deck: 'standard' }))).toThrow();
    expect(() => normalizeTuringOptions(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow();
    for (const count of [0, 1, 10, 4.5, NaN]) expect(validateTuringOptions(undefined, count)).toBeTypeOf('string');
    for (const ids of [['0', '0', '1', '2'], ['0', '1', '2'], ['0', '1', '2', '__proto__'], ['0', '1', '2', '12']]) {
      const result = createMatch({ game: TuringGame, numPlayers: 4, setupData: { participantIDs: ids }, unlisted: true });
      expect(result).toHaveProperty('setupDataError');
    }
    const overLimit = createMatch({ game: TuringGame, numPlayers: 4, setupData: { options: { deck: 'custom', customQuestions: [] } }, unlisted: true });
    expect(overLimit).toHaveProperty('setupDataError');
  });
});
