import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChallengeStandings, CompetitionStandings, GameStatisticsCard, factionRecord } from './Statistics';
import { RoomHistory } from './RoomHistory';
import type { RoomInfo } from './api';

describe('Challenge score presentation', () => {
  it('shows individual competition runs and rounds without inventing a shared faction win rate', () => {
    const html = renderToStaticMarkup(createElement(CompetitionStandings, { gameID: 'midnight-post', competitions: [
      { mode: 'classic', numPlayers: 3, runs: 2, totalRounds: 17, averageRounds: 8.5 },
      { mode: 'premium', numPlayers: 8, runs: 1, totalRounds: 15, averageRounds: 15 },
    ] }));
    expect(html).toContain('密函投遞'); expect(html).toContain('全城夜遞');
    expect(html).toContain('8.5'); expect(html).toContain('平均夜數');
    expect(html).not.toMatch(/勝率|\d+ 敗|delivery|premium/);
  });
  it('uses the registered game theme for a banquet competition', () => {
    const html = renderToStaticMarkup(createElement(CompetitionStandings, { gameID: 'hundred-ghosts', competitions: [
      { mode: 'B', numPlayers: 12, runs: 3, totalRounds: 3, averageRounds: 1 },
      { mode: 'custom', numPlayers: 6, runs: 1, totalRounds: 1, averageRounds: 1 },
    ] }));
    expect(html).toContain('夜宴競賽紀錄'); expect(html).toContain('場景 B'); expect(html).toContain('自訂場景');
    expect(html).not.toMatch(/投遞|信使|夜數|勝率/);
  });
  it.each([
    ['hundred-ghosts', '百鬼夜宴', 'A', '夜宴競賽紀錄', '場景 A', 1],
    ['curtain-heist', '謝幕劫案', 'five-acts', '劫案競賽紀錄', '五幕劫案', 5],
    ['curtain-heist', '謝幕劫案', 'five-acts-hazard-3', '劫案競賽紀錄', '同類第 3 張', 5],
    ['firewall-breach', '潛入防火牆', 'combined', '滲透競賽紀錄', '基本＋擴充', 3],
    ['star-workshop', '星匠工坊', 'base', '工坊競賽紀錄', '基本工坊', 20],
  ] as const)('renders %s individual results without inventing faction records', (gameId, name, mode, title, modeName, rounds) => {
    for (const completed of [false, true]) {
    const html = renderToStaticMarkup(createElement(GameStatisticsCard, { game: {
      gameId, name, completed: completed ? 1 : 0, rankedCompleted: 0,
      wins: {}, reasons: {}, byPlayerCount: [], competitions: completed ? [
        { mode, numPlayers: 4, runs: 1, totalRounds: rounds, averageRounds: rounds },
      ] : [],
    } }));
    expect(html).toContain(name);
    expect(html).not.toMatch(/陣營|勝率|勝利次數|faction-standings|投遞|信使/);
    if (completed) { expect(html).toContain(title); expect(html).toContain(modeName); }
    }
  });
  it('keeps endless runs out of ranked losses and supports older statistics without a ranked count', () => {
    expect(factionRecord({ completed: 10, rankedCompleted: 2, wins: { humans: 1 } }, 'humans'))
      .toEqual({ wins: 1, losses: 1, draws: 0, rate: 50 });
    expect(factionRecord({ completed: 8, rankedCompleted: 0, wins: {} }, 'humans'))
      .toEqual({ wins: 0, losses: 0, draws: 0, rate: 0 });
    expect(factionRecord({ completed: 2, wins: { humans: 1 } }, 'humans'))
      .toEqual({ wins: 1, losses: 1, draws: 0, rate: 50 });
  });
  it.each([
    ['midnight-post', 'classic', 'delivery', 8, '密函投遞', '8 夜'],
    ['midnight-post', 'premium', 'delivery', 12, '全城夜遞', '12 夜'],
    ['hundred-ghosts', 'B', 'wealth', 1, '場景 B', '1 場'],
    ['curtain-heist', 'five-acts', 'heist', 5, '五幕劫案', '5 幕'],
    ['curtain-heist', 'five-acts-hazard-3', 'heist', 5, '同類第 3 張', '5 幕'],
    ['firewall-breach', 'combined', 'wealth', 3, '基本＋擴充', '3 輪'],
    ['star-workshop', 'base', 'prestige', 20, '基本工坊', '20 輪'],
  ] as const)('keeps archived %s/%s competition labels after the room changes game', (gameName, mode, winner, rounds, label, duration) => {
    const info: RoomInfo = { roomId: 'room', matchID: 'current', gameName: 'turing-test', status: 'lobby',
      numPlayers: 4, minPlayers: 2, maxPlayers: 10, spectatorCount: 0, godViewAllowed: true, players: [], history: [{
        matchID: 'old-match', gameName, endedAt: 1, ending: 'completed', numPlayers: 4,
        winner, competition: { mode, rounds },
      }] };
    const html = renderToStaticMarkup(createElement(RoomHistory, { info, seat: { ...info, playerID: '0', credentials: 'test' } }));
    expect(html).toContain(label); expect(html).toContain(duration); expect(html).toContain('查看上一局結果與復盤');
    if (gameName !== 'midnight-post') expect(html).not.toMatch(/投遞|郵戳|夜遞/);
  });
  it('labels completed levels and conditions clearly, including a zero-level challenge', () => {
    const html = renderToStaticMarkup(createElement(ChallengeStandings, { challenges: [
      { mode: 'endless', numPlayers: 2, startingLives: 1, runs: 2, bestCompletedRounds: 0, averageCompletedRounds: 0 },
      { mode: 'endless-table', numPlayers: 3, startingLives: 5, runs: 1, bestCompletedRounds: 6, averageCompletedRounds: 6 },
    ] }));
    expect(html).toContain('最高通關'); expect(html).toContain('平均通關');
    expect(html).toContain('不算入五關模式勝敗'); expect(html).toContain('0 關'); expect(html).toContain('6 關');
    expect(html).toContain('1 點'); expect(html).toContain('5 點'); expect(html).not.toMatch(/\d+ 敗/);
    expect(html).toContain('檢測員'); expect(html).toContain('群體校準'); expect(html).not.toContain('endless-table');
  });
  it.each(['endless', 'endless-table'])('shows the preserved score and %s mode in waiting-room history instead of an ordinary defeat', mode => {
    const info: RoomInfo = { roomId: 'room', matchID: 'current', gameName: 'turing-test', status: 'lobby',
      numPlayers: 2, minPlayers: 2, maxPlayers: 9, spectatorCount: 0, godViewAllowed: true, players: [], history: [{
      matchID: 'match', gameName: 'turing-test', endedAt: 1, ending: 'completed', numPlayers: 2,
      winner: 'system', reason: 'endless-exhausted', challenge: { mode, completedRounds: 6, startingLives: 1 },
    }] };
    const html = renderToStaticMarkup(createElement(RoomHistory, { info, seat: { ...info, playerID: '0', credentials: 'test' } }));
    expect(html).toContain('挑戰結束'); expect(html).toContain('通過 6 關'); expect(html).toContain('第 7 關');
    expect(html).toContain('起始 1 點生命'); expect(html).not.toContain('測試失敗');
    expect(html).toContain(mode === 'endless-table' ? '群體校準' : '檢測員');
  });
});

it('shows heist earnings with player names, tied ranks and escaped nickname text',()=>{
  const html=renderToStaticMarkup(createElement(CompetitionStandings,{gameID:'curtain-heist',competitions:[{mode:'five-acts',numPlayers:3,runs:1,totalRounds:5,averageRounds:5,highScores:[{name:'<script>test</script>',total:50},{name:'Johnny',total:50},{name:'Sophie',total:20}]}]}));
  expect(html).toContain('最高收益排行');expect(html).toContain('Johnny');expect(html).toContain('50');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('<td>3</td><td>Sophie');
});

it('renders a separate single-act leaderboard with the player and act number',()=>{
  const html=renderToStaticMarkup(createElement(CompetitionStandings,{gameID:'curtain-heist',competitions:[{mode:'five-acts-hazard-3',numPlayers:3,runs:1,totalRounds:5,averageRounds:5,roundHighScores:[{name:'Johnny',total:42,round:4}]}]}));
  expect(html).toContain('單幕最高收益排行');expect(html).toContain('Johnny');expect(html).toContain('第 4 幕');expect(html).toContain('42 點');expect(html).not.toContain('單局最高收益排行');
});
