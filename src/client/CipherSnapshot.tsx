import type { CipherState } from '../games/cipher/game';
import type { SnapshotProps } from './game-types';
import { BattleReport } from './BattleReport';
import { CipherAgents, CipherCardNumber, CipherHeading, CipherLog, CipherMetrics, CipherRuleSummary, CipherStatus, CipherTransmission } from './CipherBoard';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';
import { cipherSnapshotState } from './snapshot-view';
import './cipher.css';

/** Observers and replay viewers receive no game client or move callbacks. */
export function CipherSnapshot({ G: unknownState, info, perspective, replay = false }: SnapshotProps) {
  const G = cipherSnapshotState(unknownState as CipherState, perspective);
  const nameOf = (id: string) => info.players.find(p => String(p.id) === id)?.name || `特務 ${Number(id) + 1}`;
  const playerIDs = Object.keys(G.players);
  const [selectedID, setSelectedID] = useInspectedPlayer(playerIDs);
  const cards = perspective === 'god' ? G.private?.[selectedID]?.cards : undefined;
  const count = G.players[selectedID]?.cardCount ?? 0;
  return <div className="game-layout snapshot-layout cipher-layout cipher-snapshot">
    <section className="game-main">
      <CipherHeading G={G} />
      <CipherMetrics G={G} />
      <CipherStatus G={G} />
      <section className="panel cipher-hand snapshot-inspection">
        <div className="section-heading"><div><div className="eyebrow">READ ONLY SIGNALS</div><h2>特務訊號牌</h2></div><span>{perspective === 'god' ? '上帝視角' : '盲視角'}</span></div>
        <SnapshotPlayerSelect playerIDs={playerIDs} value={selectedID} onChange={setSelectedID} nameOf={nameOf} label="查看特務手牌" />
        {count > 0 ? <div className="cipher-hand-cards" aria-label={`${nameOf(selectedID)}的${cards ? '訊號牌，由小到大' : '未公開訊號牌'}`}>
          {(cards ?? Array<null>(count).fill(null)).map((card, index) => <div key={index} className={`cipher-card ${card === null ? 'cipher-card-back' : ''}`}>
            <span className="cipher-card-mark">SIGNAL</span><CipherCardNumber value={card} /><span className="cipher-card-caption">{card === null ? '未公開' : '唯讀'}</span>
          </div>)}
        </div> : <div className="cipher-concealed"><p>這位特務已無剩餘訊號牌</p><span>公開傳送與棄牌可在通話紀錄查看。</span></div>}
        <p className="small muted cipher-hand-note">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 不占特務名額'}。{cards ? '切換特務可查看各自手牌，無法傳送訊號。' : '只顯示公開張數，不透露數字。'}</p>
      </section>
      <div className="cipher-tools snapshot-readonly-note"><p className="small muted">{G.status === 'pulse' ? '正在等待全體特務決定是否發動靜默脈衝。' : G.status === 'syncing' || G.status === 'intermission' ? `等待確認：${Object.values(G.players).filter(p => p.acknowledged).length} / ${playerIDs.length} 位特務已確認。` : '請保持靜默，不提示牌面或傳送時機。'}</p></div>
      <CipherTransmission G={G} />
      <CipherAgents G={G} nameOf={nameOf} />
    </section>
    <aside className="game-aside"><CipherLog G={G} nameOf={nameOf} />
      {G.status === 'finished' && !replay && <details className="panel rules-details"><summary>製作本局任務戰報</summary><BattleReport G={G} info={info} perspective={perspective} label="製作本局任務戰報" /></details>}
      <details className="panel rules-details cipher-rules"><summary>通話守則與補給速查</summary><CipherRuleSummary /></details>
    </aside>
  </div>;
}
