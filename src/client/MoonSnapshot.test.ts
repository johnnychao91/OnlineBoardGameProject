import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { MoonGame, moonPlayerView, type MoonState } from '../games/moon/game';
import { MoonCoverTask, MoonNightAction, MoonPrivatePanel, MoonPublicPhase, MoonCountdown, MoonSheriffAction, MoonStatus, MoonWolfChoices } from './MoonBoard';
import { MoonSnapshot } from './MoonSnapshot';
import type { RoomInfo } from './api';

function fixture(count = 8): MoonState {
  const match = createMatch({ game: MoonGame, numPlayers: count, setupData: { startImmediately: true }, unlisted: true });
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
const snapshot = (G: MoonState, perspective: 'blind' | 'god', replay = true) => renderToStaticMarkup(createElement(MoonSnapshot, {
  G, info: { ...info, numPlayers: Object.keys(G.players).length,
    players: Object.keys(G.players).map(id => ({ id, name: nameOf(id), isConnected: true, ready: true })) }, perspective, replay,
}));

describe('Silver Moon read-only and private surfaces', () => {
  it('shows the same public profession phase without inspecting secret deadlines', () => {
    const G = fixture();
    for (const [step, label] of ['守衛', '狼人', '預言家', '女巫'].entries()) {
      G.nightStep = step;
      const before = renderToStaticMarkup(createElement(MoonStatus, { G, nameOf, replay: true }));
      G.secret = { ...G.secret!, nightAdvance: { epoch: G.epoch, deadline: 3 } } as MoonState['secret'];
      const after = renderToStaticMarkup(createElement(MoonStatus, { G, nameOf, replay: true }));
      expect(after).toContain(`${label}時段 ${step + 1} / 4`);
      expect(after).toEqual(before);
    }
  });
  it.each([6, 7, 9])('uses three public stages for a new %i-player game in player, observer and replay views', count => {
    const G = fixture(count);
    expect(G.rulesVersion).toBe(3);
    for (const [index, label] of ['狼人', '預言家', '女巫'].entries()) {
      G.nightStep = index + 1;
      const ownView = moonPlayerView({ G, playerID: '0' });
      const player = renderToStaticMarkup(createElement(MoonStatus, { G: ownView, nameOf, ownID: '0' }));
      expect(player).toContain(`${label}時段 ${index + 1} / 3`);
      expect(player).not.toContain('守衛時段');
      for (const perspective of ['blind', 'god'] as const) for (const replay of [false, true]) {
        const html = snapshot(G, perspective, replay);
        expect(html).toContain(`${label}時段 ${index + 1} / 3`);
        expect(html).toContain(`${label}時段（${index + 1} / 3）`);
        expect(html).not.toContain('守衛時段');
      }
    }
  });
  it('preserves four-stage numbering for old six-player games and their replay', () => {
    const G = fixture(6); G.rulesVersion = 1;
    for (const [step, label] of ['守衛', '狼人', '預言家', '女巫'].entries()) {
      G.nightStep = step;
      const player = renderToStaticMarkup(createElement(MoonStatus, { G: moonPlayerView({ G, playerID: '0' }), nameOf }));
      expect(player).toContain(`${label}時段 ${step + 1} / 4`);
      for (const perspective of ['blind', 'god'] as const) {
        const html = snapshot(G, perspective);
        expect(html).toContain(`${label}時段 ${step + 1} / 4`);
        expect(html).toContain(`${label}時段（${step + 1} / 4）`);
      }
    }
  });
  it('derives public stage progress from the starting player count without reading identities or alive flags', () => {
    const G = fixture(); G.nightStep = 0;
    for (const player of Object.values(G.players)) Object.defineProperty(player, 'alive', { get: () => { throw new Error('Alive status read'); } });
    for (const field of ['private', 'secret']) Object.defineProperty(G, field, { get: () => { throw new Error(`Private source read: ${field}`); } });
    const status = renderToStaticMarkup(createElement(MoonStatus, { G, nameOf, replay: true }));
    const publicPhase = renderToStaticMarkup(createElement(MoonPublicPhase, { G, nameOf }));
    expect(status).toContain('守衛時段 1 / 4');
    expect(publicPhase).toContain('守衛時段（1 / 4）');
  });
  it('lists every living known wolf and distinguishes missing, skipped, and target choices', () => {
    const G = fixture(); G.nightStep = 1;
    Object.assign(G.private['0'], { role: 'wolf', faction: 'wolves', knownWolves: ['2', '4', '6'], wolfVotes: { '0': '3', '2': null }, nightSubmitted: true });
    G.players['6'].alive = false;
    const show = () => renderToStaticMarkup(createElement(MoonWolfChoices, { G, id: '0', nameOf }));
    const html = show();
    expect(html).toContain('乘客 0'); expect(html).toContain('（你）'); expect(html).toContain('乘客 3');
    expect(html).toContain('放棄襲擊'); expect(html).toContain('尚未選擇'); expect(html).not.toContain('乘客 6');
    G.private['0'].wolfVotes['2'] = '5';
    const updated = show();
    expect(updated).toContain('乘客 5'); expect(updated).not.toContain('放棄襲擊');
    const coveredAction = renderToStaticMarkup(createElement(MoonNightAction, { G, id: '0', nameOf, disabled: false, send: () => {}, confirm: () => {} }));
    expect(coveredAction).toContain('狼群目前選擇'); expect(coveredAction).toContain('巡查車票');
    const god = snapshot(G, 'god');
    expect(god).toContain('狼群目前選擇'); expect(god).toContain('（目前查看）');
    expect(snapshot(G, 'blind')).not.toContain('狼群目前選擇');
    expect(renderToStaticMarkup(createElement(MoonPrivatePanel, { G, playerID: '0', nameOf, observer: true, concealed: true }))).not.toContain('狼群目前選擇');
    G.private['0'].role = 'seer';
    expect(show()).toBe('');
  });
  it('reprojects a cached god payload before showing blind view', () => {
    const html = snapshot(fixture(), 'blind');
    expect(html).toContain('盲視角不顯示秘密身分');
    expect(html).not.toContain('data-moon-role=');
    expect(html).not.toContain('第 1 夜查驗');
    expect(html).not.toContain('的密票：');
    expect(html).not.toContain('選擇今晚');
    expect(html).not.toMatch(/known-wolves|known-town|moon-known-faction/);
  });
  it('shows authorized private information but no actionable night targets in god replay', () => {
    const html = snapshot(fixture(), 'god');
    expect(html).toContain('data-moon-role="seer"');
    expect(html).toContain('第 1 夜查驗 乘客 3');
    expect(html).toContain('此乘客的密票：乘客 4');
    expect(html).toContain('歷史倒數階段');
    expect(html).not.toContain('確認順序，開始發言');
    expect(html).not.toContain('aria-label="巡查票券');
    expect(html).toContain('known-town'); expect(html).toContain('moon-known-faction');
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
