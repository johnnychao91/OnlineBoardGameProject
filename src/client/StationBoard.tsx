import { useContext, useEffect, useRef, useState } from 'react';
import type { StationState } from '../games/station/game';
import { getCardSlots, possibleRoleCounts, repairClaimMaximum } from '../games/station/view-model';
import { isPlayer } from './api';
import { RoomContext } from './room-context';
import { Icon } from './ui';
import { BattleReport } from './BattleReport';
import { StationSoundToggle, useStationSounds } from './station-sounds';
import { cardNames, initials, MissionProgress, roleNames, RoundRevealList, StationTable, TurnNotice } from './StationTable';

export { cardNames, initials, roleNames } from './StationTable';

type BoardProps = {
  G: StationState;
  playerID: string | null;
  isConnected?: boolean;
  moves: Record<string, (...args: any[]) => any>;
};
type Selection = { targetID: string; slot: number; round: number; actorID: string; logLength: number; selectionID?: number };
type SelectionRequest = { targetID: string; slot: number; round: number; previousID: number };

export function StationBoard({ G, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [request, setRequest] = useState<SelectionRequest | null>(null);
  // Catch two clicks before React has rendered the first move.
  const requestRef = useRef<SelectionRequest | null>(null);
  const [notice, setNotice] = useState('');
  const [privateVisible, setPrivateVisible] = useState(false);
  const [claimDismissed, setClaimDismissed] = useState(false);
  const [claimSending, setClaimSending] = useState(false);
  const claimSendingRef = useRef(false);
  const modal = useRef<HTMLDialogElement>(null);
  const claimModal = useRef<HTMLDialogElement>(null);
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const mine = G.private?.[id];
  const own = G.players[id];
  const nameOf = (target: string) => {
    const player = info.players.find(p => String(p.id) === target);
    return `${player?.name || `隊員 ${Number(target) + 1}`}${player?.departed ? '（已離開）' : ''}`;
  };
  const myTurn = G.status === 'playing' && G.activePlayer === id;
  const canAct = isConnected !== false;
  const sounds = useStationSounds({ G, matchID: info.matchID, playerID: id, connected: canAct });
  const version2 = (G.rulesVersion ?? 1) >= 2;
  const pending = G.pendingReveal;
  const needsClaim = G.status === 'claiming' && !!own && own.claim == null;
  const claimMaximum = repairClaimMaximum(G, id);
  const roles = possibleRoleCounts(Object.keys(G.players).length, mine?.role);
  const validSelection = !!selection && canAct && myTurn
    && selection.round === G.round && selection.actorID === id
    && getCardSlots(G, selection.targetID).some(card => card.slot === selection.slot && card.kind === null)
    && (version2 || selection.logLength === G.log.length)
    && (!version2 || !!pending && pending.round === selection.round
      && pending.actorID === id && pending.targetID === selection.targetID
      && pending.slot === selection.slot && pending.selectionID === selection.selectionID);

  useEffect(() => {
    if (selection && !validSelection) setSelection(null);
    if (selection && validSelection && modal.current && !modal.current.open) modal.current.showModal();
    if ((!selection || !validSelection) && modal.current?.open) modal.current.close();
  }, [selection, validSelection]);

  useEffect(() => {
    const sent = requestRef.current;
    if (!sent) return;
    if (!canAct || !myTurn || sent.round !== G.round
      || pending && pending.selectionID > sent.previousID) {
      requestRef.current = null;
      setRequest(null);
    }
  }, [canAct, myTurn, G.round, pending]);

  useEffect(() => {
    if (!request) return;
    const timeout = window.setTimeout(() => {
      requestRef.current = null;
      setRequest(null);
      setNotice('尚未收到選牌確認，請確認連線後再點一次。');
    }, 10000);
    return () => window.clearTimeout(timeout);
  }, [request]);

  useEffect(() => {
    setClaimDismissed(false);
    setClaimSending(false);
    claimSendingRef.current = false;
    setNotice('');
  }, [G.round, G.status]);

  useEffect(() => {
    if (!needsClaim) {
      setClaimSending(false);
      claimSendingRef.current = false;
    }
    if (needsClaim && !claimDismissed && claimModal.current && !claimModal.current.open) claimModal.current.showModal();
    if ((!needsClaim || claimDismissed) && claimModal.current?.open) claimModal.current.close();
  }, [needsClaim, claimDismissed]);

  useEffect(() => {
    if (!claimSending) return;
    const timeout = window.setTimeout(() => {
      claimSendingRef.current = false;
      setClaimSending(false);
    }, 10000);
    return () => window.clearTimeout(timeout);
  }, [claimSending]);

  useEffect(() => {
    const hide = () => { if (document.hidden) setPrivateVisible(false); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  function chooseCard(targetID: string, slot: number) {
    if (!canAct || !myTurn || requestRef.current || targetID === id
      || !getCardSlots(G, targetID).some(card => card.slot === slot && card.kind === null)) return;
    setNotice('');
    if (!version2) {
      setSelection({ targetID, slot, round: G.round, actorID: id, logLength: G.log.length });
      return;
    }
    if (pending?.actorID === id && pending.round === G.round && pending.targetID === targetID && pending.slot === slot) {
      setSelection({ targetID, slot, round: G.round, actorID: id, logLength: G.log.length, selectionID: pending.selectionID });
      return;
    }
    const next = { targetID, slot, round: G.round, previousID: G.selectionSequence ?? 0 };
    requestRef.current = next;
    setRequest(next);
    moves.selectCard(targetID, slot);
  }

  function cancelSelection() {
    // An old dialog must not clear a newer selection received from the server.
    if (version2 && validSelection) moves.clearSelection();
    setSelection(null);
  }

  function confirmSelection() {
    if (!selection || !validSelection) return;
    if (version2) moves.reveal(selection.targetID, selection.slot, selection.selectionID);
    else moves.reveal(selection.targetID, selection.slot);
    setSelection(null);
  }

  function declareClaim(amount: number) {
    if (!canAct || !needsClaim || claimSendingRef.current) return;
    claimSendingRef.current = true;
    setClaimSending(true);
    moves.declareRepairs(amount, G.round);
  }

  return <>
    <div className={`connection-banner ${canAct ? '' : 'offline'}`} role="status">
      <Icon type="signal" size={15} />
      {canAct ? '即時連線中' : '連線中斷，正在自動重連。請保留這個頁面。'}
    </div>
    <main className={`game-layout station-live ${G.status === 'finished' ? 'station-finished' : ''}`}>

      <section className="game-main">
        <div className="game-title">
          <div><div className="eyebrow">SPACE MAINTENANCE</div><h1>太空維修站</h1></div>
          <div className="station-title-actions"><StationSoundToggle controls={sounds} /><span className="round-badge">第 <strong>{G.round}</strong> / 4 輪</span></div>
        </div>
        <MissionProgress G={G} numPlayers={info.numPlayers} />
        <TurnNotice G={G} nameOf={nameOf} ownID={id} />
        <div className="selection-feedback" role="status">
          {request ? '正在向全桌同步你的預選…' : notice || (myTurn && pending?.actorID === id ? '大家已看見你的預選。再點同一張牌，開啟檢修確認。' : '')}
        </div>
        <StationTable G={G} nameOf={nameOf} ownID={id} canSelect={canAct && myTurn && !request} onCardClick={chooseCard} />
      </section>
      <aside className="game-aside">
        <section className="panel private-panel">
          <button className="private-toggle" onClick={() => setPrivateVisible(!privateVisible)} aria-expanded={privateVisible}>
            <span><Icon type="shield" /><strong>我的秘密資訊</strong><small>只有你看得到</small></span>
            <span>{privateVisible ? '收起 −' : '查看 +'}</span>
          </button>
          {privateVisible && mine && <div className="private-content">
            <div className={`role-card ${mine.role}`}>
              <span>你的身份</span><strong>{roleNames[mine.role]}</strong>
              <div className="possible-roles"><span>本局可能的全場人數（包含你）</span>
                {roles.map(({ engineer, saboteur }) => <p key={`${engineer}-${saboteur}`}>
                  <b>維修員 {engineer} 位</b><span>／</span><b className="role-saboteur">干擾者 {saboteur} 位</b>
                </p>)}
                {roles.length > 1 && <small>以上是可能組合，實際陣營人數不公開。</small>}
              </div>
              <p>{mine.role === 'engineer' ? '找齊所有維修模組，讓維修站恢復運作。' : '讓反應爐危機被揭開，或讓維修模組留到四輪結束。'}</p>
            </div>
            <p className="small muted">目前剩餘設備組成</p>
            <div className="composition">
              <div><strong>{mine.composition.stable}</strong><span>穩定設備</span></div>
              <div className="mint"><strong>{mine.composition.repair}</strong><span>維修模組</span></div>
              <div className="card-kind-hazard"><strong>{mine.composition.hazard}</strong><span>反應爐危機</span></div>
            </div>
            <p className="small muted">你知道數量，不知道暗牌的排列位置。</p>
          </div>}
          {G.status === 'briefing' && <div className="briefing-action">
            <button className="button primary full" disabled={!canAct || own?.acknowledged}
              onClick={() => { if (G.rulesVersion === 3) moves.acknowledgeBriefing(G.round); else moves.acknowledge(); setPrivateVisible(false); }}>
              {own?.acknowledged ? '已確認，等待其他隊員' : '我已看過資訊，準備繼續'}
            </button>
            <p className="small muted center">{Object.values(G.players).filter(p => p.acknowledged).length} / {info.numPlayers} 位已確認</p>
          </div>}
          {G.status === 'claiming' && <div className="briefing-action claim-action">
            {needsClaim ? <button className="button primary full" onClick={() => setClaimDismissed(false)}>
              宣稱我的維修模組數量<Icon type="arrow" />
            </button> : <p className="claim-submitted"><Icon type="check" />你宣稱了 {own?.claim} 張維修模組，等待其他隊員。</p>}
            <p className="small muted center" role="status">
              {Object.values(G.players).filter(p => p.claim != null).length} / {info.numPlayers} 位已宣稱
            </p>
          </div>}
        </section>

        {G.status === 'round-review' && <section className="panel round-review-confirmation">
          <h2>看清楚最後一張了嗎？</h2>
          <p className="small muted">全體確認後，才會收回暗牌並開始下一輪。</p>
          <button className="button primary full" disabled={!canAct || own?.reviewAcknowledged}
            onClick={() => moves.acknowledgeRound(G.round)}>
            {own?.reviewAcknowledged ? '已確認，等待其他隊員' : '已看清楚，準備下一輪'}
          </button>
          <p className="small muted" role="status">{Object.values(G.players).filter(p => p.reviewAcknowledged).length} / {info.numPlayers} 位已確認</p>
        </section>}
        <RoundRevealList G={G} nameOf={nameOf} />
        {G.status === 'finished' && <details className="panel station-results-details"><summary>陣營揭曉與戰報</summary>
          <div className="role-reveal-grid">{Object.keys(G.players).map(pid => <div key={pid}>
            <span className={G.players[pid].revealedRole === 'saboteur' ? 'role-saboteur' : 'mint'}>{G.players[pid].revealedRole ? roleNames[G.players[pid].revealedRole!] : '未知'}</span>
            <strong>{nameOf(pid)}{pid === id && '（你）'}</strong>
          </div>)}</div>
          <BattleReport G={G} info={info} perspective="blind" label="製作本局戰報圖" />
        </details>}
        <details className="panel station-log-details"><summary>全部任務紀錄</summary><Log G={G} nameOf={nameOf} /></details>
        <details className="panel rules-details"><summary>任務規則速查</summary><RuleSummary legacy={!version2} /></details>
      </aside>
    </main>
    <dialog ref={modal} onCancel={event => { event.preventDefault(); cancelSelection(); }}
      onClose={() => setSelection(null)} className="confirm-dialog" aria-labelledby="station-confirm-title">
      <div className="eyebrow">CONFIRM YOUR CHOICE</div>
      <h2 id="station-confirm-title">確定檢修這項設備？</h2>
      <p>揭開 <strong>{selection ? nameOf(selection.targetID) : ''}</strong> 的第 <strong>{(selection?.slot ?? 0) + 1}</strong> 張設備牌。</p>
      <p className="muted small">確認後才會公開牌面，並由對方接手下一次檢修。</p>
      <div className="button-row">
        <button className="button secondary" autoFocus onClick={cancelSelection}>取消預選</button>
        <button className="button primary" disabled={!validSelection} onClick={confirmSelection}>確認檢修</button>
      </div>
    </dialog>
    <dialog ref={claimModal} className="confirm-dialog claim-dialog" aria-labelledby="station-claim-title"
      onCancel={event => { event.preventDefault(); setClaimDismissed(true); }}>
      <div className="eyebrow">ROUND {G.round} · YOUR DECLARATION</div>
      <h2 id="station-claim-title">你要宣稱幾張維修模組？</h2>
      <p>選擇你要公開宣稱的<strong>維修模組數量</strong>。</p>
      <p className="claim-secret"><Icon type="shield" size={17} />只有你知道：實際有 <strong>{mine?.composition.repair ?? '—'} 張</strong></p>
      <p className="small">全桌尚未翻出 {Math.max(0, G.repairsRequired - G.repairsFound)} 張維修模組；你最多可宣稱 {claimMaximum} 張。</p>
      <p className="muted small">可以說實話，也可以說謊。點選數字就會公開提交，本輪不能修改。</p>
      <div className="claim-options" aria-label="宣稱維修模組數量">
        {Array.from({ length: claimMaximum + 1 }, (_, amount) => <button key={amount} type="button"
          disabled={!canAct || !needsClaim || claimSending} aria-label={`宣稱 ${amount} 張維修模組`}
          onClick={() => declareClaim(amount)}>{amount}<small>張</small></button>)}
      </div>
      <p className="small muted center" role="status">{claimSending ? '正在提交宣稱…' : !canAct ? '重新連線後即可提交。' : '全員宣稱完成後開始檢修。'}</p>
      <button className="button secondary full" onClick={() => setClaimDismissed(true)}>先看牌桌</button>
    </dialog>
  </>;
}

export function Log({ G, nameOf }: { G: StationState; nameOf: (id: string) => string }) {
  return <section className="panel event-log">
    <div className="section-heading"><h2>任務紀錄</h2><span className="small muted">公開資訊</span></div>
    {G.log.length ? <ol>{[...G.log].reverse().slice(0, 32).map((entry, index) => <li key={`${G.log.length - index}`}>
      <span className={`log-dot ${entry.kind}`} />
      <div>
        <p><strong>{nameOf(entry.actorID)}</strong> 檢修了 {nameOf(entry.targetID)} 的第 {entry.slot + 1} 張設備牌</p>
        <span className={entry.kind === 'repair' ? 'mint' : entry.kind === 'hazard' ? 'card-kind-hazard' : 'muted'}>{cardNames[entry.kind]}</span>
        <small>第 {entry.round} 輪</small>
      </div>
    </li>)}</ol> : <p className="muted small">第一次檢修後，結果會出現在這裡。</p>}
  </section>;
}

export function RuleSummary({ legacy = false }: { legacy?: boolean } = {}) {
  return <div className="rule-summary">
    <p>每位隊員有秘密陣營。維修員要找齊所有維修模組；干擾者要讓反應爐危機被揭開，或讓維修拖過第四輪。</p>
    {legacy ? <>
      <p>每輪先查看自己的設備組成，全員確認後開始檢修。暗牌會洗亂，連本人也不知道位置。大家可以自由討論，說實話、保留資訊或說謊。</p>
      <p>輪到你檢修時，選擇其他隊員的一張暗牌，在確認視窗按下「確認檢修」後翻開，再由對方接手。這局翻開的牌移入紀錄，剩餘暗牌往前排列。</p>
    </> : <>
      <p>每輪先查看設備組成，確認後宣稱自己有幾張維修模組。宣稱可以說謊，並不代表實際牌數。暗牌會洗亂，連本人也不知道位置。</p>
      <p>輪到你檢修時，先點別人的一張暗牌，全桌都會看見預選；再點同一張牌並確認才翻開。翻開的牌留在原位，由對方接手下一次檢修。</p>
    </>}
    <p>每輪共揭開等同玩家人數的牌。新局會保留本輪牌桌，全體確認後，剩餘暗牌才重新混洗與分配，進入下一輪。穩定設備沒有特殊效果；維修模組累計維修進度。</p>
    <p>反應爐危機一揭開，干擾者立刻獲勝。所有維修模組都找到，維修員立刻獲勝。</p>
  </div>;
}
