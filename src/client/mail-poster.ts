import type { MailState } from '../games/post/game';
import { MAIL_CARDS, MAIL_MODES } from '../games/post/rules';
import type { PosterOptions } from './game-types';

function clean(text: string, limit = 50): string {
  return Array.from(text.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
}
const integer = (value: number, maximum = 99999) => Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.trunc(value))) : 0;

/** Strict public whitelist: never reads hands, intel, a resolving effect or a deck. */
export function buildMailPosterModel({ G: unknownState, info, step, totalSteps }: PosterOptions) {
  const G = unknownState as MailState;
  const nameOf = (id: string) => clean(info.players.find(player => String(player.id) === id)?.name || '午夜信使', 24);
  const total = Math.max(1, integer(totalSteps));
  return {
    mode: MAIL_MODES[G.mode].name,
    blackLetter: G.mode === 'black-letter',
    round: integer(G.round),
    step: Math.min(Math.max(1, integer(step)), total), totalSteps: total,
    deckCount: integer(G.deckCount, 32),
    directorLife: integer(G.directorLife), courierLife: integer(G.courierLife),
    players: Object.entries(G.players).map(([id, player]) => ({
      name: nameOf(id), score: integer(player.score), power: integer(player.power),
      director: G.directorID === id,
    })),
    outcome: G.status === 'finished' ? G.winner === 'delivery' ? '投遞競賽結束' : G.winner === 'director' ? '黑函局長獲勝' : '午夜信使獲勝' : '郵路仍在延伸',
    champions: G.status === 'finished' ? G.winnerIDs.map(nameOf) : [],
    events: G.log.slice(-6).map(event => ({
      round: integer(event.round),
      actor: event.actorID ? nameOf(event.actorID) : null,
      target: event.targetID ? nameOf(event.targetID) : null,
      action: ({ start: '郵局開始營業', play: '打出一張密函', discard: '公開棄置密函', eliminate: '退出本輪',
        round: '本輪投遞完成', score: '取得信任郵戳', fight: '進行郵路對決', damage: '生命減少',
        finish: '本局結果確定', power: '獲得火漆力量', seal: '宣告六封印', pass: '郵路繼續前進' } as Record<string, string>)[event.type] ?? '公開投遞事件',
      card: event.card ? { name: MAIL_CARDS[event.card.role].name, value: MAIL_CARDS[event.card.role].value } : null,
    })),
  };
}

const W = 1080, H = 1350;
const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
function write(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = '#eee3c8', weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.fillText(text, x, y);
}
function fit(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, size: number, color = '#eee3c8', weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const chars = Array.from(clean(value, 150)); let text = chars.join('');
  while (chars.length && ctx.measureText(text).width > width) { chars.pop(); text = `${chars.join('')}…`; }
  write(ctx, text, x, y, size, color, weight);
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill = '#17362e', stroke = '#a18a585f') {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, 18); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
}

export async function createMailPoster(options: PosterOptions): Promise<Blob> {
  const model = buildMailPosterModel(options);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立投遞戰報。');
  const background = ctx.createLinearGradient(0, 0, W, H);
  background.addColorStop(0, '#1b3c33'); background.addColorStop(.6, '#0d2524'); background.addColorStop(1, '#102022');
  ctx.fillStyle = background; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#dbc28b33'; ctx.lineWidth = 2; ctx.strokeRect(25, 25, W - 50, H - 50);
  ctx.strokeRect(33, 33, W - 66, H - 66);
  write(ctx, 'THE MIDNIGHT POST', 65, 99, 19, '#cab37c', 650);
  write(ctx, '午夜郵局', 62, 195, 76, '#f5e8c6', 750);
  write(ctx, '地圖上找不到，夜裡總會亮起一盞燈。', 67, 242, 25, '#b9c8b5');
  ctx.save(); ctx.translate(928, 147); ctx.rotate(-.12);
  ctx.strokeStyle = '#cab37c'; ctx.lineWidth = 3; ctx.strokeRect(-70, -43, 140, 86);
  ctx.beginPath(); ctx.moveTo(-70, -43); ctx.lineTo(0, 12); ctx.lineTo(70, -43); ctx.stroke(); ctx.restore();
  panel(ctx, 64, 285, 952, 125);
  write(ctx, model.mode, 92, 330, 27, '#e8ce95', 700);
  write(ctx, `第 ${model.round} 夜 · 復盤 ${model.step} / ${model.totalSteps}`, 92, 378, 22, '#bdc7b6');
  ctx.save(); ctx.textAlign = 'right';
  write(ctx, model.blackLetter ? `局長 ${model.directorLife} · 信使 ${model.courierLife}` : `牌堆剩餘 ${model.deckCount} 張`, 984, 375, 24, '#d8c28c', 650);
  ctx.restore();

  const columns = model.players.length > 4 ? 4 : Math.max(1, model.players.length);
  const rows = Math.ceil(model.players.length / columns), gap = 12, width = (952 - gap * (columns - 1)) / columns;
  model.players.forEach((player, index) => {
    const x = 64 + index % columns * (width + gap), y = 437 + Math.floor(index / columns) * 120;
    panel(ctx, x, y, width, 106, player.director ? '#3c2d30' : '#1d3c30');
    fit(ctx, player.name, x + 16, y + 34, width - 32, 21, '#eee3c8', 650);
    write(ctx, model.blackLetter ? `${player.power} 火漆力量${player.director ? ' · 局長' : ''}` : `${player.score} 信任郵戳`, x + 16, y + 79, 20, '#dfc486', 600);
  });
  const logTop = 450 + rows * 120, logHeight = 1010 - logTop;
  panel(ctx, 64, logTop, 952, logHeight);
  write(ctx, '公開投遞檔案', 91, logTop + 43, 22, '#d9c185', 650);
  const rowHeight = Math.min(60, (logHeight - 75) / Math.max(1, model.events.length));
  model.events.forEach((event, index) => {
    const y = logTop + 86 + index * rowHeight;
    write(ctx, `${event.round}`, 93, y, 17, '#a5b4a0');
    const description = [event.actor, event.action, event.target, event.card ? `${event.card.value} · ${event.card.name}` : ''].filter(Boolean).join('　');
    fit(ctx, description, 135, y, 846, 21, '#d0d9c4');
  });
  if (!model.events.length) write(ctx, '郵局剛剛開門，第一封密函尚未送出。', 93, logTop + 102, 24, '#bac6b2');
  panel(ctx, 64, 1037, 952, 172, '#283f2e', '#c6a96a88');
  write(ctx, model.outcome, 92, 1090, 33, '#f1dba5', 750);
  fit(ctx, model.champions.length ? `獲勝者：${model.champions.join('、')}` : '每一封留下的信，都藏著下一個選擇。', 93, 1137, 890, 24, '#d4dcc5');
  write(ctx, '公開戰報只收錄已知事件，不包含信袋與私人查驗。', 93, 1180, 19, '#aabcaa');
  write(ctx, '捷寶桌遊室', 66, 1284, 25, '#eee3c8', 650);
  ctx.save(); ctx.textAlign = 'right'; write(ctx, '午夜郵局 / PUBLIC DELIVERY REPORT', 1013, 1280, 15, '#9cac9d'); ctx.restore();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('投遞戰報產生失敗，請重試。')), 'image/png'));
}
