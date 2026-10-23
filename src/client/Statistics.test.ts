import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChallengeStandings, factionRecord } from './Statistics';
import { RoomHistory } from './RoomHistory';
import type { RoomInfo } from './api';

describe('Challenge score presentation', () => {
  it('keeps endless runs out of ranked losses and supports older statistics without a ranked count', () => {
    expect(factionRecord({ completed: 10, rankedCompleted: 2, wins: { humans: 1 } }, 'humans'))
      .toEqual({ wins: 1, losses: 1, draws: 0, rate: 50 });
    expect(factionRecord({ completed: 8, rankedCompleted: 0, wins: {} }, 'humans'))
      .toEqual({ wins: 0, losses: 0, draws: 0, rate: 0 });
    expect(factionRecord({ completed: 2, wins: { humans: 1 } }, 'humans'))
      .toEqual({ wins: 1, losses: 1, draws: 0, rate: 50 });
  });
  it('labels completed levels and conditions clearly, including a zero-level challenge', () => {
    const html = renderToStaticMarkup(createElement(ChallengeStandings, { challenges: [
      { mode: 'endless', numPlayers: 2, startingLives: 1, runs: 2, bestCompletedRounds: 0, averageCompletedRounds: 0 },
      { mode: 'endless', numPlayers: 3, startingLives: 5, runs: 1, bestCompletedRounds: 6, averageCompletedRounds: 6 },
    ] }));
    expect(html).toContain('最高通關'); expect(html).toContain('平均通關');
    expect(html).toContain('不算入五關模式勝敗'); expect(html).toContain('0 關'); expect(html).toContain('6 關');
    expect(html).toContain('1 點'); expect(html).toContain('5 點'); expect(html).not.toMatch(/\d+ 敗/);
  });
  it('shows the preserved score in the waiting-room history instead of describing a challenge as an ordinary defeat', () => {
    const info: RoomInfo = { roomId: 'room', matchID: 'current', gameName: 'turing-test', status: 'lobby',
      numPlayers: 2, minPlayers: 2, maxPlayers: 9, spectatorCount: 0, godViewAllowed: true, players: [], history: [{
      matchID: 'match', gameName: 'turing-test', endedAt: 1, ending: 'completed', numPlayers: 2,
      winner: 'system', reason: 'endless-exhausted', challenge: { mode: 'endless', completedRounds: 6, startingLives: 1 },
    }] };
    const html = renderToStaticMarkup(createElement(RoomHistory, { info, seat: { ...info, playerID: '0', credentials: 'test' } }));
    expect(html).toContain('挑戰結束'); expect(html).toContain('通過 6 關'); expect(html).toContain('第 7 關');
    expect(html).toContain('起始 1 點生命'); expect(html).not.toContain('測試失敗');
  });
});
