import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { StarGame, starObserverView, starPlayerView, starValidPayment } from '../games/star/game';
import { STAR_CARDS, STAR_CARD_LIST, STAR_COLORS, STAR_GUARDIAN_LIST, STAR_MATERIALS, STAR_TOKENS, starEmptyBonuses, starEmptyTokens, type StarTokenCounts } from '../games/star/content';
import type { StarState } from '../games/star/types';
import { StarBoard, StarCraftCard, StarLayout, StarPaymentEditor, StarSnapshot, starPaymentAllowed, starReturnAllowed } from './StarBoard';
import { StarRules, starChapters } from './StarRules';
import { starCraftArt } from './star-art';
import { buildStarPosterModel } from './star-poster';
import { starSoundAdapter } from './star-sounds';
import { GameSoundTracker } from './sound-cues';
import { RoomContext } from './room-context';
import type { RoomInfo } from './api';

const ids = ['0', '3', '7'];
const info: RoomInfo = { roomId: 'star-test-room', matchID: 'star-test-match', gameName: 'star-workshop', status: 'turn', numPlayers: 3, minPlayers: 2, maxPlayers: 4, spectatorCount: 1, godViewAllowed: true, players: ids.map(id => ({ id, name: `星匠-${id}`, ready: true, isConnected: true })) };
const seat = { ...info, access: 'player' as const, playerID: '0', credentials: 'private-star-credential' };
const nameOf = (id: string) => `星匠-${id}`;
function fixture(): StarState {
  const result = createMatch({ game: { ...StarGame, seed: 'star-surfaces' }, numPlayers: 3, setupData: { startImmediately: true, participantIDs: ids }, unlisted: true });
  if ('setupDataError' in result) throw new Error(result.setupDataError);
  const G = structuredClone(result.initialState.G) as StarState;
  G.status = 'turn'; G.activePlayer = '0'; G.epoch = 8;
  const hidden = STAR_CARD_LIST.filter(card => !Object.values(G.market).flat().includes(card.id)).slice(0, 3);
  for (const [index, id] of ids.entries()) { const card = hidden[index]; G.players[id].reserved = [{ id: `reserve-${index}`, tier: card.tier, knownCardID: null }]; G.private[id].reserved = [{ id: `reserve-${index}`, cardID: card.id }]; }
  return G;
}
const board = (G: StarState, connected = true) => renderToStaticMarkup(createElement(RoomContext.Provider, { value: { seat, info, inviteUrl: '', setInviteUrl: () => {} } }, createElement(StarBoard, { G, playerID: '0', isConnected: connected, moves: {} })));
const snapshot = (G: StarState, perspective: 'blind' | 'god') => renderToStaticMarkup(createElement(StarSnapshot, { G, info, perspective, replay: true }));
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);

