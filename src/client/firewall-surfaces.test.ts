import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { FirewallGame, firewallObserverView, firewallPlayerView } from '../games/firewall/game';
import { FIREWALL_ACTIONS, FIREWALL_PATH_DEFINITIONS, FIREWALL_PATHS, FIREWALL_ROLE_IDS, type FirewallActionID } from '../games/firewall/content';
import type { FirewallState } from '../games/firewall/types';
import { FirewallBoard, FirewallCardFace, FirewallLayout, FirewallNetwork, FirewallSnapshot, FirewallTopology } from './FirewallBoard';
import { FirewallRules, firewallChapters } from './FirewallRules';
import { firewallActionArt } from './firewall-art';
import { buildFirewallPosterModel } from './firewall-poster';
import { firewallSoundAdapter } from './firewall-sounds';
import { GameSoundTracker } from './sound-cues';
import { RoomContext } from './room-context';
import type { RoomInfo } from './api';

const info: RoomInfo = { roomId: 'firewall-test-room', matchID: 'firewall-test-match', gameName: 'firewall-breach', status: 'turn', numPlayers: 3, minPlayers: 2, maxPlayers: 12, spectatorCount: 1, godViewAllowed: true, players: ['0', '3', '7'].map(id => ({ id, name: `節點-${id}`, isConnected: true, ready: true })) };
const seat = { ...info, access: 'player' as const, playerID: '0', credentials: 'private-firewall-credential' };
const nameOf = (id: string) => `節點-${id}`;
function fixture(): FirewallState {
  const match = createMatch({ game: FirewallGame, numPlayers: 3, setupData: { startImmediately: true, participantIDs: ['0', '3', '7'] }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as FirewallState;
  G.status = 'turn'; G.activePlayer = '0'; G.epoch = 8; G.phaseEpoch = 3;
  G.private['0'].gold = 123; G.private['3'].gold = 98761; G.private['0'].role = 'blue'; G.private['3'].role = 'geologist';
  G.private['0'].hand = [{ id: 'own-path', kind: 'path', pathID: 'base_nesw' }, { id: 'own-map', kind: 'action', action: 'map' }];
  G.private['3'].hand = [{ id: 'other-hidden-program', kind: 'action', action: 'change_roles' }];
  G.private['0'].goalMemory = [{ round: 1, epoch: 5, goalID: 'goal-top', pathID: 'goal_gold' }];
  G.private['0'].roleMemory = [{ round: 1, epoch: 7, playerID: '7', role: 'profiteer' }];
  G.secret!.deck = [{ id: 'future-program-canary', kind: 'action', action: 'swap_hands' }];
  return G;
}
const board = (G: FirewallState, connected = true) => renderToStaticMarkup(createElement(RoomContext.Provider, { value: { seat, info, inviteUrl: '', setInviteUrl: () => {} } }, createElement(FirewallBoard, { G, playerID: '0', isConnected: connected, moves: {} })));
const snapshot = (G: FirewallState, perspective: 'blind' | 'god') => renderToStaticMarkup(createElement(FirewallSnapshot, { G, info, perspective, replay: true }));
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);

describe('Firewall player, snapshot and rule surfaces', () => {
  it('shows only own private role, programs, wealth and inspection memories', () => {
    const G = fixture(), before = structuredClone(G), html = board(G);
    expect(html).toContain('data-private-gold="true">123'); expect(html).toContain('藍域滲透者');
    expect(html).toContain('私人查驗紀錄'); expect(html).toContain('雙面代理');
    expect(html).not.toContain('98761'); expect(html).not.toContain('other-hidden-program'); expect(html).not.toContain('future-program-canary'); expect(html).not.toContain(seat.credentials);
    expect(G).toEqual(before);
  });
  it('reprojects a god cache before rendering blind mode and retains public player state', () => {
    const G = fixture(); G.players['3'].broken = ['cart']; G.players['7'].trapped = true;
    const god = firewallObserverView(G, 'god'), before = structuredClone(god);
    expect(snapshot(god, 'god')).toContain('data-private-gold="true">123');
    const blind = snapshot(god, 'blind'); expect(blind).not.toContain('data-private-gold'); expect(blind).not.toContain('98761'); expect(blind).not.toContain('私人查驗紀錄');
    expect(blind).toContain('傳輸器 ×'); expect(blind).toContain('隔離監禁'); expect(blind).toContain('唯讀復盤'); expect(god).toEqual(before);
    expect(buttons(blind).some(button => /確認放置|執行核心探查|棄掉/.test(button))).toBe(false);
  });
  it('manual concealment removes the role, cards, memories and amount together', () => {
    const G = firewallPlayerView({ G: fixture(), playerID: '0' });
    const html = renderToStaticMarkup(createElement(FirewallLayout, { G, info, ownID: '0', nameOf, visible: false, onVisible: () => {} }));
    expect(html).toContain('身分、手牌與私人情報已遮住'); expect(html).not.toContain('data-private-gold'); expect(html).not.toContain('私人查驗紀錄'); expect(html).not.toContain('藍域滲透者'); expect(html).not.toContain('class="firewall-hand"');
  });
  it('keeps all turn choices and hand selection disabled while offline', () => {
    const html = board(fixture(), false), relevant = buttons(html).filter(button => /選擇連通線路|選擇核心探查|使用一張|棄牌換牌|解除效果/.test(button));
    expect(relevant.length).toBeGreaterThanOrEqual(5); expect(relevant.every(button => button.includes('disabled=""'))).toBe(true); expect(html).toContain('連線中斷');
  });
  it('does not offer card operations to an inactive or empty-handed seat', () => {
    const G = fixture(); G.activePlayer = '3'; expect(board(G)).toContain('等待目前操作者'); expect(board(G)).not.toContain('選擇回合行動');
    G.private['0'].hand = []; G.players['0'].handCount = 0; expect(board(G)).toContain('目前空手，暫時跳過');
  });
  it('explains impairment without preventing the legal action and discard modes', () => {
    const G = fixture(); G.players['0'].broken = ['pickaxe']; G.players['0'].trapped = true;
    const html = board(G); expect(html).toContain('目前不能放線路'); expect(html).toContain('解密器故障'); expect(html).toContain('隔離監禁'); expect(html).toContain('棄牌換牌'); expect(html).toContain('解除效果');
  });
  it('uses the phase acknowledgement in briefing and review, including already acknowledged seats', () => {
    const G = fixture(); G.status = 'briefing'; expect(board(G)).toContain('準備完成，開始滲透');
    G.status = 'review'; G.round = 3; expect(board(G)).toContain('確認結算，公開總分');
    G.players['0'].acknowledged = true; expect(buttons(board(G)).find(button => button.includes('已確認，等待其他人'))).toContain('disabled=""');
  });
  it('offers all theft victims without revealing which one has private assets', () => {
    const G = fixture(); G.status = 'theft'; G.activePlayer = '0';
    const html = board(G); expect(html).toContain('執行竊取後門'); expect(html).toContain('節點-3'); expect(html).toContain('節點-7'); expect(html).not.toContain('98761'); expect(buttons(html).find(button => button.includes('確認竊取目標'))).toContain('disabled=""');
  });
  it('shows final public totals and shared winners after the third review', () => {
    const G = fixture(); G.status = 'finished'; G.round = 3; G.winnerIDs = ['0', '7']; G.finalScores = { '0': 17, '3': 6, '7': 17 };
    const html = snapshot(G, 'blind'); expect(html).toContain('節點-0、節點-7贏得三輪滲透'); expect(html).toContain('總分'); expect(html).toContain('>17</b>'); expect(html).not.toContain('data-private-gold');
  });
  it('renders unknown goals identically even if an upstream object still contains secret geometry', () => {
    const G = fixture(), other = structuredClone(G); G.board[1].pathID = 'goal_gold'; G.board[1].rotation = 180; other.board[1].pathID = 'goal_stone_ne'; other.board[1].rotation = 0;
    const render = (state: FirewallState) => renderToStaticMarkup(createElement(FirewallNetwork, { tiles: state.board }));
    expect(render(G)).toEqual(render(other)); expect(render(G)).toContain('未知目標');
  });
  it('provides keyboard-ready placement targets and separately projected path previews', () => {
    const html = renderToStaticMarkup(createElement(FirewallNetwork, { tiles: fixture().board, placements: [{ x: 1, y: 0, rotation: 180 }], selected: { x: 1, y: 0 }, preview: { id: 'preview', kind: 'path', pathID: 'base_ns' }, rotation: 180 }));
    expect(html).toContain('aria-label="合法位置 1, 0"'); expect(html).toContain('tabindex="0"'); expect(html).toContain('data-selected="true"'); expect(html).toContain('rotate(180 50 75)'); expect(html).toContain('aria-label="放大網格"'); expect(html).toContain('適配全圖');
  });
  it('draws bridge, dead-end, ladder and door components without merging independent paths', () => {
    const bridge = FIREWALL_PATH_DEFINITIONS.find(path => 'feature' in path && path.feature === 'bridge')!;
    const bridgeHTML = renderToStaticMarkup(createElement(FirewallTopology, { path: bridge }));
    expect(bridgeHTML).toContain('data-bridge="separate-crossing"'); expect(bridgeHTML).toContain('data-components="NS|EW"');
    const dead = FIREWALL_PATH_DEFINITIONS.find(path => path.components.length === 4 && path.components.every(component => component.length === 1))!;
    expect(renderToStaticMarkup(createElement(FirewallTopology, { path: dead })).match(/data-dead-end=/g)).toHaveLength(4);
    const ladder = FIREWALL_PATH_DEFINITIONS.find(path => 'ladderComponent' in path && path.id.startsWith('exp_'))!;
    expect(renderToStaticMarkup(createElement(FirewallTopology, { path: ladder }))).toContain('data-ladder="true"');
    const door = FIREWALL_PATH_DEFINITIONS.find(path => 'door' in path)!;
    expect(renderToStaticMarkup(createElement(FirewallTopology, { path: door }))).toContain('data-door=');
  });
  it('maps every action to the intended illustrated subject, including repair pairs', () => {
    for (const action of Object.keys(FIREWALL_ACTIONS) as FirewallActionID[]) {
      const art = firewallActionArt(action); expect(art.length).toBe(FIREWALL_ACTIONS[action].tools.length === 2 ? 2 : 1);
      if (action.startsWith('repair_')) expect(art.every(key => key.startsWith('tools/'))).toBe(true);
      const html = renderToStaticMarkup(createElement(FirewallCardFace, { card: { id: 'card', kind: 'action', action } })); expect(html).toContain(FIREWALL_ACTIONS[action].name);
    }
    expect(firewallActionArt('freedom')).toEqual(['actions/free']); expect(firewallActionArt('change_roles')).toEqual(['actions/change-role']);
  });
  it('includes all chapters, six illustrated roles and all 42 route configurations', () => {
    const html = renderToStaticMarkup(createElement(FirewallRules)); for (const [id] of firewallChapters) expect(html).toContain(`id="${id}"`);
    for (const role of FIREWALL_ROLE_IDS) expect(html).toContain(`id="firewall-${role}"`);
    expect((html.match(/class="firewall-diagram"/g) ?? []).length).toBe(42); expect(html).toContain('118 張'); expect(html).toContain('兩種視角都看不到未來抽牌'); expect(html).toContain('共享勝利');
  });
});

describe('Firewall public poster and sound', () => {
  it('never reads private records, secret piles or premature final scores', () => {
    const G = fixture(); for (const property of ['private', 'secret', 'finalScores']) Object.defineProperty(G, property, { get: () => { throw new Error(`private read ${property}`); } });
    const model = buildFirewallPosterModel({ G, info, step: 1, totalSteps: 10 }); expect(model.players.every(player => player.score === null)).toBe(true); expect(model.tiles.filter(tile => tile.hidden).every(tile => tile.topology === null && tile.asset === 'card-back')).toBe(true);
  });
  it('is invariant to all hidden data and suppresses arbitrary log text and hostile names', () => {
    const G = fixture(), other = structuredClone(G); other.private['0'].gold = 88117; other.private['0'].role = 'saboteur'; other.secret!.goals['goal-top'] = 'goal_stone_es'; other.log[0].message = 'private-log-canary'; other.board[1].pathID = 'goal_gold';
    const options = { info, step: 1, totalSteps: 10 }; expect(buildFirewallPosterModel({ ...options, G })).toEqual(buildFirewallPosterModel({ ...options, G: other })); expect(firewallSoundAdapter(G, '0')).toEqual(firewallSoundAdapter(other, '0'));
    const model = buildFirewallPosterModel({ G: other, info: { ...info, players: [{ id: '0', name: '\u202e https://example.invalid/private', ready: true, isConnected: true }] }, step: -1, totalSteps: 0 });
    expect(JSON.stringify(model)).not.toMatch(/private-log-canary|example.invalid|\u202e/); expect(model.step).toBe(1);
  });
  it('exports public rotated topology once and permits legitimate final totals', () => {
    const G = fixture(); G.board.push({ id: 'rotated', kind: 'path', revealed: true, pathID: 'base_es', rotation: 180, x: 1, y: 0 }); G.status = 'finished'; G.finalScores = { '0': 5, '3': 9, '7': 9 }; G.winnerIDs = ['3', '7'];
    const model = buildFirewallPosterModel({ G, info, step: 10, totalSteps: 10 }); expect(model.tiles.at(-1)?.topology?.components).toEqual([['W', 'N']]); expect(model.players.map(player => player.score)).toEqual([5, 9, 9]); expect(model.winners).toEqual(['節點-3', '節點-7']);
  });
  it('cues only public turns and acknowledgement, with silent initial load and reconnect', () => {
    const G = fixture(), tracker = new GameSoundTracker(), input = () => ({ G: firewallSoundAdapter(G, '0'), matchID: 'firewall-sounds', playerID: '0' });
    expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false }); G.activePlayer = '3'; G.epoch++; tracker.update(input()); G.activePlayer = '0'; G.epoch++; expect(tracker.update(input()).ownTurn).toBe(true);
    expect(tracker.update({ ...input(), connected: false })).toEqual({ reveals: 0, ownTurn: false }); expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false });
    G.status = 'review'; G.phaseEpoch++; G.epoch++; expect(tracker.update(input()).ownTurn).toBe(true); G.players['0'].acknowledged = true; expect(firewallSoundAdapter(G, '0')?.attention).toBeUndefined();
  });
});
