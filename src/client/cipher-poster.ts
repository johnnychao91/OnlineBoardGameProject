import type { CipherState } from '../games/cipher/game';

export interface CipherPosterOptions {
  G: CipherState;
  players: { id: string | number; name?: string }[];
  step: number;
  totalSteps: number;
}

function clean(value: string, limit = 40): string {
  return Array.from(value.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
}

function integer(value: number, fallback = 0, maximum = 99999): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.trunc(value))) : fallback;
}

/**
 * Explicit public projection. Neither the renderer nor its input model needs a
 * hand, observer permission, room identifier, invitation, URL or credential.
 */
export function buildCipherPosterModel({ G, players, step, totalSteps }: CipherPosterOptions) {
  const nameOf = (id: string) => clean(players.find(player => String(player.id) === id)?.name || '特務', 28);
  const event = G.log.filter(entry => entry.type === 'transmit' || entry.type === 'breach' || entry.type === 'pulse').at(-1);
  const total = Math.max(1, integer(totalSteps, 1));
  return {
    level: integer(G.level, 0, 12),
    targetLevel: integer(G.targetLevel, 12, 12),
    cover: integer(G.cover, 0, 6),
    pulses: integer(G.pulses, 0, 3),
    step: Math.min(Math.max(1, integer(step, 1)), total),
    totalSteps: total,
    transmittedCount: G.transmitted.length,
    discardedCount: G.discarded.length,
    outcome: G.status === 'finished' ? G.winner === 'agents' ? 'success' : 'failure' : 'ongoing',
    latest: event ? {
      type: event.type,
      level: integer(event.level, 0, 12),
      actor: event.actorID ? nameOf(event.actorID) : '特務小隊',
      card: event.type === 'pulse' || event.card == null ? null : integer(event.card, 0, 100),
      discarded: (event.discarded ?? []).map(({ playerID, card }) => ({
        owner: nameOf(playerID),
        card: integer(card, 0, 100),
      })),
    } : null,
  };
}

const WIDTH = 1080;
const HEIGHT = 1350;
const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
const COLOR = { ink: '#eff3e6', muted: '#adbca5', dim: '#80937b', accent: '#d0eaa9', warning: '#ecc794', line: '#40563f' };

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = COLOR.ink, weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}

function fit(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, size: number, color = COLOR.ink, weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const chars = Array.from(clean(value, 160));
  let fitted = chars.join('');
  while (chars.length && ctx.measureText(fitted).width > width) {
    chars.pop();
    fitted = chars.join('') + '…';
  }
  text(ctx, fitted, x, y, size, color, weight);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius = 20, fill = '#1b2d26', stroke = COLOR.line) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Original canvas artwork; all visual data comes from the public projection. */
