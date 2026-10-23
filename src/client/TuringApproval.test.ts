import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { TuringGame, type TuringState } from '../games/turing/game';
import { TuringBoard } from './TuringBoard';
import { TuringOptions } from './TuringOptions';
import { TuringLiveObservation } from './TuringLiveObservation';
import { TuringSnapshot } from './TuringSnapshot';
import { RoomContext } from './room-context';
import type { AuthSession, RoomInfo } from './api';

const room: RoomInfo = {
  roomId: 'approval-room', matchID: 'approval-match', gameName: 'turing-test', status: 'lobby',
  numPlayers: 3, minPlayers: 2, maxPlayers: 9, spectatorCount: 2, godViewAllowed: true, hostPlayerID: '0',
  players: ['0', '1', '2'].map(id => ({ id, name: `玩家 ${id}`, isConnected: true, ready: true })),
};
const seat = (info = room, playerID = '0'): AuthSession => ({ ...info, access: 'player', playerID, credentials: 'local-test-credential' });
const observer = (info: RoomInfo, observerID = 'observer-host'): AuthSession => ({ ...info, access: 'spectator', observerID, credentials: 'local-test-credential' });
const withRoom = (info: RoomInfo, session: AuthSession, children: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(RoomContext.Provider, {
  value: { info, seat: session, inviteUrl: '', setInviteUrl: () => {} },
}, children));
function state(): TuringState {
  const match = createMatch({ game: TuringGame, numPlayers: 3, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  return structuredClone(match.initialState.G) as TuringState;
}
function options(info: RoomInfo, session = seat(info)) {
  return renderToStaticMarkup(createElement(TuringOptions, { info, seat: session, disabled: false, onBusy: () => {}, onUpdate: () => {} }));
}
const select = (html: string, label: string) => html.match(new RegExp(`<label>${label}(<select[\\s\\S]*?<\\/select>)`))?.[1] ?? '';
const button = (html: string, label: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(match => match[0].includes(label))?.[0] ?? '';
const table = (html: string) => html.match(/<section class="panel turing-table turing-shared-table[\s\S]*?<\/section>/)?.[0] ?? '';

describe('Turing approval settings and authority surfaces', () => {
  it('defaults both independent lobby choices to all players for older room settings', () => {
    const html = options(room);
    for (const label of ['重抽題目', '確認排序']) {
      const field = select(html, label);
      expect(field).toContain('<option value="all" selected="">所有人同意</option>');
      expect(field).toContain('房主同意'); expect(field).toContain('任何人同意');
      expect(field).not.toContain('disabled');
    }
  });
  it('lets an observing host edit independent policies only before play, while other members can only read them', () => {
    const info: RoomInfo = { ...room, hostPlayerID: null, hostObserverID: 'observer-host', gameOptions: { redrawApproval: 'host', orderApproval: 'any' } };
    const editable = options(info, observer(info));
    expect(select(editable, '重抽題目')).toContain('<option value="host" selected="">房主同意</option>');
    expect(select(editable, '確認排序')).toContain('<option value="any" selected="">任何人同意</option>');
    expect(select(editable, '確認排序')).not.toContain('disabled');
    for (const html of [options(info, seat(info)), options(info, observer(info, 'ordinary-observer')), options({ ...info, status: 'sorting' }, observer(info))]) {
      for (const label of ['重抽題目', '確認排序']) expect(select(html, label)).toContain('disabled=""');
    }
  });
  it('exposes host decisions only to the current seated host and keeps shared card arrangement available to other players', () => {
    const G = state(); G.options.orderApproval = 'host'; G.options.redrawApproval = 'host';
    const info = { ...room, status: 'sorting', hostPlayerID: '1' };
    const host = withRoom(info, seat(info, '1'), createElement(TuringBoard, { G, playerID: '1', moves: {}, isConnected: true }));
    expect(button(host, '房主確認排序')).not.toBe(''); expect(button(host, '房主確認排序')).not.toContain('disabled');
    expect(button(host, '房主重抽題目')).not.toBe('');
    const guest = withRoom(info, seat(info), createElement(TuringBoard, { G, playerID: '0', moves: {}, isConnected: true }));
    expect(button(guest, '等待房主確認排序')).toContain('disabled=""');
    expect(button(guest, '房主重抽題目')).toBe('');
    expect(table(guest)).toContain('選取玩家 0的強度牌');
    expect(table(guest).match(/待房主確認<\/span>/g)).toHaveLength(1);
    expect(table(guest)).not.toContain('尚未準備');
  });
  it('labels any-player decisions as immediate and does not imply that everyone must prepare', () => {
    const G = state(); G.options.orderApproval = 'any'; G.options.redrawApproval = 'any';
    const html = withRoom(room, seat(), createElement(TuringBoard, { G, playerID: '0', moves: {}, isConnected: true }));
    expect(button(html, '確認排序並揭牌')).not.toBe(''); expect(button(html, '確認排序並揭牌')).not.toContain('disabled');
    expect(button(html, '重抽題目')).not.toBe(''); expect(html).toContain('任一玩家同意');
    expect(table(html)).not.toContain('turing-ready-badge');
  });
  it('adds only host decisions to live observation without exposing blind secrets or enabling card moves', () => {
    const G = state(); G.options.orderApproval = 'host'; G.options.redrawApproval = 'host';
    const info = { ...room, status: 'sorting', hostPlayerID: null, hostObserverID: 'observer-host' };
    const live = (session: AuthSession) => renderToStaticMarkup(createElement(TuringLiveObservation, { G, info, seat: session, perspective: 'blind', onRefresh: () => {} }));
    const host = live(observer(info));
    expect(button(host, '房主確認排序')).not.toBe(''); expect(button(host, '房主重抽題目')).not.toBe('');
    expect(table(host)).not.toContain('<button');
    expect(table(host).match(/class="turing-desk-number">\?/g)).toHaveLength(3);
    const ordinary = live(observer(info, 'ordinary-observer'));
    expect(button(ordinary, '房主確認排序')).toBe(''); expect(button(ordinary, '房主重抽題目')).toBe('');
    for (const replay of [false, true]) {
      const readonly = withRoom(info, observer(info), createElement(TuringSnapshot, { G, info, perspective: 'god', replay }));
      expect(button(readonly, '房主確認排序')).toBe(''); expect(button(readonly, '房主重抽題目')).toBe('');
      expect(table(readonly)).not.toContain('<button');
    }
  });
  it.each(['host', 'any'] as const)('keeps all-player round-result readiness under the %s decision policy', policy => {
    const G = state(); G.options.orderApproval = policy; G.options.redrawApproval = policy;
    G.status = 'round-review'; G.players['1'].acknowledged = true;
    const html = withRoom(room, seat(), createElement(TuringBoard, { G, playerID: '0', moves: {}, isConnected: true }));
    expect(table(html).match(/>尚未準備<\/span>/g)).toHaveLength(2);
    expect(table(html).match(/>已準備<\/span>/g)).toHaveLength(1);
    expect(button(html, '已看過結果，開始下一輪')).not.toBe('');
    expect(button(html, '房主確認排序')).toBe(''); expect(button(html, '確認排序並揭牌')).toBe('');
  });
});
