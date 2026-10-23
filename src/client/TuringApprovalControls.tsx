import { useEffect, useRef, useState } from 'react';
import type { TuringState } from '../games/turing/game';
import type { TuringApproval } from '../games/turing/rules';
import { api, ApiError, type AuthSession } from './api';
import { Icon } from './ui';

export const turingApprovalText = (policy: TuringApproval = 'all') => policy === 'host' ? '房主同意' : policy === 'any' ? '任一玩家同意' : '全員同意';

/** Host authority is checked by the server for both seated and observing hosts. */
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
  async function send(action: 'redraw' | 'order') {
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
