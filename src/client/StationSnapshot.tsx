import type { StationState } from '../games/station/game';
import type { Perspective, RoomInfo } from './api';
import { cardNames, initials, Log, roleNames } from './StationBoard';
import { Icon } from './ui';
import { BattleReport } from './BattleReport';

export interface SnapshotProps { G: unknown; info: RoomInfo; perspective: Perspective; replay?: boolean; }

/** Read-only by construction: snapshots never receive a game client or move callbacks. */
export function StationSnapshot({ G: unknownState, info, perspective, replay = false }: SnapshotProps) {
  const G = unknownState as StationState;
  const nameOf = (id: string) => info.players.find(p => String(p.id) === id)?.name || `隊員 ${Number(id) + 1}`;
  const isGod = perspective === 'god';
  const status = { lobby: '隊員集合', briefing: '全員確認設備資訊', playing: '任務進行中', finished: '任務結束' }[G.status];
  return <div className="snapshot-layout"><section>
    <div className="game-title"><div><div className="eyebrow">{replay ? 'MISSION REPLAY' : 'OBSERVATION DECK'}</div><h1>太空維修站</h1></div><span className="round-badge">第 <strong>{G.round || '—'}</strong> / 4 輪</span></div>
    <section className="mission-progress"><div><span>已完成維修</span><strong>{G.repairsFound}<small> / {G.repairsRequired}</small></strong></div><div className="progress-track" role="progressbar" aria-label="完成維修" aria-valuenow={G.repairsFound} aria-valuemin={0} aria-valuemax={G.repairsRequired || info.numPlayers}><span style={{ width: `${G.repairsFound / Math.max(1, G.repairsRequired) * 100}%` }} /></div><p>{status} · 本輪已揭開 {G.revealsThisRound} / {info.numPlayers} 張</p></section>
    {G.status === 'finished' ? <section className="panel snapshot-result"><div className="eyebrow">MISSION COMPLETE</div><h2>{G.winner ? roleNames[G.winner] : '任務'}陣營獲勝</h2><p className="muted">{G.winReason === 'all-repairs' ? '所有維修模組都已找出。' : G.winReason === 'hazard' ? '反應爐危機被揭開。' : '四輪結束，仍有維修模組沒有找到。'}</p></section> : <div className="turn-notice"><Icon type="signal" /><div><strong>{G.status === 'briefing' ? '等待隊員確認資訊' : G.activePlayer !== null ? `${nameOf(G.activePlayer)} 正在選擇` : status}</strong><p>{replay ? '這是歷史畫面，不會改變線上對局。' : '你正在觀戰，不占玩家座位，也無法操作設備。'}</p></div></div>}
    <section className="table"><div className="section-heading"><h2>隊員與設備</h2><span>{isGod ? '上帝視角 · 秘密資訊' : '盲視角 · 公開資訊'}</span></div>{Object.entries(G.players).map(([id, player]) => {
      const privateInfo = G.private?.[id];
      const role = player.revealedRole || (isGod ? privateInfo?.role : undefined);
      const cards = isGod ? G.secret?.cards?.[id] : undefined;
      return <article className="player-modules" key={id}><div className="module-player"><span className="avatar">{initials(nameOf(id))}</span><strong>{nameOf(id)}</strong>{role && <span className={`observer-role ${role === 'engineer' ? 'mint' : 'amber'}`}>{roleNames[role]}</span>}<span className="remaining">{player.cardCount} 張</span></div>
        {isGod && privateInfo && <p className="small muted observer-composition">剩餘：穩定 {privateInfo.composition.stable} · 維修 {privateInfo.composition.repair} · 危機 {privateInfo.composition.hazard}</p>}
        <div className="module-cards">{Array.from({ length: player.cardCount }, (_, slot) => { const kind = cards?.[slot]; return <div key={slot} className={`module-card readonly-card ${kind ? `face-${kind}` : ''}`}><span className="slot-number">{String(slot + 1).padStart(2, '0')}</span>{kind ? <><Icon type={kind === 'hazard' ? 'signal' : kind === 'repair' ? 'check' : 'orbit'} size={22} /><strong>{cardNames[kind]}</strong></> : <><Icon type="orbit" size={22} /><span>暗牌</span></>}</div>; })}{player.cardCount === 0 && <p className="small muted empty-cards">設備已全部揭開</p>}</div>
      </article>;
    })}</section>
    {G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective={perspective} label="製作本局戰報圖" />}
  </section><aside><Log G={G} nameOf={nameOf} /></aside></div>;
}
