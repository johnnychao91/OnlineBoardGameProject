import type { StationState } from '../games/station/game';
import type { SnapshotProps } from './game-types';
import { Log } from './StationBoard';
import { MissionProgress, RoundRevealList, StationTable, TurnNotice } from './StationTable';
import { BattleReport } from './BattleReport';

/** Read-only by construction: snapshots never receive a game client or move callbacks. */
export function StationSnapshot({ G: unknownState, info, perspective, replay = false }: SnapshotProps) {
  const G = unknownState as StationState;
  const nameOf = (id: string) => info.players.find(p => String(p.id) === id)?.name || `隊員 ${Number(id) + 1}`;
  return <div className={`snapshot-layout station-snapshot ${replay ? 'station-snapshot-replay' : 'station-snapshot-live'}`}>
    <section className="station-snapshot-main">
      <div className="game-title">
        <div><div className="eyebrow">{replay ? 'MISSION REPLAY' : 'OBSERVATION DECK'}</div><h1>太空維修站</h1></div>
        <span className="round-badge">第 <strong>{G.round || '—'}</strong> / 4 輪</span>
      </div>
      <MissionProgress G={G} numPlayers={info.numPlayers} />
      <TurnNotice G={G} nameOf={nameOf} replay={replay} />
      <p className="small muted station-view-label">{replay ? '這是歷史畫面，不會改變線上對局。'
        : '你正在觀戰，不占玩家座位，也無法操作設備。'} · {perspective === 'god' ? '上帝視角' : '盲視角'}</p>
      <StationTable G={G} nameOf={nameOf} god={perspective === 'god'} />
    </section>
    <aside>
      {G.status === 'round-review' && <section className="panel round-review-confirmation">
        <h2>本輪牌桌暫時保留</h2>
        <p className="small muted">等待全體隊員確認後，進入下一輪。觀戰者無需確認。</p>
        <p className="small muted" role="status">{Object.values(G.players).filter(p => p.reviewAcknowledged).length} / {info.numPlayers} 位已確認</p>
      </section>}
      <RoundRevealList G={G} nameOf={nameOf} />
      <details className="panel station-log-details"><summary>全部任務紀錄</summary><Log G={G} nameOf={nameOf} /></details>
      {G.status === 'finished' && !replay && <details className="panel station-results-details"><summary>製作本局戰報圖</summary><BattleReport G={G} info={info} perspective={perspective} label="製作本局戰報圖" /></details>}
    </aside>
  </div>;
}
