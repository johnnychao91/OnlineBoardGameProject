import { useEffect, useRef, useState } from 'react';
import { normalizeMoonOptions, normalizeMoonSeconds, MOON_TIME_LIMITS, moonRoleDeck, MOON_ROLES, type MoonTimeOption, type MoonOptions as Options } from '../games/moon/rules';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { ErrorMessage } from './ui';
import './moon.css';

const timeFields = [['speechSeconds', '每人發言'], ['nightSeconds', '每個夜間時段'], ['voteSeconds', '放逐投票']] as const;
const timeText = (options: Options) => Object.fromEntries(timeFields.map(([key]) => [key, String(options[key])])) as Record<MoonTimeOption, string>;

/** Preserve in-progress typing, then normalize on blur or submission. */
export function moonTimeFromDraft(key: MoonTimeOption, text: string, fallback: number) {
  const value = text.trim() === '' ? fallback : Number(text);
  return normalizeMoonSeconds(key, Number.isInteger(value) ? value : fallback);
}

export function MoonOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const options = normalizeMoonOptions(info.gameOptions);
  const optionsKey = JSON.stringify(options);
  const [draft, setDraft] = useState(options);
  const [times, setTimes] = useState(() => timeText(options));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false), mounted = useRef(true), match = useRef(info.matchID);
  match.current = info.matchID;
  useEffect(() => { const next = normalizeMoonOptions(info.gameOptions); setDraft(next); setTimes(timeText(next)); }, [info.matchID, optionsKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const host = isRoomHost(seat, info);
  const blocked = disabled || busy || !host || info.status !== 'lobby';
  function normalizeDraft(next = draft) {
    const normalized = { ...next };
    for (const [key] of timeFields) normalized[key] = moonTimeFromDraft(key, times[key], draft[key]);
    setDraft(normalized); setTimes(timeText(normalized));
    return normalized;
  }
  function finishTyping(key: MoonTimeOption) {
    const value = moonTimeFromDraft(key, times[key], draft[key]);
    setDraft(current => ({ ...current, [key]: value }));
    setTimes(current => ({ ...current, [key]: String(value) }));
  }
  async function update(next: Options) {
    if (blocked || sending.current) return;
    let validated: Options;
    try { validated = normalizeMoonOptions(next); } catch (cause) { setError((cause as Error).message); return; }
    const submitted = info.matchID;
    sending.current = true; setBusy(true); setError(''); onBusy(true);
    try {
      const result = await api<RoomInfo>(`/api/rooms/${seat.roomId}/options`, { method: 'POST', body: JSON.stringify({ matchID: submitted, options: validated }) }, seat);
      if (mounted.current && match.current === submitted) onUpdate(result);
    } catch (cause) { if (mounted.current && match.current === submitted) setError((cause as Error).message); }
    finally { sending.current = false; if (mounted.current) { setBusy(false); onBusy(false); } }
  }
  const count = info.players.filter(player => player.name && !player.departed).length;
  const roles = count >= 6 && count <= 12 ? moonRoleDeck(count) : [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(options) || timeFields.some(([key]) => times[key] !== String(options[key]));
  return <section className="panel moon-options" aria-label="銀月列車房規">
    <h3>選擇搭乘方式與發言時間</h3>
    <label>遊玩模式<select value={draft.mode} disabled={blocked} onChange={event => { const next = normalizeDraft({ ...draft, mode: event.target.value as Options['mode'] }); void update(next); }}><option value="online">線上模式 · 遠端推理</option><option value="assisted">輔助模式 · 現場免裁判</option></select></label>
    <p className="small muted">{draft.mode === 'assisted' ? '每人使用自己的手機、平板或電腦。白天現場發言，夜間按照裝置指示秘密操作；狼人可在自己的畫面相認。' : '沿用線上房間、觀戰、回放與分享，與朋友一同搭乘這班夜行列車。'}</p>
    <label className="moon-sheriff-toggle"><input type="checkbox" checked={draft.sheriff} disabled={blocked} onChange={event => { const next = normalizeDraft({ ...draft, sheriff: event.target.checked }); void update(next); }} />本局啟用警長競選</label>
    <p className="small muted">警長不是額外角色。開啟後，第一個白天可競選；當選者決定發言順序，放逐票算 1.5 票，離場時可移交或銷毀警徽。</p>
    <div className="moon-option-times">{timeFields.map(([key, label]) => <label key={key}>{label}<div><input type="number" inputMode="numeric" min={MOON_TIME_LIMITS[key].min} max={MOON_TIME_LIMITS[key].max} step="1" value={times[key]} disabled={blocked} onChange={event => setTimes(current => ({ ...current, [key]: event.target.value }))} onBlur={() => finishTyping(key)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!blocked) void update(normalizeDraft()); } }} /><span>秒</span></div><small>{MOON_TIME_LIMITS[key].min}～{MOON_TIME_LIMITS[key].max} 秒</small></label>)}</div>
    {host && <button className="button secondary" disabled={blocked || !dirty} onClick={() => void update(normalizeDraft())}>{busy ? '儲存中…' : '套用倒數設定'}</button>}
    <p className="small muted">發言本人可提前結束。守衛、預言家、女巫完成操作，或存活狼人選擇一致後，最多再等 3 秒切換。無人完成時保留原倒數；巡查票券不影響進度。投票逾時視為棄票。</p>
    {roles.length > 0 && <p className="moon-role-configuration">目前 {count} 人配置：{Object.entries(MOON_ROLES).filter(([id]) => roles.includes(id as typeof roles[number])).map(([id, role]) => `${role.name} ${roles.filter(value => value === id).length}`).join(' ／ ')}</p>}
    <p className="small muted">{host ? '套用設定會清除全員準備；尚未套用的數字不會更改本局房規。' : '由房主在等待室調整；更新後請重新準備。'}</p><ErrorMessage>{error}</ErrorMessage>
  </section>;
}
