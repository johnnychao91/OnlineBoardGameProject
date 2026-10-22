import type { ComponentType } from 'react';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { StationGame, type StationObserverState } from '../games/station/game';
import { RuleSummary, StationBoard } from './StationBoard';
import { StationSnapshot } from './StationSnapshot';
import type { SnapshotProps, PosterOptions, LobbyOptionsProps } from './game-types';
import { CipherGame, type CipherState } from '../games/cipher/game';
import { CipherBoard, CipherRuleSummary } from './CipherBoard';
import { CipherSnapshot } from './CipherSnapshot';
import { Icon } from './ui';
import { gameCatalog, type GameID } from '../games/catalog';
import { FogGame, type FogState } from '../games/fog/game';
import { FogBoard } from './FogBoard';
import { FogSnapshot } from './FogSnapshot';
import { FogRules } from './FogRules';
import { FogOptions } from './FogOptions';
import { createFogPoster } from './fog-poster';
import { MoonGame, type MoonState } from '../games/moon/game';
import { MoonBoard } from './MoonBoard';
import { MoonSnapshot } from './MoonSnapshot';
import { MoonRules } from './MoonRules';
import { MoonOptions } from './MoonOptions';
import { normalizeMoonOptions, validateMoonOptions } from '../games/moon/rules';
import { createMoonPoster } from './moon-poster';
import { createReplayPoster } from './replay-poster';
import { createCipherPoster } from './cipher-poster';
import { StationRules, CipherRules } from './game-rules';
import type { SoundAdapter } from './sound-cues';

function ConnectingGame() {
  return <main className="narrow"><section className="panel center" role="status" aria-live="polite"><span className="large-orbit"><Icon type="signal" size={38} /></span><h2>正在連線到遊戲伺服器…</h2><p className="muted">正在同步你的座位與最新對局，請稍候。</p><p className="small muted">若持續停在這裡，請確認網路連線，並請房主檢查遊戲伺服器是否正常運作。保留此頁面，連線恢復後會自動繼續。</p></section></main>;
}

