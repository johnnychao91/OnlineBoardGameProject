import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { BanquetGame, banquetObserverView, banquetPlayerView, type BanquetState, type BanquetPending as Pending } from '../games/banquet/game';
import { BANQUET_ROLES, BANQUET_ROLE_IDS } from '../games/banquet/rules';
import { BanquetBoard, BanquetLayout, BanquetPending, BanquetSnapshot } from './BanquetBoard';
import { BanquetLobbyOptions } from './BanquetLobbyOptions';
import { BanquetRules, banquetChapters } from './BanquetRules';
import { buildBanquetPosterModel } from './banquet-poster';
import { banquetSoundAdapter } from './banquet-sounds';
import { GameSoundTracker } from './sound-cues';
import { RoomContext } from './room-context';
import type { RoomInfo } from './api';

const info: RoomInfo = { roomId: 'test-banquet-room', matchID: 'test-banquet-match', gameName: 'hundred-ghosts', status: 'playing', numPlayers: 4, minPlayers: 4, maxPlayers: 12, spectatorCount: 1, godViewAllowed: true, players: ['0', '2', '5', '7'].map(id => ({ id, name: `賓客-${id}`, isConnected: true, ready: true })) };
const seat = { ...info, access: 'player' as const, playerID: '0', credentials: 'test-private-credential' };
const nameOf = (id: string) => `賓客-${id}`;
function fixture(): BanquetState {
  const match = createMatch({ game: BanquetGame, numPlayers: 4, setupData: { startImmediately: true, participantIDs: ['0', '2', '5', '7'] }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as BanquetState;
  G.status = 'playing'; G.activePlayer = '0'; G.turnNumber = 5; G.initialTurnsRemaining = 0; G.inPlayRoles = [];
  G.private['0'].memory = [{ turn: 4, epoch: 4, source: 'spy', location: 'seat:1', playerID: '2', role: 'king', uncertain: true }];
  G.private['2'].memory = [{ turn: 3, epoch: 3, source: 'princess', location: 'seat:3', playerID: '7', role: 'princess', uncertain: false }];
  G.secret!.masks = ['guru', 'spy', 'thief', 'widow']; G.secret!.center = ['beggar', 'fool']; G.secret!.observerMemory = [];
  return G;
}
const board = (G: BanquetState, connected = true) => renderToStaticMarkup(createElement(RoomContext.Provider, { value: { seat, info, inviteUrl: '', setInviteUrl: () => {} } }, createElement(BanquetBoard, { G, playerID: '0', isConnected: connected, moves: {} })));
const snapshot = (G: BanquetState, perspective: 'blind' | 'god') => renderToStaticMarkup(createElement(BanquetSnapshot, { G, info, perspective, replay: true }));
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);

describe('Hundred Ghosts client privacy and complete surfaces', () => {
  it('shows historical own observations and never treats the actual face as a free hand', () => {
    const G = fixture(), before = structuredClone(G), html = board(G);
    expect(html).toContain('酒吞童子'); expect(html).toContain('百目鬼私看'); expect(html).toContain('可能已改變');
    expect(html).not.toContain('guru.webp'); expect(html).not.toContain('princess.webp'); expect(html).not.toContain('spy.webp');
    expect(html).not.toContain('青行燈亮牌'); expect(html).not.toContain(seat.credentials); expect(G).toEqual(before);
  });
  it('reprojects cached god frames to blind without masks or any player private memory', () => {
    const G = fixture(), god = banquetObserverView(G, 'god'), before = structuredClone(god);
    expect(snapshot(god, 'god')).toContain('guru.webp');
    const html = snapshot(god, 'blind');
    expect(html).toContain('盲視角'); expect(html).toContain('唯讀復盤');
    expect(html).not.toContain('guru.webp'); expect(html).not.toContain('king.webp'); expect(html).not.toContain('princess.webp');
    expect(html).not.toContain('確認選擇'); expect(html).not.toContain('完成秘密盲換'); expect(html).not.toContain('百目鬼私看'); expect(god).toEqual(before);
  });
  it('retains authorized observer memories including a princess reveal while denying its target that new observation', () => {
    const G = fixture(); const seen = { turn: 4, epoch: 4, source: 'princess' as const, location: 'seat:0', playerID: '0', role: 'spy' as const, uncertain: false };
    G.secret!.observerMemory = [seen]; G.private['2'].memory.push(seen);
    expect(snapshot(banquetObserverView(G, 'god'), 'blind')).toContain('spy.webp');
    expect(board(G)).not.toContain('spy.webp'); expect(board(G)).not.toContain('青行燈亮牌');
  });
  it('hides all private face URLs when memory is manually collapsed, including god current masks', () => {
    const G = banquetObserverView(fixture(), 'god');
    const html = renderToStaticMarkup(createElement(BanquetLayout, { G, info, nameOf, ownID: '0', visible: false, onVisible: () => {}, readonly: true, god: true, replay: true }));
    expect(html).toContain('面具記憶與私人操作已遮住'); expect(html).not.toContain('king.webp'); expect(html).not.toContain('guru.webp'); expect(html).not.toContain('百目鬼私看');
  });
  it('uses initial public faces only during briefing and requires explicit acknowledgement', () => {
    const G = fixture(); G.status = 'briefing';
    const html = board(G); expect(html).toContain('記住了，準備入宴');
    expect(html.match(/data-face="shown"/g)?.length).toBeGreaterThanOrEqual(6);
    G.players['0'].acknowledged = true;
    expect(buttons(board(G)).find(button => button.includes('已確認，等待其他賓客'))).toContain('disabled=""');
  });
  it('limits the opening to blind exchange and disables every action when offline', () => {
    const G = fixture(); G.initialTurnsRemaining = 4;
    const html = board(G); expect(html).toContain('中央面具 1'); expect(html).toContain('真的交換'); expect(html).toContain('假裝交換');
    expect(buttons(html).find(button => button.includes('>宣告<'))).toContain('disabled=""');
    expect(buttons(html).find(button => button.includes('>查看<'))).toContain('disabled=""');
    const offline = buttons(board(G, false)).filter(button => !button.includes('收起秘密') && !button.includes('station-sound'));
    expect(offline.filter(button => ['真的交換', '假裝交換', '完成秘密盲換'].some(label => button.includes(label))).every(button => button.includes('disabled=""'))).toBe(true);
  });
  it('responds only at the requested seat, including claiming rather than merely accusing', () => {
    const G = fixture(); G.claim = { actorID: '2', role: 'empress', claimantIDs: ['2'], responderIDs: ['0', '5', '7'], responseIndex: 0, responses: {}, revealed: {} };
    expect(board(G)).toContain('我才是玉藻前'); expect(board(G)).toContain('不認領，讓夜宴繼續');
    G.claim.responseIndex = 1; expect(board(G)).not.toContain('我才是玉藻前');
  });
  it.each<Pending['kind']>(['fool-targets', 'spy-target', 'swap', 'guru-target', 'guru-guess', 'princess-target', 'puppeteer-targets', 'sorceress-target', 'trickster-target'])('renders the full %s selection contract only for its actor', kind => {
    const pending: Pending = { actorID: '0', kind, title: '能力選擇標題', minimum: ['fool-targets', 'puppeteer-targets'].includes(kind) ? 2 : 1, maximum: ['fool-targets', 'puppeteer-targets'].includes(kind) ? 2 : 1, choices: kind === 'swap' ? [{ id: 'swap', label: '交換面具' }, { id: 'keep', label: '假裝交換' }] : kind === 'guru-guess' ? [{ id: 'king', label: '酒吞童子', role: 'king' }] : kind === 'sorceress-target' ? [{ id: 'skip', label: '不交換財富' }, { id: '2', label: '2', playerID: '2' }] : [{ id: '2', label: '2', playerID: '2' }, { id: '5', label: '5', playerID: '5' }] };
    const html = renderToStaticMarkup(createElement(BanquetPending, { pending, nameOf, disabled: false, onSubmit: () => {} }));
    expect(html).toContain('能力選擇標題'); expect(html).toContain('確認選擇'); expect(buttons(html).find(button => button.includes('確認選擇'))).toContain('disabled=""');
    for (const choice of pending.choices!) expect(html).toContain(choice.playerID ? nameOf(choice.playerID) : choice.label);
    const G = fixture(); G.pending = pending; expect(board(G)).toContain('能力選擇標題');
    G.pending.actorID = '2'; expect(board(G)).not.toContain('能力選擇標題');
  });
  it('renders exact individual winners and the full rolebook independently of a room', () => {
    const G = fixture(); G.status = 'finished'; G.winnerIDs = ['5', '7']; G.winReason = 'bankruptcy';
    expect(snapshot(G, 'blind')).toContain('賓客-5、賓客-7贏得夜宴');
    const html = renderToStaticMarkup(createElement(BanquetRules));
    for (const [id] of banquetChapters) expect(html).toContain(`id="${id}"`);
    for (const role of BANQUET_ROLE_IDS) expect(html).toContain(`id="banquet-${role}"`);
    expect(html).toContain('id="banquet-prop-coin"'); expect(html).toContain('id="banquet-prop-court"');
    expect(html).toContain('前四個回合'); expect(html).toContain('至少三分之一'); expect(html).toContain('沒有行動倒數'); expect(html).toContain(BANQUET_ROLES.princess.description);
  });
  it('provides presets and complete custom role editing for the host', () => {
    const html = renderToStaticMarkup(createElement(BanquetLobbyOptions, { seat, info: { ...info, status: 'lobby', hostPlayerID: '0', gameOptions: { scenario: 'custom', customRoles: ['beggar', 'empress', 'fool', 'judge', 'sorceress', 'widow'] } }, disabled: false, onBusy: () => {}, onUpdate: () => {} }));
    expect(html).toContain('場景 A'); expect(html).toContain('場景 B'); expect(html).toContain('自訂面具');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(16); expect(html).toContain('小豆洗 × 2');
  });
});

describe('Hundred Ghosts public export and audio', () => {
  it('uses a strict poster whitelist even with poisoned private properties', () => {
    const G = fixture();
    for (const property of ['secret', 'private', 'currentMasks', 'observerMemory', 'initialLayout', 'pending', 'claim']) Object.defineProperty(G, property, { get: () => { throw new Error(`read ${property}`); } });
    const model = buildBanquetPosterModel({ G, info, step: 2, totalSteps: 8 });
    expect(model.players).toHaveLength(4); expect(model.turn).toBe(5); expect(JSON.stringify(model)).not.toContain('mask');
  });
  it('produces identical poster and audio identities for fake and real swaps regardless of hidden faces', () => {
    const G = fixture(), second = structuredClone(G); second.secret!.masks.reverse(); second.private['0'].memory = [];
    const options = { info, step: 1, totalSteps: 1 };
    expect(buildBanquetPosterModel({ ...options, G })).toEqual(buildBanquetPosterModel({ ...options, G: second }));
    expect(banquetSoundAdapter(G, '0')).toEqual(banquetSoundAdapter(second, '0'));
  });
  it('silences entry and reconnect and cues the target of a guru guess using public state', () => {
    const G = fixture(), tracker = new GameSoundTracker(), input = () => ({ G: banquetSoundAdapter(G, '2'), matchID: 'match', playerID: '2' });
    expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false });
    G.epoch++; G.pending = { actorID: '2', kind: 'guru-guess', title: '猜牌', choices: [{ id: 'king', label: '酒吞童子' }] };
    expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: true });
    expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update({ ...input(), connected: false })).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false });
    const visible = banquetPlayerView({ G, playerID: '0' }); expect(banquetSoundAdapter(visible, '0')?.attention).toBeUndefined();
  });
});
