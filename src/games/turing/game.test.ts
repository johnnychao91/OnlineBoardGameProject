import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateGameReducer, createMatch } from 'boardgame.io/internal';
import type { State } from 'boardgame.io';
import { TuringGame, TuringHostGame, isTuringSharedTable, turingCards, turingTableOrder, turingCardNumber, turingObserverView, turingPlayerView, type TuringState } from './game';
import { normalizeTuringOptions, validateTuringOptions, type TuringOptions } from './rules';
import { turingQuestionPool } from './questions';
import { getGameDefinition } from '../registry';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const customQuestions = Array.from({ length: 6 }, (_, index) => ({
  prompt: `請替第 ${index + 1} 段測試對話寫一句情境回應。`, low: '從容不迫', high: '緊張得說不出話',
}));
function match(count = 4, setup: { participantIDs?: string[]; options?: TuringOptions; startImmediately?: boolean } = {}, seed = 'turing-tests', legacy: boolean | 2 | 3 = false) {
  const game = { ...TuringGame, seed };
  const created = createMatch({ game, numPlayers: count, setupData: { startImmediately: true, ...setup }, unlisted: true });
  if ('setupDataError' in created) throw new Error(created.setupDataError);
  let state = clone(created.initialState) as State<TuringState>;
  if (legacy) { state.G.status = 'briefing'; delete state.G.redrawApprovals; }
  if (legacy === 3) state.G.rulesVersion = 3;
  if (legacy === true) {
    // A serialized v1 match retains its preselected question snapshots, text
    // answers and original lives instead of inheriting the new setup defaults.
    state.G.rulesVersion = 1;
    delete state.G.cards; delete state.G.completedRounds; delete state.G.secretDrawIDs;
    state.G.options = { deck: state.G.options.deck, customQuestions: state.G.options.customQuestions };
    state.G.private = Object.fromEntries(Object.entries(state.G.private).map(([id, info]) => [id, { number: info.number }]));
    state.G.secretQuestionQueue = turingQuestionPool(state.G.options).filter(item => item.id !== state.G.question?.id).slice(0, 4);
  }
  if (legacy === 2) {
    state.G.rulesVersion = 2;
    const ids = Object.keys(state.G.players);
    state.G.examinerID = ids[0];
    delete state.G.tableOrder; delete state.G.orderApprovals;
    state.G.private = {}; state.G.cards = {};
    ids.slice(1).forEach((id, index) => {
      const cards = [{ id: `${id}-a`, number: index * 2 + 2 }, { id: `${id}-b`, number: index * 2 + 3 }];
      state.G.private[id] = { number: cards[0].number, cards };
      for (const [i, card] of cards.entries()) state.G.cards![card.id] = { playerID: id, slot: i ? 'B' : 'A', spoken: false };
    });
    if (state.G.log[0]) state.G.log[0].examinerID = state.G.examinerID;
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
    hostAction(executionSeat: string, move: string, epoch: unknown, actorID: unknown) {
      const previousID = state._stateID;
      const hostReducer = CreateGameReducer({ game: { ...TuringHostGame, seed }, isClient: false });
      state = clone(hostReducer(state, { type: 'MAKE_MOVE', payload: { type: move, args: [epoch, actorID], playerID: executionSeat } })) as State<TuringState>;
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
function prepareSorting(f: Fixture) {
  if (f.G.rulesVersion < 4) { acknowledgeAll(f); answerAll(f); }
  expect(f.G.status).toBe('sorting');
}
function sortedReveal(f: Fixture) {
  const ids = Object.keys(turingCards(f.G)).sort((a, b) => turingCardNumber(f.G, a)! - turingCardNumber(f.G, b)!);
  revealOrder(f, ids);
}
function revealOrder(f: Fixture, ids: string[]) {
  if (isTuringSharedTable(f.G)) {
    const players = Object.keys(f.G.players);
    for (const [index, id] of ids.entries()) expect(f.act(players[index % players.length], 'placeCard', id, index, f.G.epoch)).toBe(true);
    const epoch = f.G.epoch;
    for (const id of players) expect(f.act(id, 'approveOrder', epoch)).toBe(true);
  } else for (const id of ids) expect(f.act(f.G.examinerID, 'revealAnswer', id, f.G.epoch)).toBe(true);
}
function replaceNumbers(f: Fixture, numbers: number[]) {
  return Object.fromEntries(Object.entries(f.G.private).map(([id, info], index) => [id, {
    ...info, number: numbers[index], ...(info.cards ? { cards: info.cards.map(card => ({ ...card, number: numbers[index] })) } : {}),
  }]));
}
function sortingFixture() {
  const f = match();
  prepareSorting(f);
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
      expect(f.G).toMatchObject({ rulesVersion: 5, status: 'sorting', round, completedRounds: round - 1, integrity: Math.max(3, Math.min(count, 8)), targetRounds: 5 });
      expect(f.G.examinerID).toBe(count <= 3 ? '' : ids[(ids.indexOf(firstExaminer) + round - 1) % ids.length]);
      expect(f.G.private[f.G.examinerID]).toBeUndefined();
      expect(f.G.secretQuestionQueue).toBeUndefined();
      expect(f.G.secretDrawIDs).toHaveLength(round);
      const cardCount = count <= 3 ? count : count - 1;
      const numbers = Object.values(f.G.private).flatMap(info => info.cards!.map(card => card.number));
      expect(new Set(numbers).size).toBe(cardCount);
      expect(Object.keys(turingCards(f.G))).toHaveLength(cardCount);
      for (const id of Object.keys(f.G.private)) {
        expect(f.G.private[id].cards).toHaveLength(1);
        expect(f.G.private[id].cards!.map(card => card.id)).toEqual([id]);
      }
      if (count <= 3) { expect(f.G.tableOrder).toEqual(ids); expect(f.G.orderApprovals).toEqual([]); }
      expect(numbers.every(number => Number.isInteger(number) && number >= 1 && number <= 10)).toBe(true);
      expect(f.G.answers).toEqual({}); expect(f.G.revealed).toEqual([]);
      questions.add(f.G.question!.id);
      prepareSorting(f); sortedReveal(f);
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
    prepareSorting(a); sortedReveal(a); acknowledgeAll(a);
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
  it.each([2, 3])('legacy v2 %i-person voice play preserves each owned A/B slot and private numbers', count => {
    const f = match(count, {}, 'legacy-v2-slots', 2);
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
    const f = match(); prepareSorting(f);
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
    expect(f.G.status).toBe('sorting');
  });
});

describe('圖靈測試有限生命無盡挑戰與舊局相容', () => {
  it.each([2, 3])('saved v2 %i-player games keep the rotating examiner and double cards through five rounds', count => {
    const f = match(count, { participantIDs: Array.from({ length: count }, (_, index) => String(9 + index)) }, 'v2-five-rounds', 2);
    const ids = Object.keys(f.G.players), first = f.G.examinerID;
    for (let round = 1; round <= 5; round += 1) {
      expect(isTuringSharedTable(f.G)).toBe(false);
      expect(f.G.rulesVersion).toBe(2);
      expect(f.G.examinerID).toBe(ids[(ids.indexOf(first) + round - 1) % ids.length]);
      expect(f.G.private[f.G.examinerID]).toBeUndefined();
      expect(Object.values(f.G.private).every(info => info.cards?.length === 2)).toBe(true);
      expect(f.G.tableOrder).toBeUndefined(); expect(f.G.orderApprovals).toBeUndefined();
      prepareSorting(f);
      const actor = ids[0], cardID = Object.keys(turingCards(f.G))[0];
      expect(f.act(actor, 'placeCard', cardID, 0, f.G.epoch)).toBe(false);
      expect(f.act(actor, 'approveOrder', f.G.epoch)).toBe(false);
      f.reload(); sortedReveal(f);
      if (round < 5) { f.reload(); acknowledgeAll(f); }
    }
    expect(f.G).toMatchObject({ completedRounds: 5, status: 'finished', winner: 'humans', integrity: 3 });
  });
  it('saved v2 endless games still finish with their original examiner and scoring', () => {
    const f = match(2, { options: normalizeTuringOptions({ mode: 'endless', lives: 1 }) }, 'v2-endless', 2);
    for (let round = 1; round <= 6; round += 1) {
      prepareSorting(f);
      const cards = Object.keys(turingCards(f.G)).sort((a, b) => turingCardNumber(f.G, a)! - turingCardNumber(f.G, b)!);
      if (round === 6) cards.reverse();
      revealOrder(f, cards);
      if (round < 6) { f.reload(); acknowledgeAll(f); }
    }
    expect(f.G).toMatchObject({ rulesVersion: 2, completedRounds: 5, status: 'finished', winner: 'system', winReason: 'endless-exhausted' });
    expect(f.G.tableOrder).toBeUndefined();
  });
  it('continues beyond five rounds, cycles custom questions without adjacent repeats and records only completed rounds', () => {
    const options = normalizeTuringOptions({ deck: 'custom', customQuestions: customQuestions.slice(0, 5), mode: 'endless', lives: 2 });
    const f = match(2, { options });
    const questionIDs: string[] = [];
    for (let round = 1; round <= 13; round += 1) {
      expect(f.G).toMatchObject({ round, completedRounds: round - 1, targetRounds: null, maxIntegrity: 2, status: 'sorting' });
      expect(f.G.secretQuestionQueue).toBeUndefined();
      expect(f.G.secretDrawIDs!.every(id => typeof id === 'string')).toBe(true);
      expect(f.G.secretDrawIDs!.length).toBeLessThanOrEqual(5);
      questionIDs.push(f.G.question!.id);
      prepareSorting(f);
      const cards = Object.keys(turingCards(f.G)).sort((a, b) => turingCardNumber(f.G, a)! - turingCardNumber(f.G, b)!);
      if (round === 1 || round === 13) cards.reverse();
      revealOrder(f, cards);
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

describe('圖靈測試群體校準共同排序桌', () => {
  it.each([2, 3])('%i players can approve the complete initial table without placing a card first', count => {
    const f = match(count), ids = Object.keys(f.G.players), epoch = f.G.epoch;
    expect(f.G.tableOrder).toEqual(ids);
    const numbers = ids.map(id => turingCardNumber(f.G, id));
    for (const id of ids.slice(0, -1)) {
      expect(f.act(id, 'approveOrder', epoch)).toBe(true);
      expect(f.G.revealed).toEqual([]); expect(f.G.epoch).toBe(epoch);
    }
    expect(f.act(ids.at(-1)!, 'approveOrder', epoch)).toBe(true);
    expect(f.G.status).toBe('round-review');
    expect(f.G.revealed.map(card => card.cardID)).toEqual(ids);
    expect(f.G.revealed.map(card => card.number)).toEqual(numbers);
  });
  it.each([
    [3, 'missing'], [3, 'empty'], [3, 'partial'], [4, 'missing'], [4, 'empty'], [4, 'partial'],
    [5, 'missing'], [5, 'empty'], [5, 'partial'],
  ] as const)('saved v%i %s tables project every card and accept direct agreement after restart', (version, layout) => {
    const f = match(3, {}, 'old-table-layout', version === 3 ? 3 : false), ids = Object.keys(f.G.players);
    const savedOrder = layout === 'missing' ? undefined : layout === 'empty' ? [] : [ids[2]];
    const fullOrder = layout === 'partial' ? [ids[2], ids[0], ids[1]] : ids;
    f.patch({ rulesVersion: version, tableOrder: savedOrder, orderApprovals: [] }); f.reload();
    expect(f.G.rulesVersion).toBe(version);
    const original = clone(f.G);
    for (const view of [turingPlayerView({ G: f.G, playerID: ids[0] }), turingObserverView(f.G, 'blind'), turingObserverView(f.G, 'god')]) {
      expect(turingTableOrder(view)).toEqual(fullOrder); expect(view.tableOrder).toEqual(fullOrder);
      view.tableOrder!.reverse();
    }
    expect(f.G).toEqual(original);
    const blind = turingObserverView(f.G, 'blind');
    expect(blind.private).toEqual({});
    expect(fullOrder.every(id => turingCardNumber(blind, id) === undefined)).toBe(true);
    if (version === 3) {
      expect(f.G.status).toBe('briefing');
      expect(f.act(ids[0], 'approveOrder', f.G.epoch)).toBe(false);
      prepareSorting(f);
    }
    const epoch = f.G.epoch;
    for (const id of ids) expect(f.act(id, 'approveOrder', epoch)).toBe(true);
    expect(f.G.tableOrder).toEqual(fullOrder);
    expect(f.G.revealed.map(card => card.cardID)).toEqual(fullOrder);
    expect(f.G.status).toBe('round-review');
    acknowledgeAll(f);
    expect(f.G.rulesVersion).toBe(version);
    expect(f.G.tableOrder).toEqual(ids);
    expect(f.G.status).toBe(version === 3 ? 'briefing' : 'sorting');
  });
  it('reorders an omitted legacy card against the full table and never leaves another card waiting', () => {
    const f = match(3), ids = Object.keys(f.G.players);
    f.patch({ tableOrder: [ids[2]], orderApprovals: [] }); f.reload();
    expect(turingTableOrder(f.G)).toEqual([ids[2], ids[0], ids[1]]);
    const epoch = f.G.epoch;
    expect(f.act(ids[0], 'placeCard', ids[1], 0, epoch)).toBe(true);
    expect(f.G.tableOrder).toEqual([ids[1], ids[2], ids[0]]);
    expect(f.G.epoch).toBe(epoch + 1);
    expect(f.act(ids[1], 'approveOrder', epoch)).toBe(false);
    expect(f.act(ids[1], 'approveOrder', f.G.epoch)).toBe(true);
    expect(f.act(ids[2], 'removeCard', ids[1], f.G.epoch)).toBe(true);
    expect(f.G.tableOrder).toEqual([ids[2], ids[0], ids[1]]);
    expect(f.G.orderApprovals).toEqual([]);
    expect(f.G.revealed).toEqual([]);
  });
  it.each([2, 3, 4, 10])('%i players place any face-down card and reveal atomically only after everyone agrees', count => {
    const ids = Array.from({ length: count }, (_, index) => String(12 - count + index));
    const f = match(count, { participantIDs: ids, options: normalizeTuringOptions({ sortingMode: 'group' }) });
    expect(isTuringSharedTable(f.G)).toBe(true);
    expect(f.G.examinerID).toBe('');
    expect(Object.keys(f.G.private)).toEqual(ids);
    expect(Object.keys(turingCards(f.G))).toEqual(ids);
    expect(new Set(ids.map(id => turingCardNumber(f.G, id))).size).toBe(count);
    for (const id of ids) {
      expect(f.G.private[id].cards).toHaveLength(1);
      const own = turingPlayerView({ G: f.G, playerID: id });
      expect(Object.keys(own.private)).toEqual([id]);
      for (const other of ids.filter(other => other !== id)) expect(turingCardNumber(own, other)).toBeUndefined();
    }
    prepareSorting(f);
    const sorted = [...ids].sort((a, b) => turingCardNumber(f.G, a)! - turingCardNumber(f.G, b)!);
    for (const [index, cardID] of sorted.entries()) {
      // Move somebody else's card: the table belongs to everyone.
      const actor = ids.find(id => id !== cardID)!;
      expect(f.act(actor, 'placeCard', cardID, index, f.G.epoch)).toBe(true);
      expect(f.G.revealed).toEqual([]);
      expect(turingObserverView(f.G, 'blind').private).toEqual({});
    }
    const epoch = f.G.epoch;
    for (const id of ids.slice(0, -1)) {
      expect(f.act(id, 'approveOrder', epoch)).toBe(true);
      expect(f.G.epoch).toBe(epoch);
      expect(f.G.revealed).toEqual([]);
      expect(f.G.log.some(event => event.type === 'reveal')).toBe(false);
    }
    const beforeStateID = f.state._stateID;
    f.reload();
    expect(f.act(ids.at(-1)!, 'approveOrder', epoch)).toBe(true);
    expect(f.state._stateID).toBe(beforeStateID + 1);
    expect(f.G.status).toBe('round-review');
    expect(f.G.completedRounds).toBe(1);
    expect(f.G.revealed.map(card => card.cardID)).toEqual(sorted);
    expect(f.G.revealed.every(card => !card.error)).toBe(true);
    expect(f.G.log.filter(event => event.type === 'reveal')).toHaveLength(count);
    const blind = turingObserverView(f.G, 'blind');
    expect(blind.tableOrder).toEqual(sorted); expect(blind.orderApprovals).toEqual(ids);
    expect(blind.private).toEqual({}); // Numbers are public through revealed only.
    expect(blind.revealed.map(card => card.number)).toEqual(f.G.revealed.map(card => card.number));
    expect(f.act(ids[0], 'placeCard', sorted[0], count - 1, f.G.epoch)).toBe(false);
    expect(f.act(ids[0], 'withdrawApproval', f.G.epoch)).toBe(false);
    acknowledgeAll(f);
    expect(f.G).toMatchObject({ round: 2, examinerID: '', tableOrder: ids, orderApprovals: [] });
  });
  it('revisions invalidate prior consent, unchanged placements retain it, and players may withdraw only their own approval', () => {
    const f = match(3), ids = Object.keys(f.G.players); prepareSorting(f);
    for (const [index, id] of ids.entries()) expect(f.act(ids[0], 'placeCard', id, index, f.G.epoch)).toBe(true);
    let epoch = f.G.epoch;
    expect(f.act(ids[0], 'approveOrder', epoch)).toBe(true);
    expect(f.act(ids[1], 'approveOrder', epoch)).toBe(true);
    const approved = clone(f.G);
    expect(f.act(ids[2], 'placeCard', ids[1], 1, epoch)).toBe(true);
    expect(f.G).toEqual(approved);
    expect(f.act(ids[0], 'approveOrder', epoch)).toBe(false);
    expect(f.act(ids[2], 'withdrawApproval', epoch)).toBe(false);
    expect(f.act(ids[0], 'withdrawApproval', epoch)).toBe(true);
    expect(f.G.epoch).toBe(epoch + 1); expect(f.G.orderApprovals).toEqual([ids[1]]);
    expect(f.act(ids[0], 'approveOrder', epoch)).toBe(false);
    expect(f.G.orderApprovals).toEqual([ids[1]]); expect(f.G.revealed).toEqual([]);
    epoch = f.G.epoch;
    expect(f.act(ids[2], 'placeCard', ids[0], 2, epoch)).toBe(true);
    expect(f.G.tableOrder).toEqual([ids[1], ids[2], ids[0]]);
    expect(f.G.epoch).toBe(epoch + 1); expect(f.G.orderApprovals).toEqual([]);
    expect(f.act(ids[2], 'approveOrder', epoch)).toBe(false);
    expect(f.G.revealed).toEqual([]);
    epoch = f.G.epoch;
    expect(f.act(ids[0], 'approveOrder', epoch)).toBe(true);
    expect(f.act(ids[1], 'removeCard', ids[2], epoch)).toBe(true);
    expect(f.G.orderApprovals).toEqual([]); expect(f.G.tableOrder).toEqual([ids[1], ids[0], ids[2]]);
    expect(f.act(ids[2], 'approveOrder', f.G.epoch)).toBe(true);
    const beforeNoop = clone(f.G);
    expect(f.act(ids[0], 'removeCard', ids[2], f.G.epoch)).toBe(true);
    expect(f.G).toEqual(beforeNoop);
    expect(f.act(ids[0], 'placeCard', ids[2], 1, f.G.epoch)).toBe(true);
    expect(f.G.tableOrder).toEqual([ids[1], ids[2], ids[0]]);
    epoch = f.G.epoch;
    for (const id of ids) expect(f.act(id, 'approveOrder', epoch)).toBe(true);
    expect(f.G.status).toBe('round-review');
  });
  it('rejects unauthorized, malformed, stale and out-of-phase operations without exposing a number', () => {
    const f = match(3, { startImmediately: false }), ids = Object.keys(f.G.players), initialEpoch = f.G.epoch;
    expect(f.act(ids[0], 'placeCard', ids[0], 0, initialEpoch)).toBe(false);
    for (const id of ids) expect(f.act(id, 'setReady', true)).toBe(true);
    expect(f.act(ids[0], 'startGame')).toBe(true);
    const epoch = f.G.epoch;
    expect(f.act(ids[0], 'acknowledge', epoch)).toBe(false);
    expect(f.act(ids[0], 'confirmSpoken', ids[1], epoch)).toBe(false);
    expect(f.act(ids[0], 'submitAnswer', '不能打字繞過共同桌', epoch)).toBe(false);
    expect(f.G.status).toBe('sorting');
    for (const [card, index] of [[ids[0], -1], [ids[0], ids.length], [ids[0], '0'], [ids[0], .5], [ids[0], null], ['__proto__', 0], ['99', 0], [null, 0]] as [unknown, unknown][]) {
      expect(f.act(ids[0], 'placeCard', card, index, f.G.epoch)).toBe(false);
    }
    expect(f.act('99', 'placeCard', ids[0], 0, f.G.epoch)).toBe(false);
    expect(f.act(ids[0], 'placeCard', ids[0], 0, initialEpoch)).toBe(false);
    expect(f.act(ids[0], 'placeCard', ids[0], 0, String(f.G.epoch))).toBe(false);
    expect(f.act('99', 'approveOrder', f.G.epoch)).toBe(false);
    expect(f.act(ids[0], 'removeCard', '99', f.G.epoch)).toBe(false);
    expect(f.act(ids[0], 'revealAnswer', ids[0], f.G.epoch)).toBe(false);
    expect(f.act(ids[0], 'approveOrder', f.G.epoch - 1)).toBe(false);
    expect(f.act(ids[0], 'withdrawApproval', f.G.epoch)).toBe(false);
    expect(f.G.revealed).toEqual([]);
    const blind = turingObserverView(f.G, 'blind'), god = turingObserverView(f.G, 'god');
    expect(blind.private).toEqual({}); expect(Object.keys(god.private)).toHaveLength(3);
    expect(turingObserverView(god, 'blind').private).toEqual({});
    blind.tableOrder!.reverse(); blind.orderApprovals!.push('fake');
    expect(f.G.tableOrder).toEqual(ids); expect(f.G.orderApprovals).toEqual([]);
  });
  it('counts every adjacent descent, reveals the whole agreed table, clamps life at zero and gives failure priority', () => {
    const f = match(3), ids = Object.keys(f.G.players); prepareSorting(f);
    f.patch({ private: replaceNumbers(f, [9, 2, 3]) });
    revealOrder(f, ids);
    expect(f.G.integrity).toBe(2);
    expect(f.G.revealed.map(card => card.error)).toEqual([false, true, false]);
    expect(f.G.completedRounds).toBe(1);
    acknowledgeAll(f); prepareSorting(f);
    f.patch({ round: 5, integrity: 1, private: replaceNumbers(f, [9, 5, 2]) });
    revealOrder(f, ids);
    expect(f.G).toMatchObject({ status: 'finished', integrity: 0, completedRounds: 1, winner: 'system', winReason: 'integrity-lost' });
    expect(f.G.revealed.map(card => card.number)).toEqual([9, 5, 2]);
    expect(f.G.log.filter(event => event.type === 'reveal').slice(-3).map(event => event.integrity)).toEqual([1, 0, 0]);
    expect(f.G.log.filter(event => event.type === 'round-complete')).toHaveLength(1);
  });
});


describe('圖靈測試直接排序與全員重抽', () => {
  it.each([2, 3, 4, 9])('%i seats enter sorting immediately and redraw unanimously without redealing or charging lives', count => {
    const ids = Array.from({ length: count }, (_, index) => String(12 - count + index));
    const f = match(count, { participantIDs: ids, options: normalizeTuringOptions({ deck: 'custom', customQuestions, mode: 'endless', lives: 7 }) });
    expect(f.G).toMatchObject({ rulesVersion: 5, status: 'sorting', redrawApprovals: [] });
    const before = clone(f.G), firstQuestion = clone(f.G.question!);
    for (const id of ids) {
      expect(f.act(id, 'acknowledge', f.G.epoch)).toBe(false);
      expect(f.act(id, 'submitAnswer', '已經不需要回答確認', f.G.epoch)).toBe(false);
    }
    for (const [cardID, card] of Object.entries(turingCards(f.G))) {
      expect(f.act(card.playerID, 'confirmSpoken', cardID, f.G.epoch)).toBe(false);
    }
    if (isTuringSharedTable(f.G)) {
      for (const [index, id] of ids.entries()) expect(f.act(ids[0], 'placeCard', id, index, f.G.epoch)).toBe(true);
      expect(f.act(ids[1], 'approveOrder', f.G.epoch)).toBe(true);
    }
    const previousEpoch = f.G.epoch;
    expect(f.act(ids[0], 'approveRedraw', previousEpoch)).toBe(true);
    expect(f.G.epoch).toBe(previousEpoch + 1);
    expect(f.G.redrawApprovals).toEqual([ids[0]]);
    expect(f.G.orderApprovals ?? []).toEqual([]);
    expect(f.G.question).toEqual(firstQuestion);
    expect(f.act(ids[1], 'approveRedraw', previousEpoch)).toBe(false);
    const votingEpoch = f.G.epoch;
    for (const id of ids.slice(1, -1)) {
      expect(f.act(id, 'approveRedraw', votingEpoch)).toBe(true);
      expect(f.G.epoch).toBe(votingEpoch);
      expect(f.G.question).toEqual(firstQuestion);
    }
    f.reload();
    const beforeStateID = f.state._stateID;
    expect(f.act(ids.at(-1)!, 'approveRedraw', votingEpoch)).toBe(true);
    expect(f.state._stateID).toBe(beforeStateID + 1);
    expect(f.G.epoch).toBe(votingEpoch + 1);
    expect(f.G.question!.id).not.toBe(firstQuestion.id);
    expect(f.G).toMatchObject({ status: 'sorting', round: before.round, completedRounds: before.completedRounds,
      examinerID: before.examinerID, integrity: before.integrity, maxIntegrity: before.maxIntegrity,
      private: before.private, players: before.players, cards: before.cards, revealed: [], redrawApprovals: [] });
    if (isTuringSharedTable(f.G)) { expect(f.G.tableOrder).toEqual(ids); expect(f.G.orderApprovals).toEqual([]); }
    expect(f.G.log[0].question).toEqual(firstQuestion);
    expect(f.G.log.at(-1)).toEqual({ type: 'question-redraw', round: 1, actorID: ids.at(-1),
      examinerID: before.examinerID, question: f.G.question, integrity: 7 });
    expect(f.G.log.some(event => event.type === 'spoken' || event.type === 'answers')).toBe(false);
    expect(f.act(ids.at(-1)!, 'approveRedraw', votingEpoch)).toBe(false);
    const source = clone(f.G);
    for (const view of [turingPlayerView({ G: f.G, playerID: ids[0] }), turingObserverView(f.G, 'blind'), turingObserverView(f.G, 'god')]) {
      expect(view).not.toHaveProperty('secretDrawIDs'); expect(view).not.toHaveProperty('secretQuestionQueue');
      expect(view.log.at(-1)!.question).toEqual(f.G.question);
      view.redrawApprovals!.push('99'); view.log.at(-1)!.question!.prompt = 'changed view';
    }
    expect(turingObserverView(f.G, 'blind').private).toEqual({});
    expect(f.G).toEqual(source);
    sortedReveal(f); acknowledgeAll(f);
    expect(f.G).toMatchObject({ status: 'sorting', round: 2, completedRounds: 1, redrawApprovals: [] });
  });

  it('keeps redraw consent while cards move, blocks mixed reveal proposals, and revokes only the withdrawing seat', () => {
    const f = match(3), ids = Object.keys(f.G.players);
    for (const [index, id] of ids.entries()) expect(f.act(ids[0], 'placeCard', id, index, f.G.epoch)).toBe(true);
    expect(f.act(ids[0], 'approveOrder', f.G.epoch)).toBe(true);
    const oldOrderEpoch = f.G.epoch;
    expect(f.act(ids[1], 'approveRedraw', oldOrderEpoch)).toBe(true);
    expect(f.G.orderApprovals).toEqual([]);
    expect(f.act(ids[2], 'approveOrder', oldOrderEpoch)).toBe(false);
    expect(f.act(ids[2], 'approveOrder', f.G.epoch)).toBe(false);
    expect(f.act(ids[0], 'approveRedraw', f.G.epoch)).toBe(true);
    const pendingEpoch = f.G.epoch;
    expect(f.act(ids[2], 'placeCard', ids[0], 2, pendingEpoch)).toBe(true);
    expect(f.G.redrawApprovals).toEqual([ids[1], ids[0]]);
    expect(f.act(ids[2], 'approveRedraw', pendingEpoch)).toBe(false);
    expect(f.act(ids[2], 'removeCard', ids[0], f.G.epoch)).toBe(true);
    expect(f.G.redrawApprovals).toEqual([ids[1], ids[0]]);
    const withdrawalEpoch = f.G.epoch;
    expect(f.act(ids[2], 'withdrawRedraw', withdrawalEpoch)).toBe(false);
    expect(f.act(ids[0], 'withdrawRedraw', withdrawalEpoch)).toBe(true);
    expect(f.G.redrawApprovals).toEqual([ids[1]]);
    expect(f.act(ids[0], 'approveRedraw', withdrawalEpoch)).toBe(false);
    expect(f.act(ids[0], 'withdrawRedraw', f.G.epoch)).toBe(false);
    expect(f.act(ids[1], 'withdrawRedraw', f.G.epoch)).toBe(true);
    expect(f.G.redrawApprovals).toEqual([]);
    expect(f.G.orderApprovals).toEqual([]);
    const question = clone(f.G.question);
    sortedReveal(f);
    expect(f.G.question).toEqual(question); expect(f.G.status).toBe('round-review');
    expect(f.G.log.some(event => event.type === 'question-redraw')).toBe(false);
  });

  it('an examiner cannot reveal during a redraw proposal and nobody can redraw after the first public card', () => {
    const f = match(4), ids = Object.keys(f.G.players), cardID = Object.keys(turingCards(f.G))[0];
    const proposer = ids.find(id => id !== f.G.examinerID)!;
    expect(f.act(proposer, 'approveRedraw', f.G.epoch)).toBe(true);
    expect(f.act(f.G.examinerID, 'revealAnswer', cardID, f.G.epoch)).toBe(false);
    expect(f.G.revealed).toEqual([]);
    expect(f.act(proposer, 'withdrawRedraw', f.G.epoch)).toBe(true);
    expect(f.act(f.G.examinerID, 'revealAnswer', cardID, f.G.epoch)).toBe(true);
    const before = clone(f.G);
    for (const id of ids) expect(f.act(id, 'approveRedraw', f.G.epoch)).toBe(false);
    expect(f.G).toEqual(before);
  });

  it('rejects unknown seats, duplicate votes, malformed tokens, unavailable questions and wrong phases without mutation', () => {
    const f = match(3), id = Object.keys(f.G.players)[0];
    const before = clone(f.G);
    for (const actor of ['99', '__proto__', 'observer']) {
      expect(f.act(actor, 'approveRedraw', f.G.epoch)).toBe(false);
      expect(f.act(actor, 'withdrawRedraw', f.G.epoch)).toBe(false);
    }
    for (const epoch of [null, undefined, String(f.G.epoch), {}, NaN, Infinity, f.G.epoch - 1]) {
      expect(f.act(id, 'approveRedraw', epoch)).toBe(false);
    }
    expect(f.act(id, 'withdrawRedraw', f.G.epoch)).toBe(false);
    expect(f.G).toEqual(before);
    expect(f.act(id, 'approveRedraw', f.G.epoch)).toBe(true);
    const voted = clone(f.G);
    expect(f.act(id, 'approveRedraw', f.G.epoch)).toBe(false);
    expect(f.G).toEqual(voted);
    for (const status of ['lobby', 'briefing', 'answering', 'round-review'] as const) {
      f.patch({ status }); const old = clone(f.G);
      expect(f.act(id, 'approveRedraw', f.G.epoch)).toBe(false);
      expect(f.act(id, 'withdrawRedraw', f.G.epoch)).toBe(false);
      expect(f.G).toEqual(old);
    }
    // A malformed or old persisted one-question pool must fail safely instead
    // of consuming votes, changing the RNG or choosing the same prompt again.
    const single = match(2, { options: normalizeTuringOptions({ deck: 'custom', customQuestions }) });
    const question = single.G.question!, custom = { prompt: question.prompt, low: question.low, high: question.high };
    const options = { ...single.G.options, customQuestions: [custom] };
    const only = turingQuestionPool(options)[0];
    single.patch({ options, question: only, secretDrawIDs: [only.id] });
    const singleBefore = clone(single.state);
    expect(single.act(Object.keys(single.G.players)[0], 'approveRedraw', single.G.epoch)).toBe(false);
    expect(single.G).toEqual(singleBefore.G);
    expect(single.state.plugins.random.data).toEqual(singleBefore.plugins.random.data);
  });

  it('cycles a small pool across repeated redraws without adjacent duplicates or extra completed rounds', () => {
    const f = match(2, { options: normalizeTuringOptions({ deck: 'custom', customQuestions: customQuestions.slice(0, 5) }) });
    const ids = Object.keys(f.G.players), originalPrivate = clone(f.G.private), drawn = [f.G.question!.id];
    for (let redraw = 0; redraw < 12; redraw += 1) {
      for (const id of ids) expect(f.act(id, 'approveRedraw', f.G.epoch)).toBe(true);
      drawn.push(f.G.question!.id);
      expect(f.G).toMatchObject({ round: 1, completedRounds: 0, integrity: 3, private: originalPrivate });
      expect(f.G.secretDrawIDs!.length).toBeLessThanOrEqual(5);
      f.reload();
    }
    expect(drawn.every((id, index) => index === 0 || id !== drawn[index - 1])).toBe(true);
    expect(new Set(drawn.slice(0, 5)).size).toBe(5);
    expect(new Set(drawn.slice(5, 10)).size).toBe(5);
    expect(f.G.log.map(event => event.question!.id)).toEqual(drawn);
    expect(f.G.log.filter(event => event.type === 'round-start')).toHaveLength(1);
    expect(f.G.log.filter(event => event.type === 'question-redraw')).toHaveLength(12);
    sortedReveal(f); acknowledgeAll(f);
    expect(f.G.question!.id).not.toBe(drawn.at(-1));
  });

  it.each([1, 2, 3] as const)('persisted v%i games keep their confirmation flow and cannot adopt new redraw rules', version => {
    const f = match(version === 1 ? 4 : 3, {}, 'persisted-old-flow', version === 1 ? true : version);
    const ids = Object.keys(f.G.players);
    expect(f.G.status).toBe('briefing');
    expect(f.G.redrawApprovals).toBeUndefined();
    f.reload(); prepareSorting(f);
    for (const id of ids) expect(f.act(id, 'approveRedraw', f.G.epoch)).toBe(false);
    sortedReveal(f); acknowledgeAll(f);
    expect(f.G.status).toBe('briefing'); expect(f.G.rulesVersion).toBe(version);
    expect(f.G.log.some(event => event.type === (version === 1 ? 'answers' : 'spoken'))).toBe(true);
  });
});


describe('圖靈測試分別設定重抽與排序的同意方式', () => {
  it.each([2, 3])('any-player order approval reveals the %i-seat table once but round review still requires everyone', count => {
    const f = match(count, { options: normalizeTuringOptions({ orderApproval: 'any', redrawApproval: 'all' }) });
    const ids = Object.keys(f.G.players), epoch = f.G.epoch;
    for (const id of ['99', 'observer']) expect(f.act(id, 'approveOrder', epoch)).toBe(false);
    expect(f.act(ids.at(-1)!, 'approveOrder', epoch)).toBe(true);
    expect(f.G.status).toBe('round-review'); expect(f.G.revealed).toHaveLength(count);
    expect(f.G.orderApprovals).toEqual([ids.at(-1)!]);
    expect(f.act(ids[0], 'approveOrder', epoch)).toBe(false);
    const reviewEpoch = f.G.epoch;
    expect(f.act(ids[0], 'acknowledge', reviewEpoch)).toBe(true);
    expect(f.G).toMatchObject({ status: 'round-review', round: 1 });
    for (const id of ids.slice(1)) expect(f.act(id, 'acknowledge', reviewEpoch)).toBe(true);
    expect(f.G).toMatchObject({ status: 'sorting', round: 2 });
  });
  it.each([2, 4, 9])('any participant can redraw immediately in a %i-seat game without changing cards or requiring order consent', count => {
    const f = match(count, { options: normalizeTuringOptions({ redrawApproval: 'any', orderApproval: 'all' }) });
    const ids = Object.keys(f.G.players), before = clone(f.G);
    expect(f.act('99', 'approveRedraw', f.G.epoch)).toBe(false);
    expect(f.act(ids.at(-1)!, 'approveRedraw', f.G.epoch)).toBe(true);
    expect(f.G.question!.id).not.toBe(before.question!.id);
    expect(f.G).toMatchObject({ status: 'sorting', round: before.round, completedRounds: 0, private: before.private,
      integrity: before.integrity, examinerID: before.examinerID, redrawApprovals: [] });
    expect(f.act(ids.at(-1)!, 'approveRedraw', before.epoch)).toBe(false);
    expect(turingObserverView(f.G, 'blind').options).toMatchObject({ redrawApproval: 'any', orderApproval: 'all' });
    if (count <= 3) {
      expect(f.act(ids[0], 'approveOrder', f.G.epoch)).toBe(true);
      expect(f.G.status).toBe('sorting'); expect(f.G.revealed).toEqual([]);
    }
  });
  it('unanimous redraw remains independent of any-player order approval and blocks revealing until withdrawn', () => {
    const f = match(3, { options: normalizeTuringOptions({ redrawApproval: 'all', orderApproval: 'any' }) });
    const ids = Object.keys(f.G.players), original = clone(f.G.question);
    expect(f.act(ids[0], 'approveRedraw', f.G.epoch)).toBe(true);
    expect(f.G.question).toEqual(original);
    expect(f.act(ids[1], 'approveOrder', f.G.epoch)).toBe(false);
    expect(f.act(ids[0], 'withdrawRedraw', f.G.epoch)).toBe(true);
    expect(f.act(ids[1], 'approveOrder', f.G.epoch)).toBe(true);
    expect(f.G.status).toBe('round-review');
  });
  it('saved missing policies retain unanimous consent and project without rewriting old options', () => {
    const f = match(3), ids = Object.keys(f.G.players);
    const options = { ...f.G.options }; delete options.redrawApproval; delete options.orderApproval; delete options.nextApproval;
    f.patch({ options }); f.reload();
    expect(turingObserverView(f.G, 'god').options).toEqual(options);
    expect(f.act(ids[0], 'approveRedraw', f.G.epoch)).toBe(true);
    expect(f.G.redrawApprovals).toEqual([ids[0]]);
    expect(f.act(ids[0], 'withdrawRedraw', f.G.epoch)).toBe(true);
    expect(f.act(ids[0], 'approveOrder', f.G.epoch)).toBe(true);
    expect(f.G.status).toBe('sorting'); expect(f.G.orderApprovals).toEqual([ids[0]]);
  });
  it('host policy only accepts a seated host through the server-only reducer', () => {
    const f = match(3, { options: normalizeTuringOptions({ redrawApproval: 'host', orderApproval: 'host' }) });
    const ids = Object.keys(f.G.players), actorID = ids[1];
    const before = clone(f.G);
    expect(TuringGame.moves).not.toHaveProperty('serverApproveOrder');
    expect(TuringGame.moves).not.toHaveProperty('serverApproveRedraw');
    for (const id of ids) {
      expect(f.act(id, 'approveOrder', f.G.epoch, { isHost: true })).toBe(false);
      expect(f.act(id, 'approveRedraw', f.G.epoch, { isHost: true })).toBe(false);
      expect(f.act(id, 'serverApproveOrder', f.G.epoch, actorID)).toBe(false);
      expect(f.act(id, 'serverApproveRedraw', f.G.epoch, actorID)).toBe(false);
    }
    expect(f.G).toEqual(before);
    expect(f.hostAction(ids[0], 'serverApproveRedraw', f.G.epoch, null)).toBe(false);
    expect(f.hostAction(ids[0], 'serverApproveOrder', f.G.epoch, null)).toBe(false);
    expect(f.hostAction(ids[0], 'serverApproveRedraw', f.G.epoch, actorID)).toBe(true);
    expect(f.G.question!.id).not.toBe(before.question!.id);
    expect(f.G.private).toEqual(before.private);
    expect(f.G.redrawApprovals).toEqual([]);
    expect(f.G.log.at(-1)?.actorID).toBe(actorID ?? undefined);
    expect(f.hostAction(ids[0], 'serverApproveRedraw', before.epoch, actorID)).toBe(false);
    expect(f.hostAction(ids[0], 'serverApproveOrder', f.G.epoch, actorID)).toBe(true);
    expect(f.G.status).toBe('round-review'); expect(f.G.revealed).toHaveLength(3);
    expect(f.G.log.filter(event => event.type === 'reveal').every(event => event.actorID === (actorID ?? undefined))).toBe(true);
    expect(f.G.orderApprovals).toEqual([actorID]);
    expect(f.hostAction(ids[0], 'serverApproveOrder', f.G.epoch, actorID)).toBe(false);
    expect(f.hostAction(ids[0], 'serverApproveRedraw', f.G.epoch, actorID)).toBe(false);
    acknowledgeAll(f); expect(f.G.round).toBe(2);
  });
  it.each(['all', 'any'] as const)('the server-only host path cannot bypass a configured %s policy', policy => {
    const f = match(3, { options: normalizeTuringOptions({ redrawApproval: policy, orderApproval: policy }) });
    const ids = Object.keys(f.G.players), before = clone(f.G);
    expect(f.hostAction(ids[0], 'serverApproveOrder', f.G.epoch, ids[0])).toBe(false);
    expect(f.hostAction(ids[0], 'serverApproveRedraw', f.G.epoch, null)).toBe(false);
    expect(f.G).toEqual(before);
  });
  it('host-only actions validate epoch, execution seat and audit actor, while 4+ players keep examiner-only card revealing', () => {
    const f = match(4, { options: normalizeTuringOptions({ redrawApproval: 'host', orderApproval: 'host' }) });
    const ids = Object.keys(f.G.players), before = clone(f.G);
    expect(f.hostAction('99', 'serverApproveRedraw', f.G.epoch, null)).toBe(false);
    for (const epoch of [f.G.epoch - 1, String(f.G.epoch), null]) {
      expect(f.hostAction(ids[0], 'serverApproveRedraw', epoch, null)).toBe(false);
    }
    for (const actor of ['99', '__proto__', undefined, {}, true]) expect(f.hostAction(ids[0], 'serverApproveRedraw', f.G.epoch, actor)).toBe(false);
    expect(f.hostAction(ids[0], 'serverApproveOrder', f.G.epoch, null)).toBe(false);
    expect(f.G).toEqual(before);
    const card = Object.keys(turingCards(f.G))[0];
    expect(f.act(ids.find(id => id !== f.G.examinerID)!, 'revealAnswer', card, f.G.epoch)).toBe(false);
    expect(f.act(f.G.examinerID, 'revealAnswer', card, f.G.epoch)).toBe(true);
    expect(f.hostAction(ids[0], 'serverApproveRedraw', f.G.epoch, null)).toBe(false);
  });
});

describe('即時同意方式、下一題與保留成績結束', () => {
  it.each([2, 3, 4])('any participant can proceed from a %i-player completed round without touching examiner rules', count => {
    const f = match(count, { options: normalizeTuringOptions({ nextApproval: 'any' }) });
    sortedReveal(f);
    expect(f.G.status).toBe('round-review');
    const before = clone(f.G), id = Object.keys(f.G.players).at(-1)!;
    expect(f.act(id, 'acknowledge', before.epoch)).toBe(true);
    expect(f.G).toMatchObject({ status: 'sorting', round: 2, completedRounds: 1, integrity: before.integrity });
    expect(f.act(id, 'acknowledge', before.epoch)).toBe(false);
    expect(f.G.examinerID === '').toBe(count <= 3);
  });
  it('host-only next round is not a normal move and needs no preceding participant confirmations', () => {
    const f = match(3, { options: normalizeTuringOptions({ nextApproval: 'host' }) });
    sortedReveal(f);
    const ids = Object.keys(f.G.players), epoch = f.G.epoch;
    for (const id of ids) {
      expect(f.act(id, 'acknowledge', epoch)).toBe(false);
      expect(f.act(id, 'serverApproveNext', epoch, id)).toBe(false);
    }
    expect(f.hostAction(ids[0], 'serverApproveNext', epoch, null)).toBe(false);
    expect(f.hostAction(ids[1], 'serverApproveNext', epoch, ids[1])).toBe(true);
    expect(f.G).toMatchObject({ status: 'sorting', round: 2, completedRounds: 1 });
    expect(f.hostAction(ids[1], 'serverApproveNext', f.G.epoch, ids[1])).toBe(false);
  });
  it('changing policies resets consent atomically, preserves cards and rejects stale approvals', () => {
    const f = match(3), ids = Object.keys(f.G.players);
    expect(f.act(ids[0], 'approveOrder', f.G.epoch)).toBe(true);
    expect(f.act(ids[1], 'approveRedraw', f.G.epoch)).toBe(true);
    const before = clone(f.G);
    const policies = { orderApproval: 'any', redrawApproval: 'host', nextApproval: 'host' };
    expect(f.act(ids[0], 'serverSetApprovalPolicies', before.epoch, policies)).toBe(false);
    expect(f.hostAction(ids[0], 'serverSetApprovalPolicies', before.epoch, policies)).toBe(true);
    expect(f.G).toMatchObject({ epoch: before.epoch + 1, question: before.question, private: before.private,
      cards: before.cards, integrity: before.integrity, tableOrder: before.tableOrder, orderApprovals: [], redrawApprovals: [], options: policies });
    expect(f.G.log.at(-1)).toMatchObject({ type: 'approval-change', policies });
    for (const move of ['approveOrder', 'approveRedraw', 'acknowledge']) expect(f.act(ids[2], move, before.epoch)).toBe(false);
    f.reload(); expect(turingObserverView(f.G, 'blind').options).toMatchObject(policies);
    expect(f.act(ids[2], 'approveOrder', f.G.epoch)).toBe(true);
    expect(f.G.status).toBe('round-review');
    const review = clone(f.G);
    expect(f.hostAction(ids[0], 'serverSetApprovalPolicies', review.epoch, { nextApproval: 'any' })).toBe(true);
    expect(f.act(ids[2], 'acknowledge', f.G.epoch)).toBe(true);
    expect(f.G.round).toBe(2);
  });
  it.each([{}, null, [], { orderApproval: 'owner' }, { nextApproval: false }, { deck: 'mixed' }])('rejects invalid live policy patch %j without mutation', input => {
    const f = match(3), before = clone(f.G);
    expect(f.hostAction('0', 'serverSetApprovalPolicies', f.G.epoch, input)).toBe(false);
    expect(f.G).toEqual(before);
  });
  it.each(['sorting', 'round-review'] as const)('host finishing during %s retains only completed rounds, current lives and replay result', stage => {
    const f = match(3, { options: normalizeTuringOptions({ mode: 'endless', lives: 7 }) });
    sortedReveal(f);
    if (stage === 'sorting') acknowledgeAll(f);
    const before = clone(f.G);
    expect(TuringGame.moves).not.toHaveProperty('serverFinishChallenge');
    expect(f.act('0', 'serverFinishChallenge', before.epoch)).toBe(false);
    expect(f.hostAction('0', 'serverFinishChallenge', before.epoch - 1, null)).toBe(false);
    expect(f.hostAction('0', 'serverFinishChallenge', before.epoch, null)).toBe(true);
    expect(f.G).toMatchObject({ status: 'finished', winner: 'humans', winReason: 'endless-stopped', completedRounds: 1,
      integrity: before.integrity, round: before.round });
    expect(f.state.ctx.gameover).toEqual({ winner: 'humans', reason: 'endless-stopped' });
    expect(f.G.log.at(-1)).toMatchObject({ type: 'finish', completedRounds: 1, reason: 'endless-stopped' });
    f.reload(); expect(turingObserverView(f.G, 'blind').log.at(-1)?.completedRounds).toBe(1);
    expect(f.hostAction('0', 'serverFinishChallenge', f.G.epoch, null)).toBe(false);
    expect(f.hostAction('0', 'serverSetApprovalPolicies', f.G.epoch, { nextApproval: 'any' })).toBe(false);
  });
  it('does not allow scoring a waiting room or ordinary five-round game', () => {
    const regular = match(3), waiting = match(3, { startImmediately: false, options: normalizeTuringOptions({ mode: 'endless' }) });
    for (const f of [regular, waiting]) expect(f.hostAction('0', 'serverFinishChallenge', f.G.epoch, null)).toBe(false);
  });
});

describe('圖靈測試 v5 群體校準與檢測員玩法', () => {
  it.each([2, 3])('%i-player rooms always use group calibration even with an examiner preference', count => {
    const f = match(count, { options: normalizeTuringOptions({ sortingMode: 'examiner' }) });
    expect(isTuringSharedTable(f.G)).toBe(true);
    expect(f.G.examinerID).toBe('');
    expect(Object.keys(turingCards(f.G))).toHaveLength(count);
  });
  it.each([
    { count: 4, mode: 'standard' as const, rounds: 5 },
    { count: 10, mode: 'standard' as const, rounds: 5 },
    { count: 10, mode: 'endless' as const, rounds: 6 },
  ])('$count-player $mode group calibration preserves its table, privacy and challenge type across rounds and reloads', ({ count, mode, rounds }) => {
    const f = match(count, { options: normalizeTuringOptions({ sortingMode: 'group', mode, lives: 20 }) });
    const ids = Object.keys(f.G.players);
    for (let round = 1; round <= rounds; round++) {
      expect(f.G).toMatchObject({ rulesVersion: 5, examinerID: '', round, completedRounds: round - 1,
        targetRounds: mode === 'endless' ? null : 5, tableOrder: ids, orderApprovals: [] });
      expect(Object.keys(f.G.private)).toEqual(ids);
      expect(new Set(ids.map(id => turingCardNumber(f.G, id))).size).toBe(count);
      expect(turingObserverView(f.G, 'blind').private).toEqual({});
      expect(turingObserverView(f.G, 'blind').options.sortingMode).toBe('group');
      expect(f.act(ids[0], 'revealAnswer', ids[1], f.G.epoch)).toBe(false);
      sortedReveal(f); f.reload();
      if (round < rounds) acknowledgeAll(f);
    }
    if (mode === 'endless') {
      expect(f.G).toMatchObject({ status: 'round-review', completedRounds: rounds, integrity: 20 });
      expect(f.hostAction(ids[0], 'serverFinishChallenge', f.G.epoch, undefined)).toBe(true);
      expect(getGameDefinition('turing-test')!.getOutcome(f.G)?.challenge)
        .toEqual({ mode: 'endless-table', completedRounds: rounds, startingLives: 20 });
    } else {
      expect(f.G).toMatchObject({ status: 'finished', winner: 'humans', completedRounds: rounds });
      expect(getGameDefinition('turing-test')!.getOutcome(f.G)?.challenge).toBeUndefined();
    }
  });
  it.each([
    { count: 4, policy: 'any' as const }, { count: 10, policy: 'host' as const },
  ])('$count-player group calibration honors $policy redraw and ordering without waiting for extra votes', ({ count, policy }) => {
    const f = match(count, { options: normalizeTuringOptions({ sortingMode: 'group', redrawApproval: policy, orderApproval: policy }) });
    const ids = Object.keys(f.G.players), before = clone(f.G), actor = ids.at(-1)!;
    const act = (move: 'Order' | 'Redraw') => policy === 'host'
      ? f.hostAction(ids[0], `serverApprove${move}`, f.G.epoch, actor)
      : f.act(actor, `approve${move}`, f.G.epoch);
    expect(act('Redraw')).toBe(true);
    expect(f.G.question!.id).not.toBe(before.question!.id);
    expect(f.G.private).toEqual(before.private); expect(f.G.integrity).toBe(before.integrity);
    expect(f.G.tableOrder).toEqual(ids); expect(f.G.orderApprovals).toEqual([]);
    const sorted = [...ids].sort((a, b) => turingCardNumber(f.G, a)! - turingCardNumber(f.G, b)!);
    sorted.forEach((id, index) => expect(f.act(ids[0], 'placeCard', id, index, f.G.epoch)).toBe(true));
    if (policy === 'host') expect(f.act(actor, 'approveOrder', f.G.epoch)).toBe(false);
    expect(act('Order')).toBe(true);
    expect(f.G).toMatchObject({ status: 'round-review', completedRounds: 1, orderApprovals: [actor] });
    expect(f.G.revealed).toHaveLength(count);
  });
  it.each([3, 4] as const)('saved v%i four-player games keep their examiner despite a stray group option', version => {
    const f = match(4, { options: normalizeTuringOptions({ mode: 'endless', lives: 7 }) });
    f.patch({ rulesVersion: version, options: { ...f.G.options, sortingMode: 'group' } });
    const firstExaminer = f.G.examinerID, ids = Object.keys(f.G.players);
    for (let round = 1; round <= 2; round++) {
      expect(isTuringSharedTable(f.G)).toBe(false);
      expect(f.G.examinerID).toBe(ids[(ids.indexOf(firstExaminer) + round - 1) % ids.length]);
      expect(Object.keys(turingCards(f.G))).toHaveLength(3);
      expect(f.act(ids[0], 'placeCard', Object.keys(turingCards(f.G))[0], 0, f.G.epoch)).toBe(false);
      if (f.G.status === 'briefing') prepareSorting(f);
      sortedReveal(f); f.reload();
      if (round === 1) acknowledgeAll(f);
    }
    expect(f.hostAction(ids[0], 'serverFinishChallenge', f.G.epoch, undefined)).toBe(true);
    expect(getGameDefinition('turing-test')!.getOutcome(f.G)?.challenge)
      .toEqual({ mode: 'endless', completedRounds: 2, startingLives: 7 });
  });
  it('nine-player examiner play deals eight cards and keeps examiner challenge statistics', () => {
    const f = match(9, { options: normalizeTuringOptions({ sortingMode: 'examiner', mode: 'endless', lives: 6 }) });
    const ids = Object.keys(f.G.players);
    expect(isTuringSharedTable(f.G)).toBe(false);
    expect(Object.keys(turingCards(f.G))).toHaveLength(8);
    expect(f.G.private[f.G.examinerID]).toBeUndefined();
    sortedReveal(f);
    expect(f.hostAction(ids[0], 'serverFinishChallenge', f.G.epoch, undefined)).toBe(true);
    expect(getGameDefinition('turing-test')!.getOutcome(f.G)?.challenge)
      .toEqual({ mode: 'endless', completedRounds: 1, startingLives: 6 });
  });
  it('a saved v5 ten-player examiner match resumes and rotates without adopting the new-room limit', () => {
    const f = match(10, { options: normalizeTuringOptions({ sortingMode: 'group', mode: 'endless', lives: 6 }) });
    const ids = Object.keys(f.G.players), examinerID = ids[3], saved = clone(f.G);
    // Reconstruct the already-started examiner state supported by 0.27.0.
    saved.options.sortingMode = 'examiner'; saved.examinerID = examinerID;
    delete saved.private[examinerID]; delete saved.cards![examinerID];
    delete saved.tableOrder; delete saved.orderApprovals;
    saved.log[0].examinerID = examinerID;
    f.patch(saved); f.reload();
    expect(validateTuringOptions(f.G.options, 10)).toBeTypeOf('string');
    for (let round = 1; round <= 2; round++) {
      expect(f.G).toMatchObject({ rulesVersion: 5, status: 'sorting', round, completedRounds: round - 1,
        options: { sortingMode: 'examiner', mode: 'endless' }, examinerID: ids[round + 2] });
      expect(Object.keys(f.G.players)).toHaveLength(10);
      expect(isTuringSharedTable(f.G)).toBe(false);
      expect(Object.keys(turingCards(f.G))).toHaveLength(9);
      expect(Object.keys(f.G.private)).toHaveLength(9);
      expect(f.G.private[f.G.examinerID]).toBeUndefined();
      sortedReveal(f);
      expect(f.G).toMatchObject({ status: 'round-review', completedRounds: round, integrity: 6 });
      expect(f.G.revealed).toHaveLength(9);
      f.reload();
      if (round === 1) acknowledgeAll(f);
    }
    expect(f.hostAction(ids[0], 'serverFinishChallenge', f.G.epoch, undefined)).toBe(true);
    expect(getGameDefinition('turing-test')!.getOutcome(f.G)?.challenge)
      .toEqual({ mode: 'endless', completedRounds: 2, startingLives: 6 });
  });
});

describe('圖靈測試公開房規驗證', () => {
  it.each(['standard', 'endless'] as const)('%s enforces the examiner limit without changing the requested mode', mode => {
    const inputs = mode === 'standard' ? [undefined, {}, { sortingMode: 'examiner' }]
      : [{ mode }, { mode, sortingMode: 'examiner' }];
    for (const input of inputs) {
      const before = input === undefined ? undefined : clone(input);
      const error = validateTuringOptions(input, 10);
      expect(error).toBe('檢測員排序最多 9 位玩家；10 人請選擇群體校準。');
      expect(createMatch({ game: TuringGame, numPlayers: 10, setupData: { options: input, startImmediately: true }, unlisted: true }))
        .toMatchObject({ setupDataError: error });
      expect(input).toEqual(before);
      expect(normalizeTuringOptions(input).sortingMode).toBe('examiner');
      expect(validateTuringOptions(input, 9)).toBeUndefined();
    }
    for (const [count, sortingMode] of [[9, 'examiner'], [10, 'group']] as const) {
      const options = normalizeTuringOptions({ mode, sortingMode });
      expect(validateTuringOptions(options, count)).toBeUndefined();
      const f = match(count, { options });
      expect(f.G.options).toMatchObject({ mode, sortingMode });
      expect(isTuringSharedTable(f.G)).toBe(sortingMode === 'group');
      expect(Object.keys(turingCards(f.G))).toHaveLength(sortingMode === 'group' ? count : count - 1);
    }
  });
  it.each([undefined, false])('a ten-seat waiting room preserves examiner settings with startImmediately=%s but cannot start them', startImmediately => {
    const options = normalizeTuringOptions({ sortingMode: 'examiner', mode: 'endless', lives: 7 });
    const f = match(10, { options, startImmediately });
    expect(f.G).toMatchObject({ status: 'lobby', options, private: {}, cards: {}, round: 0 });
    for (const id of Object.keys(f.G.players)) expect(f.act(id, 'setReady', true)).toBe(true);
    const before = clone(f.G);
    expect(f.act(Object.keys(f.G.players)[0], 'startGame')).toBe(false);
    expect(f.G).toEqual(before);
  });
  it.each([[9, 'examiner'], [10, 'group']] as const)('%i-seat %s waiting rooms can start through the ready flow', (count, sortingMode) => {
    const f = match(count, { startImmediately: false, options: normalizeTuringOptions({ sortingMode }) });
    const ids = Object.keys(f.G.players);
    for (const id of ids) expect(f.act(id, 'setReady', true)).toBe(true);
    expect(f.act(ids[0], 'startGame')).toBe(true);
    expect(f.G).toMatchObject({ status: 'sorting', options: { sortingMode } });
    expect(isTuringSharedTable(f.G)).toBe(sortingMode === 'group');
    expect(Object.keys(turingCards(f.G))).toHaveLength(sortingMode === 'group' ? count : count - 1);
  });
  it('normalizes independent defaults and trimmed custom cards without truncation', () => {
    const a = normalizeTuringOptions(undefined), b = normalizeTuringOptions(undefined);
    a.customQuestions.push(customQuestions[0]);
    expect(b).toEqual({ deck: 'standard', customQuestions: [], mode: 'standard', lives: 5, sortingMode: 'examiner', redrawApproval: 'all', orderApproval: 'all', nextApproval: 'all' });
    expect(normalizeTuringOptions({ customQuestions: [{ prompt: '  請說一句歡迎詞。  ', low: ' 冷淡 ', high: ' 熱情 ' }] })).toEqual({
      deck: 'standard', customQuestions: [{ prompt: '請說一句歡迎詞。', low: '冷淡', high: '熱情' }], mode: 'standard', lives: 5, sortingMode: 'examiner', redrawApproval: 'all', orderApproval: 'all', nextApproval: 'all',
    });
    expect(validateTuringOptions({ deck: 'custom', customQuestions: customQuestions.slice(0, 5) }, 4)).toBeUndefined();
    expect(validateTuringOptions({ deck: 'custom', customQuestions: customQuestions.slice(0, 4) }, 4)).toContain('至少');
  });
  it.each([
    null, [], 'custom', 10, { unknown: true }, { deck: '__proto__' }, { deck: null }, { deck: true },
    { redrawApproval: null }, { orderApproval: null }, { redrawApproval: 'everyone' }, { orderApproval: 'owner' },
    { redrawApproval: true }, { orderApproval: 1 }, { redrawApproval: [] }, { orderApproval: {} },
    { nextApproval: 'owner' }, { nextApproval: null }, { nextApproval: false },
    { sortingMode: 'all' }, { sortingMode: null }, { sortingMode: false }, { sortingMode: [] }, { sortingMode: {} },
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
    for (const count of [0, 1, 11, 4.5, NaN]) expect(validateTuringOptions(undefined, count)).toBeTypeOf('string');
    for (const ids of [['0', '0', '1', '2'], ['0', '1', '2'], ['0', '1', '2', '__proto__'], ['0', '1', '2', '12']]) {
      const result = createMatch({ game: TuringGame, numPlayers: 4, setupData: { participantIDs: ids }, unlisted: true });
      expect(result).toHaveProperty('setupDataError');
    }
    const overLimit = createMatch({ game: TuringGame, numPlayers: 4, setupData: { options: { deck: 'custom', customQuestions: [] } }, unlisted: true });
    expect(overLimit).toHaveProperty('setupDataError');
  });
});
