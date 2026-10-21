import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FOG_OPTIONS, normalizeFogOptions, validateFogOptions, type FogOptions as Options } from '../games/fog/rules';
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
    <label>蘭斯洛特模式<select value={options.lancelotMode} disabled={blocked} onChange={event => void update({ ...options, lancelotMode: event.target.value as Options['lancelotMode'] })}><option value="off">不加入蘭斯洛特</option><option value="random">隨機模式 · 每座燈塔揭一張鐘牌</option><option value="forecast">預示模式 · 五座燈塔的鐘牌預先公開</option></select></label>
    <p className="small muted">{options.lancelotMode === 'off' ? '本局沒有效忠轉換。' : options.lancelotMode === 'random' ? '加入正、邪蘭斯洛特。每次新任務開始揭鐘，效忠可能互換；未來鐘牌不公開。' : '加入正、邪蘭斯洛特。開局公開五張鐘牌；效忠黑霧使徒的蘭斯洛特出征時必須侵蝕燈塔。'}</p>
    <div className="fog-option-roles">{([['percival', '派西維爾'], ['morgana', '莫甘娜'], ['mordred', '莫德雷德'], ['oberon', '奧伯倫']] as const).map(([key, name]) => <label key={key}><input type="checkbox" checked={options[key]} disabled={blocked} onChange={event => void update({ ...options, [key]: event.target.checked })} />{name}</label>)}</div>
    <p className="small muted">固定加入梅林與刺客，其餘席位由忠臣、爪牙補足。兩位蘭斯洛特各占一個陣營名額，特殊角色不能超過陣營席位；莫甘娜需搭配派西維爾。</p>
    <p className="small muted">{host ? '每次更改即時儲存，並清除全員準備；實際人數以開局時的參與席位為準。' : '由房主在開局前調整；更改後請重新準備。'}{busy ? ' 正在儲存…' : ''}</p>
    <ErrorMessage>{error || validation}</ErrorMessage>
  </section>;
}
