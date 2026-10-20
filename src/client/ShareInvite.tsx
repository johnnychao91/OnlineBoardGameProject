import { useContext, useState } from 'react';
import { api, saveInvite } from './api';
import { RoomContext } from './room-context';
import { ErrorMessage, Icon } from './ui';

export function ShareInvite({ active }: { active: boolean }) {
  const { seat, inviteUrl, setInviteUrl } = useContext(RoomContext)!;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  async function copy() {
    setError('');
    try { await navigator.clipboard.writeText(inviteUrl); setMessage('已複製邀請，貼給朋友就可以了。'); }
    catch { setManual(true); setMessage('請長按下方連結，選擇複製。'); }
  }
  async function share() {
    if (!navigator.share) return copy();
    try { await navigator.share({ title: '一起來捷寶桌遊室', text: '一起來我們的私人桌遊室，參與遊戲或觀戰。', url: inviteUrl }); }
    catch (e) { if ((e as Error).name !== 'AbortError') setError('分享沒有完成，可以改用複製連結。'); }
  }
  async function rotate() {
    setBusy(true); setError('');
    try {
      const result = await api<{ inviteUrl: string }>(`/api/rooms/${seat.roomId}/invite`, { method: 'POST', body: '{}' }, seat);
      saveInvite(seat.roomId, result.inviteUrl); setInviteUrl(result.inviteUrl); setMessage('新邀請已建立，之前的連結已失效。');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="invite-card"><div className="invite-heading"><span className="icon-tile"><Icon type="link" /></span><div><h3>把這一桌，分享給朋友</h3><p>參與或觀戰，都用同一個邀請連結。</p></div></div>{inviteUrl && active && <div className="button-row"><button className="button primary" onClick={share}><Icon type="link" />分享邀請</button><button className="button secondary" onClick={copy}><Icon type="copy" />複製連結</button></div>}{manual && active && <input aria-label="手動複製邀請連結" readOnly className="manual-invite" value={inviteUrl} onFocus={e => e.currentTarget.select()} />}<p className="small muted">邀請於建立後 24 小時失效。只傳給這一桌的朋友。</p>{active && <details className="invite-controls"><summary>{inviteUrl ? '連結外流了？管理邀請' : '重新產生邀請'}</summary><p className="small muted">產生新連結會立即撤銷舊連結；已入座的朋友不受影響。</p><button className="text-button" disabled={busy} onClick={rotate}>{busy ? '正在更新…' : '撤銷舊連結並產生新邀請'}</button></details>}<p className="feedback small" role="status">{message}</p><ErrorMessage>{error}</ErrorMessage></section>;
}