describe('Star Workshop player, snapshot and rules', () => {
  it('renders only own blind reservation while exposing public amounts and counts', () => {
    const G = fixture(), before = structuredClone(G), ownName = STAR_CARDS[G.private['0'].reserved[0].cardID].name, otherName = STAR_CARDS[G.private['3'].reserved[0].cardID].name;
    G.players['3'].tokens.blue = 4; G.players['3'].prestige = 7;
    const html = board(G); expect(html).toContain(`選擇保留設計 ${ownName}`); expect(html).not.toContain(`選擇保留設計 ${otherName}`); expect(html).not.toContain(otherName); expect(html).toContain('1 級隱藏設計'); expect(html).toContain('星晶 4'); expect(html).not.toContain(seat.credentials);
    expect(G.private).toEqual(before.private); expect(G.secret).toEqual(before.secret);
  });
  it('reprojects god cache on blind mode and preserves public known market reservations', () => {
    const G = fixture(), known = G.market[2][0]!; G.players['3'].reserved.push({ id: 'known', tier: 2, knownCardID: known });
    const god = starObserverView(G, 'god'), before = structuredClone(god), html = snapshot(god, 'blind');
    expect(snapshot(god, 'god')).toContain('盲抽設計 · 私人可見'); expect(html).not.toContain('選擇保留設計'); expect(html).toContain('目前視角不能查看盲抽保留設計'); expect(html).toContain(STAR_CARDS[known].name); expect(html).toContain('唯讀復盤'); expect(god).toEqual(before);
    expect(buttons(html).some(button => /支付並打造|確認保留|確認取得|迎接這位/.test(button))).toBe(false);
  });
  it('conceals private designs together while keeping public material and prestige states', () => {
    const G = starPlayerView({ G: fixture(), playerID: '0' }); G.players['0'].prestige = 11;
    const html = renderToStaticMarkup(createElement(StarLayout, { G, info, ownID: '0', nameOf, visible: false, onVisible: () => {} }));
    expect(html).toContain('私人保留設計已遮住'); expect(html).not.toContain('選擇保留設計'); expect(html).toContain('>11<small>聲望'); expect(html).toContain('共用星材供應');
  });
  it('disables marketplace, private-card and action selections when disconnected', () => {
    const html = board(fixture(), false), relevant = buttons(html).filter(button => /選擇市場設計|選擇保留設計|取得星材|打造作品|保留設計/.test(button));
    expect(relevant.length).toBeGreaterThan(12); expect(relevant.every(button => button.includes('disabled=""'))).toBe(true); expect(html).toContain('連線中斷');
  });
  it('keeps inactive seats out of all move controls and still shows their private designs', () => {
    const G = fixture(); G.activePlayer = '3'; const html = board(G); expect(html).toContain('等待目前星匠完成回合'); expect(html).not.toContain('選擇星匠行動'); expect(html).toContain('盲抽設計 · 私人可見');
  });
  it('offers forced pass only when no ordinary action exists, and disables it offline', () => {
    const G = fixture(), reserved = STAR_CARD_LIST.filter(card => !Object.values(G.market).flat().includes(card.id)).slice(0, 3);
    G.bank = starEmptyTokens(); G.players['0'].tokens = starEmptyTokens(); G.players['0'].bonuses = starEmptyBonuses();
    G.players['0'].reserved = reserved.map((card, index) => ({ id: `full-${index}`, tier: card.tier, knownCardID: null })); G.private['0'].reserved = reserved.map((card, index) => ({ id: `full-${index}`, cardID: card.id }));
    const html = board(G); expect(html).toContain('目前沒有可用行動'); expect(buttons(html).find(button => button.includes('無可用行動，結束此回合'))).not.toContain('disabled=""'); expect(html).not.toContain('選擇星匠行動');
    expect(buttons(board(G, false)).find(button => button.includes('無可用行動，結束此回合'))).toContain('disabled=""');
    const take = structuredClone(G); take.bank.white = 1; expect(board(take)).not.toContain('無可用行動，結束此回合');
    const reserve = structuredClone(G); reserve.players['0'].reserved.pop(); reserve.private['0'].reserved.pop(); expect(board(reserve)).not.toContain('無可用行動，結束此回合');
    const buy = structuredClone(G); buy.players['0'].tokens = { white: 5, blue: 5, green: 5, red: 5, black: 5, gold: 0 }; expect(board(buy)).not.toContain('無可用行動，結束此回合');
    const other = structuredClone(G); other.activePlayer = '3'; expect(board(other)).not.toContain('無可用行動，結束此回合');
  });
  it('requires briefing acknowledgement once without a countdown', () => {
    const G = fixture(); G.status = 'briefing'; expect(board(G)).toContain('準備完成，開始打造'); G.players['0'].acknowledged = true;
    expect(buttons(board(G)).find(button => button.includes('已準備，等待其他星匠'))).toContain('disabled=""'); expect(board(G)).toContain('回合選擇沒有倒數');
  });
  it('renders token return for every resource including gold and requires an exact total', () => {
    const G = fixture(); G.status = 'return-tokens'; G.pending = { playerID: '0', returnCount: 2, guardianIDs: [] }; G.players['0'].tokens = { white: 3, blue: 3, green: 2, red: 1, black: 1, gold: 2 };
    const html = board(G); expect(html).toContain('歸還多出的星材'); expect(html).toContain('共 12 枚'); for (const token of STAR_TOKENS) expect(html).toContain(`多歸還一枚${STAR_MATERIALS[token].name}`); expect(buttons(html).find(button => button.includes('確認歸還星材'))).toContain('disabled=""');
  });
  it('renders multiple eligible guardians without automatically choosing one', () => {
    const G = fixture(); G.status = 'choose-guardian'; G.pending = { playerID: '0', returnCount: 0, guardianIDs: ['lyra', 'draco'] };
    const html = board(G); expect(html).toContain('選擇星座守護者'); expect(html).toContain('天琴織夢者'); expect(html).toContain('天龍司儀'); expect(buttons(html).find(button => button.includes('迎接這位守護者'))).toContain('disabled=""');
  });
  it('announces the equal-turn final round and displays public finished tie-break totals', () => {
    const G = fixture(); G.endTriggeredBy = '3'; expect(board(G)).toContain('星匠-3已達 15 聲望，本輪完成後結算');
    G.status = 'finished'; G.winnerIDs = ['0', '7']; G.finalScores = { '0': 16, '3': 15, '7': 16 }; G.players['0'].prestige = 16; G.players['7'].prestige = 16;
    const html = snapshot(G, 'blind'); expect(html).toContain('星匠-0、星匠-7完成最耀眼的星匠工坊'); expect(html).toContain('星匠聲望總帳'); expect(html).toContain('>16</td>'); expect(html).toContain('同聲望時，打造作品較少者勝');
  });
  it('renders exact cost, prestige and bonus separately from shared original art', () => {
    const card = STAR_CARD_LIST.find(card => card.prestige === 5)!;
    const html = renderToStaticMarkup(createElement(StarCraftCard, { card })); expect(html).toContain(card.name); expect(html).toContain(`data-tier="${card.tier}"`); expect(html).toContain(`data-bonus="${card.bonus}"`); expect(html).toContain('>5<small>聲望');
    for (const color of STAR_COLORS.filter(color => card.cost[color] > 0)) expect(html).toContain(`title="${STAR_MATERIALS[color].name} ${card.cost[color]}"`);
    expect(new Set(STAR_CARD_LIST.map(card => starCraftArt(card.bonus, card.tier, card.id))).size).toBe(30);
  });
  it('provides complete rule chapters, all ten guardians, six materials and searchable 90-card pages', () => {
    const html = renderToStaticMarkup(createElement(StarRules)); for (const [id] of starChapters) expect(html).toContain(`id="${id}"`);
    for (const guardian of STAR_GUARDIAN_LIST) expect(html).toContain(`id="star-guardian-${guardian.id}"`);
    for (const color of STAR_TOKENS) expect(html).toContain(`id="star-material-${color}"`);
    expect(html).toContain('搜尋星匠作品'); expect(html).toContain('篩選作品等級'); expect(html).toContain('90 / 90 張'); expect(html).toContain('第 1 / 8 頁'); expect(html).toContain('不會再多開一整輪'); expect(html).toContain('若只剩一或兩種有庫存，可從剩餘種類選一種或兩種');
  });
});

