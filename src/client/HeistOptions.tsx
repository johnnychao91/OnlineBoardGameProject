import { useEffect, useRef, useState } from 'react';
import { normalizeHeistOptions, type HeistOptions as Options } from '../games/heist/rules';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { ErrorMessage } from './ui';
import './heist-options.css';

export function HeistOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const options = normalizeHeistOptions(info.gameOptions), host = isRoomHost(seat, info);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<Options | null>(null);
  const sending = useRef(false), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const latest = useRef({ info, onBusy, onUpdate }); latest.current = { info, onBusy, onUpdate };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); latest.current.onBusy(false); };
  }, []);
  async function update(hazardLimit: Options['hazardLimit']) {
    if (!host || disabled || sending.current || info.status !== 'lobby' || hazardLimit === options.hazardLimit) return;
    const matchID = info.matchID;
    sending.current = true; setBusy(true); setPending({ hazardLimit }); setError(''); latest.current.onBusy(true);
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const result = await api<RoomInfo>(`/api/rooms/${seat.roomId}/options`, {
        method: 'POST', body: JSON.stringify({ matchID, options: { hazardLimit } }), signal: controller.signal,
      }, seat);
      if (mounted.current && latest.current.info.matchID === matchID) latest.current.onUpdate(result);
    } catch (cause) {
      if (mounted.current && latest.current.info.matchID === matchID) setError(controller.signal.aborted
        ? '尚未確認設定已儲存，請確認連線後重試。' : (cause as Error).message);
    } finally {
      window.clearTimeout(timeout); request.current = null; sending.current = false;
      if (mounted.current) { setBusy(false); setPending(null); latest.current.onBusy(false); }
    }
  }
  return <section className="panel heist-options" aria-label="謝幕劫案本局設定">
    <h3>哪一道警訊讓演出落幕？</h3>
    <label>危機結束條件<select value={(pending ?? options).hazardLimit}
      disabled={disabled || busy || !host || info.status !== 'lobby'}
      onChange={event => void update(Number(event.target.value) as Options['hazardLimit'])}>
      <option value={2}>同類第 2 張危機卡 · 基本規則</option>
      <option value={3}>同類第 3 張危機卡</option>
    </select></label>
    <p className="small muted">只計算同一幕、同一種危機；不同種類不合併。達到所選張數即結束本幕，仍在場的人失去隨身贓物，僅移除造成封鎖的那一張牌。</p>
    <p className="small muted">{host ? '開局前可調整，選擇後即時儲存並清除全員準備；開局後固定。' : '由房主在開局前選擇；開局後固定。'}{busy && ' 正在儲存…'}</p>
    <ErrorMessage>{error}</ErrorMessage>
  </section>;
}
