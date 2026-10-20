import { useEffect, useRef, useState } from 'react';
import type { RoomPlayer } from './api';

export function RemovePlayer({ player, busy, onRemove }: {
  player: RoomPlayer;
  busy: boolean;
  onRemove: (player: RoomPlayer) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirming && modal.current && !modal.current.open) modal.current.showModal();
    if (!confirming && modal.current?.open) modal.current.close();
  }, [confirming]);
  const titleID = `remove-player-${player.id}`;
  return <>
    <button type="button" className="remove-player" disabled={busy || !player.membershipID}
      aria-label={`移出${player.name}`} onClick={() => setConfirming(true)}>移出</button>
    <dialog ref={modal} className="confirm-dialog" aria-labelledby={titleID}
      onCancel={() => setConfirming(false)} onClose={() => setConfirming(false)}>
      <h2 id={titleID}>移出這位隊員？</h2>
      <p>將 <strong>{player.name}</strong> 移出等待室，空出這個座位。</p>
      <p className="small muted">只移出這次加入，不會封鎖本人。對方仍可使用有效邀請重新加入。</p>
      <div className="button-row">
        <button type="button" className="button secondary" autoFocus disabled={busy} onClick={() => setConfirming(false)}>取消</button>
        <button type="button" className="button danger" disabled={busy} onClick={async () => {
          await onRemove(player);
          setConfirming(false);
        }}>{busy ? '正在移出…' : '確認移出'}</button>
      </div>
    </dialog>
  </>;
}
