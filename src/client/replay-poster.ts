import type { CardKind, StationObserverState } from '../games/station/game';

export interface ReplayPosterOptions {
  G: StationObserverState;
  players: { id: string | number; name?: string }[];
  /** One-based display position: pass frameIndex + 1 from the replay viewer. */
  step: number;
  totalSteps: number;
}

const WIDTH = 1080;
const HEIGHT = 1350;
const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft JhengHei", sans-serif';
const COLORS = {
  ink: '#edf8f7', muted: '#a8c0c4', faint: '#738f98', mint: '#8be7ca',
  amber: '#ffd18a', navy: '#071820', panel: '#102b36', stroke: '#284752',
};
const CARDS: Record<CardKind, { label: string; detail: string; color: string; mark: string }> = {
  stable: { label: '穩定設備', detail: '設備維持穩定，任務繼續。', color: '#b6d0df', mark: '—' },
  repair: { label: '維修模組', detail: '找到維修模組，太空站更接近恢復運作。', color: COLORS.mint, mark: '+' },
  hazard: { label: '反應爐危機', detail: '危機已揭開，這次任務就此結束。', color: COLORS.amber, mark: '!' },
};

function positiveInteger(value: number, fallback = 1): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(99999, Math.trunc(value))) : fallback;
}

function safeText(value: string, maxLength = 80): string {
  return Array.from(value.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/https?:\/\/\S+/gi, '…')
    .replace(/\s+/g, ' ').trim()).slice(0, maxLength).join('');
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function font(ctx: CanvasRenderingContext2D, size: number, weight = 500): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number,
  size: number, color = COLORS.ink, weight = 500): void {
  font(ctx, size, weight);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

/** Wrap by rendered width, including CJK and emoji; ellipsize the last line. */
function wrapped(ctx: CanvasRenderingContext2D, value: string, x: number, y: number,
  maxWidth: number, size: number, lineHeight: number, maxLines: number,
  color = COLORS.ink, weight = 500): void {
  font(ctx, size, weight);
  ctx.fillStyle = color;
  const characters = graphemes(safeText(value));
  const lines: string[] = [];
  let current = '';
  for (let index = 0; index < characters.length; index += 1) {
    const next = current + characters[index];
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      const ending = graphemes(current);
      while (ending.length && ctx.measureText(ending.join('') + '…').width > maxWidth) ending.pop();
      current = ending.join('') + '…';
      break;
    }
    lines.push(current);
    current = characters[index];
  }
  if (current) lines.push(current);
  lines.slice(0, maxLines).forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number,
  height: number, radius: number, fill: string, stroke?: string): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function pill(ctx: CanvasRenderingContext2D, label: string, x: number, y: number,
  width: number, accent = COLORS.mint): void {
  box(ctx, x, y, width, 52, 26, '#16343f', '#2b4c56');
  ctx.save();
  ctx.textAlign = 'center';
  text(ctx, label, x + width / 2, y + 34, 21, accent, 600);
  ctx.restore();
}

