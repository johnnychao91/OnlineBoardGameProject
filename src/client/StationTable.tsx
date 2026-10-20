import type { CardKind, StationState } from '../games/station/game';
import type { CSSProperties } from 'react';
import { getCardSlots } from '../games/station/view-model';
import { Icon } from './ui';
import { DeviceArtwork } from './StationArtwork';
import './station-display.css';

export const roleNames = { engineer: '維修員', saboteur: '干擾者' };
export const cardNames = { stable: '穩定設備', repair: '維修模組', hazard: '反應爐危機' };
export function initials(name: string) { return Array.from(name || '?').slice(0, 1).join(''); }

export function MissionProgress({ G, numPlayers }: { G: StationState; numPlayers: number }) {
  return <section className="mission-progress">
    <div><span>已完成維修</span><strong>{G.repairsFound}<small> / {G.repairsRequired}</small></strong></div>
    <div className="progress-track" role="progressbar" aria-label="完成維修"
      aria-valuenow={G.repairsFound} aria-valuemin={0} aria-valuemax={G.repairsRequired || numPlayers}>
      <span style={{ width: `${Math.min(100, G.repairsFound / Math.max(1, G.repairsRequired) * 100)}%` }} />
    </div>
    <p>本輪已揭開 {G.revealsThisRound} / {numPlayers} 張</p>
  </section>;
}

export function TurnNotice({ G, nameOf, ownID, replay = false }: {
  G: StationState; nameOf: (id: string) => string; ownID?: string; replay?: boolean;
}) {
  const playing = G.status === 'playing';
  const myTurn = playing && G.activePlayer === ownID;
  const lastReveal = G.log.at(-1);
  const review = G.status === 'round-review';
  const heading = G.status === 'briefing' ? '先確認你的任務資訊'
    : G.status === 'claiming' ? '宣稱階段 · 每人說出維修模組數量'
      : playing ? myTurn ? '輪到你檢修設備！' : `現在由 ${nameOf(G.activePlayer!)} 檢修設備`
        : review ? '本輪檢修完成 · 先確認最後一張'
          : G.status === 'finished' ? G.winner ? `${roleNames[G.winner]}陣營獲勝 · 本局結束` : '本局已結束' : '等待隊員集合';
  return <section className={`turn-notice station-turn-notice ${myTurn ? 'your-turn' : ''}`}
    role="status" aria-live="polite" aria-atomic="true">
    <span className="turn-symbol"><Icon type={playing ? 'arrow' : 'signal'} size={24} /></span>
    <div>
      <strong className={G.status === 'finished' && G.winner === 'saboteur' ? 'role-saboteur' : undefined}>{heading}</strong>
      <p>{G.status === 'briefing' ? (G.rulesVersion ?? 1) >= 2 ? '每輪重新洗牌，全員確認後進入宣稱階段。' : '每輪重新洗牌，全員確認後開始檢修。'
        : G.status === 'claiming' ? ownID ? '先提交自己的宣稱，才可看其他人的數量。全員提交後開始檢修。' : '隊員正在宣稱維修模組數量，全員提交後開始檢修。'
          : playing ? myTurn ? (G.rulesVersion ?? 1) >= 2 ? '先點一張暗牌讓大家看到，再點同一張確認檢修。' : '討論後，選擇其他隊員的一張暗牌。' : '請一起討論，只有目前負責檢修的隊員能翻牌。'
            : review ? '牌桌暫時保留，全體隊員確認後才重新發牌。'
            : G.status === 'finished' ? `${G.winReason === 'all-repairs' ? '所有維修模組都已找出。'
              : G.winReason === 'hazard' ? '反應爐危機被揭開。' : '四輪結束，仍有維修模組沒有找到。'}${replay ? '下方保留最後牌桌，可繼續復盤。' : '保留最後牌桌片刻後，大家會一起返回等待室。'}`
              : '集合完成後即可開始。'}</p>
      {(review || G.status === 'finished') && lastReveal && <p className="last-reveal" role="status">
        最後揭開：<strong className={`card-kind-${lastReveal.kind}`}>{cardNames[lastReveal.kind]}</strong>
        <span> · {nameOf(lastReveal.actorID)} → {nameOf(lastReveal.targetID)} · 第 {lastReveal.slot + 1} 張</span>
      </p>}
    </div>
  </section>;
}

/** Only the public reveal log is used, including in god-view snapshots. */
export function RoundRevealList({ G, nameOf }: { G: StationState; nameOf: (id: string) => string }) {
  const reveals = G.log.filter(entry => entry.round === G.round);
  return <section className="panel station-round-reveals" aria-label={`第 ${G.round} 輪檢修順序`}>
    <div className="section-heading"><h2>本輪檢修順序</h2><span>第 {G.round} 輪 · {reveals.length} 張</span></div>
    {reveals.length ? <ol>{reveals.map((entry, index) => <li key={`${entry.round}-${index}`}
      className={index === reveals.length - 1 ? 'latest-reveal' : ''}>
      <span className="reveal-order">{index + 1}</span>
      <DeviceArtwork kind={entry.kind} />
      <div><strong className={`card-kind-${entry.kind}`}>{cardNames[entry.kind]}</strong>
        <p><span>{nameOf(entry.actorID)}</span><span aria-hidden="true"> → </span><span>{nameOf(entry.targetID)}</span><span> · 第 {entry.slot + 1} 張</span></p>
      </div>
    </li>)}</ol> : <p className="small muted">本輪尚未檢修。揭開後依先後順序顯示。</p>}
  </section>;
}

