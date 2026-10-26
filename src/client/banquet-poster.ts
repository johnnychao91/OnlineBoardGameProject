import type { BanquetState } from '../games/banquet/game';
import type { PosterOptions } from './game-types';
import { banquetArt } from './banquet-art';

const clean = (value: string, limit = 40) => Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
const integer = (value: number) => Number.isFinite(value) ? Math.min(9999, Math.max(0, Math.trunc(value))) : 0;
/** Only whitelisted public data. No observations, faces, choices, or secret exchange decisions. */
export function buildBanquetPosterModel({ G: state, info, step, totalSteps }: PosterOptions) {
  const G = state as BanquetState, nameOf = (id: string) => clean(info.players.find(player => String(player.id) === id)?.name || '夜宴賓客', 24);
  const total = Math.max(1, integer(totalSteps));
  return {
    turn: integer(G.turnNumber), court: integer(G.court), step: Math.min(Math.max(1, integer(step)), total), totalSteps: total,
    players: G.turnOrder.map(id => ({ name: nameOf(id), coins: integer(G.players[id].coins), winner: G.status === 'finished' && G.winnerIDs.includes(id) })),
    outcome: G.status === 'finished' ? G.winReason === 'cheater' ? '天邪鬼贏得夜宴' : G.winReason === 'bankruptcy' ? '有人破產，妖金定勝負' : '十三枚妖金，夜宴勝負已定' : '面具流轉，夜宴未歇',
    winners: G.status === 'finished' ? G.winnerIDs.map(nameOf) : [],
    events: G.log.slice(-6).map(event => ({ turn: integer(event.turn), actor: event.actorID ? nameOf(event.actorID) : '', action: ({ deal: '賓客入席，面具公開', exchange: '進行一次盲換', look: '私下查看自己的面具', announce: '宣告面具', 'claim-response': '回應面具認領', reveal: '面具公開驗證', power: '面具能力生效', fine: '向裁決堂繳納罰款', inspect: '百目鬼私下查驗', guess: '受詢問者猜自己的面具', 'princess-reveal': '青行燈照見面具', seats: '絡新婦交換座次', 'wealth-swap': '交換全部財富', 'beggar-payment': '垢嘗收到一枚妖金', finish: '夜宴結束' } as Record<string, string>)[event.type] ?? '夜宴公開事件' })),
  };
}
const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = '#f2e4ce', weight = 500, width = 950) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const chars = Array.from(clean(value, 150)); let fitted = chars.join('');
  while (chars.length && ctx.measureText(fitted).width > width) { chars.pop(); fitted = `${chars.join('')}…`; }
  ctx.fillText(fitted, x, y);
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill = '#302637e8', stroke = '#be985c66') {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 15); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke();
}
async function loadBackground() {
  const src = banquetArt('background'); if (!src) return null;
  return new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image(); let completed = false;
    const finish = (value: HTMLImageElement | null) => { if (!completed) { completed = true; window.clearTimeout(timer); resolve(value); } };
    const timer = window.setTimeout(() => finish(null), 4000);
    img.onload = () => finish(img); img.onerror = () => finish(null); img.src = src;
  });
}
export async function createBanquetPoster(options: PosterOptions): Promise<Blob> {
  const model = buildBanquetPosterModel(options), canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立夜宴戰報。');
  ctx.fillStyle = '#211b2b'; ctx.fillRect(0, 0, 1080, 1350);
  const background = await loadBackground(); if (background) { const scale = Math.max(1080 / background.width, 1350 / background.height); ctx.globalAlpha = .3; ctx.drawImage(background, (1080 - background.width * scale) / 2, (1350 - background.height * scale) / 2, background.width * scale, background.height * scale); ctx.globalAlpha = 1; }
  const shade = ctx.createLinearGradient(0, 0, 0, 1350); shade.addColorStop(0, '#251c2e66'); shade.addColorStop(1, '#211829f5'); ctx.fillStyle = shade; ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = '#c7a16470'; ctx.lineWidth = 2; ctx.strokeRect(25, 25, 1030, 1300); ctx.strokeRect(33, 33, 1014, 1284);
  text(ctx, 'THE HUNDRED GHOSTS’ BANQUET', 65, 98, 19, '#cbae75', 600); text(ctx, '百鬼夜宴', 61, 194, 78, '#f8e4bb', 750); text(ctx, '燈影流轉，面具之下，誰已贏得今夜？', 67, 244, 25, '#d6bfc9');
  ctx.beginPath(); ctx.arc(944, 158, 48, 0, Math.PI * 2); ctx.strokeStyle = '#c7a164'; ctx.lineWidth = 2; ctx.stroke(); text(ctx, '宴', 915, 178, 50, '#ddbd80', 500);
  panel(ctx, 64, 280, 952, 105); text(ctx, `第 ${model.turn} 回合 · 復盤 ${model.step} / ${model.totalSteps}`, 90, 323, 25, '#e7d7c4', 600); text(ctx, `裁決堂 ${model.court} 妖金　｜　勝利門檻 13 妖金`, 90, 363, 22, '#c4aa93');
  const columns = model.players.length > 4 ? 4 : Math.max(1, model.players.length), rows = Math.ceil(model.players.length / columns), gap = 12, width = (952 - gap * (columns - 1)) / columns;
  model.players.forEach((player, index) => { const x = 64 + index % columns * (width + gap), y = 410 + Math.floor(index / columns) * 113; panel(ctx, x, y, width, 101, player.winner ? '#5a3e40f0' : '#322638e8', player.winner ? '#e1b56c' : '#be985c55'); text(ctx, player.name, x + 15, y + 33, 21, '#e9d7d7', 600, width - 30); text(ctx, `${player.coins} 妖金${player.winner ? ' · 勝者' : ''}`, x + 15, y + 78, 26, '#e5bc73', 650, width - 30); });
  const top = 425 + rows * 113, height = 1000 - top; panel(ctx, 64, top, 952, height); text(ctx, '夜宴公開紀事', 90, top + 42, 24, '#dbb779', 650);
  const rowHeight = Math.min(57, (height - 80) / Math.max(1, model.events.length));
  model.events.forEach((event, index) => { const y = top + 82 + index * rowHeight; text(ctx, String(event.turn), 93, y, 17, '#a58e99'); text(ctx, `${event.actor ? `${event.actor}　` : ''}${event.action}`, 132, y, 21, '#d3c3cb', 500, 850); });
  if (!model.events.length) text(ctx, '燈籠剛剛點亮，賓客正在入席。', 91, top + 95, 23, '#baa7b6');
  panel(ctx, 64, 1025, 952, 178, '#523743ed', '#d6ae6f88'); text(ctx, model.outcome, 91, 1081, 33, '#f4d79f', 700, 891); text(ctx, model.winners.length ? `獲勝者：${model.winners.join('、')}` : '妖金在明處，真身在暗處。', 91, 1128, 25, '#e8d2d5', 500, 891); text(ctx, '只收錄公開財富與事件，不含面具記憶或交換真假。', 91, 1175, 20, '#bfa5b1');
  text(ctx, '百鬼夜宴 · 公開戰報', 67, 1268, 20, '#ad929f', 500); text(ctx, '原創夜宴插畫與人物設計', 712, 1268, 19, '#ad929f', 500, 310);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('夜宴戰報產生失敗。')), 'image/png'));
}
