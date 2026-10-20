import { useEffect, useRef, useState } from 'react';
import { api, forgetSeat, isPlayer, isRoomHost, type AuthSession, type RoomInfo } from './api';
import { ErrorMessage, navigate } from './ui';

export function RoomActions({ seat, info, onUpdate }: {
  seat: AuthSession; info: RoomInfo; onUpdate: (info: RoomInfo) => void;
}) {
  const [confirming, setConfirming] = useState<'abort' | 'leave' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmedMatch = useRef<string | null>(null);
  const active = info.status !== 'lobby' && info.status !== 'finished';
  const host = isRoomHost(seat, info);

  useEffect(() => {
    if (confirming && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!confirming && dialog.current?.open) dialog.current.close();
  }, [confirming]);
  useEffect(() => {
    if (confirming === 'abort' && (!active || !host || confirmedMatch.current !== info.matchID)) setConfirming(null);
  }, [active, host, confirming, info.matchID]);

  async function confirm() {
    if (!confirming || busy) return;
    setBusy(true); setError('');
    try {
      if (confirming === 'abort') {
        if (!active || !host || confirmedMatch.current !== info.matchID) {
          setConfirming(null);
          return;
        }
        const next = await api<RoomInfo>(`/api/rooms/${seat.roomId}/abort`, {
          method: 'POST', body: JSON.stringify({ matchID: confirmedMatch.current }),
        }, seat);
        onUpdate(next);
        setConfirming(null);
      } else {
        await api(`/api/rooms/${seat.roomId}/leave`, { method: 'POST', body: '{}' }, seat);
        forgetSeat(seat.roomId, seat.credentials);
        navigate('/');
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="room-actions">
    <div className="room-action-buttons">
      {host && active && <button className="button secondary" onClick={() => { confirmedMatch.current = info.matchID; setError(''); setConfirming('abort'); }}>提前結束本局</button>}
      <button className="button secondary" onClick={() => { setError(''); setConfirming('leave'); }}>離開房間</button>
    </div>
    <p className="small muted">關閉分頁不會立即退出；所有人離線超過 60 秒，進行中的對局會結束且不計勝敗。</p>
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby="room-action-title"
      onCancel={event => { if (busy) event.preventDefault(); else setConfirming(null); }}
      onClose={() => { if (!busy) setConfirming(null); }}>
      <h2 id="room-action-title">{confirming === 'abort' ? '提前結束本局？' : '確定離開房間？'}</h2>
      {confirming === 'abort' ? <>
        <p>所有人會回到原本的等待室，這一局不計入勝敗統計。</p>
        <p className="small muted">房間邀請繼續有效。下一局需全員重新準備，已完成的對局與復盤會保留。</p>
      </> : <>
        <p>將退出目前的{isPlayer(seat) ? '玩家座位' : '觀戰席'}，這個瀏覽器其他分頁的同一身分也會一併退出。</p>
        <p className="small muted">{active && isPlayer(seat)
          ? '本局不會補入新隊員，請先與隊友協調。想再參與下一局，可在等待室使用有效邀請重新加入。'
          : '想再加入時，請重新開啟有效邀請。'}{host && ' 房主會交由仍留在房間的隊員接任。'}</p>
      </>}
      <ErrorMessage>{error}</ErrorMessage>
      <div className="button-row">
        <button className="button secondary" disabled={busy} autoFocus onClick={() => setConfirming(null)}>取消</button>
        <button className="button danger" disabled={busy} onClick={confirm}>{busy ? '正在處理…' : confirming === 'abort' ? '確認提前結束' : '確認離開'}</button>
      </div>
    </dialog>
  </div>;
}
