import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { MoonGame, moonPlayerView, type MoonState } from '../games/moon/game';
import { MOON_PRESETS, moonNightSteps, normalizeMoonOptions } from '../games/moon/rules';
import { MoonExplosionAction, MoonNightAction, MoonPublicPhase, MoonStatus, MoonPrivatePanel, moonForcedShot } from './MoonBoard';
import { MoonSnapshot } from './MoonSnapshot';
import { MoonOptions } from './MoonOptions';
import { buildMoonPosterModel } from './moon-poster';
import { factionRecord } from './Statistics';
import { clientGames } from './game-registry';
import type { RoomInfo } from './api';

const nameOf = (id: string) => `乘客 ${id}`;
function fixture(presetId: string) {
  const preset = MOON_PRESETS.find(item => item.id === presetId)!;
  const count = preset.count ?? 8;
  const match = createMatch({ game: MoonGame, numPlayers: count, setupData: { startImmediately: true, options: normalizeMoonOptions({ presetId }) }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  return structuredClone(match.initialState.G) as MoonState;
}
function room(G: MoonState): RoomInfo {
  return { roomId: 'test', matchID: 'match', gameName: 'silver-moon', status: 'lobby', numPlayers: Object.keys(G.players).length,
    minPlayers: 6, maxPlayers: 12, spectatorCount: 0, godViewAllowed: true, gameOptions: { ...G.options },
    players: Object.keys(G.players).map(id => ({ id, name: nameOf(id), isConnected: true, ready: false })) };
}
const night = (G: MoonState, id: string) => renderToStaticMarkup(createElement(MoonNightAction, { G, id, nameOf, disabled: false, send: () => {}, confirm: () => {} }));

describe('Silver Moon preset presentation', () => {
  it.each(MOON_PRESETS.filter(preset => preset.count !== null))('renders $name with its own public composition and night stages in both read-only perspectives', preset => {
    const G = fixture(preset.id);
    G.status = 'night';
    const steps = moonNightSteps(preset.count!, 3, G.configuration);
    G.nightStep = steps[0];
    for (const perspective of ['blind', 'god'] as const) {
      const html = renderToStaticMarkup(createElement(MoonSnapshot, { G, info: room(G), perspective, replay: true }));
      expect(html).toContain(`1 / ${steps.length}`);
      expect(html).toContain(preset.name);
      expect(html).not.toContain('確認自爆');
      if (perspective === 'blind') expect(html).not.toContain('data-moon-role=');
    }
  });
  it('previews an eight-player preset before everyone joins and prevents mismatched starts', () => {
    const G = fixture('eight-ragnarok'), info = room(G);
    info.players = info.players.slice(0, 2);
    const html = renderToStaticMarkup(createElement(MoonOptions, { seat: { ...info, playerID: '0', credentials: 'test' }, info, disabled: false, onBusy: () => {}, onUpdate: () => {} }));
    expect(html).toContain('此配置需要 8 位參與玩家，目前 2 位');
    expect(html).toContain('惡靈騎士 1'); expect(html).toContain('此配置固定無警長');
    expect(clientGames['silver-moon'].validateLobby?.(info.gameOptions, 7)).toBeTruthy();
    expect(clientGames['silver-moon'].validateLobby?.(info.gameOptions, 8)).toBeUndefined();
  });
  it('uses authorized legal targets for special wolves and removes attack actions during first-night peace', () => {
    const G = fixture('six-ghost-rider');
    const id = Object.keys(G.private).find(id => G.private[id].role === 'ghost-rider')!;
    G.status = 'night'; G.nightStep = 1;
    expect(night(moonPlayerView({ G, playerID: id }), id)).toContain('首夜無刀');
    expect(night(moonPlayerView({ G, playerID: id }), id)).not.toContain('與狼群選擇');
    G.day = 2;
    const html = night(moonPlayerView({ G, playerID: id }), id);
    expect(html).toContain('與狼群選擇今晚的目標'); expect(html).toContain('狼群目前選擇');
    expect(html).not.toContain(`class="moon-seat">${Number(id) + 1}</span><span>${nameOf(id)}</span>`);
  });
  it('only offers explosions to authorized living wolves in the allowed public phase', () => {
    const G = fixture('eight-ragnarok'); G.status = 'speaking';
    const show = (id: string) => renderToStaticMarkup(createElement(MoonExplosionAction, { G: moonPlayerView({ G, playerID: id }), id, nameOf, disabled: false, confirm: () => {} }));
    const white = Object.keys(G.private).find(id => G.private[id].role === 'white-wolf-king')!;
    const ghost = Object.keys(G.private).find(id => G.private[id].role === 'ghost-rider')!;
    expect(show(white)).toContain('白狼王 · 自爆帶走一人'); expect(show(ghost)).toBe('');
    G.status = 'voting'; expect(show(white)).toBe('');
    G.status = 'speaking'; G.players[white].alive = false; expect(show(white)).toBe('');
  });
  it('clearly reports an idiot reveal and a self-explosion followed by a chained shot', () => {
    const G = fixture('seven-king-idiot'); G.status = 'vote-review';
    G.players['0'].voteDisabled = true;
    G.lastVote = { day: 1, round: 1, votes: { '1': '0' }, tied: [], exiledID: null, weights: { '1': 2 } };
    G.log.push({ type: 'vote', day: 1, targetID: '0' }, { type: 'idiot', day: 1, actorID: '0' });
    expect(renderToStaticMarkup(createElement(MoonPublicPhase, { G, nameOf }))).toContain('乘客 0 翻牌留場，失去投票權');
    G.lastVote = null;
    G.log.push({ type: 'explosion', day: 1, actorID: '1', targetID: '2' }, { type: 'hunter', day: 1, actorID: '2', targetID: '3', role: 'hunter' });
    const html = renderToStaticMarkup(createElement(MoonPublicPhase, { G, nameOf }));
    expect(html).toContain('乘客 1 自爆離場'); expect(html).toContain('同時帶走：乘客 2'); expect(html).toContain('獵人帶走 乘客 3'); expect(html).toContain('確認後進入下一晚');
  });
  it('shows forced-shooting timeout rules and private reflection only to its authorized viewer', () => {
    const G = fixture('six-hunters'); G.status = 'hunter'; G.hunterID = '0'; G.players['0'].revealedRole = 'hunter';
    expect(moonForcedShot(G)).toBe(true);
    expect(renderToStaticMarkup(createElement(MoonStatus, { G, nameOf }))).toContain('逾時由系統隨機選擇合法目標');
    const ghost = fixture('eight-ragnarok');
    const id = Object.keys(ghost.private).find(id => ghost.private[id].role === 'ghost-rider')!;
    const show = (concealed: boolean) => renderToStaticMarkup(createElement(MoonPrivatePanel, { G: moonPlayerView({ G: ghost, playerID: id }), playerID: id, nameOf, concealed }));
    expect(show(false)).toContain('data-moon-role="ghost-rider"'); expect(show(false)).toContain('尚可發動一次');
    expect(show(true)).not.toContain('data-moon-role'); expect(show(true)).not.toContain('反傷');
  });
  it('reports draws without awarding a win or loss, including old statistics without a draws field', () => {
    expect(factionRecord({ completed: 5, draws: 2, wins: { town: 2, wolves: 1 } }, 'town')).toEqual({ wins: 2, losses: 1, draws: 2, rate: 67 });
    expect(factionRecord({ completed: 2, draws: 2, wins: {} }, 'wolves')).toEqual({ wins: 0, losses: 0, draws: 2, rate: 0 });
    expect(factionRecord({ completed: 4, wins: { town: 3 } }, 'town').losses).toBe(1);
    const G = fixture('six-wolf-king'); G.status = 'finished'; G.winner = 'draw'; G.winReason = 'mutual-elimination';
    expect(renderToStaticMarkup(createElement(MoonStatus, { G, nameOf }))).toContain('平局 · 雙方全數離場');
    expect(buildMoonPosterModel({ G, players: [], step: 1, totalSteps: 1 }).outcome).toBe('draw');
  });
});
