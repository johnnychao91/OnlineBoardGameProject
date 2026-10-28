import type { HeistState } from '../games/heist/game';
import { HEIST_ARTIFACTS, HEIST_HAZARDS, type HeistCard } from '../games/heist/content';
import type { PosterOptions } from './game-types';
import { heistArt } from './heist-art';
import { heistHazardLimit } from '../games/heist/rules';

const clean = (value: string, limit = 40) => Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
const integer = (value: number) => Number.isFinite(value) ? Math.min(99999, Math.max(0, Math.trunc(value))) : 0;
function cardModel(card: HeistCard) {
  if (card.kind === 'loot') return { kind: 'loot', name: '贓物', value: integer(card.value), asset: `loot-${card.value >= 9 ? 'b' : 'a'}` };
  if (card.kind === 'hazard') return { kind: 'hazard', name: HEIST_HAZARDS[card.hazard].name, value: null, asset: `hazards/${card.hazard}` };
  return { kind: 'artifact', name: HEIST_ARTIFACTS[card.artifact].name, value: HEIST_ARTIFACTS[card.artifact].value, asset: `artifacts/${card.artifact}` };
}
/** Public whitelist only. Private vaults, sealed choices and the future deck are never read. */
export function buildHeistPosterModel({ G: state, info, step, totalSteps }: PosterOptions) {
  const G = state as HeistState, finished = G.status === 'finished';
  const nameOf = (id: string) => clean(info.players.find(player => String(player.id) === id)?.name || '劫案成員', 24);
  const total = Math.max(1, integer(totalSteps));
  return {
    round: integer(G.round), stage: integer(G.step), leftovers: integer(G.leftovers), deckCount: integer(G.deckCount), hazardLimit: heistHazardLimit(G.options),
    step: Math.min(Math.max(1, integer(step)), total), totalSteps: total, finished,
    players: G.turnOrder.map(id => {
      const player = G.players[id], score = finished ? G.finalScores[id] : undefined;
      return { name: nameOf(id), carried: integer(player.carried), exploring: player.exploring,
        artifacts: player.artifacts.map(artifact => ({ name: HEIST_ARTIFACTS[artifact].name, value: HEIST_ARTIFACTS[artifact].value })),
        total: score ? integer(score.total) : null, banked: score ? integer(score.banked) : null,
        winner: finished && G.winnerIDs.includes(id) };
    }),
    path: G.path.slice(-8).map(cardModel),
    events: G.log.slice(-5).map(event => ({ round: integer(event.round), step: integer(event.step),
      action: ({ 'round-start': '新一幕開場，珍藏加入牌堆', reveal: '下一段路線揭曉', decision: '密封決策同時公開', exit: '撤離成員已安全入庫', disaster: '同種警戒重複，路線封鎖', 'round-end': '本幕落下，等待全員確認', finish: '五幕結束，財富總帳公開' } as Record<string, string>)[event.type] ?? '公開劫案事件',
      card: event.card ? cardModel(event.card) : null })),
    outcome: finished ? '掌聲落下，財富歸於勝者' : G.status === 'review' ? '這一幕已謝幕' : '劫案仍在進行',
    winners: finished ? G.winnerIDs.map(nameOf) : [],
  };
}

