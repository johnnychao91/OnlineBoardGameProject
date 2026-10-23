import { useContext, useEffect, useRef, useState } from 'react';
import { TURING_APPROVAL_KEYS, type TuringApproval, type TuringPolicies } from '../games/turing/rules';
import { api, ApiError, isRoomHost, roomHostPlayerID, type AuthSession, type RoomInfo } from './api';
import { RoomContext } from './room-context';

export const turingPolicyLabels = { redrawApproval: '提議重抽題目', orderApproval: '同意這個順序', nextApproval: '檢查完畢下一題' } as const;
export function turingSeatedHost(info: RoomInfo): string | null {
  const id = roomHostPlayerID(info);
  return id !== null && info.players.some(player => String(player.id) === id && !!player.name && !player.departed) ? id : null;
}

/** Each selection is saved immediately; unsubmitted deck/custom-question drafts are separate. */
export function TuringPolicySettings({ seat, info, policies, epoch, disabled = false, onUpdate, onBusy, onRefresh, compact = false }: {
  seat: AuthSession; info: RoomInfo; policies: TuringPolicies; epoch?: number; disabled?: boolean;
  onUpdate?: (info: RoomInfo) => void; onBusy?: (busy: boolean) => void; onRefresh?: () => void; compact?: boolean;
}) {
  const context = useContext(RoomContext);
  const host = isRoomHost(seat, info), hostAvailable = turingSeatedHost(info) !== null;
  const [pending, setPending] = useState<{ key: typeof TURING_APPROVAL_KEYS[number]; value: TuringApproval } | null>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const sending = useRef(false), mounted = useRef(true);
  const key = `${seat.roomId}:${seat.credentials}:${info.matchID}:${epoch ?? 'lobby'}:${JSON.stringify(policies)}`;
  const current = useRef(key); current.current = key;
  const callbacks = useRef({ onBusy, onUpdate, onRefresh, contextUpdate: context?.onUpdate });
  callbacks.current = { onBusy, onUpdate, onRefresh, contextUpdate: context?.onUpdate };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; callbacks.current.onBusy?.(false); }; }, []);
  useEffect(() => { sending.current = false; setPending(null); setError(''); callbacks.current.onBusy?.(false); }, [key]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => { sending.current = false; setPending(null); setMessage(''); setError('尚未同步最新設定，請確認連線後再試。'); callbacks.current.onBusy?.(false); }, 8000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  async function save(field: typeof TURING_APPROVAL_KEYS[number], value: TuringApproval) {
    if (!host || disabled || sending.current || info.status === 'finished' || (value === 'host' && !hostAvailable) || (policies[field] ?? 'all') === value) return;
    const submitted = key;
    sending.current = true; setPending({ key: field, value }); setError(''); setMessage(''); callbacks.current.onBusy?.(true);
    try {
      const updated = await api<RoomInfo>(`/api/rooms/${seat.roomId}/turing-policies`, {
        method: 'POST', body: JSON.stringify({ matchID: info.matchID, policies: { [field]: value }, ...(epoch === undefined ? {} : { epoch }) }),
      }, seat);
      if (!mounted.current || current.current !== submitted) return;
      setMessage('已儲存');
      (callbacks.current.onUpdate ?? callbacks.current.contextUpdate)?.(updated);
      callbacks.current.onRefresh?.();
    } catch (cause) {
      if (!mounted.current || current.current !== submitted) return;
      sending.current = false; setPending(null); callbacks.current.onBusy?.(false);
      setError(cause instanceof ApiError && cause.status === 409 ? '房間進度已更新，請依最新設定再選擇。' : (cause as Error).message);
      callbacks.current.onRefresh?.();
    }
  }
  const fields = <><div className="turing-policy-fields">{TURING_APPROVAL_KEYS.map(field => <label key={field}>{turingPolicyLabels[field]}<select aria-label={turingPolicyLabels[field]} value={pending?.key === field ? pending.value : policies[field] ?? 'all'} disabled={disabled || !!pending || !host || info.status === 'finished'} onChange={event => void save(field, event.target.value as TuringApproval)}>
    <option value="host" disabled={!hostAvailable}>房主同意</option><option value="all">所有人同意</option><option value="any">任何人同意</option>
  </select></label>)}</div><p className="small muted turing-policy-status" role="status">{error || (pending ? '儲存並同步中…' : message || (host ? '切換即儲存' : '由房主設定'))}{!hostAvailable && ' · 房主入座後才可選房主同意'}</p></>;
  return compact ? <details className="turing-policy-details"><summary>同意方式</summary>{fields}</details> : <div className="turing-policy-settings">{fields}<p className="small muted">排序同意適用「群體校準」；檢測員玩法仍由檢測員逐張揭牌。</p></div>;
}