export function PendingRevealNotice({ G, nameOf }: { G: StationState; nameOf: (id: string) => string }) {
  const pending = G.status === 'playing' ? G.pendingReveal : null;
  return <div className="pending-announcement" role="status" aria-live="polite" aria-atomic="true">
    {pending && <p><Icon type="arrow" size={18} /><span>
      <strong>{nameOf(pending.actorID)}</strong> 預選了 <strong>{nameOf(pending.targetID)}</strong> 的
      <strong> 第 {pending.slot + 1} 張設備牌</strong><small>尚未檢修，仍可更換</small>
    </span></p>}
  </div>;
}

function CardContents({ slot, kind, revealed, selected }: {
  slot: number; kind: CardKind | null; revealed: boolean; selected: boolean;
}) {
  return <>
    <span className="slot-number">{String(slot + 1).padStart(2, '0')}</span>
    <DeviceArtwork kind={kind} />
    <Icon type={kind === 'hazard' ? 'signal' : kind === 'repair' ? 'check' : 'orbit'} size={22} />
    <strong>{kind ? cardNames[kind] : '暗牌'}</strong>
    <span className="card-state-label">{selected ? '預選中' : revealed ? '已翻開' : '未翻開'}</span>
  </>;
}

/** Shared fixed-slot table for players, observers and historical snapshots. */
export function StationTable({ G, nameOf, ownID, god = false, canSelect = false, onCardClick }: {
  G: StationState;
  nameOf: (id: string) => string;
  ownID?: string;
  god?: boolean;
  canSelect?: boolean;
  onCardClick?: (targetID: string, slot: number) => void;
}) {
  return <section className="table station-table">
    <div className="section-heading">
      <h2>{G.status === 'finished' ? '最後一輪牌桌' : '隊員的設備'}</h2>
      <span className="small muted">{god ? '上帝視角 · 包含暗牌' : (G.rulesVersion ?? 1) >= 2 ? '翻開的牌保留原位' : '暗牌順序未知'}</span>
    </div>
    <PendingRevealNotice G={G} nameOf={nameOf} />
    <div className="station-players" style={{ '--station-rows': Math.ceil(Object.keys(G.players).length / 2) } as CSSProperties}>
    {Object.entries(G.players).map(([id, player]) => {
      const active = G.status === 'playing' && G.activePlayer === id;
      const confirming = G.status === 'briefing' || G.status === 'round-review';
      const confirmed = G.status === 'round-review' ? !!player.reviewAcknowledged : player.acknowledged;
      const privateInfo = G.private?.[id];
      const role = player.revealedRole || (god ? privateInfo?.role : undefined);
      const slots = getCardSlots(G, id);
      return <article key={id}
        className={`player-modules ${id === ownID ? 'self' : ''} ${active ? 'active-player' : ''}`}>
        <div className="module-player">
          <span className={`avatar ${id === ownID ? 'mine' : ''}`}>{initials(nameOf(id))}</span>
          <strong>{nameOf(id)}{id === ownID && <small className="you-label">你</small>}</strong>
          {confirming && <span className={`station-ready-badge ${confirmed ? 'confirmed' : 'pending'}`}
            aria-label={`${nameOf(id)}${confirmed ? '已準備' : '尚未準備'}`}
            title={G.status === 'round-review' ? '本輪結算確認' : '本輪任務資訊確認'}>
            {confirmed ? '✓ 已準備' : '待準備'}
          </span>}
          {active && <span className="actor-tag"><Icon type="arrow" size={13} />正在檢修</span>}
          {role && <span className={`observer-role ${role === 'engineer' ? 'mint' : 'role-saboteur'}`}>{roleNames[role]}</span>}
          <span className="remaining">暗牌 {player.cardCount} 張</span>
        </div>
        <div className="station-player-facts">
        {(G.rulesVersion ?? 1) >= 2 && <p className={`public-claim ${player.claim == null ? 'unclaimed' : ''}`}>
          {player.claim == null ? player.claimSubmitted ? '已宣稱 · 提交後可見數量'
            : G.status === 'briefing' ? '確認資訊後宣稱' : '尚未宣稱'
            : <><span>宣稱維修模組</span><strong>{player.claim} 張</strong><small>玩家自述，未經驗證</small></>}
        </p>}
        {god && privateInfo && <p className="small muted observer-composition">
          剩餘：穩定 {privateInfo.composition.stable} · 維修 {privateInfo.composition.repair} · 危機 {privateInfo.composition.hazard}
        </p>}
        </div>
        <div className="module-cards">
          {slots.map(({ slot, kind: publicKind }) => {
            const revealed = publicKind !== null;
            const kind = publicKind ?? (god ? G.secret?.cards?.[id]?.[slot] ?? null : null);
            const pending = G.status === 'playing' ? G.pendingReveal : null;
            const selected = pending?.targetID === id && pending.slot === slot;
            const className = `module-card station-card ${kind ? `face-${kind}` : ''} ${revealed ? 'revealed-card' : ''} ${selected ? 'selected-card' : ''}`;
            const contents = <CardContents slot={slot} kind={kind} revealed={revealed} selected={selected} />;
            if (!onCardClick || revealed) return <div key={slot} className={`${className} readonly-card`}
              aria-label={`${nameOf(id)}的第 ${slot + 1} 張設備牌，${revealed ? '已翻開：' : ''}${kind ? cardNames[kind] : '暗牌'}${selected ? '，預選中' : ''}`}>
              {contents}
            </div>;
            return <button key={slot} type="button" className={className}
              disabled={!canSelect || id === ownID} aria-pressed={selected}
              aria-label={`${selected ? '再次點選確認檢修：' : '預選'}${nameOf(id)}的第 ${slot + 1} 張設備牌`}
              onClick={() => onCardClick(id, slot)}>
              {contents}
            </button>;
          })}
          {slots.length === 0 && <p className="small muted empty-cards">目前沒有設備</p>}
        </div>
      </article>;
    })}
    </div>
  </section>;
}
