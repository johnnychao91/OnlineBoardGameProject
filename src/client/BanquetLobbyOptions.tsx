import { useEffect, useRef, useState } from 'react';
import { BANQUET_ROLES, BANQUET_ROLE_IDS, banquetRoleSet, normalizeBanquetOptions, validateBanquetOptions, type BanquetOptions, type BanquetRole } from '../games/banquet/rules';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { banquetPortrait } from './banquet-art';
import './banquet.css';

export function BanquetLobbyOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const options = normalizeBanquetOptions(info.gameOptions), count = info.players.filter(player => player.name && !player.departed).length;
  const host = isRoomHost(seat, info), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState<BanquetRole[] | null>(null), [pending, setPending] = useState<BanquetOptions | null>(null);
  const sending = useRef(false), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const latest = useRef({ info, onBusy, onUpdate }); latest.current = { info, onBusy, onUpdate };
  const locks = useRef({ draft: false, request: false }), emittedLock = useRef(false);
  function lock(kind: 'draft' | 'request', value: boolean) {
    locks.current[kind] = value;
    const locked = locks.current.draft || locks.current.request;
    if (emittedLock.current !== locked) { emittedLock.current = locked; latest.current.onBusy(locked); }
  }
  function edit(next: BanquetRole[] | null) { lock('draft', host && next !== null); setDraft(next); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); latest.current.onBusy(false); }; }, []);
  useEffect(() => { edit(null); }, [info.matchID]);
  useEffect(() => { lock('draft', host && draft !== null); }, [host, draft !== null]);
  async function update(next: BanquetOptions) {
    if (!host || disabled || sending.current || info.status !== 'lobby') return;
    const invalid = validateBanquetOptions(next); if (invalid) { setError(invalid); return; }
    const matchID = info.matchID; sending.current = true; setBusy(true); setPending(next); setError(''); lock('request', true);
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const result = await api<RoomInfo>(`/api/rooms/${seat.roomId}/options`, { method: 'POST', body: JSON.stringify({ matchID, options: next }), signal: controller.signal }, seat);
      if (mounted.current && latest.current.info.matchID === matchID) { latest.current.onUpdate(result); edit(null); }
    } catch (cause) { if (mounted.current && latest.current.info.matchID === matchID) setError(controller.signal.aborted ? '尚未確認設定已儲存，請確認連線後重試。' : (cause as Error).message); }
    finally { window.clearTimeout(timeout); request.current = null; sending.current = false; if (mounted.current) { setBusy(false); setPending(null); lock('request', false); } }
  }
  const shown = pending ?? options, blocked = disabled || busy || !host || info.status !== 'lobby';
  const previewCount = Math.min(12, Math.max(4, count)), roles = draft ?? banquetRoleSet(shown, previewCount);
  const draftOptions: BanquetOptions = { scenario: 'custom', customRoles: roles };
  const issue = validateBanquetOptions(draft !== null ? draftOptions : shown, count >= 4 ? count : undefined);
  function toggle(role: BanquetRole) {
    lock('draft', true);
    setDraft(current => { const existing = current ?? roles; return existing.includes(role) ? existing.filter(value => value !== role) : [...existing, role, ...(role === 'peasant' ? [role] : [])]; });
  }
  return <section className="panel banquet-options" aria-label="百鬼夜宴本局設定"><div className="eyebrow">CHOOSE TONIGHT'S MASKS</div><h3>今夜，誰來赴宴？</h3><p>燈影之下，面具易主，名字卻任你宣告。每位賓客帶著 6 枚妖金入席，先累積到 13 枚的人贏得夜宴。</p>
    <label className="banquet-field">面具場景<select value={draft !== null ? 'custom' : shown.scenario} disabled={blocked} onChange={event => {
      const scenario = event.target.value as BanquetOptions['scenario'];
      if (scenario === 'custom') edit(shown.scenario === 'custom' ? [...shown.customRoles] : banquetRoleSet(shown, previewCount));
      else { edit(null); void update({ scenario, customRoles: shown.customRoles }); }
    }}><option value="A">場景 A · 隨開局人數配置</option><option value="B">場景 B · 隨開局人數配置</option><option value="custom">自訂面具 · 手動配置</option></select></label>
    <p className="small muted">{count < 4 ? '目前先預覽 4 人配置。' : `目前 ${count} 位參與玩家。`}{draft !== null ? '編輯中的自訂配置尚未儲存。' : shown.scenario === 'custom' ? '使用已儲存的自訂面具。' : '正式名單依開局時人數決定。'}觀戰者不占席。</p>
    {(draft !== null || shown.scenario === 'custom') && <><div className="banquet-custom-roles">{BANQUET_ROLE_IDS.map(role => <label key={role} data-selected={roles.includes(role)}><input type="checkbox" disabled={blocked} checked={roles.includes(role)} onChange={() => toggle(role)} /><span>{BANQUET_ROLES[role].name}{role === 'peasant' ? ' × 2' : ''}<small>{BANQUET_ROLES[role].minPlayers} 人起{BANQUET_ROLES[role].producesCoins ? ' · 金庫收入' : ''}</small></span></label>)}</div>
      <p className="small">自訂須有閻魔，小豆洗成對；至少三分之一面具帶來金庫收入。4～5 人固定 6 張，6 人以上使用人數至人數加 2 張，多的面具放中央。</p>
      {draft !== null && <><p className="small banquet-warning" role="status">面具配置尚未儲存，請儲存或取消編輯後再準備、開局。</p><div className="banquet-option-actions"><button className="button primary" disabled={blocked || !!validateBanquetOptions(draftOptions)} onClick={() => void update(draftOptions)}>儲存自訂配置</button><button className="button secondary" disabled={blocked} onClick={() => edit(null)}>取消編輯</button></div></>}</>}
    <details className="banquet-setup-preview" open><summary>本局面具預覽 · {roles.length} 張</summary><div>{roles.map((role, index) => <article key={`${role}:${index}`}><img src={banquetPortrait(role)} alt="" loading="lazy" /><span><b>{BANQUET_ROLES[role].name}</b><small>{BANQUET_ROLES[role].description}</small></span></article>)}</div></details>
    <p className="small muted">{host ? '預設場景變更即時儲存；自訂名單需按儲存。設定變更會清除全員準備，人數限制在開局時再次檢查。' : '由房主選擇面具配置；變更後請重新準備。'}沒有行動倒數。{busy && ' 正在儲存…'}</p>
    {(error || issue) && <p className="error-message" role="status">{error || issue}</p>}
  </section>;
}