export async function createCipherPoster(options: CipherPosterOptions): Promise<Blob> {
  const model = buildCipherPosterModel(options);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('此瀏覽器無法建立任務戰報。');

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#13241e');
  background.addColorStop(1, '#0d1920');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = '#68825618';
  ctx.lineWidth = 1;
  for (let x = 24; x < WIDTH; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
  }
  for (let y = 24; y < HEIGHT; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
  }
  box(ctx, 65, 58, 238, 42, 8, '#223924', '#6e8758');
  text(ctx, 'FIELD REPORT / 公開紀錄', 82, 85, 16, COLOR.accent, 650);
  text(ctx, '加密通話', 65, 188, 72, COLOR.ink, 750);
  text(ctx, '我們沒有說話，卻聽見了彼此。', 70, 238, 26, COLOR.muted);
  ctx.save();
  ctx.translate(911, 153);
  ctx.strokeStyle = COLOR.accent;
  ctx.lineWidth = 3;
  for (const radius of [28, 49, 70]) {
    ctx.beginPath(); ctx.arc(0, 0, radius, Math.PI * 0.65, Math.PI * 1.35); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, radius, -Math.PI * 0.35, Math.PI * 0.35); ctx.stroke();
  }
  ctx.fillStyle = COLOR.accent;
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const metricLabels = ['目前頻段', '剩餘掩護', '靜默脈衝'];
  const metricValues = [`${model.level} / ${model.targetLevel}`, String(model.cover), String(model.pulses)];
  for (let i = 0; i < 3; i += 1) {
    const x = 64 + i * 324;
    box(ctx, x, 281, 304, 128, 17);
    text(ctx, metricLabels[i], x + 24, 321, 19, COLOR.muted, 550);
    text(ctx, metricValues[i], x + 24, 380, 43, i === 1 && model.cover <= 1 ? COLOR.warning : COLOR.accent, 750);
  }

  box(ctx, 64, 437, 952, 475, 25, '#192c24', '#557046');
  text(ctx, '通話中的這一刻', 96, 485, 22, COLOR.accent, 650);
  ctx.save(); ctx.textAlign = 'right';
  text(ctx, `復盤 ${model.step} / ${model.totalSteps}`, 981, 485, 18, COLOR.muted);
  ctx.restore();
  const latest = model.latest;
  if (latest) {
    box(ctx, 96, 519, 184, 192, 15, latest.type === 'breach' ? '#473a28' : '#2b422d', latest.type === 'breach' ? '#9a7e50' : '#7b9462');
    ctx.save(); ctx.textAlign = 'center';
    text(ctx, latest.type === 'pulse' ? 'PULSE' : 'SIGNAL', 188, 554, 16, COLOR.muted, 650);
    text(ctx, latest.card == null ? '⌁' : String(latest.card), 188, 654, latest.card == null ? 96 : 83, latest.type === 'breach' ? COLOR.warning : COLOR.accent, 750);
    text(ctx, `頻段 ${latest.level}`, 188, 688, 16, COLOR.muted);
    ctx.restore();
    fit(ctx, latest.actor, 313, 563, 660, 34, COLOR.ink, 700);
    text(ctx, latest.type === 'pulse' ? '全員同意，靜默脈衝發動' : latest.type === 'breach' ? '訊號錯序，掩護減少 1 點' : '訊號安全送出', 313, 618, 28,
      latest.type === 'breach' ? COLOR.warning : COLOR.accent, 650);
    text(ctx, latest.type === 'pulse' ? '每位特務公開棄置最小訊號。' : latest.type === 'breach' ? '更小的未傳送訊號已公開棄置。' : '下一次傳送，繼續靠你們的默契。',
      313, 668, 22, COLOR.muted);
    if (latest.discarded.length) {
      text(ctx, `本次公開棄置 ${latest.discarded.length} 張`, 98, 758, 19, COLOR.warning, 600);
      const grouped = new Map<string, number[]>();
      for (const entry of latest.discarded) grouped.set(entry.owner, [...(grouped.get(entry.owner) ?? []), entry.card]);
      [...grouped.entries()].slice(0, 3).forEach(([owner, cards], index) => {
        fit(ctx, `${owner}  ·  ${cards.join(' / ')}`, 98, 796 + index * 33, 875, 20, COLOR.muted);
      });
      if (grouped.size > 3) text(ctx, '…完整過程可在復盤中查看', 98, 891, 16, COLOR.dim);
    } else {
      text(ctx, '不需要一個字，也能完成一次配合。', 98, 786, 25, COLOR.ink, 550);
      text(ctx, '只保留公開操作，不揭露尚未傳送的訊號。', 98, 834, 20, COLOR.muted);
    }
  } else {
    text(ctx, '特務就位，保持靜默。', 98, 589, 44, COLOR.ink, 700);
    text(ctx, '第一道訊號尚未送出。', 98, 655, 29, COLOR.accent, 550);
    text(ctx, '這場行動的關鍵，是相信彼此的節奏。', 98, 742, 25, COLOR.muted);
    text(ctx, '沒有暗號、沒有倒數，只有你們的默契。', 98, 790, 25, COLOR.muted);
  }

  const result = model.outcome === 'success' ? '情報送達 · 全隊行動成功'
    : model.outcome === 'failure' ? '掩護耗盡 · 通話遭到攔截' : '頻道開放 · 行動持續中';
  box(ctx, 64, 941, 952, 244, 25, '#182a25', model.outcome === 'failure' ? '#886b48' : '#536d46');
  text(ctx, '任務檔案', 98, 986, 19, COLOR.muted, 650);
  fit(ctx, result, 98, 1046, 870, 40, model.outcome === 'failure' ? COLOR.warning : COLOR.accent, 750);
  text(ctx, `本頻段已傳送 ${model.transmittedCount} 張 · 已棄置 ${model.discardedCount} 張`, 98, 1100, 23, COLOR.muted);
  text(ctx, model.outcome === 'success' ? '所有頻段完成。這份默契，值得留下。'
    : model.outcome === 'failure' ? '收好這次經驗，下一次重新建立同步。' : '每一次無聲的配合，都是一個值得記住的瞬間。',
  98, 1146, 22, COLOR.muted);
  ctx.strokeStyle = COLOR.line;
  ctx.beginPath(); ctx.moveTo(72, 1234); ctx.lineTo(1008, 1234); ctx.stroke();
  text(ctx, '捷寶桌遊室', 72, 1288, 25, COLOR.ink, 650);
  ctx.save(); ctx.textAlign = 'right';
  text(ctx, '公開事件戰報 / ENCRYPTED CALL', 1008, 1286, 16, COLOR.dim);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('任務戰報產生失敗，請重試。'));
  }, 'image/png'));
}
