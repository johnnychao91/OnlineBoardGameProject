import { useEffect, useRef, useState } from 'react';
import type { StationObserverState } from '../games/station/game';
import type { Perspective, RoomInfo } from './api';
import { createReplayPoster } from './replay-poster';
import { ErrorMessage } from './ui';

interface PosterOptions { G: unknown; info: RoomInfo; step: number; totalSteps: number; }
/** A game can add its original report renderer without changing the replay controls. */
const posterRenderers: Record<string, (options: PosterOptions) => Promise<Blob>> = {
  'space-station': ({ G, info, step, totalSteps }) => createReplayPoster({ G: G as StationObserverState, players: info.players, step, totalSteps }),
};

export function BattleReport({ G, info, frameIndex = 0, totalFrames = 1, perspective, label = '製作這一步的戰報圖', beforeCreate }: { G: unknown; info: RoomInfo; frameIndex?: number; totalFrames?: number; perspective: Perspective; label?: string; beforeCreate?: () => void }) {
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const currentUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const render = posterRenderers[info.gameName];
  useEffect(() => () => { if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);
  useEffect(() => { generation.current += 1; setPreview(null); setError(''); setMessage(''); if (currentUrl.current) { URL.revokeObjectURL(currentUrl.current); currentUrl.current = null; } }, [info.roomId, frameIndex, perspective, totalFrames]);
  if (!render) return null;
  async function makeReport() {
    beforeCreate?.();
    setBusy(true); setError(''); setMessage('');
    const requestGeneration = generation.current;
    try {
      const blob = await render({ G, info, step: frameIndex + 1, totalSteps: totalFrames });
      if (requestGeneration !== generation.current) return;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      const url = URL.createObjectURL(blob); currentUrl.current = url; setPreview({ url, blob });
    } catch { setError('戰報圖暫時無法產生，請稍後再試。'); }
    finally { setBusy(false); }
  }
  function download() {
    if (!preview) return;
    const anchor = document.createElement('a'); anchor.href = preview.url; anchor.download = `space-station-step-${frameIndex + 1}.png`; anchor.click();
    setMessage('戰報已準備下載，可直接把圖片傳給朋友。');
  }
  async function shareImage() {
    if (!preview) return;
    const file = new File([preview.blob], `space-station-step-${frameIndex + 1}.png`, { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] }) || !navigator.share) return download();
    try { await navigator.share({ files: [file], title: '太空維修站 · 任務戰報' }); }
    catch (e) { if ((e as Error).name !== 'AbortError') { setError('這個瀏覽器無法分享圖片，可改為下載。'); } }
  }
  return <section className="battle-report"><button className="button secondary" disabled={busy} onClick={makeReport}>{busy ? '正在繪製戰報…' : label}</button><p className="small muted">只把公開操作、玩家暱稱與任務進度放進圖片，不包含邀請、網址、憑證或秘密牌面。</p>{preview && <div className="report-preview"><img src={preview.url} alt={`太空維修站第 ${frameIndex + 1} 步的公開戰報`} /><div className="button-row"><button className="button primary" onClick={shareImage}>分享圖片</button><button className="button secondary" onClick={download}>下載 PNG</button></div></div>}<p className="small feedback" role="status">{message}</p><ErrorMessage>{error}</ErrorMessage></section>;
}
