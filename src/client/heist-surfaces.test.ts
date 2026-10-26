import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from 'boardgame.io/internal';
import { describe, expect, it } from 'vitest';
import { HeistGame, heistObserverView, heistPlayerView, type HeistState } from '../games/heist/game';
import { HEIST_ARTIFACT_IDS, HEIST_HAZARD_IDS, HEIST_ARTIFACTS } from '../games/heist/content';
import { HeistBoard, HeistDecision, HeistLayout, HeistSnapshot } from './HeistBoard';
import { HeistRules, heistChapters } from './HeistRules';
import { buildHeistPosterModel } from './heist-poster';
import { heistSoundAdapter } from './heist-sounds';
import { GameSoundTracker } from './sound-cues';
import { RoomContext } from './room-context';
import type { RoomInfo } from './api';

const info: RoomInfo = { roomId: 'test-heist-room', matchID: 'test-heist-match', gameName: 'curtain-heist', status: 'decision', numPlayers: 3, minPlayers: 3, maxPlayers: 8, spectatorCount: 1, godViewAllowed: true, players: ['0', '3', '7'].map(id => ({ id, name: `成員-${id}`, isConnected: true, ready: true })) };
const seat = { ...info, access: 'player' as const, playerID: '0', credentials: 'test-heist-private-credential' };
const nameOf = (id: string) => `成員-${id}`;
function fixture(): HeistState {
  const match = createMatch({ game: HeistGame, numPlayers: 3, setupData: { startImmediately: true, participantIDs: ['0', '3', '7'] }, unlisted: true });
  if ('setupDataError' in match) throw new Error(match.setupDataError);
  const G = structuredClone(match.initialState.G) as HeistState;
  G.status = 'decision'; G.round = 2; G.step = 3; G.epoch = 11; G.phaseEpoch = 9;
  G.path = [{ kind: 'loot', value: 11 }, { kind: 'artifact', artifact: 'moon-watch' }, { kind: 'hazard', hazard: 'camera' }];
  G.availableArtifacts = ['moon-watch']; G.leftovers = 2;
  for (const player of Object.values(G.players)) { player.exploring = true; player.carried = 3; player.submitted = false; }
  G.private['0'] = { banked: 123, choice: null }; G.private['3'] = { banked: 98761, choice: 'exit' }; G.players['3'].submitted = true;
  G.secret!.deck = [{ kind: 'loot', value: 98765 }];
  G.log = [{ type: 'round-start', round: 2, step: 0, message: '本幕開始', artifact: 'moon-watch' }, { type: 'reveal', round: 2, step: 3, message: '警戒已揭開', card: { kind: 'hazard', hazard: 'camera' } }];
  return G;
}
const board = (G: HeistState, connected = true) => renderToStaticMarkup(createElement(RoomContext.Provider, { value: { seat, info, inviteUrl: '', setInviteUrl: () => {} } }, createElement(HeistBoard, { G, playerID: '0', isConnected: connected, moves: {} })));
const snapshot = (G: HeistState, perspective: 'blind' | 'god') => renderToStaticMarkup(createElement(HeistSnapshot, { G, info, perspective, replay: true }));
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);

