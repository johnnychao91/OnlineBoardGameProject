import { describe, expect, it } from 'vitest';
import type { EchoState } from '../games/echo/game';
import { normalizeEchoOptions } from '../games/echo/rules';
import type { RoomInfo } from './api';
import { buildEchoPosterModel } from './echo-poster';

const seats = ['2', '6', '10'];
const info: RoomInfo = {
  roomId: 'private-room', matchID: 'private-match', gameName: 'cup-echo', status: 'finished',
  numPlayers: 3, minPlayers: 2, maxPlayers: 4, spectatorCount: 0, godViewAllowed: true,
  players: [...seats].reverse().map(id => ({ id, name: '客人 ' + id, isConnected: true, ready: true })),
};
const state: EchoState = {
  rulesVersion: 1, status: 'finished', round: 2, epoch: 5, phaseEpoch: 5, deadline: null,
  options: normalizeEchoOptions(), clues: [],
  players: Object.fromEntries(seats.map(id => [id, { ready: true, sealed: false, reviewed: false }])),
  private: { 2: { draft: '機密草稿', word: '未公開封詞' } }, result: 'same-meaning',
  history: [
    { number: 1, timedOut: true, words: { 2: '風箏', 10: 'https://example.com/hidden-link' } },
    { number: 2, timedOut: false, words: { 2: '鳳梨', 6: '菠蘿', 10: '鳳梨' } },
  ],
};

describe('Cup Echo full word-chain PNG', () => {
  it('uses the table order, public words, missing-answer labels, and the final matching round', () => {
    const model = buildEchoPosterModel({ G: state, info, step: 1, totalSteps: 12 });
    expect(model.names).toEqual(['客人 2', '客人 6', '客人 10']);
    expect(model.rounds).toEqual([
      { number: 1, matched: false, words: ['風箏', '未作答', '…'] },
      { number: 2, matched: true, words: ['鳳梨', '菠蘿', '鳳梨'] },
    ]);
    expect(model.headline).toBe('我們在第 2 輪產生共鳴');
    expect(model.note).toBe('同義共鳴');
    expect(JSON.stringify(model)).not.toMatch(/private-room|private-match|機密草稿|未公開封詞|hidden-link/);
  });
  it('does not mark a last round as successful when the round limit was reached', () => {
    const model = buildEchoPosterModel({ G: { ...state, result: 'round-limit' }, info, step: 12, totalSteps: 12 });
    expect(model.headline).toBe('這一桌尚未共鳴');
    expect(model.rounds.every(round => !round.matched)).toBe(true);
  });
  it('retains every round in a single export up to the 1,000-round limit', () => {
    const history = Array.from({ length: 1000 }, (_, index) => ({ number: index + 1, words: { 2: '晚風' }, timedOut: false }));
    const { rounds } = buildEchoPosterModel({ G: { ...state, history, round: 1000 }, info, step: 1, totalSteps: 1 });
    expect(rounds).toHaveLength(1000);
    expect(rounds.slice(-4).map(round => round.number)).toEqual([997, 998, 999, 1000]);
    expect(rounds.filter(round => round.matched).map(round => round.number)).toEqual([1000]);
  });
});
