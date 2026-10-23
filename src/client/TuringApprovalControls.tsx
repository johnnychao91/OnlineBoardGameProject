import { useEffect, useRef, useState } from 'react';
import { isTuringSharedTable, type TuringState } from '../games/turing/game';
import type { TuringApproval } from '../games/turing/rules';
import { api, ApiError, type AuthSession } from './api';
import { Icon } from './ui';

export const turingApprovalText = (policy: TuringApproval = 'all') => policy === 'host' ? '房主同意' : policy === 'any' ? '任一玩家同意' : '全員同意';

export function turingReadiness(G: TuringState, id: string, hostID?: string | null) {
  const review = G.status === 'briefing' || G.status === 'round-review';
  const redraw = G.status === 'sorting' && !!G.redrawApprovals?.length;
  if (!review && !(G.status === 'sorting' && (isTuringSharedTable(G) || redraw))) return undefined;
  const policy = G.status === 'briefing' ? 'all' : review ? G.options.nextApproval ?? 'all' : redraw ? G.options.redrawApproval ?? 'all' : G.options.orderApproval ?? 'all';
  if (policy === 'any' || (policy === 'host' && id !== hostID)) return undefined;
  const ready = review ? !!G.players[id]?.acknowledged : !!(redraw ? G.redrawApprovals : G.orderApprovals)?.includes(id);
  return { ready, text: `${policy === 'host' ? '房主' : ''}${ready ? '已準備' : '尚未準備'}` };
}

/** Approval requires the seated host; only challenge settlement also accepts an observing host. */
export function useTuringHostAction(seat: AuthSession, matchID: string, epoch: number, onRefresh?: () => void) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const sending = useRef(false), version = useRef(0);
  const requestKey = `${seat.roomId}:${seat.credentials}:${matchID}:${epoch}`;
  const currentKey = useRef(requestKey);
  currentKey.current = requestKey;
  useEffect(() => { version.current++; sending.current = false; setPending(false); setError(''); return () => { version.current++; }; }, [requestKey]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => { sending.current = false; setPending(false); setError('尚未收到最新進度，請確認連線後再試。'); }, 8000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  async function send(action: 'redraw' | 'order' | 'next' | 'finish') {
    if (sending.current) return;
    const current = version.current, key = requestKey;
    let succeeded = false;
    sending.current = true; setPending(true); setError('');
    try {
      await api<{ matchID: string; epoch: number; stateID: number }>(`/api/rooms/${seat.roomId}/turing-host-action`, {
        method: 'POST', body: JSON.stringify({ matchID, epoch, action }),
      }, seat);
      succeeded = true;
      if (version.current === current && currentKey.current === key) onRefresh?.();
    } catch (cause) {
      if (version.current === current && currentKey.current === key) {
        setError(cause instanceof ApiError && cause.status === 409 ? '進度已更新，請查看最新畫面後再操作。' : (cause as Error).message);
        onRefresh?.();
      }
    } finally { if (!succeeded && version.current === current && currentKey.current === key) { sending.current = false; setPending(false); } }
  }
  return { pending, error, send };
}

export function TuringRedrawControls({ G, id, nameOf, canAct, onApprove, onWithdraw }: {
  G: TuringState; id?: string; nameOf: (id: string) => string; canAct: boolean;
  onApprove?: () => void; onWithdraw?: () => void;
}) {
  if ((G.rulesVersion ?? 1) < 4 || G.status !== 'sorting' || G.revealed.length > 0) return null;
  const policy = G.options.redrawApproval ?? 'all', approvals = G.redrawApprovals ?? [];
  const approved = policy === 'all' && id !== undefined && approvals.includes(id);
  return <div className="turing-question-actions"><div className="turing-redraw-controls">
    {onApprove ? <button className="button secondary" type="button" disabled={!canAct} onClick={approved ? onWithdraw : onApprove}>
      {policy === 'host' ? '房主重抽題目' : policy === 'any' ? '重抽題目' : approved ? '撤回重抽同意' : approvals.length ? '同意重抽題目' : '提議重抽題目'}
    </button> : <span className="small muted">由房主決定是否重抽</span>}
    {policy === 'all' && approvals.length > 0 && <div className="turing-redraw-status" role="status"><p>同意重抽：{approvals.map(nameOf).join('、')}</p><p>等待：{Object.keys(G.players).filter(player => !approvals.includes(player)).map(nameOf).join('、')}</p><small>全員同意才換題，保留強度牌與生命；提議完成或撤回後才能揭牌。</small></div>}
    {policy !== 'all' && onApprove && <span className="small muted">{turingApprovalText(policy)}即換題，保留強度牌與生命。</span>}
  </div></div>;
}

export function TuringOrderControl({ G, id, canAct, onApprove, onWithdraw }: {
  G: TuringState; id?: string; canAct: boolean; onApprove?: () => void; onWithdraw?: () => void;
}) {
  const policy = G.options.orderApproval ?? 'all', approved = policy === 'all' && id !== undefined && !!G.orderApprovals?.includes(id);
  const redrawPending = !!G.redrawApprovals?.length;
  return <button className="button primary full" type="button" disabled={!canAct || !onApprove || redrawPending} onClick={approved ? onWithdraw : onApprove}>
    {redrawPending ? '先決定是否重抽' : policy === 'host' ? onApprove ? '房主確認排序' : '等待房主確認排序' : policy === 'any' ? '確認排序並揭牌' : approved ? '撤回同意' : '同意這個順序'}<Icon type="check" size={16} />
  </button>;
}

export function TuringNextControl({ G, id, canAct, onApprove }: {
  G: TuringState; id?: string; canAct: boolean; onApprove?: () => void;
}) {
  const policy = G.status === 'briefing' ? 'all' : G.options.nextApproval ?? 'all';
  const approved = policy === 'all' && id !== undefined && !!G.players[id]?.acknowledged;
  return <button className="button primary full" type="button" disabled={!canAct || !onApprove || approved} onClick={onApprove}>
    {G.status === 'briefing' ? approved ? '已確認，等待同伴' : '我已了解本輪任務'
      : policy === 'host' ? onApprove ? '檢查完畢，下一題' : '等待房主進入下一題'
      : approved ? '已確認，等待同伴' : '檢查完畢，下一題'}<Icon type="check" size={16} />
  </button>;
}

export function TuringFinishControl({ G, canAct, onFinish }: { G: TuringState; canAct: boolean; onFinish: () => void }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setConfirming(false); }, [G.epoch, G.status]);
  if (G.targetRounds !== null || G.status === 'lobby' || G.status === 'finished') return null;
  return <div className="turing-finish-control">{confirming ? <>
    <p className="small">記錄已通過 {G.completedRounds ?? 0} 關並結束挑戰？未完成的這關不計分。</p>
    <div className="button-row"><button type="button" className="button secondary" disabled={!canAct} onClick={() => setConfirming(false)}>繼續挑戰</button><button type="button" className="button primary" disabled={!canAct} onClick={onFinish}>確認結算</button></div>
  </> : <button type="button" className="button secondary full" disabled={!canAct} onClick={() => setConfirming(true)}>以目前成績結束</button>}</div>;
}
