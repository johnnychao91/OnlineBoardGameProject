import { useState } from 'react';
import { ECHO_TIMES, normalizeEchoOptions, type EchoOptions as Options } from '../games/echo/rules';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { ErrorMessage } from './ui';

export function EchoOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const applied = normalizeEchoOptions(info.gameOptions);
  return <EchoOptionsForm key={JSON.stringify(applied)} {...{ seat, info, disabled, onBusy, onUpdate }} applied={applied} live={info.status !== 'lobby'} />;
}

function EchoOptionsForm({ seat, info, disabled, onBusy, onUpdate, applied, live }: LobbyOptionsProps & { applied: Options; live: boolean }) {
  const [options, setOptions] = useState(applied);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const host = isRoomHost(seat, info);
  const locked = disabled || busy || !host || info.status === 'finished';
  async function apply(nextOptions: Options) {
    if (locked) return;
    setOptions(nextOptions);
    setBusy(true); onBusy(true); setError('');
    try {
      const next = await api<RoomInfo>('/api/rooms/' + seat.roomId + '/options', {
        method: 'POST', body: JSON.stringify({ matchID: info.matchID, options: nextOptions }), signal: AbortSignal.timeout(8000),
      }, seat);
      onUpdate(next);
    } catch (cause) {
      setOptions(applied);
      setError(cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : '尚未確認設定已儲存，請稍後重試。');
    } finally { setBusy(false); onBusy(false); }
  }
  return <section className="panel echo-options" aria-labelledby="echo-options-title" aria-busy={busy}>
    <h3 id="echo-options-title">杯中回聲本局設定</h3>
    <div className="echo-options-fields"><label>封詞時間<select value={options.seconds} disabled={locked}
      onChange={event => void apply({ ...options, seconds: Number(event.target.value) as Options['seconds'] })}>
      {ECHO_TIMES.map(seconds => <option key={seconds} value={seconds}>{seconds === 0 ? '不限時' : `${seconds} 秒`}</option>)}</select></label>
      <label>提交後<select value={options.allowChanges ? 'editable' : 'locked'} disabled={locked}
        onChange={event => void apply({ ...options, allowChanges: event.target.value === 'editable' })}>
        <option value="editable">可更改</option><option value="locked">不可更改</option></select></label>
      {!live && <label>輪數上限<select value={options.roundLimit} disabled={locked}
        onChange={event => void apply({ ...options, roundLimit: Number(event.target.value) as Options['roundLimit'] })}>
        <option value={5}>5 輪</option><option value={8}>8 輪</option><option value={12}>12 輪</option></select></label>}</div>
    {busy && <p className="small muted" role="status">正在套用設定…</p>}
    <p className="small muted">{live ? '封詞中切換秒數會從套用時重新計時，選「不限時」會停止倒數。' : '選擇後立即套用，並清除全員準備。正式局會用匿名瀏覽器身分累計相遇次數，排行榜只顯示暱稱和次數。'}</p>
    <ErrorMessage>{error}</ErrorMessage>
  </section>;
}