describe('Curtain Heist player, snapshot and rule surfaces', () => {
  it('renders only the player vault and public path, never a future card or another sealed choice', () => {
    const G = fixture(), before = structuredClone(G), html = board(G);
    expect(html).toContain('data-private-bank="true">123'); expect(html).toContain('1 / 3 位已密封決定');
    expect(html).not.toContain('98761'); expect(html).not.toContain('98765'); expect(html).not.toContain('你的選擇：撤退'); expect(html).not.toContain(seat.credentials);
    const route = html.split('class="heist-path"')[1].split('</details>')[0];
    expect((route.match(/class="heist-card"/g) ?? []).length).toBe(3); expect(G).toEqual(before);
  });
  it('reprojects a cached god snapshot before showing blind mode and preserves input', () => {
    const god = heistObserverView(fixture(), 'god'), before = structuredClone(god);
    expect(snapshot(god, 'god')).toContain('data-private-bank="true">123');
    const blind = snapshot(god, 'blind');
    expect(blind).not.toContain('data-private-bank'); expect(blind).not.toContain('98761'); expect(blind).not.toContain('98765');
    expect(blind).toContain('目前視角不可查看私人金庫'); expect(blind).toContain('唯讀復盤'); expect(blind).not.toContain('密封決定</button>'); expect(god).toEqual(before);
  });
  it('shows no unpublicized choice even to an authorized god observer', () => {
    const G = fixture(); G.private['0'].choice = 'explore'; G.players['0'].submitted = true;
    const html = snapshot(G, 'god');
    expect(html).toContain('data-private-bank="true">123'); expect(html).not.toContain('你的選擇：深入'); expect(html).not.toContain('你的選擇：撤退'); expect(html).not.toContain('密封決定</button>');
  });
  it('lets only the submitting player read their sealed action until batch resolution', () => {
    const G = fixture(); G.private['0'].choice = 'explore'; G.players['0'].submitted = true;
    const html = board(G); expect(html).toContain('你的選擇：深入'); expect(html).toContain('決定已密封'); expect(html).not.toContain('你的選擇：撤退');
    expect(buttons(html).some(button => button.includes('密封決定'))).toBe(false);
  });
  it('manually conceals all private amounts without concealing public carried loot', () => {
    const G = heistPlayerView({ G: fixture(), playerID: '0' });
    const html = renderToStaticMarkup(createElement(HeistLayout, { G, info, ownID: '0', nameOf, visible: false, onVisible: () => {} }));
    expect(html).toContain('金庫與密封選擇已遮住'); expect(html).not.toContain('data-private-bank'); expect(html).not.toContain('>123<'); expect(html).toContain('隨身');
  });
  it('requires an explicit selection before sealing and disables both choices while offline', () => {
    const G = fixture(), html = renderToStaticMarkup(createElement(HeistDecision, { G, id: '0', disabled: false, onSubmit: () => {} }));
    expect(html).toContain('繼續深入'); expect(html).toContain('撤退入庫'); expect(html).toContain('還能帶走 1 件珍藏，共 7 點');
    expect(buttons(html).find(button => button.includes('密封決定'))).toContain('disabled=""');
    const offline = buttons(board(G, false)).filter(button => ['繼續深入', '撤退入庫', '密封決定'].some(label => button.includes(label)));
    expect(offline.length).toBe(3); expect(offline.every(button => button.includes('disabled=""'))).toBe(true);
  });
  it('keeps evacuated players out of decisions and still includes them in round review', () => {
    const G = fixture(); G.players['0'].exploring = false;
    expect(board(G)).toContain('這一幕不再參與決策'); expect(board(G)).not.toContain('密封決定</button>');
    G.status = 'review'; G.roundResult = { round: 2, reason: 'all-exited', hazard: null, escaped: ['0', '3', '7'], lost: {}, discardedArtifacts: [], discardedLeftovers: 1 };
    const html = board(G); expect(html).toContain('確認結果，準備下一幕'); expect(html).toContain('路上剩餘 1 點歸回供應');
    G.players['0'].acknowledged = true; expect(buttons(board(G)).find(button => button.includes('已確認，等待其他成員'))).toContain('disabled=""');
  });
  it('explains disaster losses and discarded artifacts without publishing banks', () => {
    const G = fixture(); G.status = 'review'; G.roundResult = { round: 2, reason: 'hazard', hazard: 'camera', escaped: ['7'], lost: { '0': 8, '3': 6 }, discardedArtifacts: ['moon-watch'], discardedLeftovers: 2 }; G.discardedArtifacts = ['moon-watch']; G.availableArtifacts = [];
    const html = snapshot(G, 'blind'); expect(html).toContain('監視鏡頭觸發封鎖'); expect(html).toContain('成員-0失去本幕隨身的'); expect(html).toContain('月相懷錶'); expect(html).not.toContain('data-private-bank');
  });
  it('publishes resolved simultaneous choices but never labels another pending choice', () => {
    const G = fixture(); G.lastDecision = { round: 2, step: 2, choices: { '0': 'explore', '3': 'explore', '7': 'exit' }, exited: ['7'], continued: ['0', '3'], returns: [{ playerID: '7', carried: 4, pathShare: 2, bankedDelta: 6, artifacts: [] }] };
    const html = snapshot(G, 'blind'); expect(html).toContain('上一批公開決定'); expect(html).toContain('成員-7'); expect(html).toContain('存入 6 點'); expect(html).not.toContain('你的選擇：撤退');
  });
  it('reveals final score breakdown only after the fifth review completes, including shared winners', () => {
    const G = fixture(); G.round = 5; G.status = 'review';
    expect(board(G)).toContain('確認結果，公開總分'); expect(snapshot(G, 'blind')).not.toContain('五幕財富總帳');
    G.status = 'finished'; G.winnerIDs = ['0', '7']; G.finalScores = { '0': { banked: 20, artifactValue: 12, artifactCount: 1, total: 32 }, '3': { banked: 12, artifactValue: 0, artifactCount: 0, total: 12 }, '7': { banked: 27, artifactValue: 5, artifactCount: 1, total: 32 } };
    const html = snapshot(G, 'blind'); expect(html).toContain('成員-0、成員-7贏得謝幕劫案'); expect(html).toContain('五幕財富總帳'); expect(html).toContain('data-private-bank="true">20'); expect(html).toContain('件數');
  });
  it('offers all chapters, fifteen original illustrated references and exact base values', () => {
    const html = renderToStaticMarkup(createElement(HeistRules));
    for (const [chapter] of heistChapters) expect(html).toContain(`id="${chapter}"`);
    for (const id of [...HEIST_ARTIFACT_IDS, ...HEIST_HAZARD_IDS, 'loot-a', 'loot-b', 'bank', 'decision-explore', 'decision-exit']) expect(html).toContain(`id="heist-${id}"`);
    expect(html).toContain('1、2、3、4、5、5、7、7、9、11、11、13、14、15、17'); expect(html).toContain('5、7、8、10、12');
    expect(html).toContain('只有第二張'); expect(html).toContain('共享勝利'); expect(html).toContain('沒有行動倒數');
  });
});

