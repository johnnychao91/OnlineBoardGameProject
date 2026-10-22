import type { MoonState } from '../games/moon/game';

export interface MoonPosterOptions { G: MoonState; players: { id: string | number; name?: string }[]; step: number; totalSteps: number }
function clean(value: string, limit = 24) { return Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join(''); }
const bounded = (n: number, max: number, fallback = 0) => Number.isFinite(n) ? Math.max(0, Math.min(max, Math.trunc(n))) : fallback;

/** Copy only named public fields; never read roles, private, secret, or current night targets. */
export function buildMoonPosterModel({ G, players, step, totalSteps }: MoonPosterOptions) {
  const nameOf = (id: string) => clean(players.find(player => String(player.id) === id)?.name || '乘客');
  const total = Math.max(1, bounded(totalSteps, 999999, 1));
  const latest = G.log.filter(entry => ['dawn', 'vote', 'hunter', 'explosion', 'idiot', 'sheriff-election', 'sheriff-transfer'].includes(entry.type)).at(-1);
  return {
    day: Math.max(1, bounded(G.day, 999, 1)), step: Math.min(Math.max(1, bounded(step, 999999, 1)), total), totalSteps: total,
    living: Object.values(G.players).filter(player => player.alive === true).length,
    passengers: Object.keys(G.players).length,
    outcome: G.status === 'finished' && (G.winner === 'town' || G.winner === 'wolves' || G.winner === 'draw') ? G.winner : 'ongoing',
    sheriff: G.sheriffID ? nameOf(G.sheriffID) : null,
    latest: latest ? {
      type: latest.type, shooter: latest.type === 'hunter' && latest.role === 'wolf-king' ? '狼王' : '獵人', day: Math.max(1, bounded(latest.day, 999, 1)),
      actor: ['hunter', 'explosion', 'idiot', 'sheriff-transfer'].includes(latest.type) ? latest.actorID ? nameOf(latest.actorID) : null : null,
      target: latest.type !== 'dawn' && latest.targetID ? nameOf(latest.targetID) : null,
      deaths: latest.type === 'dawn' ? (latest.deaths ?? []).slice(0, 12).map(nameOf) : [],
      ballots: latest.type === 'vote' || latest.type === 'sheriff-election' ? Object.entries(latest.votes ?? {}).slice(0, 12).map(([id, target]) => ({ voter: nameOf(id), target: target ? nameOf(target) : '棄票', weight: latest.type === 'vote' && latest.weights?.[id] === 3 ? 1.5 : 1 })) : [],
      tied: latest.type === 'vote' || latest.type === 'sheriff-election' ? (latest.tied ?? []).slice(0, 12).map(nameOf) : [],
    } : null,
  };
}
const font = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = '#f1e7d2', weight = 500, width = 910) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const chars = Array.from(value); let fitted = value;
  while (chars.length && ctx.measureText(fitted).width > width) { chars.pop(); fitted = chars.join('') + '…'; }
  ctx.fillText(fitted, x, y);
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, 20); ctx.fillStyle = '#252b36'; ctx.fill(); ctx.strokeStyle = '#9b8967'; ctx.lineWidth = 2; ctx.stroke();
}
export async function createMoonPoster(options: MoonPosterOptions): Promise<Blob> {
  const model = buildMoonPosterModel(options);
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立列車戰報。');
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350); gradient.addColorStop(0, '#252d40'); gradient.addColorStop(1, '#101721'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1350);
  // Public procedural moon, rail and carriage windows, independent of role artwork.
  ctx.fillStyle = '#d9d4bd'; ctx.beginPath(); ctx.arc(871, 165, 89, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#151d2b'; ctx.fillRect(0, 289, 1080, 110);
  for (let x = 45; x < 1080; x += 115) { ctx.fillStyle = '#84744e'; ctx.fillRect(x, 310, 67, 40); }
  ctx.strokeStyle = '#756b57'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 392); ctx.lineTo(1080, 392); ctx.stroke();
  text(ctx, 'SILVER MOON EXPRESS / 公開旅程戰報', 65, 83, 20, '#e7c98f', 650);
  text(ctx, '銀月列車', 64, 181, 76, '#f2e8d2', 750, 710);
  text(ctx, '窗外是滿月，身旁的人未必是同伴。', 68, 237, 26, '#bdc5d1');
  panel(ctx, 64, 429, 952, 122);
  [['旅程', `第 ${model.day} 天`], ['仍在車上', `${model.living} / ${model.passengers}`], ['復盤位置', `${model.step} / ${model.totalSteps}`]].forEach(([label, value], i) => { text(ctx, label, 92 + i * 310, 467, 19, '#aab8cb'); text(ctx, value, 92 + i * 310, 516, 34, '#e7c98f', 700, 290); });
  panel(ctx, 64, 582, 952, 502);
  const latest = model.latest;
  text(ctx, '這一刻的公開紀錄', 94, 630, 21, '#b4bfd0', 650);
  let title = '列車即將出發。';
  if (latest?.type === 'dawn') title = latest.deaths.length ? '晨光照見空下來的座位。' : '平安夜，列車仍有希望。';
  if (latest?.type === 'vote') title = latest.target ? `餐車的決定：放逐 ${latest.target}` : latest.tied.length ? '票數相同，信任仍未落定。' : '這一次，沒有人被放逐。';
  if (latest?.type === 'hunter') title = latest.target ? latest.shooter + '的最後一槍。' : latest.shooter + '放下了槍。';
  if (latest?.type === 'explosion') title = latest.target ? '白狼王自爆，帶走一位乘客。' : '狼人自爆離場。';
  if (latest?.type === 'idiot') title = '白癡翻牌，留場繼續推理。';
  if (latest?.type === 'sheriff-election') title = latest.target ? `${latest.target} 接過警徽。` : '警長選舉未選出人選。';
  if (latest?.type === 'sheriff-transfer') title = latest.target ? `警徽交到 ${latest.target} 手中。` : '警徽已被銷毀。';
  text(ctx, title, 94, 704, 39, '#edcf97', 750, 885);
  if (latest?.ballots.length) {
    text(ctx, latest.type === 'vote' ? '公開票型' : '公開選舉票型', 94, 758, 20, '#b5c1d0');
    latest.ballots.forEach((vote, i) => text(ctx, `${vote.voter}${vote.weight === 1.5 ? ' ×1.5' : ''} → ${vote.target}`, 94 + (i % 2) * 441, 801 + Math.floor(i / 2) * 40, 22, '#e4e7ed', 500, 417));
  } else if (latest?.type === 'dawn') {
    text(ctx, latest.deaths.length ? '昨夜離場的乘客' : '沒有乘客在昨夜離場', 94, 779, 25, '#b5c1d0');
    latest.deaths.slice(0, 8).forEach((name, i) => text(ctx, name, 94 + (i % 2) * 441, 830 + Math.floor(i / 2) * 46, 28, '#e6e6e9', 600, 415));
    if (!latest.deaths.length) text(ctx, '謎團尚未解開，下一段對話正要開始。', 94, 874, 28, '#95d9c3');
  } else if (latest && ['hunter', 'explosion', 'idiot', 'sheriff-transfer'].includes(latest.type)) {
    text(ctx, latest.type === 'idiot' ? `${latest.actor ?? '乘客'} · 永久失去投票權` : `${latest.actor ?? '乘客'} → ${latest.target ?? (latest.type === 'explosion' ? '自爆離場' : '放棄')}`, 94, 822, 37, '#e4e7ed', 650, 870);
    text(ctx, '一個決定，改變這班列車的方向。', 94, 917, 28, '#b5c1d0');
  } else text(ctx, '每段發言、每張公開選票，都會留下線索。', 94, 833, 28, '#b5c1d0', 500, 870);
  const result = model.outcome === 'town' ? '好人獲勝 · 列車駛向晨光' : model.outcome === 'wolves' ? '狼人獲勝 · 滿月掌握列車' : model.outcome === 'draw' ? '平局 · 雙方全數離場' : '旅程仍在繼續 · 留下這一刻';
  text(ctx, result, 70, 1158, 36, model.outcome === 'wolves' ? '#ff9ca3' : '#e7c98f', 700, 950);
  ctx.strokeStyle = '#786f5e'; ctx.beginPath(); ctx.moveTo(70, 1227); ctx.lineTo(1010, 1227); ctx.stroke();
  text(ctx, '捷寶桌遊室', 70, 1290, 26, '#eee8d9', 650);
  ctx.save(); ctx.textAlign = 'right'; text(ctx, '公開事件戰報 / SILVER MOON', 1010, 1288, 18, '#aeb8c7'); ctx.restore();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('列車戰報產生失敗，請重試。')), 'image/png'));
}
