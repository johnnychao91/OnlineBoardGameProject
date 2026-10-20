import type { ComponentType } from 'react';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { StationGame } from '../games/station/game';
import { RuleSummary, StationBoard } from './StationBoard';
import { StationSnapshot } from './StationSnapshot';
import type { SnapshotProps } from './game-types';
import { CipherGame } from '../games/cipher/game';
import { CipherBoard, CipherRuleSummary } from './CipherBoard';
import { CipherSnapshot } from './CipherSnapshot';
import { Icon } from './ui';

function ConnectingGame() {
  return <main className="narrow"><section className="panel center" role="status" aria-live="polite"><span className="large-orbit"><Icon type="signal" size={38} /></span><h2>正在連線到遊戲伺服器…</h2><p className="muted">正在同步你的座位與最新對局，請稍候。</p><p className="small muted">若持續停在這裡，請確認網路連線，並請房主檢查遊戲伺服器是否正常運作。保留此頁面，連線恢復後會自動繼續。</p></section></main>;
}

const StationClient = Client({ game: StationGame, board: StationBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: window.location.origin }), debug: false });
const CipherClient = Client({ game: CipherGame, board: CipherBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: window.location.origin }), debug: false });

export interface ClientGameDefinition {
  PlayerClient: ComponentType<{ matchID: string; playerID: string; credentials: string }>;
  /** A separate read-only renderer is used for live observation and historical replay. */
  Snapshot: ComponentType<SnapshotProps>;
  Rules?: ComponentType;
  lobbyTitle?: string;
  lobbyDescription?: string;
  factionLabels: Record<string, string>;
  reasonLabels: Record<string, string>;
  /** Cooperative games have one player team, including when the mission fails. */
  cooperative?: boolean;
  resultLabels?: Record<string, string>;
}

/** Add each game's player client, snapshot renderer and statistics labels together. */
export const clientGames: Record<string, ClientGameDefinition> = {
  'space-station': {
    PlayerClient: props => <StationClient {...props} />,
    Snapshot: StationSnapshot,
    Rules: RuleSummary,
    lobbyTitle: '這裡，每個人都有秘密。',
    lobbyDescription: '維修員要找齊維修模組；干擾者要讓反應爐危機被揭開，或讓維修拖過第四輪。',
    factionLabels: { engineer: '維修員', saboteur: '干擾者' },
    reasonLabels: { 'all-repairs': '完成全部維修', hazard: '揭開反應爐危機', 'round-limit': '四輪時間用盡' },
  },
  'encrypted-call': {
    PlayerClient: props => <CipherClient {...props} />,
    Snapshot: CipherSnapshot,
    Rules: CipherRuleSummary,
    lobbyTitle: '保持沉默，接通同一個頻率。',
    lobbyDescription: '所有人都是友方特務。不能透露訊號數字、打暗號或約定節奏，靠默契由小到大傳送。',
    cooperative: true,
    factionLabels: { agents: '特務小隊' },
    resultLabels: { agents: '全隊任務成功', intercepted: '全隊任務失敗' },
    reasonLabels: { 'all-levels': '所有頻段完成同步', 'cover-blown': '掩護耗盡，通訊遭到攔截' },
  },
};

export function gameResultLabel(gameID: string, winner?: string) {
  const definition = clientGames[gameID];
  if (!winner) return '任務完成';
  return definition?.resultLabels?.[winner] ?? `${definition?.factionLabels[winner] ?? winner}陣營獲勝`;
}