describe('Curtain Heist public poster and sound boundaries', () => {
  it('never reads private records or final scores before the end, even with poisoned getters', () => {
    const G = fixture();
    for (const property of ['private', 'secret', 'finalScores', 'lastDecision']) Object.defineProperty(G, property, { get: () => { throw new Error(`private read: ${property}`); } });
    const model = buildHeistPosterModel({ G, info, step: 1, totalSteps: 9 });
    expect(model.players.every(player => player.banked === null && player.total === null)).toBe(true); expect(model.path).toHaveLength(3);
    expect(JSON.stringify(model)).not.toContain('98761'); expect(JSON.stringify(model)).not.toContain('98765');
  });
  it('uses identical poster and sound state for different secret decisions and vaults', () => {
    const G = fixture(), other = structuredClone(G); other.private['0'].banked = 99887; other.private['3'].choice = 'explore'; other.secret!.deck = [{ kind: 'hazard', hazard: 'alarm' }];
    const options = { info, step: 1, totalSteps: 5 };
    expect(buildHeistPosterModel({ ...options, G })).toEqual(buildHeistPosterModel({ ...options, G: other }));
    expect(heistSoundAdapter(G, '0')).toEqual(heistSoundAdapter(other, '0'));
  });
  it('includes legitimate public endgame totals and artifact identities', () => {
    const G = fixture(); G.status = 'finished'; G.winnerIDs = ['0']; G.players['0'].artifacts = ['prism-heart']; G.finalScores = { '0': { banked: 25, artifactValue: 12, artifactCount: 1, total: 37 } };
    const model = buildHeistPosterModel({ G, info, step: 99, totalSteps: 100 });
    expect(model.players[0]).toMatchObject({ banked: 25, total: 37, winner: true }); expect(model.players[0].artifacts[0].name).toBe(HEIST_ARTIFACTS['prism-heart'].name);
  });
  it('sanitizes player names and ignores arbitrary log message contents in the PNG model', () => {
    const G = fixture(); G.log[0].message = 'secret-canary-never-export';
    const model = buildHeistPosterModel({ G, info: { ...info, players: [{ id: '0', name: '成員\u202e https://example.invalid/secret', isConnected: true, ready: true }] }, step: -1, totalSteps: 0 });
    expect(JSON.stringify(model)).not.toContain('secret-canary'); expect(JSON.stringify(model)).not.toContain('example.invalid'); expect(JSON.stringify(model)).not.toContain('\u202e'); expect(model.step).toBe(1);
  });
  it('does not sound another submission, but cues the next public decision batch and silences reconnect', () => {
    const G = fixture(), tracker = new GameSoundTracker(), input = () => ({ G: heistSoundAdapter(G, '0'), matchID: 'test', playerID: '0' });
    expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false });
    G.epoch++; G.players['7'].submitted = true; expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false });
    G.epoch++; G.phaseEpoch = G.epoch; expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: true });
    expect(tracker.update({ ...input(), connected: false })).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: false });
    G.players['0'].exploring = false; expect(heistSoundAdapter(G, '0')?.attention).toBeUndefined();
    G.status = 'review'; G.phaseEpoch++; expect(tracker.update(input())).toEqual({ reveals: 0, ownTurn: true });
  });
});
