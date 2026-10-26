import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { MailGame, mailPlayerView, type MailState } from '../games/post/game';
import { MAIL_CARDS, type MailMode } from '../games/post/rules';
import { MailBoard, MailLayout } from './MailBoard';
import { MailOptions } from './MailOptions';
import { MailRules, mailChapters } from './MailRules';
import { MailSnapshot } from './MailSnapshot';
import { RoomContext } from './room-context';
import type { RoomInfo } from './api';

const info: RoomInfo = {
  roomId: 'test-mail-room', matchID: 'test-mail-match', gameName: 'midnight-post', status: 'playing',
  numPlayers: 3, minPlayers: 2, maxPlayers: 8, spectatorCount: 1, godViewAllowed: true,
  players: ['0', '1', '4'].map(id => ({ id, name: `信使-${id}`, isConnected: true, ready: true })),
};
const nameOf = (id: string) => `信使-${id}`;
const seat = { ...info, access: 'player' as const, playerID: '0', credentials: 'private-test-credential' };
function fixture(mode: MailMode = 'classic'): MailState {
  const count = mode === 'premium' ? 5 : 3;
  const ids = mode === 'premium' ? ['0', '1', '4', '7', '9'] : ['0', '1', '4'];
  const match = createMatch({ game: MailGame, numPlayers: count, setupData: { startImmediately: true, participantIDs: ids, options: { mode, directorID: '0' } }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as MailState;
  G.status = 'playing'; G.activePlayer = '0'; G.pending = null;
  G.private['0'] = { cards: [{ id: 'own-guard', role: mode === 'black-letter' ? 'director-1' : 'guard' }, { id: 'own-priest', role: mode === 'black-letter' ? 'director-2' : 'priest' }],
    intel: [{ round: 1, label: '本人限定查驗', text: '本人限定的文字', playerID: '1', card: { id: 'seen-countess', role: 'countess' } }] };
  G.private['1'] = { cards: [{ id: 'other-princess', role: 'princess' }], intel: [{ round: 1, label: '他人限定查驗', text: '別人的秘密文字' }] };
  for (const id of ids) G.players[id].cardCount = G.private[id].cards.length;
  return G;
}
const board = (G: MailState, connected = true) => renderToStaticMarkup(createElement(RoomContext.Provider, {
  value: { seat, info, inviteUrl: '', setInviteUrl: () => {} },
}, createElement(MailBoard, { G, playerID: '0', isConnected: connected, moves: {} })));
const snapshot = (G: MailState, perspective: 'blind' | 'god') => renderToStaticMarkup(createElement(MailSnapshot, { G, info, perspective, replay: true }));
function buttons(html: string) { return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]); }

describe('Midnight Post private and read-only surfaces', () => {
  it.each(['classic', 'premium', 'black-letter'] as const)('reprojects a cached god frame before rendering a %s blind view', mode => {
    const G = fixture(mode), before = structuredClone(G);
    const html = snapshot(G, 'blind');
    expect(html).toContain('目前視角不可查看這個信袋');
    expect(html).not.toContain('本人限定查驗'); expect(html).not.toContain('他人限定查驗');
    expect(html).not.toContain('other-princess'); expect(html).not.toContain('own-guard');
    expect(html).not.toContain('打出 1'); expect(html).not.toContain('確認選擇');
    expect(G).toEqual(before);
  });

  it('shows only the inspected god-view hand and intel, without live game controls', () => {
    const html = snapshot(fixture(), 'god');
    expect(html).toContain('本人限定查驗'); expect(html).toContain(MAIL_CARDS.guard.name);
    expect(html).not.toContain('他人限定查驗'); expect(html).not.toContain('別人的秘密文字');
    expect(html).toContain('唯讀復盤'); expect(html).not.toContain('點選打出');
    expect(html).not.toContain('宣告集齊六封印'); expect(html).not.toContain('開始下一輪</button>');
  });

  it('exposes only legal own-hand buttons and disables them offline or when a mandatory card is held', () => {
    const G = fixture();
    const online = board(mailPlayerView({ G, playerID: '0' }));
    expect(online).toContain('aria-label="打出 1 巡街郵差"');
    expect(online).toContain('本人限定查驗'); expect(online).not.toContain('他人限定查驗');
    expect(online).not.toContain(seat.credentials);
    const offline = buttons(board(mailPlayerView({ G, playerID: '0' }), false)).filter(button => button.includes('aria-label="打出 '));
    expect(offline.length).toBe(2); expect(offline.every(button => button.includes('disabled=""'))).toBe(true);
    G.private['0'].cards = [{ id: 'mandatory', role: 'countess' }, { id: 'cannot-play', role: 'king' }];
    const forced = buttons(board(mailPlayerView({ G, playerID: '0' })));
    expect(forced.find(button => button.includes('打出 6 換袋總管'))).toContain('disabled=""');
    expect(forced.find(button => button.includes('打出 7 緘默夫人'))).not.toContain('disabled=""');
  });

  it('hides the hand and private action choices when the signal bag is manually collapsed', () => {
    const G = mailPlayerView({ G: fixture(), playerID: '0' });
    const html = renderToStaticMarkup(createElement(MailLayout, { G, info, nameOf, ownID: '0', visible: false, onVisible: () => {} }));
    expect(html).toContain('信袋與私人情報已遮住');
    expect(html).not.toContain('本人限定查驗'); expect(html).not.toContain('mail-card-copy');
    expect(html).not.toContain('priest.webp'); expect(html).not.toContain('guard.webp');
  });

  it('keeps nonacting pending choices private and identifies the actual individual champion', () => {
    const G = fixture();
    G.pending = { actorID: '1', title: '不得顯示給別人的牌堆內容', kind: 'reorder', choices: [{ id: 'x', label: '秘密下一張牌' }], minimum: 1, maximum: 1 };
    const playing = board(mailPlayerView({ G, playerID: '0' }));
    expect(playing).not.toContain('秘密下一張牌'); expect(playing).not.toContain('不得顯示給別人的牌堆內容');
    G.status = 'finished'; G.pending = null; G.winner = 'delivery'; G.winnerIDs = ['4']; G.winReason = 'delivery-champion';
    const finished = snapshot(G, 'blind');
    expect(finished).toContain('信使-4贏得投遞競賽');
    expect(finished).not.toContain('全隊獲勝');
  });

  it('offers all three modes and only seated participants as director candidates in the lobby', () => {
    const room = { ...info, status: 'lobby', hostPlayerID: '0', gameOptions: { mode: 'black-letter', directorID: 'random' } };
    const html = renderToStaticMarkup(createElement(MailOptions, { seat, info: room, disabled: false, onBusy: () => {}, onUpdate: () => {} }));
    expect(html).toContain('依人數選擇'); expect(html).toContain('密函投遞 · 3～4 人'); expect(html).toContain('全城夜遞 · 5～8 人'); expect(html).toContain('黑函局長 · 2～6 人');
    expect(html).toContain('<option value="4">信使-4</option>'); expect(html).not.toContain('觀戰者 1');
  });

  it('provides every registered rules chapter and an independent public character gallery', () => {
    const html = renderToStaticMarkup(createElement(MailRules));
    for (const [id] of mailChapters) expect(html).toContain(`id="${id}"`);
    expect(html.match(/rules-role-card/g)).toHaveLength(8);
    expect(html).toContain('六封印'); expect(html).toContain('雙人特例'); expect(html).toContain('終宵大主事的輪末判定');
    expect(html).not.toContain('Thanos'); expect(html).not.toContain('漫威'); expect(html).not.toContain('Marvel');
  });
});
