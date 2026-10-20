import type { StationState } from '../games/station/game';
import type { Perspective, RoomInfo } from './api';
import { Log } from './StationBoard';
import { MissionProgress, roleNames, StationTable, TurnNotice } from './StationTable';
import { BattleReport } from './BattleReport';

export interface SnapshotProps { G: unknown; info: RoomInfo; perspective: Perspective; replay?: boolean; }

/** Read-only by construction: snapshots never receive a game client or move callbacks. */
export function StationSnapshot({ G: unknownState, info, perspective, replay = false }: SnapshotProps) {
  const G = unknownState as StationState;
  const nameOf = (id: string) => info.players.find(p => String(p.id) === id)?.name || `隊員 ${Number(id) + 1}`;
  return <div className="snapshot-layout">
    <section>
      <div className="game-title">
        <div><div className="eyebrow">{replay ? 'MISSION REPLAY' : 'OBSERVATION DECK'}</div><h1>太空維修站</h1></div>
        <span className="round-badge">第 <strong>{G.round || '—'}</strong> / 4 輪</span>
      </div>
      <MissionProgress G={G} numPlayers={info.numPlayers} />
      {G.status === 'finished' ? <section className="panel snapshot-result">
        <div className="eyebrow">MISSION COMPLETE</div>
        <h2>{G.winner ? roleNames[G.winner] : '任務'}陣營獲勝</h2>
        <p className="muted">{G.winReason === 'all-repairs' ? '所有維修模組都已找出。'
          : G.winReason === 'hazard' ? '反應爐危機被揭開。' : '四輪結束，仍有維修模組沒有找到。'}</p>
      </section> : <TurnNotice G={G} nameOf={nameOf} />}
      <p className="small muted">{replay ? '這是歷史畫面，不會改變線上對局。'
        : '你正在觀戰，不占玩家座位，也無法操作設備。'} · {perspective === 'god' ? '上帝視角' : '盲視角'}</p>
      <StationTable G={G} nameOf={nameOf} god={perspective === 'god'} />
      {G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective={perspective} label="製作本局戰報圖" />}
    </section>
    <aside><Log G={G} nameOf={nameOf} /></aside>
  </div>;
}
