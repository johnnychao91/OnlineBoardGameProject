import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { TuringGame, type TuringState } from '../games/turing/game';
import { TuringLayout } from './TuringBoard';
import { TuringSnapshot } from './TuringSnapshot';
import type { RoomInfo } from './api';

const info: RoomInfo = {
  roomId: 'test-room', matchID: 'test-match', gameName: 'turing-test', status: 'answering',
  numPlayers: 4, minPlayers: 4, maxPlayers: 9, spectatorCount: 1, godViewAllowed: true,
  players: Array.from({ length: 4 }, (_, id) => ({ id, name: `受測者 ${id}`, isConnected: true, ready: true })),
};
const nameOf = (id: string) => `受測者 ${id}`;
const sealed = '只有零號本人與上帝視角可見的封存回答';
function fixture(): TuringState {
  const created = createMatch({ game: TuringGame, numPlayers: 4, setupData: { startImmediately: true }, unlisted: true });
  if ('setupDataError' in created) throw new Error(created.setupDataError);
  const G = structuredClone(created.initialState.G) as TuringState;
  G.status = 'answering'; G.examinerID = '3';
  G.private = { '0': { number: 7, answer: sealed }, '1': { number: 2, answer: '其他人的私密回答' }, '2': { number: 9 } };
  G.players['0'].answered = true; G.players['1'].answered = true;
  return G;
}
const snapshot = (G: TuringState, perspective: 'blind' | 'god') => renderToStaticMarkup(createElement(TuringSnapshot, { G, info, perspective, replay: true }));

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
});