const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
function write(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = '#efe1c8', weight = 500, width = 950) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const chars = Array.from(clean(value, 150)); let fitted = chars.join('');
  while (chars.length && ctx.measureText(fitted).width > width) { chars.pop(); fitted = `${chars.join('')}…`; }
  ctx.fillText(fitted, x, y);
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill = '#1b2934ed', stroke = '#bf9c6166') {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
}
async function loadArt(key: string) {
  const src = heistArt(key); if (!src) return null;
  return new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image(); let complete = false;
    const finish = (value: HTMLImageElement | null) => { if (!complete) { complete = true; window.clearTimeout(timer); resolve(value); } };
    const timer = window.setTimeout(() => finish(null), 4000); img.onload = () => finish(img); img.onerror = () => finish(null); img.src = src;
  });
}
export async function createHeistPoster(options: PosterOptions): Promise<Blob> {
  const model = buildHeistPosterModel(options), canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立劫案戰報。');
  const [background, ...cards] = await Promise.all([loadArt('background'), ...model.path.map(card => loadArt(card.asset))]);
  ctx.fillStyle = '#111e2b'; ctx.fillRect(0, 0, 1080, 1350);
  if (background) { const scale = Math.max(1080 / background.width, 1350 / background.height); ctx.globalAlpha = .32; ctx.drawImage(background, (1080 - background.width * scale) / 2, (1350 - background.height * scale) / 2, background.width * scale, background.height * scale); ctx.globalAlpha = 1; }
  const overlay = ctx.createLinearGradient(0, 0, 0, 1350); overlay.addColorStop(0, '#101b2466'); overlay.addColorStop(1, '#0e1926f5'); ctx.fillStyle = overlay; ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = '#c7a26770'; ctx.lineWidth = 2; ctx.strokeRect(25, 25, 1030, 1300); ctx.strokeRect(33, 33, 1014, 1284);
  write(ctx, 'THE CURTAIN HEIST', 65, 94, 20, '#d6b77e', 650); write(ctx, '謝幕劫案', 61, 182, 76, '#f5e1b8', 750); write(ctx, '最後的掌聲之後，真正的冒險才開始。', 66, 231, 25, '#ccbcb9');
  panel(ctx, 64, 264, 952, 105); write(ctx, `第 ${model.round} / 5 幕 · 第 ${model.stage} 段通道 · 同類第 ${model.hazardLimit} 張封鎖`, 91, 308, 28, '#ecd7b7', 650); write(ctx, `路線餘款 ${model.leftovers}　｜　未揭牌 ${model.deckCount}　｜　復盤 ${model.step} / ${model.totalSteps}`, 91, 348, 22, '#bcaeaa');
  const columns = model.players.length > 4 ? 4 : Math.max(1, model.players.length), rows = Math.ceil(model.players.length / columns), gap = 12, width = (952 - gap * (columns - 1)) / columns;
  model.players.forEach((player, index) => { const x = 64 + index % columns * (width + gap), y = 393 + Math.floor(index / columns) * 110; panel(ctx, x, y, width, 98, player.winner ? '#503c36ed' : '#1c2935ed', player.winner ? '#d8b36f' : '#bf9c6155'); write(ctx, player.name, x + 14, y + 30, 21, '#e8d6cb', 650, width - 28); write(ctx, model.finished ? `${player.total} 點${player.winner ? ' · 勝者' : ''}` : `隨身 ${player.carried} 點`, x + 14, y + 66, 24, '#e2bb71', 650, width - 28); write(ctx, `珍藏 ${player.artifacts.length} 件${model.finished ? ` · 入庫 ${player.banked}` : player.exploring ? ' · 仍在現場' : ' · 已撤退'}`, x + 14, y + 87, 15, '#b8a9a7', 500, width - 28); });
  const routeTop = 412 + rows * 110; write(ctx, '已揭路線 · 最後八張', 65, routeTop + 12, 22, '#d5b77c', 650);
  const cardY = routeTop + 30, cardWidth = 105, cardHeight = 157;
  model.path.forEach((card, index) => { const x = 64 + index * 121; panel(ctx, x, cardY, cardWidth, cardHeight, '#13202c', '#cba56888'); const img = cards[index]; if (img) { ctx.save(); ctx.beginPath(); ctx.roundRect(x + 2, cardY + 2, cardWidth - 4, cardHeight - 4, 12); ctx.clip(); const scale = Math.min((cardWidth - 4) / img.width, (cardHeight - 4) / img.height); ctx.drawImage(img, x + (cardWidth - img.width * scale) / 2, cardY + (cardHeight - img.height * scale) / 2, img.width * scale, img.height * scale); ctx.restore(); }
    ctx.fillStyle = '#101722d9'; ctx.fillRect(x + 2, cardY + 103, cardWidth - 4, 52); ctx.save(); ctx.textAlign = 'center'; write(ctx, card.value === null ? '警戒' : String(card.value), x + cardWidth / 2, cardY + 128, 25, card.kind === 'hazard' ? '#f0afb0' : '#ffe0a1', 700, 102); write(ctx, card.name, x + cardWidth / 2, cardY + 148, 13, '#eedec7', 500, 100); ctx.restore(); });
  if (!model.path.length) write(ctx, '尚未揭開第一段通道。', 66, cardY + 78, 26, '#b8a9a7');
  const eventTop = cardY + cardHeight + 22, eventHeight = 1051 - eventTop; panel(ctx, 64, eventTop, 952, eventHeight); write(ctx, '公開行動檔案', 88, eventTop + 34, 21, '#d5b77c', 650);
  const rowHeight = Math.min(33, (eventHeight - 61) / Math.max(1, model.events.length));
  model.events.forEach((event, index) => { const y = eventTop + 62 + index * rowHeight; write(ctx, `${event.round}.${event.step}`, 89, y, 16, '#a99791'); write(ctx, `${event.action}${event.card ? ` · ${event.card.name}${event.card.value === null ? '' : ` ${event.card.value}`}` : ''}`, 141, y, 19, '#d4c5bb', 500, 849); });
  panel(ctx, 64, 1074, 952, 146, '#483337ed', '#d1a86d88'); write(ctx, model.outcome, 90, 1122, 33, '#f2d59d', 700, 893); write(ctx, model.winners.length ? `獲勝者：${model.winners.join('、')}` : '每一次安全離場，都值得一聲安靜的掌聲。', 91, 1164, 23, '#e3cccc', 500, 890); write(ctx, '僅呈現已公開資訊，不含密封決策或未揭牌堆。', 91, 1199, 18, '#bda7a7');
  write(ctx, '謝幕劫案 · 公開戰報', 66, 1271, 20, '#ae9b9f'); write(ctx, '五幕、五件珍藏，每一步都由你決定。', 591, 1271, 19, '#ae9b9f', 500, 430);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('劫案戰報產生失敗。')), 'image/png'));
}
