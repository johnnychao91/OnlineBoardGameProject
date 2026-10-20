import type { StationState } from '../games/station/game';
import type { SnapshotProps } from './game-types';
import { Log, RuleSummary, roleNames } from './StationBoard';
import { MissionProgress, RoundRevealList, StationTable, TurnNotice } from './StationTable';
import { BattleReport } from './BattleReport';
import { possibleRoleCounts } from '../games/station/view-model';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';
import { stationSnapshotState } from './snapshot-view';

/** Read-only by construction: snapshots never receive a game client or move callbacks. */
export function StationSnapshot({ G: unknownState, info, perspective, replay = false }: SnapshotProps) {
  const G = stationSnapshotState(unknownState as StationState, perspective);
  const nameOf = (id: string) => info.players.find(p => String(p.id) === id)?.name || `隊員 ${Number(id) + 1}`;
  const playerIDs = Object.keys(G.players);
  const [selectedID, setSelectedID] = useInspectedPlayer(playerIDs);
  const inspected = perspective === 'god' ? G.private?.[selectedID] : undefined;
  const role = G.players[selectedID]?.revealedRole ?? inspected?.role;
  return <div className={`game-layout snapshot-layout station-live station-player-live station-snapshot ${replay ? 'station-snapshot-replay' : 'station-snapshot-live'} ${G.status === 'finished' ? 'station-finished' : ''}`}>
    <section className="game-main station-snapshot-main">
      <div className="game-title">
        <div><div className="eyebrow">{replay ? 'MISSION REPLAY' : 'OBSERVATION DECK'}</div><h1>太空維修站</h1></div>
        <span className="round-badge">第 <strong>{G.round || '—'}</strong> / 4 輪</span>
      </div>
      <MissionProgress G={G} numPlayers={info.numPlayers} />
      <TurnNotice G={G} nameOf={nameOf} replay={replay} />
      <StationTable G={G} nameOf={nameOf} god={perspective === 'god'} />
    </section>
    <aside className="station-personal-aside">
      <section className="panel private-panel snapshot-inspection">
        <div className="snapshot-inspection-heading"><h2>隊員資訊</h2><span>{perspective === 'god' ? '上帝視角' : '盲視角'}</span></div>
        <div className="private-content">
          <SnapshotPlayerSelect playerIDs={playerIDs} value={selectedID} onChange={setSelectedID} nameOf={nameOf} label="查看隊員資訊" />
          <div className={`role-card ${role ?? 'unrevealed'}`}>
            <span>{nameOf(selectedID)}的身分</span><strong>{role ? roleNames[role] : '尚未公開'}</strong>
            <div className="possible-roles"><span>本局可能的全場人數</span>
              {possibleRoleCounts(info.numPlayers, role).map(({ engineer, saboteur }) => <p key={`${engineer}-${saboteur}`}>
                <b>維修員 {engineer} 位</b><span>／</span><b className="role-saboteur">干擾者 {saboteur} 位</b>
              </p>)}
            </div>
          </div>
          {inspected ? <><p className="small muted">目前剩餘設備組成</p><div className="composition">
            <div><strong>{inspected.composition.stable}</strong><span>穩定設備</span></div>
            <div><strong className="mint">{inspected.composition.repair}</strong><span>維修模組</span></div>
            <div><strong className="card-kind-hazard">{inspected.composition.hazard}</strong><span>反應爐危機</span></div>
          </div></> : <p className="small muted">剩餘 {G.players[selectedID]?.cardCount ?? 0} 張未檢修設備。盲視角不顯示秘密組成。</p>}
          <p className="small muted snapshot-readonly-note">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 不占參與席位'}。切換隊員僅改變查看對象，不會操作牌桌。</p>
        </div>
      </section>
      {G.status === 'round-review' && <section className="panel round-review-confirmation">
        <h2>本輪牌桌暫時保留</h2>
        <p className="small muted">等待全體隊員確認後，進入下一輪。觀戰者無需確認。</p>
        <p className="small muted" role="status">{Object.values(G.players).filter(p => p.reviewAcknowledged).length} / {info.numPlayers} 位已確認</p>
      </section>}
    </aside>
    <aside className="game-aside">
      <RoundRevealList G={G} nameOf={nameOf} />
      <details className="panel station-log-details"><summary>全部任務紀錄</summary><Log G={G} nameOf={nameOf} /></details>
      {G.status === 'finished' && !replay && <details className="panel station-results-details"><summary>製作本局戰報圖</summary><BattleReport G={G} info={info} perspective={perspective} label="製作本局戰報圖" /></details>}
      <details className="panel rules-details"><summary>任務規則速查</summary><RuleSummary /></details>
    </aside>
  </div>;
}
