import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FOG_OPTIONS, FOG_ROLES, FOG_TWIN_KNIGHTS_LORE, normalizeFogOptions, validateFogOptions, type FogOptions as Options } from '../games/fog/rules';
import { api, isRoomHost, type AuthSession, type RoomInfo } from './api';
import { ErrorMessage } from './ui';

export function FogOptions({ seat, info, disabled, onBusy, onUpdate }: {
  seat: AuthSession; info: RoomInfo; disabled: boolean; onBusy: (busy: boolean) => void; onUpdate: (info: RoomInfo) => void;
}) {
  const options = normalizeFogOptions(info.gameOptions ?? DEFAULT_FOG_OPTIONS);
  const host = isRoomHost(seat, info);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const mounted = useRef(true);
  const match = useRef(info.matchID);
  match.current = info.matchID;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function update(next: Options) {
    if (!host || disabled || sending.current || info.status !== 'lobby') return;
    const submittedMatch = info.matchID;
    sending.current = true; setBusy(true); setError(''); onBusy(true);
    try {
      const result = await api<RoomInfo>(`/api/rooms/${seat.roomId}/options`, { method: 'POST', body: JSON.stringify({ matchID: submittedMatch, options: next }) }, seat);
      if (mounted.current && match.current === submittedMatch) onUpdate(result);
    } catch (error) { if (mounted.current && match.current === submittedMatch) setError((error as Error).message); }
    finally { sending.current = false; if (mounted.current) { setBusy(false); onBusy(false); } }
  }
  const count = info.players.filter(player => player.name && !player.departed).length;
  const validation = count >= 5 && count <= 10 ? validateFogOptions(options, count) : undefined;
  const blocked = disabled || busy || !host || info.status !== 'lobby';
  return <section className="panel fog-options" aria-label="黑霧襲城本局配置"><h3>詛咒之鐘與角色配置</h3>
    <label>詛咒之鐘模式<select value={options.lancelotMode} disabled={blocked} onChange={event => void update({ ...options, lancelotMode: event.target.value as Options['lancelotMode'] })}><option value="off">不加入雙鐘騎士</option><option value="random">隨機模式 · 每座燈塔揭一張鐘牌</option><option value="forecast">預示模式 · 五座燈塔的鐘牌預先公開</option></select></label>
    <p className="small muted">{options.lancelotMode === 'off' ? '本局沒有效忠轉換。' : options.lancelotMode === 'random' ? '加入晨鐘騎士與沉鐘騎士。每次新任務開始揭鐘，效忠可能互換；未來鐘牌不公開。' : '加入晨鐘騎士與沉鐘騎士。開局公開五張鐘牌；效忠黑霧使徒的雙鐘騎士出征時必須侵蝕燈塔。'}</p>
    {options.lancelotMode !== 'off' && <details className="small"><summary>雙鐘騎士的誓約</summary><p>{FOG_TWIN_KNIGHTS_LORE}</p></details>}
    <div className="fog-option-roles">{(['percival', 'morgana', 'mordred', 'oberon'] as const).map(key => <label key={key}><input type="checkbox" checked={options[key]} disabled={blocked} onChange={event => void update({ ...options, [key]: event.target.checked })} />{FOG_ROLES[key].name}</label>)}</div>
    <p className="small muted">固定加入逐星神諭者與深海之刃，其餘席位由城郊守衛、迷霧信徒補足。晨鐘騎士與沉鐘騎士各占所屬初始陣營的一個名額，特殊角色不能超過陣營席位；幻淵祭司需搭配聆諭騎士。</p>
    <p className="small muted">{host ? '每次更改即時儲存，並清除全員準備；實際人數以開局時的參與席位為準。' : '由房主在開局前調整；更改後請重新準備。'}{busy ? ' 正在儲存…' : ''}</p>
    <ErrorMessage>{error || validation}</ErrorMessage>
  </section>;
}