function stationEmblem(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(911, 161);
  ctx.rotate(-0.28);
  ctx.strokeStyle = '#315b63';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, 91, 46, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, 0, 91, 46, Math.PI / 2, 0, Math.PI * 2); ctx.stroke();
  box(ctx, -22, -31, 44, 62, 13, '#214a53', COLORS.mint);
  box(ctx, -72, -17, 38, 34, 4, '#143944', '#5b9c9e');
  box(ctx, 34, -17, 38, 34, 4, '#143944', '#5b9c9e');
  ctx.strokeStyle = COLORS.mint;
  ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(-22, 0); ctx.moveTo(22, 0); ctx.lineTo(34, 0); ctx.stroke();
  ctx.fillStyle = COLORS.amber;
  ctx.beginPath(); ctx.arc(72, -30, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function playerName(players: ReplayPosterOptions['players'], id: string): string {
  const name = players.find((player) => String(player.id) === id)?.name;
  if (typeof name === 'string' && safeText(name, 32)) return safeText(name, 32);
  const seat = Number(id);
  return Number.isInteger(seat) && seat >= 0 && seat < 8 ? `玩家 ${seat + 1}` : '未命名玩家';
}

function backdrop(ctx: CanvasRenderingContext2D): void {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#07161f');
  background.addColorStop(0.6, '#0d2832');
  background.addColorStop(1, '#071820');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(970, 160, 10, 970, 160, 470);
  glow.addColorStop(0, '#285b5b66');
  glow.addColorStop(1, '#285b5b00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // Fixed coordinates keep exports repeatable without assets or random state.
  for (let index = 0; index < 78; index += 1) {
    const x = (index * 137 + 37) % WIDTH;
    const y = (index * 211 + 49) % HEIGHT;
    ctx.fillStyle = index % 4 === 0 ? '#c6e6e566' : '#c6e6e52b';
    ctx.beginPath(); ctx.arc(x, y, index % 4 === 0 ? 1.8 : 1, 0, Math.PI * 2); ctx.fill();
  }
  stationEmblem(ctx);
}

/** Render only public fields, even when the supplied replay uses god perspective. */
export async function createReplayPoster({ G, players, step, totalSteps }: ReplayPosterOptions): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('此瀏覽器無法建立戰報圖片。');
  const total = positiveInteger(totalSteps);
  const position = Math.min(positiveInteger(step), total);
  const round = Number.isFinite(G.round) ? Math.max(0, Math.trunc(G.round)) : 0;
  backdrop(ctx);

  text(ctx, '一起出發，把這一刻留下。', 72, 81, 21, COLORS.mint, 600);
  text(ctx, '太空維修站', 68, 168, 66, COLORS.ink, 750);
  text(ctx, '精彩操作', 72, 222, 28, COLORS.muted, 600);
  pill(ctx, round > 0 ? `第 ${round} 輪` : '任務準備', 72, 270, 155);
  pill(ctx, `復盤 ${String(position).padStart(2, '0')} / ${String(total).padStart(2, '0')} 步`, 243, 270, 304);
  const status = G.status === 'finished' ? '任務結束' : G.status === 'briefing' ? '情報確認'
    : G.status === 'playing' ? '行動中' : '等待出發';
  pill(ctx, status, 563, 270, 164, G.status === 'finished' ? COLORS.amber : COLORS.muted);

  box(ctx, 64, 360, 952, 410, 30, COLORS.panel, COLORS.stroke);
  const latest = G.log.length ? G.log[G.log.length - 1] : undefined;
  if (latest) {
    const card = CARDS[latest.kind] ?? CARDS.stable;
    text(ctx, '最近揭牌', 100, 407, 21, COLORS.mint, 650);
    ctx.save(); ctx.textAlign = 'right';
    text(ctx, `公開紀錄 · 第 ${positiveInteger(latest.round)} 輪`, 980, 407, 18, COLORS.faint);
    ctx.restore();
    text(ctx, '行動者', 100, 450, 17, COLORS.faint, 600);
    text(ctx, '設備持有者', 624, 450, 17, COLORS.faint, 600);
    wrapped(ctx, playerName(players, latest.actorID), 100, 494, 340, 36, 45, 2, COLORS.ink, 700);
    wrapped(ctx, playerName(players, latest.targetID), 624, 494, 350, 36, 45, 2, COLORS.ink, 700);
    ctx.strokeStyle = COLORS.mint; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(482, 494); ctx.lineTo(572, 494);
    ctx.moveTo(559, 483); ctx.lineTo(572, 494); ctx.lineTo(559, 505); ctx.stroke();
    text(ctx, `選擇第 ${positiveInteger(latest.slot + 1)} 張設備`, 100, 580, 23, COLORS.muted);
    box(ctx, 100, 609, 880, 121, 22, '#0b222c', '#24454f');
    box(ctx, 122, 632, 70, 70, 20, '#183d45', card.color);
    ctx.save(); ctx.textAlign = 'center';
    text(ctx, card.mark, 157, 681, 44, card.color, 700);
    ctx.restore();
    text(ctx, card.label, 220, 656, 31, card.color, 700);
    wrapped(ctx, card.detail, 220, 698, 720, 20, 27, 1, COLORS.muted);
  } else {
    text(ctx, '開局時刻', 100, 407, 21, COLORS.mint, 650);
    const headline = G.status === 'briefing' ? '確認你的設備情報'
      : G.status === 'playing' ? '全員就位，準備出發' : '任務即將展開';
    wrapped(ctx, headline, 100, 492, 840, 47, 62, 2, COLORS.ink, 700);
    const introduction = G.status === 'briefing'
      ? '每個人都掌握一部分線索。確認資訊後，任務開始。'
      : G.status === 'playing' ? '第一位玩家即將選擇設備，讓這場太空任務開始。'
        : '等待夥伴就位，一起決定太空站的下一步。';
    wrapped(ctx, introduction, 100, 577, 824, 26, 41, 2, COLORS.muted);
    box(ctx, 100, 675, 880, 53, 17, '#0b222c');
    text(ctx, '尚未揭開設備 · 每個選擇都值得記住', 123, 710, 20, COLORS.mint);
  }

  box(ctx, 64, 799, 952, 178, 28, '#102b36', COLORS.stroke);
  text(ctx, '維修進度', 100, 845, 21, COLORS.muted, 600);
  const required = positiveInteger(G.repairsRequired);
  const found = Number.isFinite(G.repairsFound) ? Math.max(0, Math.min(required, Math.trunc(G.repairsFound))) : 0;
  ctx.save(); ctx.textAlign = 'right';
  text(ctx, `${found} / ${required}`, 980, 849, 39, COLORS.mint, 750);
  ctx.restore();
  box(ctx, 100, 877, 880, 18, 9, '#081d26');
  if (found > 0) box(ctx, 100, 877, Math.max(18, 880 * found / required), 18, 9, COLORS.mint);
  text(ctx, found === required ? '維修模組已全部找到' : `還有 ${required - found} 個維修模組等待被發現`, 100, 938, 21, COLORS.muted);

  const finished = G.status === 'finished';
  const accent = finished && G.winner === 'saboteur' ? COLORS.amber : COLORS.mint;
  box(ctx, 64, 1006, 952, 213, 28, finished ? '#17323b' : '#0c222c', finished ? accent : COLORS.stroke);
  text(ctx, finished ? '任務結果' : '這一刻，任務仍在繼續', 100, 1049, 19, accent, 650);
  const winner = G.winner === 'engineer' ? '維修員獲勝' : G.winner === 'saboteur' ? '干擾者獲勝' : '任務結束';
  text(ctx, finished ? winner : '下一個選擇，由你們決定', 100, 1109, finished ? 44 : 36, COLORS.ink, 750);
  const reason = G.winReason === 'all-repairs' ? '所有維修模組都已找到，太空站恢復運作。'
    : G.winReason === 'hazard' ? '反應爐危機被揭開，這次任務宣告結束。'
      : G.winReason === 'round-limit' ? '第四輪結束時維修尚未完成，任務時間已用盡。'
        : '這次太空任務已結束。';
  wrapped(ctx, finished ? reason : '信任、判斷與一點勇氣，讓每次揭牌都有故事。', 100, 1159, 820, 23, 33, 2, COLORS.muted);

  ctx.strokeStyle = '#28434b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(72, 1257); ctx.lineTo(1008, 1257); ctx.stroke();
  text(ctx, '朋友桌遊室', 72, 1302, 25, COLORS.ink, 650);
  ctx.save(); ctx.textAlign = 'right';
  text(ctx, '公開事件戰報', 1008, 1300, 18, COLORS.faint);
  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('戰報圖片產生失敗，請重試。'));
    }, 'image/png');
  });
}

/** One-based step number, without user names, room IDs, URLs, or credentials. */
export function replayPosterFilename(step: number): string {
  return `space-station-replay-${String(positiveInteger(step)).padStart(2, '0')}.png`;
}
