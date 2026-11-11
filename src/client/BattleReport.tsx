import { useEffect, useRef, useState } from 'react';
import type { Perspective, RoomInfo } from './api';
import { clientGames } from './game-registry';
import { ErrorMessage } from './ui';

export function BattleReport({ G, info, frameIndex = 0, totalFrames = 1, perspective, label = '製作這一步的戰報圖', beforeCreate }: { G: unknown; info: RoomInfo; frameIndex?: number; totalFrames?: number; perspective: Perspective; label?: string; beforeCreate?: () => void }) {
  const [preview, setPreview] = useState<{ url: string; blob: Blob; showImage: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const currentUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const render = clientGames[info.gameName]?.createPoster;
  const wordChain = info.gameName === 'cup-echo';
  const filename = wordChain ? 'cup-echo-word-chain-full.png' : `boardgame-step-${frameIndex + 1}.png`;
  useEffect(() => () => { if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);
  useEffect(() => { generation.current += 1; setPreview(null); setError(''); setMessage(''); if (currentUrl.current) { URL.revokeObjectURL(currentUrl.current); currentUrl.current = null; } }, [info.roomId, info.matchID, frameIndex, perspective, totalFrames]);
  if (!render) return null;
  const makeReport = async () => {
    beforeCreate?.();
    setBusy(true); setError(''); setMessage('');
    const requestGeneration = generation.current;
    try {
      const blob = await render({ G, info, step: frameIndex + 1, totalSteps: totalFrames });
      // PNG stores its height in the IHDR chunk. Avoid decoding very tall exports in the page.
      const showImage = !wordChain || new DataView(await blob.slice(20, 24).arrayBuffer()).getUint32(0) <= 8192;
      if (requestGeneration !== generation.current) return;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      const url = URL.createObjectURL(blob); currentUrl.current = url; setPreview({ url, blob, showImage });
    } catch {
      if (requestGeneration === generation.current) setError(wordChain ? '整局詞鏈圖無法產生，請重試或換個瀏覽器。' : '戰報圖暫時無法產生，請稍後再試。');
    }
    finally { setBusy(false); }
  };
  function download() {
    if (!preview) return;
    const anchor = document.createElement('a'); anchor.href = preview.url; anchor.download = filename; anchor.click();
    setMessage(wordChain ? '逐輪詞鏈圖已準備下載。' : '戰報已準備下載，可直接把圖片傳給朋友。');
  }
  async function copyImage() {
    if (!preview) return;
    setError(''); setMessage('');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': preview.blob })]);
      setMessage('已複製逐輪詞鏈圖。');
    } catch { setError('這個瀏覽器無法複製圖片，請改用下載 PNG。'); }
  }
  async function shareImage() {
    if (!preview || (wordChain && window.matchMedia('(min-width: 701px)').matches)) return;
    const file = new File([preview.blob], filename, { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] }) || !navigator.share) return download();
    try { await navigator.share({ files: [file], title: wordChain ? '杯中回聲 · 逐輪詞鏈' : '未央酒肆 · 對局戰報' }); }
    catch (e) { if ((e as Error).name !== 'AbortError') { setError('這個瀏覽器無法分享圖片，可改為下載。'); } }
  }
  return <section className="battle-report">
    <button className="button secondary" disabled={busy} onClick={makeReport}>{busy ? '正在繪製戰報…' : wordChain ? '製作逐輪詞鏈圖' : label}</button>
    <p className="small muted">{wordChain ? '將全桌已揭曉的詞語、玩家暱稱與共鳴結果收錄在一張長圖。' : '只把公開操作、玩家暱稱與對局進度放進圖片，不包含邀請、網址、憑證或秘密牌面。'}</p>
    {preview && <div className={`report-preview${wordChain ? ' echo-chain-preview' : ''}`}>
      {preview.showImage
        ? <img src={preview.url} alt={wordChain ? '杯中回聲整局逐輪詞鏈圖' : `未央酒肆第 ${frameIndex + 1} 步的公開戰報`} />
        : <p className="small" role="status">整局長圖已完成，可直接下載查看。</p>}
      <div className="button-row">
        <button className={wordChain ? 'button primary echo-image-share' : 'button primary'} onClick={shareImage}>分享圖片</button>
        <button className="button secondary" onClick={download}>下載 PNG</button>
        {wordChain && <button className="button secondary" onClick={copyImage}>複製圖片</button>}
      </div>
    </div>}
    <p className="small feedback" role="status">{message}</p><ErrorMessage>{error}</ErrorMessage>
  </section>;
}
