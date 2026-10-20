import type { CardKind, StationState } from '../games/station/game';
import { getCardSlots } from '../games/station/view-model';
import { Icon } from './ui';

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

export function TurnNotice({ G, nameOf, ownID }: {
  G: StationState; nameOf: (id: string) => string; ownID?: string;
}) {
  const playing = G.status === 'playing';
  const myTurn = playing && G.activePlayer === ownID;
  const heading = G.status === 'briefing' ? '先確認你的任務資訊'
    : G.status === 'claiming' ? '宣稱階段 · 每人說出好引線數量'
      : playing ? myTurn ? '輪到你剪線！' : `現在由 ${nameOf(G.activePlayer!)} 剪線`
        : G.status === 'finished' ? '本局已結束' : '等待隊員集合';
  return <section className={`turn-notice station-turn-notice ${myTurn ? 'your-turn' : ''}`}
    role="status" aria-live="polite" aria-atomic="true">
    <span className="turn-symbol"><Icon type={playing ? 'arrow' : 'signal'} size={24} /></span>
    <div>
      <strong>{heading}</strong>
      <p>{G.status === 'briefing' ? G.rulesVersion === 2 ? '每輪重新洗牌，全員確認後進入宣稱階段。' : '每輪重新洗牌，全員確認後開始剪線。'
        : G.status === 'claiming' ? '宣稱可以說謊。所有人提交後，才開始剪線。'
          : playing ? myTurn ? G.rulesVersion === 2 ? '先點一張暗牌讓大家看到，再點同一張確認剪線。' : '討論後，選擇其他隊員的一張暗牌。' : '請一起討論，只有目前的剪線玩家能翻牌。'
            : G.status === 'finished' ? '最後一輪牌桌保留在下方，可繼續復盤。' : '集合完成後即可開始。'}</p>
    </div>
  </section>;
}

export function PendingRevealNotice({ G, nameOf }: { G: StationState; nameOf: (id: string) => string }) {
  const pending = G.status === 'playing' ? G.pendingReveal : null;
  return <div className="pending-announcement" role="status" aria-live="polite" aria-atomic="true">
    {pending && <p><Icon type="arrow" size={18} /><span>
      <strong>{nameOf(pending.actorID)}</strong> 預選了 <strong>{nameOf(pending.targetID)}</strong> 的
      <strong> 第 {pending.slot + 1} 張</strong><small>尚未剪線，仍可更換</small>
    </span></p>}
  </div>;
}

function CardContents({ slot, kind, revealed, selected }: {
  slot: number; kind: CardKind | null; revealed: boolean; selected: boolean;
}) {
  return <>
    <span className="slot-number">{String(slot + 1).padStart(2, '0')}</span>
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
      <span className="small muted">{god ? '上帝視角 · 包含暗牌' : G.rulesVersion === 2 ? '翻開的牌保留原位' : '暗牌順序未知'}</span>
    </div>
    <PendingRevealNotice G={G} nameOf={nameOf} />
    {Object.entries(G.players).map(([id, player]) => {
      const active = G.status === 'playing' && G.activePlayer === id;
      const privateInfo = G.private?.[id];
      const role = player.revealedRole || (god ? privateInfo?.role : undefined);
      const slots = getCardSlots(G, id);
      return <article key={id}
        className={`player-modules ${id === ownID ? 'self' : ''} ${active ? 'active-player' : ''}`}>
        <div className="module-player">
          <span className={`avatar ${id === ownID ? 'mine' : ''}`}>{initials(nameOf(id))}</span>
          <strong>{nameOf(id)}{id === ownID && <small className="you-label">你</small>}</strong>
          {active && <span className="actor-tag"><Icon type="arrow" size={13} />正在剪線</span>}
          {role && <span className={`observer-role ${role === 'engineer' ? 'mint' : 'amber'}`}>{roleNames[role]}</span>}
          <span className="remaining">暗牌 {player.cardCount} 張</span>
        </div>
        {G.rulesVersion === 2 && <p className={`public-claim ${player.claim == null ? 'unclaimed' : ''}`}>
          {player.claim == null ? G.status === 'briefing' ? '確認資訊後宣稱' : '尚未宣稱'
            : <><span>宣稱好引線</span><strong>{player.claim} 張</strong><small>玩家自述，未經驗證</small></>}
        </p>}
        {god && privateInfo && <p className="small muted observer-composition">
          剩餘：穩定 {privateInfo.composition.stable} · 維修 {privateInfo.composition.repair} · 危機 {privateInfo.composition.hazard}
        </p>}
        <div className="module-cards">
          {slots.map(({ slot, kind: publicKind }) => {
            const revealed = publicKind !== null;
            const kind = publicKind ?? (god ? G.secret?.cards?.[id]?.[slot] ?? null : null);
            const pending = G.status === 'playing' ? G.pendingReveal : null;
            const selected = pending?.targetID === id && pending.slot === slot;
            const className = `module-card station-card ${kind ? `face-${kind}` : ''} ${revealed ? 'revealed-card' : ''} ${selected ? 'selected-card' : ''}`;
            const contents = <CardContents slot={slot} kind={kind} revealed={revealed} selected={selected} />;
            if (!onCardClick || revealed) return <div key={slot} className={`${className} readonly-card`}
              aria-label={`${nameOf(id)}的第 ${slot + 1} 張，${revealed ? '已翻開：' : ''}${kind ? cardNames[kind] : '暗牌'}${selected ? '，預選中' : ''}`}>
              {contents}
            </div>;
            return <button key={slot} type="button" className={className}
              disabled={!canSelect || id === ownID} aria-pressed={selected}
              aria-label={`${selected ? '再次點選確認剪線：' : '預選'}${nameOf(id)}的第 ${slot + 1} 張暗牌`}
              onClick={() => onCardClick(id, slot)}>
              {contents}
            </button>;
          })}
          {slots.length === 0 && <p className="small muted empty-cards">目前沒有設備</p>}
        </div>
      </article>;
    })}
  </section>;
}