describe('Star Workshop custom payment and return', () => {
  const cost = { ...starEmptyBonuses(), white: 3, blue: 1 }, tokens = { white: 4, blue: 2, green: 0, red: 0, black: 0, gold: 3 };
  it('allows voluntary gold substitution despite matching colors being available', () => {
    expect(starPaymentAllowed(tokens, cost, { ...starEmptyTokens(), white: 2, gold: 2 })).toBe(true);
    expect(starPaymentAllowed(tokens, cost, { ...starEmptyTokens(), white: 3, blue: 1 })).toBe(true);
    const html = renderToStaticMarkup(createElement(StarPaymentEditor, { cost, tokens, payment: { ...starEmptyTokens(), white: 3, blue: 1 }, disabled: false, onPayment: () => {} })); expect(html).toContain('使用星砂替代月銀'); expect(html).toContain('使用星砂替代星晶'); expect(html).toContain('自訂作品付款');
  });
  it.each([
    { ...starEmptyTokens(), white: 3, blue: 1, gold: 1 },
    { ...starEmptyTokens(), white: 4 },
    { ...starEmptyTokens(), gold: 4 },
    { ...starEmptyTokens(), white: -1, gold: 5 },
    { ...starEmptyTokens(), white: 2.5, blue: 1, gold: .5 },
  ])('rejects surplus, unavailable or malformed payments %j', payment => expect(starPaymentAllowed(tokens, cost, payment)).toBe(false));
  it('accepts a fully discounted free purchase and arbitrary exact return including gold', () => {
    expect(starPaymentAllowed(starEmptyTokens(), starEmptyBonuses(), starEmptyTokens())).toBe(true);
    expect(starReturnAllowed(tokens, 2, { ...starEmptyTokens(), white: 1, gold: 1 })).toBe(true);
    expect(starReturnAllowed(tokens, 2, { ...starEmptyTokens(), white: 1 })).toBe(false);
    expect(starReturnAllowed(tokens, 2, { ...starEmptyTokens(), green: 2 })).toBe(false);
    expect(starReturnAllowed(tokens, 2, { ...starEmptyTokens(), gold: 2.5, white: -.5 })).toBe(false);
  });
  it('matches authoritative payment validation over all bounded payment vectors', () => {
    const G = fixture(); G.players['0'].tokens = { ...tokens }; G.players['0'].bonuses = { ...starEmptyBonuses(), green: 1, red: 1 };
    const discounted = { ...starEmptyBonuses(), white: 1, blue: 1 };
    for (let white = 0; white <= 4; white++) for (let blue = 0; blue <= 2; blue++) for (let gold = 0; gold <= 4; gold++) {
      const payment = { ...starEmptyTokens(), white, blue, gold };
      expect(starPaymentAllowed(tokens, discounted, payment)).toBe(starValidPayment(G, '0', 'star-1-black-1', payment));
    }
  });
});

