import { useState } from 'react';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { ErrorMessage } from './ui';

export function StationOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = disabled || busy || !isRoomHost(seat, info);
  async function apply(chiefEngineer: boolean) {
    if (locked) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const next = await api<RoomInfo>('/api/rooms/' + seat.roomId + '/options', {
        method: 'POST', body: JSON.stringify({ matchID: info.matchID, options: { chiefEngineer } }),
        signal: AbortSignal.timeout(8000),
      }, seat);
      onUpdate(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法更新大工程師設定。');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return <section className="panel" aria-labelledby="station-options-title" aria-busy={busy}>
    <h3 id="station-options-title">太空維修站本局設定</h3>
    <label>大工程師
      <select value={info.gameOptions?.chiefEngineer === true ? 'on' : 'off'} disabled={locked}
        onChange={event => void apply(event.target.value === 'on')}>
        <option value="off">關閉</option>
        <option value="on">加入大工程師</option>
      </select>
    </label>
    <p className="small muted">開啟後，一名維修員會成為大工程師，持有一次性道具「反應爐救星」。</p>
    <ErrorMessage>{error}</ErrorMessage>
  </section>;
}
