import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { MoonGame, moonPlayerView, type MoonState } from '../games/moon/game';
import { MoonCoverTask, MoonNightAction, MoonPrivatePanel, MoonCountdown, MoonSheriffAction } from './MoonBoard';
import { MoonSnapshot } from './MoonSnapshot';
import type { RoomInfo } from './api';

function fixture(): MoonState {
  const match = createMatch({ game: MoonGame, numPlayers: 8, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as MoonState;
  G.status = 'night'; G.nightStep = 2; G.deadline = Date.now() + 30000;
  G.private['0'].role = 'seer'; G.private['0'].faction = 'town'; G.private['0'].checks = [{ day: 1, targetID: '3', isWolf: true }];
  G.private['0'].ownVote = '4'; G.private['0'].voteSubmitted = true;
  return G;
}
const info: RoomInfo = { roomId: 'test-room', matchID: 'test-match', gameName: 'silver-moon', status: 'night', numPlayers: 8, minPlayers: 6, maxPlayers: 12,
  spectatorCount: 1, godViewAllowed: true, players: Array.from({ length: 8 }, (_, id) => ({ id, name: `乘客 ${id}`, isConnected: true, ready: true })) };
const nameOf = (id: string) => `乘客 ${id}`;
const snapshot = (G: MoonState, perspective: 'blind' | 'god') => renderToStaticMarkup(createElement(MoonSnapshot, { G, info, perspective, replay: true }));

describe('Silver Moon read-only and private surfaces', () => {
  it('reprojects a cached god payload before showing blind view', () => {
    const html = snapshot(fixture(), 'blind');
    expect(html).toContain('盲視角不顯示秘密身分');
    expect(html).not.toContain('data-moon-role=');
    expect(html).not.toContain('第 1 夜查驗');
    expect(html).not.toContain('的密票：');
    expect(html).not.toContain('選擇今晚');
  });
  it('shows authorized private information but no actionable night targets in god replay', () => {
    const html = snapshot(fixture(), 'god');
    expect(html).toContain('data-moon-role="seer"');
    expect(html).toContain('第 1 夜查驗 乘客 3');
    expect(html).toContain('此乘客的密票：乘客 4');
    expect(html).toContain('歷史倒數階段');
    expect(html).not.toContain('確認順序，開始發言');
    expect(html).not.toContain('aria-label="巡查票券');
  });
  it('conceals all own role artwork and intelligence when privacy cover is enabled', () => {
    const G = fixture();
    const html = renderToStaticMarkup(createElement(MoonPrivatePanel, { G: moonPlayerView({ G, playerID: '0' }), playerID: '0', nameOf, concealed: true }));
    expect(html).toContain('秘密情報已遮住');
    expect(html).not.toContain('預言家'); expect(html).not.toContain('data-moon-role'); expect(html).not.toContain('查驗');
  });
  it('gives nonacting villagers and dead passengers the same cover activity without move callbacks', () => {
    const G = fixture(); G.private['0'].role = 'villager';
    const first = renderToStaticMarkup(createElement(MoonNightAction, { G, id: '0', nameOf, disabled: false, send: () => { throw new Error('Unexpected send'); }, confirm: () => { throw new Error('Unexpected confirmation'); } }));
    G.players['0'].alive = false; G.private['0'].role = 'wolf';
    const second = renderToStaticMarkup(createElement(MoonNightAction, { G, id: '0', nameOf, disabled: false, send: () => {}, confirm: () => {} }));
    expect(first).toEqual(second); expect(first).toContain('巡查車票'); expect(first.match(/aria-label="巡查票券 /g)).toHaveLength(8);
    expect(first).not.toContain('狼人'); expect(first).not.toContain('alive');
  });
  it('keeps historical timers frozen even when the recorded deadline has long expired', () => {
    const html = renderToStaticMarkup(createElement(MoonCountdown, { deadline: 1, replay: true }));
    expect(html).toContain('歷史倒數階段'); expect(html).not.toContain('等待同步'); expect(html).not.toContain('剩餘 0 秒');
  });
  it('restricts sheriff ballot controls to eligible noncandidates', () => {
    const G = fixture(); G.status = 'sheriff-voting'; G.sheriffCandidates = ['0', '1'];
    const html = renderToStaticMarkup(createElement(MoonSheriffAction, { G, id: '0', nameOf, disabled: false, send: () => {}, confirm: () => {} }));
    expect(html).toContain('不能投票'); expect(html).not.toContain('<button');
  });
  it('does not display future or unrelated role actions inside generic cover task', () => {
    const html = renderToStaticMarkup(createElement(MoonCoverTask));
    expect(html).toContain('不影響技能、投票或勝負'); expect(html).not.toMatch(/女巫|預言家|守衛|狼人|獵人/);
  });
});
