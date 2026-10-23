import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { TuringGame, type TuringState } from '../games/turing/game';
import { TuringBoard, turingEventText } from './TuringBoard';
import { TuringOptions } from './TuringOptions';
import { TuringLiveObservation } from './TuringLiveObservation';
import { TuringPolicySettings } from './TuringPolicySettings';
import { TuringSnapshot } from './TuringSnapshot';
import { RoomContext } from './room-context';
import type { AuthSession, RoomInfo } from './api';

const room: RoomInfo = {
  roomId: 'approval-room', matchID: 'approval-match', gameName: 'turing-test', status: 'lobby',
  numPlayers: 3, minPlayers: 2, maxPlayers: 10, spectatorCount: 2, godViewAllowed: true, hostPlayerID: '0',
  players: ['0', '1', '2'].map(id => ({ id, name: `玩家 ${id}`, isConnected: true, ready: true })),
};
const seat = (info = room, playerID = '0'): AuthSession => ({ ...info, access: 'player', playerID, credentials: 'local-test-credential' });
const observer = (info: RoomInfo, observerID = 'observer-host'): AuthSession => ({ ...info, access: 'spectator', observerID, credentials: 'local-test-credential' });
const withRoom = (info: RoomInfo, session: AuthSession, children: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(RoomContext.Provider, {
  value: { info, seat: session, inviteUrl: '', setInviteUrl: () => {} },
}, children));
function state(count = 3): TuringState {
  const match = createMatch({ game: TuringGame, numPlayers: count, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  return structuredClone(match.initialState.G) as TuringState;
}
function options(info: RoomInfo, session = seat(info)) {
  return renderToStaticMarkup(createElement(TuringOptions, { info, seat: session, disabled: false, onBusy: () => {}, onUpdate: () => {} }));
}
const labels = ['提議重抽題目', '同意這個順序', '檢查完畢下一題'];
const select = (html: string, label: string) => html.match(new RegExp(`<label>${label}(<select[\\s\\S]*?<\\/select>)`))?.[1] ?? '';
const button = (html: string, label: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(match => match[0].includes(label))?.[0] ?? '';
const table = (html: string) => html.match(/<section class="panel turing-table turing-shared-table[\s\S]*?<\/section>/)?.[0] ?? '';
const board = (G: TuringState, info = room, id = '0') => withRoom(info, seat(info, id), createElement(TuringBoard, { G, playerID: id, moves: {}, isConnected: true }));

describe('Turing approval settings and authority surfaces', () => {
  it('defaults all three independent choices to all players and explains immediate saving', () => {
    const html = options(room);
    for (const label of labels) {
      expect(select(html, label)).toContain('<option value="all" selected="">所有人同意</option>');
      expect(select(html, label)).toContain('<option value="host">房主同意</option>');
      expect(select(html, label)).toContain('任何人同意');
      expect(select(html, label)).not.toContain('disabled');
    }
    expect(html).toContain('切換即儲存');
    expect(button(html, '套用測試設定')).toBe('');
    expect(button(html, '套用自訂題目')).toContain('disabled');
  });
  it('shows the saved challenge and sorting modes separately, including observer-host options', () => {
    const info: RoomInfo = { ...room, hostPlayerID: null, hostObserverID: 'observer-host', gameOptions: { mode: 'endless', lives: 7, sortingMode: 'group', deck: 'protocol' } };
    const html = options(info, observer(info));
    expect(select(html, '挑戰模式')).toContain('<option value="endless" selected="">');
    expect(select(html, '排序玩法')).toContain('<option value="group" selected="">群體校準');
    expect(select(html, '題庫模式')).toContain('<option value="protocol" selected="">');
    expect(html).toMatch(/<input[^>]*min="1"[^>]*max="20"[^>]*value="7"/);
    expect(html).toContain('2～10 人'); expect(html).toContain('2～3 人固定使用群體校準');
    for (const label of ['挑戰模式', '排序玩法', '題庫模式']) {
      expect(select(html, label)).not.toContain('disabled');
      expect(select(options(info, seat(info)), label)).toContain('disabled');
    }
  });
  it('renders independent saved choices and prevents an observing host from choosing host approval', () => {
    const info: RoomInfo = { ...room, hostPlayerID: null, hostObserverID: 'observer-host', gameOptions: { redrawApproval: 'any', orderApproval: 'all', nextApproval: 'any' } };
    const editable = options(info, observer(info));
    expect(select(editable, labels[0])).toContain('<option value="any" selected="">任何人同意</option>');
    expect(select(editable, labels[1])).toContain('<option value="all" selected="">所有人同意</option>');
    expect(select(editable, labels[2])).toContain('<option value="any" selected="">任何人同意</option>');
    for (const label of labels) {
      expect(select(editable, label)).toContain('<option value="host" disabled="">房主同意</option>');
      expect(select(editable, label)).not.toMatch(/<select[^>]*disabled/);
    }
    for (const html of [options(info, seat(info)), options(info, observer(info, 'ordinary-observer')), options({ ...info, status: 'sorting' }, observer(info))]) {
      for (const label of labels) expect(select(html, label)).toMatch(/<select[^>]*disabled=""/);
    }
  });
  it('exposes host decisions only to the seated current host, with exactly one host readiness marker', () => {
    const G = state(); G.options.orderApproval = 'host'; G.options.redrawApproval = 'host';
    const info = { ...room, status: 'sorting', hostPlayerID: '1' };
    const host = board(G, info, '1');
    expect(button(host, '房主確認排序')).not.toBe(''); expect(button(host, '房主確認排序')).not.toContain('disabled');
    expect(button(host, '房主重抽題目')).not.toBe('');
    // Live settings are portalled into the room menu, never duplicated on the game board.
    expect(host).not.toContain('turing-policy-details');
    const guest = board(G, info);
    expect(button(guest, '等待房主確認排序')).toContain('disabled=""');
    expect(button(guest, '房主重抽題目')).toBe('');
    expect(table(guest)).toContain('選取玩家 0的強度牌');
    expect(table(guest).match(/>房主尚未準備<\/span>/g)).toHaveLength(1);
    expect(table(guest)).not.toContain('>尚未準備</span>');
    expect(guest).not.toContain('turing-policy-details');
  });
  it('uses immediate labels for any-player sorting and hides readiness badges', () => {
    const G = state(); G.options.orderApproval = 'any'; G.options.redrawApproval = 'any';
    const html = board(G);
    expect(button(html, '確認排序並揭牌')).not.toContain('disabled');
    expect(button(html, '確認排序並揭牌')).not.toBe('');
    expect(button(html, '重抽題目')).not.toBe(''); expect(html).toContain('任一玩家同意');
    expect(table(html)).not.toContain('turing-ready-badge');
  });
  it('shows pending unanimous redraw readiness instead of the otherwise immediate sorting policy', () => {
    const G = state(); G.options.orderApproval = 'any'; G.options.redrawApproval = 'all';
    G.redrawApprovals = ['1']; G.orderApprovals = ['0'];
    const html = board(G);
    expect(table(html).match(/>已準備<\/span>/g)).toHaveLength(1);
    expect(table(html).match(/>尚未準備<\/span>/g)).toHaveLength(2);
    expect(table(html)).toContain('玩家 1的強度牌，已準備');
    expect(table(html)).toContain('玩家 0的強度牌，尚未準備');
    expect(button(html, '先決定是否重抽')).toContain('disabled');
  });
  it.each(['host', 'all', 'any'] as const)('uses the %s next-question policy independently of the sorting policy', policy => {
    const G = state(); G.options.orderApproval = 'any'; G.options.nextApproval = policy;
    G.status = 'round-review'; G.players['1'].acknowledged = true;
    const info = { ...room, hostPlayerID: '1' }, guest = board(G, info), host = board(G, info, '1');
    if (policy === 'host') {
      expect(table(guest).match(/>房主已準備<\/span>/g)).toHaveLength(1);
      expect(table(guest)).not.toContain('>尚未準備</span>');
      expect(button(guest, '等待房主進入下一題')).toContain('disabled');
      expect(button(host, '檢查完畢，下一題')).not.toContain('disabled');
    } else if (policy === 'all') {
      expect(table(guest).match(/>尚未準備<\/span>/g)).toHaveLength(2);
      expect(table(guest).match(/>已準備<\/span>/g)).toHaveLength(1);
      expect(button(host, '已確認，等待同伴')).toContain('disabled');
    } else {
      expect(table(guest)).not.toContain('turing-ready-badge');
      expect(button(host, '檢查完畢，下一題')).not.toContain('disabled');
    }
    expect(button(guest, '房主確認排序')).toBe(''); expect(button(guest, '確認排序並揭牌')).toBe('');
  });
  it('keeps legacy briefing unanimous and hides live policy settings in legacy games', () => {
    const G = state(); G.rulesVersion = 3; G.status = 'briefing'; G.options.nextApproval = 'any';
    expect(table(board(G)).match(/>尚未準備<\/span>/g)).toHaveLength(3);
    expect(button(board(G), '我已了解本輪任務')).not.toBe('');
    expect(board(G)).not.toContain('turing-policy-details');
  });
  it('lets an observing host manage policies and settle an endless score without approving cards or voting', () => {
    const G = state(); G.options.mode = 'endless'; G.targetRounds = null;
    G.options.orderApproval = 'host'; G.options.redrawApproval = 'host'; G.options.nextApproval = 'host';
    const info = { ...room, status: 'sorting', hostPlayerID: null, hostObserverID: 'observer-host' };
    const live = (session: AuthSession) => renderToStaticMarkup(createElement(TuringLiveObservation, { G, info, seat: session, perspective: 'blind', onRefresh: () => {} }));
    const host = live(observer(info));
    expect(button(host, '房主確認排序')).toBe(''); expect(button(host, '房主重抽題目')).toBe('');
    expect(button(host, '檢查完畢，下一題')).toBe('');
    expect(button(host, '以目前成績結束')).not.toBe(''); expect(host).not.toContain('turing-policy-details');
    const menu = renderToStaticMarkup(createElement(TuringPolicySettings, { seat: observer(info), info, policies: G.options, epoch: G.epoch, compact: true }));
    expect(menu).toContain('<details class="turing-policy-details">');
    for (const label of labels) {
      expect(select(menu, label)).toContain('value="host" disabled=""');
      expect(select(menu, label)).not.toMatch(/<select[^>]*disabled=""/);
    }
    expect(table(host)).not.toContain('<button');
    expect(table(host).match(/class="turing-desk-number">\?/g)).toHaveLength(3);
    const ordinary = live(observer(info, 'ordinary-observer'));
    expect(button(ordinary, '以目前成績結束')).toBe(''); expect(ordinary).not.toContain('turing-policy-details');
    for (const replay of [false, true]) {
      const readonly = withRoom(info, observer(info), createElement(TuringSnapshot, { G, info, perspective: 'god', replay }));
      expect(button(readonly, '以目前成績結束')).toBe(''); expect(readonly).not.toContain('turing-policy-details');
      expect(table(readonly)).not.toContain('<button');
    }
  });
  it('labels the examiner readiness too when a four-player host has to confirm the next question', () => {
    const G = state(4); G.status = 'round-review'; G.options.nextApproval = 'host';
    const info = { ...room, numPlayers: 4, hostPlayerID: G.examinerID, players: [...room.players, { id: '3', name: '玩家 3', isConnected: true, ready: true }] };
    const html = board(G, info, G.examinerID);
    expect(html.match(/>房主尚未準備<\/span>/g)).toHaveLength(1);
    expect(button(html, '檢查完畢，下一題')).not.toBe('');
    expect(button(html, '房主確認排序')).toBe('');
  });
  it('reports a voluntarily settled challenge without claiming life was exhausted', () => {
    const G = state(); G.options.mode = 'endless'; G.targetRounds = null; G.status = 'finished'; G.winReason = 'endless-stopped'; G.winner = 'humans'; G.completedRounds = 4; G.round = 5;
    const html = board(G);
    expect(html).toContain('無盡挑戰結束 · 已通過 4 關');
    expect(html).toContain('房主已結算目前成績'); expect(html).not.toContain('在第 5 關耗盡生命');
    expect(button(html, '以目前成績結束')).toBe('');
    expect(turingEventText({ type: 'finish', round: 5, reason: 'endless-stopped', completedRounds: 4 }, id => id)).toContain('已通過 4 關');
    expect(turingEventText({ type: 'approval-change', round: 1, policies: { nextApproval: 'any' } }, id => id)).toContain('檢查完畢下一題改為任一玩家同意');
  });
});
