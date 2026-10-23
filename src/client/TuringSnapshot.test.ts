import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { TuringGame, type TuringState } from '../games/turing/game';
import { TuringBoard, TuringLayout } from './TuringBoard';
import { TuringSnapshot } from './TuringSnapshot';
import { RoomContext } from './room-context';
import type { RoomInfo } from './api';

const info: RoomInfo = {
  roomId: 'test-room', matchID: 'test-match', gameName: 'turing-test', status: 'answering',
  numPlayers: 4, minPlayers: 2, maxPlayers: 9, spectatorCount: 1, godViewAllowed: true,
  players: Array.from({ length: 4 }, (_, id) => ({ id, name: `受測者 ${id}`, isConnected: true, ready: true })),
};
const nameOf = (id: string) => `受測者 ${id}`;
const sealed = '只有零號本人與上帝視角可見的封存回答';
function fixture(): TuringState {
  const created = createMatch({ game: TuringGame, numPlayers: 4, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in created) throw new Error(created.setupDataError);
  const G = structuredClone(created.initialState.G) as TuringState;
  G.rulesVersion = 1;
  delete G.cards; delete G.completedRounds; delete G.secretDrawIDs; delete G.tableOrder; delete G.orderApprovals;
  G.status = 'answering'; G.examinerID = '3';
  G.private = { '0': { number: 7, answer: sealed }, '1': { number: 2, answer: '其他人的私密回答' }, '2': { number: 9 } };
  G.players['0'].answered = true; G.players['1'].answered = true;
  return G;
}
const snapshot = (G: TuringState, perspective: 'blind' | 'god', room = info) => renderToStaticMarkup(createElement(TuringSnapshot, { G, info: room, perspective, replay: true }));
const voiceInfo: RoomInfo = { ...info, numPlayers: 3, players: info.players.slice(0, 3) };
function voiceFixture(): TuringState {
  const created = createMatch({ game: TuringGame, numPlayers: 3, setupData: { startImmediately: true, options: { deck: 'standard', customQuestions: [], mode: 'endless', lives: 5 } }, unlisted: true });
  if ('setupDataError' in created) throw new Error(created.setupDataError);
  const G = structuredClone(created.initialState.G) as TuringState;
  G.rulesVersion = 2; delete G.tableOrder; delete G.orderApprovals;
  G.status = 'answering'; G.examinerID = '1'; G.round = 7; G.completedRounds = 6;
  G.private = { '0': { number: 2, cards: [{ id: '0-a', number: 2 }, { id: '0-b', number: 8 }] },
    '2': { number: 4, cards: [{ id: '2-a', number: 4 }, { id: '2-b', number: 9 }] } };
  G.cards = { '0-a': { playerID: '0', slot: 'A', spoken: true }, '0-b': { playerID: '0', slot: 'B', spoken: false },
    '2-a': { playerID: '2', slot: 'A', spoken: false }, '2-b': { playerID: '2', slot: 'B', spoken: false } };
  return G;
}

function sharedFixture(count: 2 | 3): TuringState {
  const created = createMatch({ game: TuringGame, numPlayers: count, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in created) throw new Error(created.setupDataError);
  const G = structuredClone(created.initialState.G) as TuringState;
  G.status = 'sorting';
  G.cards = Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index), { playerID: String(index), slot: 'A' as const, spoken: true }]));
  G.private = Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index), { number: [2, 8, 5][index], cards: [{ id: String(index), number: [2, 8, 5][index] }] }]));
  G.tableOrder = ['1', '0']; G.orderApprovals = ['0'];
  return G;
}
const sharedInfo = (count: number): RoomInfo => ({ ...info, numPlayers: count, players: info.players.slice(0, count) });
const sharedSurface = (html: string) => html.match(/<section class="panel turing-table turing-shared-table[\s\S]*?<\/section>/)?.[0] ?? '';
const liveBoard = (G: TuringState) => renderToStaticMarkup(createElement(RoomContext.Provider, {
  value: { info: sharedInfo(3), seat: { ...sharedInfo(3), access: 'player', playerID: '0', credentials: 'local-test-credential' }, inviteUrl: '', setInviteUrl: () => {} },
}, createElement(TuringBoard, { G, playerID: '0', moves: {}, isConnected: true })));

describe('Turing read-only and private surfaces', () => {
  it('reprojects a cached god payload before rendering a blind snapshot', () => {
    const G = fixture(), before = structuredClone(G);
    const html = snapshot(G, 'blind');
    expect(html).toContain('目前視角不可查看');
    expect(html).not.toContain(sealed);
    expect(html).not.toContain('其他人的私密回答');
    expect(html).not.toContain('<strong>7</strong>');
    expect(html).not.toContain('<strong>2</strong>');
    expect(html).not.toContain('<strong>9</strong>');
    expect(G).toEqual(before);
  });
  it('shows the inspected god-view seat’s number and sealed answer, without rendering the other sealed answers', () => {
    const html = snapshot(fixture(), 'god');
    expect(html).toContain('<strong>7</strong>');
    expect(html).toContain(sealed);
    expect(html).toContain('已封存的回答');
    expect(html).not.toContain('其他人的私密回答');
  });
  it.each(['briefing', 'answering', 'sorting', 'round-review'] as const)('offers no live game controls in a %s snapshot', status => {
    const G = fixture(); G.status = status;
    const html = snapshot(G, 'god');
    expect(html).toContain('唯讀復盤');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('送出回答</button>');
    expect(html).not.toContain('揭曉這張強度</button>');
    expect(html).not.toContain('我已了解本輪任務');
    expect(html).not.toContain('已看過結果，開始下一輪');
  });
  it.each(['blind', 'god'] as const)('shows unfinished cards at the end in %s view without inventing a reveal order', perspective => {
    const G = fixture();
    G.status = 'finished'; G.winner = 'system'; G.winReason = 'integrity-lost'; G.integrity = 0;
    G.answers = { '0': '第一個公開回答', '1': '第二個公開回答', '2': '第三個公開回答' };
    G.revealed = [{ playerID: '0', number: 7, error: false }, { playerID: '1', number: 2, error: true }];
    const originalOrder = structuredClone(G.revealed);
    const html = snapshot(G, perspective);
    expect(html.match(/終局公開 · 未參與排序/g)).toHaveLength(1);
    expect(html).toContain('<b>9</b>');
    const strip = html.match(/<div class="turing-reveal-strip">([\s\S]*?)<\/div>/)?.[1];
    expect(strip).toContain('7'); expect(strip).toContain('2'); expect(strip).not.toContain('9');
    expect(G.revealed).toEqual(originalOrder);
  });
  it('hides the number and pending answer when the shared private panel is collapsed', () => {
    const G = fixture();
    const html = renderToStaticMarkup(createElement(TuringLayout, {
      G, info, nameOf, ownID: '0', visible: false, onVisible: () => {}, readonly: true, replay: true,
    }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(sealed);
    expect(html).not.toContain('turing-chip');
    expect(html).not.toContain('<strong>7</strong>');
  });
  it('renders custom prompt and answer markup as text', () => {
    const G = fixture(); G.status = 'sorting';
    G.question!.prompt = '<script>alert("prompt")</script>';
    G.answers['0'] = '<img src=x onerror=alert(1)>';
    const html = snapshot(G, 'blind');
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x');
  });
  it('renders only the inspected voice player’s A/B secrets and reprojects cached god frames to blind', () => {
    const G = voiceFixture(), before = structuredClone(G);
    const god = snapshot(G, 'god', voiceInfo), blind = snapshot(G, 'blind', voiceInfo);
    expect(god).toContain('<span>A 卡</span>'); expect(god).toContain('<span>B 卡</span>');
    expect(god).toContain('<strong>2</strong>'); expect(god).toContain('<strong>8</strong>');
    expect(god).not.toContain('<strong>4</strong>'); expect(god).not.toContain('<strong>9</strong>');
    expect(blind.match(/目前視角不可查看/g)).toHaveLength(2);
    expect(blind).not.toContain('<strong>2</strong>'); expect(blind).not.toContain('<strong>8</strong>');
    expect(blind).toContain('已口頭回答');
    for (const html of [god, blind]) {
      expect(html.match(/data-card-id=/g)).toHaveLength(4);
      expect(html).toContain('不含語音或逐字稿');
      expect(html).not.toContain('<textarea'); expect(html).not.toContain('我已口頭回答</button>');
    }
    expect(G).toEqual(before);
  });
  it('collapses both voice strength cards while retaining public completion states', () => {
    const html = renderToStaticMarkup(createElement(TuringLayout, {
      G: voiceFixture(), info: voiceInfo, nameOf, ownID: '0', visible: false, onVisible: () => {}, readonly: true, replay: true,
    }));
    expect(html).toContain('aria-expanded="false"'); expect(html).toContain('已口頭回答');
    expect(html).not.toContain('turing-chip'); expect(html).not.toContain('<strong>2</strong>'); expect(html).not.toContain('<strong>8</strong>');
  });
  it('shows the completed endless score and remaining dual card without inventing a reveal', () => {
    const G = voiceFixture(); G.status = 'finished'; G.winner = 'system'; G.winReason = 'endless-exhausted'; G.integrity = 0;
    G.revealed = [{ playerID: '0', cardID: '0-b', slot: 'B', number: 8, error: false },
      { playerID: '2', cardID: '2-a', slot: 'A', number: 4, error: true },
      { playerID: '0', cardID: '0-a', slot: 'A', number: 2, error: true }];
    const html = snapshot(G, 'blind', voiceInfo);
    expect(html).toContain('無盡挑戰結束 · 已通過 6 關'); expect(html).toContain('在第 7 關耗盡生命');
    expect(html.match(/終局公開 · 未參與排序/g)).toHaveLength(1); expect(html).toContain('<b>9</b>');
    const strip = html.match(/<div class="turing-reveal-strip">([\s\S]*?)<\/div>/)?.[1];
    expect(strip).toContain('受測者 0 · B 卡'); expect(strip).not.toContain('受測者 2 · B 卡');
  });
  it.each([2, 3] as const)('renders %i shared-table cards with cached god-to-blind reprojection and no spectator moves', count => {
    const G = sharedFixture(count), before = structuredClone(G);
    expect(G.rulesVersion).toBe(4); expect(G.examinerID).toBe('');
    const god = sharedSurface(snapshot(G, 'god', sharedInfo(count)));
    const blind = sharedSurface(snapshot(G, 'blind', sharedInfo(count)));
    expect(god).toContain('共同排序桌面'); expect(god).not.toContain('檢測員');
    for (const number of [2, 8, 5].slice(0, count)) {
      expect(god).toContain(`<strong class="turing-desk-number">${number}</strong>`);
      expect(blind).not.toContain(`<strong class="turing-desk-number">${number}</strong>`);
    }
    expect(blind.match(/class="turing-desk-number">\?/g)).toHaveLength(count);
    for (const html of [god, blind]) {
      expect(html.match(/data-card-id=/g)).toHaveLength(count);
      expect(html.match(/data-turing-slot=/g)).toHaveLength(count);
      expect(html).not.toContain('<button'); expect(html).not.toContain('draggable=');
      expect(html).not.toContain('A 卡'); expect(html).not.toContain('B 卡');
      expect(html).toMatch(/data-turing-slot="0"[\s\S]*?data-card-id="1"/);
      expect(html).toMatch(/data-turing-slot="1"[\s\S]*?data-card-id="0"/);
    }
    expect(G).toEqual(before);
  });
  it('only displays the live seat’s shared-table secret even if passed an unprojected state', () => {
    const G = sharedFixture(3);
    G.orderApprovals = [];
    const html = renderToStaticMarkup(createElement(TuringLayout, { G, info: sharedInfo(3), nameOf, ownID: '0', visible: true, onVisible: () => {} }));
    const table = sharedSurface(html);
    expect(table).toContain('<strong class="turing-desk-number">2</strong>');
    expect(table).not.toContain('<strong class="turing-desk-number">8</strong>');
    expect(table).not.toContain('<strong class="turing-desk-number">5</strong>');
    expect(table.match(/class="turing-desk-number">\?/g)).toHaveLength(2);
    expect(table).toContain('同意這個順序');
    expect(table).toContain('disabled=""');
  });
  it('collapses shared-table secrets while retaining an already revealed public card', () => {
    const G = sharedFixture(3);
    G.revealed = [{ playerID: '1', cardID: '1', number: 8, slot: 'A', error: false }];
    const html = renderToStaticMarkup(createElement(TuringLayout, { G, info: sharedInfo(3), nameOf, ownID: '0', visible: false, onVisible: () => {}, readonly: true, replay: true }));
    const table = sharedSurface(html);
    expect(table).toContain('<strong class="turing-desk-number">8</strong>');
    expect(table).not.toContain('<strong class="turing-desk-number">2</strong>');
    expect(table).not.toContain('<strong class="turing-desk-number">5</strong>');
    expect(html).not.toContain('turing-private-cards');
    expect(table).toContain('強度已公開');
  });
  it('shows consent status and public final order without adding interactive controls to shared replay', () => {
    const G = sharedFixture(3); G.tableOrder = ['0', '2', '1'];
    let table = sharedSurface(snapshot(G, 'blind', sharedInfo(3)));
    expect(table).toContain('尚未同意：受測者 1、受測者 2');
    expect(table).not.toContain('<button');
    G.status = 'round-review'; G.orderApprovals = ['0', '1', '2'];
    G.revealed = G.tableOrder.map(playerID => ({ playerID, cardID: playerID, slot: 'A', number: G.private[playerID].number, error: false }));
    table = sharedSurface(snapshot(G, 'blind', sharedInfo(3)));
    expect(table).toContain('<strong class="turing-desk-number">2</strong>');
    expect(table).toContain('<strong class="turing-desk-number">5</strong>');
    expect(table).toContain('<strong class="turing-desk-number">8</strong>');
    expect(table).not.toContain('尚未同意'); expect(table).not.toContain('<button');
  });
  it('starts new live games with movable cards and question tools while removing redundant answer confirmations from cards', () => {
    const G = sharedFixture(3); G.orderApprovals = []; G.redrawApprovals = [];
    const html = liveBoard(G);
    expect(html).toContain('提議重抽題目'); expect(html).toContain('turing-question-feedback');
    expect(html).toContain('選取受測者 0的強度牌'); expect(html).toContain('同意這個順序');
    const table = sharedSurface(html);
    expect(table).not.toContain('turing-slot-label'); expect(table).not.toContain('turing-place-button');
    expect(table).not.toContain('待排'); expect(table).not.toContain('秘密強度');
    expect(html).not.toContain('我已了解本輪任務'); expect(html).not.toContain('我已口頭回答');
    expect(html).not.toContain('只代表這次回答的程度'); expect(html).not.toContain('turing-desk-spoken');
    expect(html).not.toContain('turing-empty-slot'); expect(html).not.toContain('turing-chip-state');
    const readonly = snapshot(G, 'blind', sharedInfo(3));
    expect(readonly).not.toContain('提議重抽題目'); expect(readonly).not.toContain('turing-question-feedback');
  });
  it('keeps every old partially arranged card on the live table and allows immediate order approval', () => {
    const G = sharedFixture(3); G.tableOrder = ['2']; G.orderApprovals = [];
    const table = sharedSurface(liveBoard(G));
    expect([...table.matchAll(/data-card-id="([^"]+)"/g)].map(match => match[1])).toEqual(['2', '0', '1']);
    expect(table).toContain('<button class="button primary" type="button">同意這個順序</button>');
    expect(table).not.toContain('待排'); expect(table).not.toContain('放第');
    expect(G.tableOrder).toEqual(['2']);
  });
  it('shows redraw consent and waiting names while suspending final reveal, without hiding round-result confirmation', () => {
    const G = sharedFixture(3); G.tableOrder = ['0', '1', '2']; G.redrawApprovals = ['0', '2'];
    let html = liveBoard(G);
    expect(html).toContain('同意重抽：受測者 0、受測者 2'); expect(html).toContain('等待：受測者 1');
    expect(html).toContain('撤回重抽同意'); expect(html).toContain('先決定是否重抽');
    G.status = 'round-review'; G.redrawApprovals = [];
    html = liveBoard(G);
    expect(html).toContain('已看過結果，開始下一輪'); expect(html).not.toContain('提議重抽題目');
  });
  it('retains briefing and spoken controls for an in-progress v3 shared game', () => {
    const G = sharedFixture(3); G.rulesVersion = 3; delete G.redrawApprovals;
    G.status = 'briefing';
    expect(liveBoard(G)).toContain('我已了解本輪任務');
    G.status = 'answering'; G.cards!['0'].spoken = false;
    expect(liveBoard(G)).toContain('我已口頭回答');
    expect(liveBoard(G)).not.toContain('提議重抽題目');
  });
});