describe('Star Workshop public output and sound', () => {
  it('never reads private designs, future decks or premature final scores', () => {
    const G = fixture(); for (const field of ['private', 'secret', 'finalScores']) Object.defineProperty(G, field, { get: () => { throw new Error(`private read ${field}`); } });
    const model = buildStarPosterModel({ G, info, step: 1, totalSteps: 5 }); expect(model.players.every(player => player.reserved[0].name === null)).toBe(true); expect(model.market.flatMap(tier => tier.cards)).toHaveLength(12);
  });
  it('keeps hidden reservations and future decks from influencing poster or sound', () => {
    const G = fixture(), other = structuredClone(G); other.private['0'].reserved[0].cardID = G.private['3'].reserved[0].cardID; other.secret!.decks[3].reverse(); other.log[0].message = 'private-log-canary';
    const options = { info, step: 1, totalSteps: 9 }; expect(buildStarPosterModel({ ...options, G })).toEqual(buildStarPosterModel({ ...options, G: other })); expect(starSoundAdapter(G, '0')).toEqual(starSoundAdapter(other, '0'));
    expect(JSON.stringify(buildStarPosterModel({ ...options, G: other }))).not.toContain('private-log-canary');
  });
  it('exports public known reservations, resources and completed score breakdown', () => {
    const G = fixture(); const known = G.market[2][0]!; G.players['3'].reserved.push({ id: 'known', tier: 2, knownCardID: known }); G.players['0'].purchased = [G.market[1][0]!]; G.players['0'].prestige = 17; G.players['0'].guardians = ['lyra']; G.status = 'finished'; G.winnerIDs = ['0'];
    const model = buildStarPosterModel({ G, info, step: 10, totalSteps: 10 }); expect(model.players[1].reserved[1].name).toBe(STAR_CARDS[known].name); expect(model.players[0]).toMatchObject({ prestige: 17, purchased: 1, winner: true, guardians: ['天琴織夢者'] }); expect(model.winners).toEqual(['星匠-0']);
  });
  it('clearly labels the no-actions settlement and its public forced-pass event', () => {
    const G = fixture(); G.status = 'finished'; G.winReason = 'stalemate'; G.winnerIDs = ['0']; G.finalScores = { '0': 7, '3': 5, '7': 5 }; G.players['0'].prestige = 7;
    G.log.push({ type: 'forced-pass', round: G.round, epoch: G.epoch, actor: '0', message: '無可用行動' });
    const html = snapshot(G, 'blind'); expect(html).toContain('全桌已無可用行動，以目前成績結算'); expect(html).toContain('>7</td>');
    const model = buildStarPosterModel({ G, info, step: 1, totalSteps: 1 }); expect(model.outcome).toBe('全桌無可用行動，按目前聲望結算'); expect(model.events.at(-1)?.action).toBe('無可用行動，結束本回合'); expect(model.winners).toEqual(['星匠-0']);
    expect(starSoundAdapter(G, '0')?.events.at(-1)).toContain('forced-pass'); expect(starSoundAdapter(G, '0')?.attention).toBeUndefined();
  });
  it('sanitizes names and clamps replay coordinates without copying arbitrary text', () => {
    const G = fixture(), model = buildStarPosterModel({ G, info: { ...info, players: [{ id: '0', name: '\u202e https://example.invalid/private', ready: true, isConnected: true }] }, step: -1, totalSteps: 0 });
    expect(JSON.stringify(model)).not.toMatch(/example.invalid|\u202e/); expect(model.step).toBe(1); expect(model.totalSteps).toBe(1);
  });
  it('cues the public turn and mandatory pending phases, silencing load and reconnect', () => {
    const G = fixture(), tracker = new GameSoundTracker(), input = () => ({ G: starSoundAdapter(G, '0'), matchID: 'star-sounds', playerID: '0' });
    expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false }); G.activePlayer = '3'; G.epoch++; tracker.update(input()); G.activePlayer = '0'; G.epoch++; expect(tracker.update(input()).ownTurn).toBe(true);
    G.status = 'return-tokens'; G.epoch++; expect(tracker.update(input()).ownTurn).toBe(true); G.status = 'choose-guardian'; G.epoch++; expect(tracker.update(input()).ownTurn).toBe(true);
    expect(tracker.update({ ...input(), connected: false })).toEqual({ reveals: 0, ownTurn: false }); expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false });
  });
});
