import { useEffect, useRef, useState } from 'react';
import { api, ApiError, isPlayer, isRoomHost, loadSeat, type Admission, type AuthSession, type RoomInfo } from './api';
import { clearRoleSwitch, completeRoleSwitch, prepareRoleSwitch, readRoleSwitch, withRoleSwitchLock, type PendingRoleSwitch } from './role-switch';
import { ErrorMessage } from './ui';

export function RoleSwitcher({ seat, info, onChange }: {
  seat: AuthSession; info: RoomInfo; onChange: (seat: AuthSession) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pending = readRoleSwitch(seat);
  const playing = isPlayer(seat);
  const full = !playing && info.numPlayers >= (info.roomCapacity ?? info.maxPlayers);
  const target = playing ? '觀戰' : '參加遊戲';
  async function changeRole() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    const attempt: { request?: PendingRoleSwitch } = {};
    try {
      await withRoleSwitchLock(seat.roomId, async () => {
        if (!mounted.current) return;
        // A second tab may have completed while this tab waited for the lock.
        const current = loadSeat(seat.roomId);
        if (current?.credentials !== seat.credentials) {
          if (mounted.current && current) onChange(current);
          return;
        }
        let request: PendingRoleSwitch;
        try { request = prepareRoleSwitch(seat, info.matchID); attempt.request = request; }
        catch { throw new Error('瀏覽器無法保存切換資料，尚未送出操作。請允許網站儲存資料後再試。'); }
        const result = await api<Admission>(`/api/rooms/${seat.roomId}/switch-role`, {
          method: 'POST', body: JSON.stringify({ access: request.access, matchID: request.matchID, requestID: request.requestID }),
        }, seat);
        const next = completeRoleSwitch(seat, request, result);
        if (mounted.current && next) onChange(next);
      });
    } catch (error) {
      const request = attempt.request;
      // Network / server failures may have committed the switch. Keep the receipt
      // request so retrying retrieves the same identity instead of adding a seat.
      if (request && error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        clearRoleSwitch(seat, request.requestID);
      }
      if (mounted.current) setError(error instanceof ApiError ? error.message
        : request ? '尚未確認切換結果。請保留此頁，稍後按「重試身分切換」。'
          : error instanceof Error ? error.message : '無法切換身分，請重新整理後再試。');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <section className="role-switcher" aria-label="房間身分">
    <div className="role-switcher-row">
      <strong>目前身分：{playing ? '參與玩家' : '觀戰者'}</strong>
      <button className="button secondary" disabled={busy || (!pending && (info.status !== 'lobby' || full))} onClick={changeRole}>
        {busy ? '正在切換…' : pending ? '重試身分切換' : `改為${target}`}
      </button>
    </div>
    <p className="small muted">{pending ? '切換結果尚待確認；重試會找回同一次切換，不會重複占位。'
      : info.status !== 'lobby' ? '本局進行中，身分暫時固定；回到等待室後即可切換。'
        : full ? '玩家席位已滿，有人改為觀戰或離開後即可入座。'
          : playing && isRoomHost(seat, info) ? '改為觀戰會釋出玩家席位，仍保留房主權限；可以管理房間並在全員準備後開始遊戲。'
            : playing ? '改為觀戰會釋出玩家席位。保留暱稱與房間，觀戰不計入開局人數。'
              : isRoomHost(seat, info) ? '加入玩家席位後仍保留房主權限，但需重新準備，並計入本局玩家人數。'
              : '加入玩家席位後需重新準備。保留暱稱與房間，不用重開邀請。'}</p>
    <ErrorMessage>{error}</ErrorMessage>
  </section>;
}
