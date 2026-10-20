import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, isRoomHost, type AuthSession, type Perspective, type RoomInfo } from './api';
import { BattleReport } from './BattleReport';
import { clientGames } from './game-registry';
import { PerspectiveNote, PerspectiveSwitch } from './ObservationPanel';
import { ErrorMessage, Header } from './ui';

interface ReplayFrame { stateID: number; at: number | string; G: unknown; }
interface ReplayData { complete: boolean; frames: ReplayFrame[]; room?: RoomInfo; }
interface SharedReplayData extends ReplayData { room: RoomInfo; perspective: Perspective; frameIndex: number; }

const sharedTokenKey = (roomId: string) => `friends-table.replay-share.${roomId}`;
export function captureReplayShare() {
  const match = location.pathname.match(/^\/replay\/([A-Za-z0-9_-]+)\/?$/);
  if (!match || !location.hash) return;
  const token = new URLSearchParams(location.hash.slice(1)).get('share');
  if (token && token.length <= 256) sessionStorage.setItem(sharedTokenKey(match[1]), token);
  history.replaceState(null, '', location.pathname);
}

export function ReplayPanel({ seat, info, matchID = info.matchID, initialLast = false }: {
  seat: AuthSession; info: RoomInfo; matchID?: string; initialLast?: boolean;
}) {
  const [perspective, setPerspective] = useState<Perspective>('blind');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [data, setData] = useState<{ matchID: string; perspective: Perspective; replay: ReplayData } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setError('');
    api<ReplayData>(`/api/rooms/${seat.roomId}/replay?matchID=${encodeURIComponent(matchID)}&perspective=${perspective}`, { signal: controller.signal }, seat)
      .then(replay => { if (!controller.signal.aborted) setData({ matchID, perspective, replay }); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [seat.roomId, seat.credentials, matchID, perspective]);
  return <section className="replay-panel"><div className="observer-toolbar"><div><div className="eyebrow">REPLAY THE MISSION</div><h2>這一步，重新看一次。</h2><p className="small muted">逐步查看歷史，任何操作都不會改變已結束的對局。</p></div><PerspectiveSwitch perspective={perspective} onChange={setPerspective} /></div><PerspectiveNote perspective={perspective} /><ErrorMessage>{error}</ErrorMessage>{data?.perspective === perspective && data.matchID === matchID ? <ReplayViewer key={`${matchID}-${perspective}`} info={data.replay.room ?? info} data={data.replay} perspective={perspective} seat={seat} matchID={matchID} canManageShares={isRoomHost(seat, info)} initialIndex={selectedIndex ?? (initialLast ? data.replay.frames.length - 1 : 0)} onIndexChange={setSelectedIndex} /> : !error && <p className="loading" role="status">正在讀取對局紀錄…</p>}</section>;
}

export function SharedReplay({ roomId }: { roomId: string }) {
  const [data, setData] = useState<SharedReplayData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const token = sessionStorage.getItem(sharedTokenKey(roomId));
    if (!token) { setError('分享資訊不完整。請重新開啟朋友傳來的完整復盤連結。'); return; }
    const controller = new AbortController();
    api<SharedReplayData>(`/api/replays/${roomId}`, { signal: controller.signal, headers: { 'X-Replay-Token': token } })
      .then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [roomId]);
  return <><Header /><main className="shared-replay"><div className="observer-toolbar"><div><div className="eyebrow">A MOMENT WORTH SHARING</div><h1>朋友分享的任務片刻</h1><p className="small muted">公開唯讀復盤 · 不提供座位或對局操作權限</p></div>{data && <span className="room-tag">固定{data.perspective === 'god' ? '上帝' : '盲'}視角</span>}</div><ErrorMessage>{error}</ErrorMessage>{data ? <><PerspectiveNote perspective={data.perspective} shared /><ReplayViewer key={roomId} info={data.room} data={data} perspective={data.perspective} initialIndex={data.frameIndex} /></> : !error && <p className="loading" role="status">正在開啟朋友分享的復盤…</p>}</main></>;
}

