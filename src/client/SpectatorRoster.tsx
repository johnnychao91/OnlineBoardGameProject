import { useEffect, useRef, useState } from 'react';
import { api, isPlayer, isRoomHost, type AuthSession, type RoomInfo, type RoomSpectator } from './api';
import { ErrorMessage, Icon } from './ui';
import './spectator-roster.css';

export function SpectatorRoster({ info, seat, onUpdate }: {
  info: RoomInfo; seat: AuthSession; onUpdate: (info: RoomInfo) => void;
}) {
  const spectators = info.spectators;
  const count = spectators?.length ?? info.spectatorCount;
  const host = isRoomHost(seat, info);
  const [target, setTarget] = useState<(RoomSpectator & { roomID: string; credentials: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ info, seat, onUpdate });
  latest.current = { info, seat, onUpdate };
  const validTarget = !!target && host && target.roomID === info.roomId && target.credentials === seat.credentials
    && target.id !== info.hostObserverID && spectators?.some(spectator => spectator.id === target.id);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (target && validTarget && dialog.current && !dialog.current.open) dialog.current.showModal();
    if ((!target || !validTarget) && dialog.current?.open) dialog.current.close();
    if (target && !validTarget) setTarget(null);
  }, [target, validTarget]);

  async function remove() {
    if (sending.current || !target || !validTarget) return;
    // Recheck the current identity and roster, including changes received while
    // the confirmation was open. Observer IDs belong to one admission only.
    const submitted = latest.current;
    if (!isRoomHost(submitted.seat, submitted.info) || submitted.seat.credentials !== target.credentials
      || submitted.info.roomId !== target.roomID || submitted.info.hostObserverID === target.id
      || !submitted.info.spectators?.some(spectator => spectator.id === target.id)) {
      setTarget(null);
      return;
    }
    sending.current = true; setBusy(true); setError('');
    try {
      const next = await api<RoomInfo>(`/api/rooms/${submitted.seat.roomId}/remove`, {
        method: 'POST', body: JSON.stringify({ observerID: target.id }),
      }, submitted.seat);
      if (mounted.current) {
        // A concurrent poll, role change or new match may already be newer than
        // this response. In that case the next normal poll refreshes the roster.
        if (latest.current.info === submitted.info && latest.current.seat.credentials === submitted.seat.credentials) {
          latest.current.onUpdate(next);
        }
        setTarget(null);
      }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className="spectator-roster" aria-label="觀戰席名單">
    <details className="spectator-roster-panel" open>
      <summary>
        <Icon type="signal" size={18} />
        <span className="spectator-roster-title">觀戰席</span>
        <span className="spectator-roster-count">{count} 位</span>
        <span className="spectator-roster-chevron" aria-hidden="true">⌄</span>
      </summary>
      <p className="spectator-roster-note">觀戰者不計入參與人數。</p>
      {spectators?.length ? <ul className="spectator-roster-list" aria-label="觀戰者">
        {spectators.map(spectator => {
          const mine = !isPlayer(seat) && seat.observerID === spectator.id;
          return <li key={spectator.id} className={mine ? 'spectator-roster-person mine' : 'spectator-roster-person'}>
            <span className="spectator-roster-avatar" aria-hidden="true"><Icon type="signal" size={15} /></span>
            <span className="spectator-roster-name">{spectator.name}</span>
            {info.hostObserverID === spectator.id && <span className="spectator-roster-you spectator-roster-host">房主</span>}
            {mine && <span className="spectator-roster-you">你</span>}
            {host && !mine && info.hostObserverID !== spectator.id && <button type="button"
              className="remove-player spectator-remove" disabled={busy} aria-label={`移出觀戰者 ${spectator.name}`}
              onClick={() => { setError(''); setTarget({ ...spectator, roomID: info.roomId, credentials: seat.credentials }); }}>移出</button>}
          </li>;
        })}
      </ul> : <p className="spectator-roster-empty">{count ? '正在同步觀戰名單…' : '目前沒有觀戰者，朋友可以透過邀請連結加入觀戰。'}</p>}
    </details>
    {(host || target) && <dialog ref={dialog} className="confirm-dialog" aria-labelledby="remove-spectator-title"
      onCancel={event => { if (busy) event.preventDefault(); else setTarget(null); }}
      onClose={() => { if (!busy) setTarget(null); }}>
      <h2 id="remove-spectator-title">移出這位觀戰者？</h2>
      <p>將 <strong>{target?.name}</strong> 移出房間，對方其他分頁的同一觀戰身分也會一併退出。</p>
      <p className="small muted">只移出這次加入，不會封鎖本人。對方仍可使用有效邀請重新加入觀戰。</p>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="button-row">
        <button type="button" className="button secondary" autoFocus disabled={busy} onClick={() => setTarget(null)}>取消</button>
        <button type="button" className="button danger" disabled={busy || !validTarget} onClick={remove}>{busy ? '正在移出…' : '確認移出'}</button>
      </div>
    </dialog>}
  </section>;
}
