import { useEffect, useRef, useState } from 'react';
import { BAKER_ERAS, type BakerEra } from '../games/baker/content';
import { normalizeBakerOptions, validateBakerOptions, type BakerOptions as Options } from '../games/baker/rules';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { ErrorMessage } from './ui';
import './baker.css';

export function BakerOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const options = normalizeBakerOptions(info.gameOptions);
  const players = info.players.filter(player => player.name && !player.departed);
  const host = isRoomHost(seat, info);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<Options | null>(null);
  const sending = useRef(false), mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const latest = useRef({ info, onBusy, onUpdate }); latest.current = { info, onBusy, onUpdate };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); latest.current.onBusy(false); }; }, []);
  async function update(next: Options) {
    if (!host || disabled || sending.current || info.status !== 'lobby') return;
    const matchID = info.matchID;
    sending.current = true; setBusy(true); setPending(next); setError(''); onBusy(true);
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const result = await api<RoomInfo>(`/api/rooms/${seat.roomId}/options`, { method: 'POST', body: JSON.stringify({ matchID, options: next }), signal: controller.signal }, seat);
      if (mounted.current && latest.current.info.matchID === matchID) latest.current.onUpdate(result);
    } catch (cause) {
      if (mounted.current && latest.current.info.matchID === matchID) setError(controller.signal.aborted ? '尚未確認設定已儲存，請確認連線後重試。' : (cause as Error).message);
    } finally {
      window.clearTimeout(timeout); request.current = null; sending.current = false;
      if (mounted.current) { setBusy(false); setPending(null); latest.current.onBusy(false); }
    }
  }
  const shown = pending ?? options, era = BAKER_ERAS[shown.era];
  const blocked = disabled || busy || !host || info.status !== 'lobby';
  const validation = players.length >= 4 ? validateBakerOptions(shown, players.length, players.map(player => String(player.id))) : undefined;
  return <section className="panel baker-options" aria-label="貝克街迷霧本局設定">
    <h3>打開一份倫敦案件卷宗</h3>
    <p className="baker-options-story">莫里亞蒂的犯罪網藏在不同年代的倫敦。福爾摩斯以現場線索引導調查，執行者與內應則試圖讓真相留在霧中。</p>
    <div className="baker-option-grid">
      <label>案件年代<select value={shown.era} disabled={blocked} onChange={event => {
        const nextEra = event.target.value as BakerEra;
        void update({ ...options, era: nextEra, year: BAKER_ERAS[nextEra].defaultYear });
      }}>{(Object.keys(BAKER_ERAS) as BakerEra[]).map(id => <option value={id} key={id}>{BAKER_ERAS[id].name}</option>)}</select></label>
      <label>案發年份<input type="number" key={`${info.matchID}:${shown.year}`} defaultValue={shown.year} min={era.minYear} max={era.maxYear} disabled={blocked || era.minYear === era.maxYear}
        onBlur={event => { const year = Number(event.target.value); if (year !== shown.year) void update({ ...options, year }); }} />
        <small>{era.minYear === era.maxYear ? `${era.minYear} 年` : `${era.minYear}～${era.maxYear} 年`}</small></label>
    </div>
    <p>{era.description} 每個年代各有 400 張現場物證與 180 張作案手段；案發年份公開顯示，破案不需要猜年份。</p>
    <label>角色配置<select value={shown.roleSet} disabled={blocked} onChange={event => void update({ ...options, roleSet: event.target.value as Options['roleSet'] })}>
      <option value="auto">依人數配置 · 6 人起加入華生與內應</option>
      <option value="basic">基本調查 · 福爾摩斯、執行者與倫敦警察</option>
      <option value="accomplice">犯罪內應 · 6～12 人</option>
      <option value="all">目擊反轉 · 華生與內應 · 6～12 人</option>
    </select></label>
    <label>福爾摩斯由誰擔任？<select value={shown.holmesID} disabled={blocked} onChange={event => void update({ ...options, holmesID: event.target.value })}>
      <option value="random">開局隨機選一人</option>
      {players.map(player => <option value={String(player.id)} key={player.id}>{player.name}</option>)}
      {shown.holmesID !== 'random' && !players.some(player => String(player.id) === shown.holmesID) && <option value={shown.holmesID}>原指定成員尚未入座</option>}
    </select></label>
    <label>每人桌面的牌數<select value={shown.cardsPerType} disabled={blocked} onChange={event => void update({ ...options, cardsPerType: Number(event.target.value) as Options['cardsPerType'] })}>
      <option value={3}>各 3 張 · 較容易辨認</option><option value={4}>各 4 張 · 標準調查</option><option value={5}>各 5 張 · 更多可能性</option>
    </select></label>
    <label className="baker-check-option"><input type="checkbox" checked={shown.specialScenes} disabled={blocked}
      onChange={event => void update({ ...options, specialScenes: event.target.checked })} /><span>加入 12 塊特別圖板<small>第二、三輪可能出現的原創案件事件。</small></span></label>
    <p className="baker-option-note">{host ? '變更即時儲存並清除全員準備；年份輸入後離開欄位即可儲存。' : '由房主在開局前設定。'}觀戰者不占參與人數。{busy && ' 正在儲存…'}</p>
    <ErrorMessage>{error || validation}</ErrorMessage>
  </section>;
}
