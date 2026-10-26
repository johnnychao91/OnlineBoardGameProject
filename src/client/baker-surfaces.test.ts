import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { BakerGame, bakerPlayerView, type BakerState } from '../games/baker/game';
import { BAKER_SCENES } from '../games/baker/content';
import { BakerBoard, BakerLayout } from './BakerBoard';
import { BakerOptions } from './BakerOptions';
import { BakerRules, BakerEvidenceGallery, bakerChapters } from './BakerRules';
import { BakerSnapshot } from './BakerSnapshot';
import { RoomContext } from './room-context';
import type { RoomInfo } from './api';

const ids = ['0', '2', '5', '7', '9', '11'];
const info: RoomInfo = { roomId: 'test-baker-room', matchID: 'test-baker-match', gameName: 'baker-street', status: 'playing',
  numPlayers: 6, minPlayers: 4, maxPlayers: 12, spectatorCount: 1, godViewAllowed: true,
  players: ids.map(id => ({ id, name: `警員-${id}`, isConnected: true, ready: true })) };
const nameOf = (id: string) => `警員-${id}`;
function fixture(): BakerState {
  const match = createMatch({ game: BakerGame, numPlayers: ids.length, setupData: { startImmediately: true, participantIDs: ids,
    options: { era: 'victorian', year: 1890, cardsPerType: 4, roleSet: 'all', specialScenes: true, holmesID: '0' } }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as BakerState;
  const solution = { murdererID: '2', meansID: G.players['2'].means[0].id, clueID: G.players['2'].clues[0].id };
  for (const id of ids) G.private[id] = { role: 'investigator', faction: 'police', knownCriminals: [], solution: null };
  G.private['0'] = { role: 'holmes', faction: 'police', knownCriminals: ['2', '5'], knownWitnessID: '7', solution };
  G.private['2'] = { role: 'murderer', faction: 'criminals', knownCriminals: ['2', '5'], solution };
  G.private['5'] = { role: 'accomplice', faction: 'criminals', knownCriminals: ['2', '5'], solution };
  G.private['7'] = { role: 'watson', faction: 'police', knownCriminals: ['5', '2'], solution: null };
  G.secret!.solution = solution; G.status = 'discussion'; G.round = 1;
  G.scenes = BAKER_SCENES.filter(tile => tile.kind === 'scene').slice(0, 6).map(tile => ({ tile, marks: [0] }));
  return G;
}
function board(G: BakerState, id: string, connected = true) {
  const seat = { ...info, access: 'player' as const, playerID: id, credentials: 'never-render-this-credential' };
  return renderToStaticMarkup(createElement(RoomContext.Provider, { value: { seat, info, inviteUrl: '', setInviteUrl: () => {} } },
    createElement(BakerBoard, { G, playerID: id, isConnected: connected, moves: {} })));
}
const snapshot = (G: BakerState, perspective: 'blind' | 'god') => renderToStaticMarkup(createElement(BakerSnapshot, { G, info, perspective, replay: true }));
const allButtons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);

describe('Baker Street private and read-only surfaces', () => {
  it('reprojects a cached god frame before rendering blind observation and does not mutate it', () => {
    const G = fixture(), before = structuredClone(G), html = snapshot(G, 'blind');
    expect(html).toContain('目前視角不可查看這份秘密卷宗');
    expect(html).not.toContain('完整案情'); expect(html).not.toContain('你目擊的兩位涉案者');
    expect(html).not.toContain('baker-identity-card'); expect(html).not.toContain('確認並提交破案');
    expect(html).not.toContain('在' + G.scenes[0].tile.name + '標記');
    expect(html).toContain('<option value="0" selected="">警員-0</option>');
    expect(G).toEqual(before);
  });

  it('shows only the inspected god-view dossier and no game controls', () => {
    const html = snapshot(fixture(), 'god');
    expect(html).toContain('完整案情'); expect(html).toContain('唯讀復盤');
    expect(html).not.toContain('你目擊的兩位涉案者'); expect(html).not.toContain('開始本輪發言</button>');
    expect(html).not.toContain('確認鑑證選擇'); expect(html).not.toContain('確認並提交破案');
  });

  it('keeps Watson information ambiguous and hides the full solution from ordinary police', () => {
    const G = fixture();
    const witness = board(bakerPlayerView({ G, playerID: '7' }), '7');
    expect(witness).toContain('你目擊的兩位涉案者'); expect(witness).toContain('無法區分誰是執行者、誰是內應');
    expect(witness).not.toContain('完整案情'); expect(witness).not.toContain('never-render-this-credential');
    const police = board(bakerPlayerView({ G, playerID: '9' }), '9');
    expect(police).not.toContain('完整案情'); expect(police).not.toContain('你目擊的兩位涉案者');
    expect(police).toContain('提交破案推論');
  });

  it('hides all role and case detail when the dossier is manually collapsed', () => {
    const G = bakerPlayerView({ G: fixture(), playerID: '0' });
    const html = renderToStaticMarkup(createElement(BakerLayout, { G, info, ownID: '0', nameOf, visible: false, onVisible: () => {} }));
    expect(html).toContain('身分、案情與私人情報已遮住');
    expect(html).not.toContain('完整案情'); expect(html).not.toContain('baker-identity-card');
    expect(html).not.toContain('你知道的涉案者');
  });

  it('only gives the executor the secret case selector and disables submissions while disconnected', () => {
    const G = fixture(); G.status = 'crime';
    const murderer = board(bakerPlayerView({ G, playerID: '2' }), '2');
    expect(murderer).toContain('秘密建立案件'); expect(murderer).toContain('確認秘密案情');
    const police = board(bakerPlayerView({ G, playerID: '9' }), '9');
    expect(police).not.toContain('秘密建立案件'); expect(police).not.toContain('確認秘密案情');
    const disconnected = board(bakerPlayerView({ G, playerID: '2' }), '2', false);
    expect(allButtons(disconnected).find(button => button.includes('確認秘密案情'))).toContain('disabled=""');
  });

  it('renders evidence prompts as actions only for Holmes and prevents duplicate markers', () => {
    const G = fixture(); G.status = 'evidence'; G.scenes[0].marks = [];
    const label = `在${G.scenes[0].tile.name}標記`;
    expect(board(bakerPlayerView({ G, playerID: '0' }), '0')).toContain(label);
    expect(board(bakerPlayerView({ G, playerID: '9' }), '9')).not.toContain(label);
    G.scenes[0].marks = [0];
    expect(board(bakerPlayerView({ G, playerID: '0' }), '0')).not.toContain(label);
  });

  it('offers era, public year, difficulty and only seated Holmes choices in lobby', () => {
    const room = { ...info, status: 'lobby', hostPlayerID: '0', gameOptions: { era: 'modern', year: 2026 } };
    const seat = { ...room, playerID: '0', credentials: 'not-rendered' };
    const html = renderToStaticMarkup(createElement(BakerOptions, { seat, info: room, disabled: false, onBusy: () => {}, onUpdate: () => {} }));
    expect(html).toContain('2026 年現代'); expect(html).toContain('世界大戰時期'); expect(html).toContain('工業革命');
    expect(html).toContain('案發年份'); expect(html).toContain('各 5 張');
    expect(html).toContain('<option value="11">警員-11</option>'); expect(html).not.toContain('觀戰者 1');
    expect(html).toContain('破案不需要猜年份');
  });

  it('provides a paged public card library and labels reserve people without inventing playable abilities', () => {
    const gallery = renderToStaticMarkup(createElement(BakerEvidenceGallery));
    expect(gallery).toContain('現場物證 · 400 張'); expect(gallery).toContain('作案手段 · 180 張');
    expect(gallery.match(/class="baker-card"/g)?.length).toBeLessThanOrEqual(24);
    expect(gallery).toContain('搜尋牌名'); expect(gallery).toContain('下一頁');
    const rules = renderToStaticMarkup(createElement(BakerRules));
    for (const [chapter] of bakerChapters) expect(rules).toContain(`id="${chapter}"`);
    expect(rules).toContain('預製人物 · 未加入角色配置'); expect(rules).toContain('葛萊森探長');
    expect(rules).toContain('目前沒有額外技能'); expect(rules).toContain('12 塊特別圖板');
    expect(rules).not.toContain('福爾摩斯：貝克街迷霧');
  });
});