function ReplayViewer({ info, data, perspective, initialIndex = 0, seat, matchID = info.matchID, canManageShares = false, onIndexChange }: { info: RoomInfo; data: ReplayData; perspective: Perspective; initialIndex?: number; seat?: AuthSession; matchID?: string; canManageShares?: boolean; onIndexChange?: (index: number) => void }) {
  const { frames } = data;
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, frames.length - 1)));
  const [playing, setPlaying] = useState(false);
  const definition = clientGames[info.gameName];
  const frame = frames[index];
  useEffect(() => { onIndexChange?.(index); }, [index, onIndexChange]);
  useEffect(() => {
    if (!playing || !data.complete || frames.length < 2) return;
    const timer = window.setTimeout(() => { const next = Math.min(index + 1, frames.length - 1); setIndex(next); if (next === frames.length - 1) setPlaying(false); }, 1800);
    return () => clearTimeout(timer);
  }, [playing, data.complete, frames.length, index]);
  function seek(next: number) { setPlaying(false); setIndex(Math.max(0, Math.min(next, frames.length - 1))); }
  if (!definition) return <ErrorMessage>此遊戲尚未註冊復盤介面。</ErrorMessage>;
  if (!data.complete || frames.length === 0) return <section className="panel incomplete-replay"><h3>這局沒有完整的逐步回放</h3><p className="muted">較早版本的對局可能只保存最後狀態，無法還原完整過程。這裡不會用最後畫面冒充歷史紀錄。</p>{frames.length > 0 && <BattleReport G={frames[frames.length - 1].G} info={info} perspective={perspective} />}</section>;
  const Snapshot = definition.Snapshot;
  return <><section className="replay-controls panel"><div className="section-heading"><strong>步驟 {index + 1} / {frames.length}</strong><span>{Number.isNaN(new Date(frame.at).valueOf()) ? '' : new Date(frame.at).toLocaleTimeString('zh-TW')}</span></div><label className="visually-hidden" htmlFor="replay-timeline">復盤時間軸</label><input id="replay-timeline" type="range" min={0} max={frames.length - 1} value={index} step={1} onChange={e => seek(Number(e.target.value))} aria-valuetext={`第 ${index + 1} 步，共 ${frames.length} 步`} /><div className="replay-buttons"><button className="button secondary" disabled={index === 0} onClick={() => seek(index - 1)}>← 上一步</button><button className="button primary" disabled={frames.length < 2} onClick={() => { if (index === frames.length - 1 && !playing) setIndex(0); setPlaying(!playing); }}>{playing ? '暫停播放' : '自動播放'}</button><button className="button secondary" disabled={index === frames.length - 1} onClick={() => seek(index + 1)}>下一步 →</button></div></section><Snapshot G={frame.G} info={info} perspective={perspective} replay /><section className="replay-sharing panel"><div className="section-heading"><h2>留下這個瞬間</h2><span>第 {index + 1} 步</span></div>{seat && <ShareReplay seat={seat} info={info} matchID={matchID} canManageShares={canManageShares} frameIndex={index} perspective={perspective} beforeShare={() => setPlaying(false)} />}<BattleReport G={frame.G} info={info} frameIndex={index} totalFrames={frames.length} perspective={perspective} beforeCreate={() => setPlaying(false)} /></section></>;
}

function ShareReplay({ seat, info, matchID, canManageShares, frameIndex, perspective, beforeShare }: { seat: AuthSession; info: RoomInfo; matchID: string; canManageShares: boolean; frameIndex: number; perspective: Perspective; beforeShare: () => void }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const shareRequest = useRef<AbortController | null>(null);
  // Invalidate before the changed step is painted, including on unmount.
  useLayoutEffect(() => {
    generation.current += 1;
    setLink(''); setMessage(''); setError(''); setBusy(false);
    return () => { generation.current += 1; shareRequest.current?.abort(); shareRequest.current = null; };
  }, [matchID, frameIndex, perspective]);
  async function share() {
    beforeShare(); setBusy(true); setError('');
    const requestGeneration = ++generation.current;
    shareRequest.current?.abort();
    const controller = new AbortController(); shareRequest.current = controller;
    const isCurrent = () => requestGeneration === generation.current && !controller.signal.aborted;
    try {
      const result = await api<{ url: string; expiresAt: number }>(`/api/rooms/${info.roomId}/share`, { method: 'POST', body: JSON.stringify({ matchID, frameIndex, perspective }), signal: controller.signal }, seat);
      if (!isCurrent()) return;
      setLink(result.url);
      if (navigator.share) {
        try { await navigator.share({ title: '捷寶桌遊室 · 這一步你怎麼看？', text: `第 ${frameIndex + 1} 步的${perspective === 'god' ? '上帝' : '盲'}視角復盤`, url: result.url }); if (isCurrent()) setMessage('復盤連結已準備好，有效 7 天。'); return; }
        catch (e) { if (!isCurrent()) return; if ((e as Error).name === 'AbortError') { setMessage('分享已取消，仍可複製下方連結。'); return; } }
      }
      if (isCurrent()) await copy(result.url, requestGeneration);
    } catch (e) { if (isCurrent()) setError((e as Error).message); }
    finally { if (isCurrent()) { setBusy(false); shareRequest.current = null; } }
  }
  async function copy(url = link, requestGeneration = generation.current) {
    if (requestGeneration !== generation.current) return;
    try { await navigator.clipboard.writeText(url); if (requestGeneration === generation.current) setMessage('已複製復盤連結，有效 7 天。'); }
    catch { if (requestGeneration === generation.current) setMessage('請長按下方連結手動複製。'); }
  }
  async function revoke() {
    setBusy(true); setError('');
    try { await api(`/api/rooms/${info.roomId}/revoke-shares`, { method: 'POST', body: '{}' }, seat); setLink(''); setMessage('這個房間先前產生的所有復盤分享都已撤銷。'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="share-replay"><p className={`small ${perspective === 'god' ? 'amber' : 'muted'}`}>將分享第 {frameIndex + 1} 步的{perspective === 'god' ? '上帝視角，持有連結的人可看到全部參與者的秘密資訊與牌面' : '盲視角，只顯示公開資訊'}。朋友可以前後查看整局；連結有效 7 天。</p><button className="button primary" disabled={busy} onClick={share}>{busy ? '正在處理…' : `分享這一步（${perspective === 'god' ? '上帝' : '盲'}視角）`}</button>{link && <div className="manual-share"><input readOnly aria-label="復盤分享連結" value={link} onFocus={e => e.currentTarget.select()} /><button className="button secondary" onClick={() => copy()}>複製連結</button></div>}{canManageShares && <details className="invite-controls"><summary>管理房間的復盤分享</summary><p className="small muted">撤銷後，這個房間所有對局的既有分享連結都會失效；已下載的圖片不受影響。</p><button className="text-button" disabled={busy} onClick={revoke}>撤銷房間所有復盤分享</button></details>}<p role="status" className="small feedback">{message}</p><ErrorMessage>{error}</ErrorMessage></div>;
}