const StationClient = Client({ game: StationGame, board: StationBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const CipherClient = Client({ game: CipherGame, board: CipherBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const FogClient = Client({ game: FogGame, board: FogBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const MoonClient = Client({ game: MoonGame, board: MoonBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });

export interface ClientGameDefinition {
  name: string;
  PlayerClient: ComponentType<{ matchID: string; playerID: string; credentials: string }>;
  /** A separate read-only renderer is used for live observation and historical replay. */
  Snapshot: ComponentType<SnapshotProps>;
  Rules?: ComponentType;
  DetailedRules: ComponentType;
  chapters: readonly (readonly [string, string])[];
  createPoster: (options: PosterOptions) => Promise<Blob>;
  soundAdapter: SoundAdapter;
  LobbyOptions?: ComponentType<LobbyOptionsProps>;
  validateLobby?: (options: unknown, count: number) => string | undefined;
  lobbyTitle?: string;
  lobbyDescription?: string;
  factionLabels: Record<string, string>;
  reasonLabels: Record<string, string>;
  /** Cooperative games have one player team, including when the mission fails. */
  cooperative?: boolean;
  resultLabels?: Record<string, string>;
}

/** Add each game's player client, snapshot renderer and statistics labels together. */
export const clientGames: Record<GameID, ClientGameDefinition> & Record<string, ClientGameDefinition> = {
  'silver-moon': {
    name: gameCatalog['silver-moon'].name,
    PlayerClient: props => <MoonClient {...props} />,
    Snapshot: MoonSnapshot, DetailedRules: MoonRules, LobbyOptions: MoonOptions,
    validateLobby: (options, count) => { try { return validateMoonOptions(normalizeMoonOptions(options), count); } catch (error) { return (error as Error).message; } },
    Rules: () => <p>狼人夜間秘密選擇襲擊目標，神職依序行動；白天依發言倒數討論並投票放逐。房主可選擇警長規則與現場輔助模式，夜間每個人都有不影響結果的掩護操作。</p>,
    chapters: [['setup', '人數與模式'], ['roles', '角色與技能'], ['night', '夜間與掩護'], ['day', '發言與放逐'], ['sheriff', '警長規則'], ['end', '勝負與復盤']],
    createPoster: ({ G, info, step, totalSteps }) => createMoonPoster({ G: G as MoonState, players: info.players, step, totalSteps }),
    // Night sounds are identical for all roles. Never cue a private skill or result.
    soundAdapter: (G: MoonState) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.map(entry => JSON.stringify(entry)) }),
    lobbyTitle: '下一站，誰能平安抵達？',
    lobbyDescription: gameCatalog['silver-moon'].description,
    factionLabels: { town: '好人', wolves: '狼人' },
    reasonLabels: { 'wolves-eliminated': '狼人全數離場', 'wolves-dominate': '狼人數量達到或超過其餘乘客', 'town-eliminated': '全部好人離場', 'villagers-eliminated': '全部村民離場', 'specials-eliminated': '全部神職離場', 'mutual-elimination': '雙方全數離場' },
    resultLabels: { town: '好人獲勝', wolves: '狼人獲勝', draw: '平局' },
  },
  'space-station': {
    name: '太空維修站',
    PlayerClient: props => <StationClient {...props} />,
    Snapshot: StationSnapshot,
    Rules: RuleSummary,
    DetailedRules: StationRules,
    chapters: [['setup', '人數與配置'], ['goals', '陣營與勝負'], ['round', '每輪流程'], ['inspect', '如何檢修'], ['review', '換輪與結束']],
    createPoster: ({ G, info, step, totalSteps }) => createReplayPoster({ G: G as StationObserverState, players: info.players, step, totalSteps }),
    soundAdapter: (G, id) => ({ revision: G.round * 1000 + G.log.length, events: G.log.map((entry: unknown) => JSON.stringify(entry)),
      attention: id && G.status === 'playing' && G.activePlayer === id ? `${G.round}:${G.log.length}:${id}` : undefined }),
    lobbyTitle: '這裡，每個人都有秘密。',
    lobbyDescription: '維修員要找齊維修模組；干擾者要讓反應爐危機被揭開，或讓維修拖過第四輪。',
    factionLabels: { engineer: '維修員', saboteur: '干擾者' },
    reasonLabels: { 'all-repairs': '完成全部維修', hazard: '揭開反應爐危機', 'round-limit': '四輪時間用盡' },
  },
  'encrypted-call': {
    name: '加密通話',
    PlayerClient: props => <CipherClient {...props} />,
    Snapshot: CipherSnapshot,
    Rules: CipherRuleSummary,
    DetailedRules: CipherRules,
    chapters: [['setup', '人數與配牌'], ['silence', '通訊限制'], ['transmit', '同步與傳送'], ['mistakes', '順序錯誤'], ['pulse', '靜默脈衝'], ['levels', '進階與補給']],
    createPoster: ({ G, info, step, totalSteps }) => createCipherPoster({ G: G as CipherState, players: info.players, step, totalSteps }),
    // No ticking or transmission cue: audio must not become a timing guide.
    soundAdapter: (G: CipherState, id) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.filter(entry => entry.type === 'level-complete').map(entry => JSON.stringify(entry)),
      attention: id && G.players[id] && G.status === 'syncing' && !G.players[id].acknowledged ? `${G.level}:${G.epoch}:sync` : undefined }),
    lobbyTitle: '保持沉默，接通同一個頻率。',
    lobbyDescription: '所有人都是友方特務。不能透露訊號數字、打暗號或約定節奏，靠默契由小到大傳送。',
    cooperative: true,
    factionLabels: { agents: '特務小隊' },
    resultLabels: { agents: '全隊任務成功', intercepted: '全隊任務失敗' },
    reasonLabels: { 'all-levels': '所有頻段完成同步', 'cover-blown': '掩護耗盡，通訊遭到攔截' },
  },
  'black-fog': {
    name: gameCatalog['black-fog'].name,
    PlayerClient: props => <FogClient {...props} />,
    Snapshot: FogSnapshot, DetailedRules: FogRules, LobbyOptions: FogOptions,
    Rules: () => <p>輪流組隊前往城郊燈塔，全員表決後由隊員秘密執行任務。守夜騎士要完成三次任務並保住梅林，黑霧使徒則要破壞任務或找出梅林。兩位蘭斯洛特可能隨詛咒之鐘交換陣營。</p>,
    chapters: [['setup', '人數與配置'], ['roles', '角色與情報'], ['flow', '組隊、表決與任務'], ['bell', '詛咒之鐘'], ['end', '勝敗與刺殺']],
    createPoster: ({ G, info, step, totalSteps }) => createFogPoster({ G: G as FogState, players: info.players, step, totalSteps }),
    soundAdapter: (G: FogState, id) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.filter(entry => ['vote', 'quest', 'bell', 'finish'].includes(entry.type)).map(entry => JSON.stringify(entry)),
      attention: id && ((G.status === 'nomination' && G.leaderID === id)
        || (G.status === 'assassination' && G.private?.[id]?.role === 'assassin')) ? `${G.epoch}:${G.status}:${id}` : undefined }),
    lobbyTitle: '誰會帶隊點亮下一座燈塔？',
    lobbyDescription: gameCatalog['black-fog'].description,
    factionLabels: { knights: '守夜騎士', apostles: '黑霧使徒' },
    reasonLabels: { 'three-fails': '三次燈塔任務失敗', 'five-rejections': '連續五次否決組隊', 'merlin-found': '刺客找出梅林', 'merlin-safe': '點亮三座燈塔並保住梅林' },
  },
};

export function gameResultLabel(gameID: string, winner?: string) {
  const definition = clientGames[gameID];
  if (!winner) return '任務完成';
  return definition?.resultLabels?.[winner] ?? `${definition?.factionLabels[winner] ?? winner}陣營獲勝`;
}
