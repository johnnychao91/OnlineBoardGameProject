import type { EchoState } from '../games/echo/game';
import type { PosterOptions } from './game-types';
import tavernArt from './assets/art/cup-echo-tavern.webp';
import endlessBarLogo from './assets/endlessbar-logo-transparent.png';
import openCup from './assets/echo/open-cup.webp';

function clean(value: unknown, limit: number) {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(/https?:\/\/\S+/gi, '…')
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ').trim()).slice(0, limit).join('');
}

/** Only the already revealed words and public participant names belong in the image. */
export function buildEchoPosterModel({ G: state, info }: PosterOptions) {
  const G = state as EchoState;
  const ids = Object.keys(G.players).slice(0, 4);
  const names = ids.map((id, index) => clean(info.players.find(player => String(player.id) === id)?.name, 20) || `客人 ${index + 1}`);
  const success = G.result === 'same-word' || G.result === 'same-meaning';
  const rounds = G.history.slice(0, 12).map(round => ({
    number: round.number, matched: success && round.number === G.round,
    words: ids.map(id => clean(Object.hasOwn(round.words, id) ? round.words[id] : undefined, 32) || '未作答'),
  }));
  return {
    names, rounds,
    headline: success ? `我們在第 ${G.round} 輪相遇了` : G.result === 'round-limit' ? '這一桌尚未相遇' : '這一桌的聯想詞鏈',
    note: G.result === 'same-meaning' ? '全員確認同義' : success ? '全員同詞' : '未央酒肆 · 逐輪詞鏈',
  };
}

const WIDTH = 1080;
const FONT = 'system-ui, "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
const PALETTES = [
  { card: '#332444', accent: '#dbc4ef' },
  { card: '#213b3d', accent: '#b6e1d8' },
  { card: '#49302e', accent: '#f5ccb1' },
  { card: '#2a3450', accent: '#c6d3ff' },
];
const GOLD = '#e7b773';
const TEXT = '#f2e4ef';
const MUTED = '#bcabc0';
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' }) : undefined;
const graphemes = (value: string) => segmenter ? Array.from(segmenter.segment(value), part => part.segment) : Array.from(value);
const font = (size: number, weight: number) => `${weight} ${size}px ${FONT}`;

function wrap(ctx: CanvasRenderingContext2D, value: string, width: number, style: string) {
  ctx.font = style;
  const lines: string[] = [];
  let line = '';
  for (const character of graphemes(value)) {
    if (line && ctx.measureText(line + character).width > width) { lines.push(line.trimEnd()); line = ''; }
    line += character;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

function write(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: string, color: string) {
  ctx.font = style;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, edge?: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 20);
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke(); }
}

async function loadArt(src: string) {
  const image = new Image();
  image.src = src;
  try { await image.decode(); return image; } catch { return undefined; }
}

function drawTavern(ctx: CanvasRenderingContext2D, height: number, image?: HTMLImageElement) {
  if (image) {
    const width = image.naturalWidth;
    const windowHeight = Math.round(image.naturalHeight * .65);
    const tableTop = Math.round(windowHeight * WIDTH / width);
    ctx.drawImage(image, 0, 0, width, windowHeight, 0, 0, WIDTH, tableTop);
    // Keep the window and both lanterns in frame when long games extend the tabletop.
    ctx.drawImage(image, 0, windowHeight, width, image.naturalHeight - windowHeight, 0, tableTop, WIDTH, height - tableTop);
  }
  const tint = ctx.createLinearGradient(0, 0, 0, height);
  tint.addColorStop(0, image ? '#17102039' : '#2e203c');
  tint.addColorStop(.28, image ? '#1c12226e' : '#281b33');
  tint.addColorStop(1, image ? '#17121f9e' : '#17121f');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, WIDTH, height);
}

function drawEchoCup(ctx: CanvasRenderingContext2D, y: number, cup?: HTMLImageElement) {
  if (!cup) return;
  const size = 240, x = WIDTH / 2;
  // The mouth center sits at (351.5, 272) on the 704 px open-cup artwork.
  const rimY = y + size * 272 / 704;
  ctx.save();
  ctx.shadowColor = '#efac5f';
  ctx.shadowBlur = 16;
  ctx.lineWidth = 2.5;
  for (const [radius, color] of [[98, '#ffd993d9'], [151, '#efb97099'], [212, '#e7a95f5e']] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, rimY, radius, radius * .19, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.drawImage(cup, x - size * 351.5 / 704, y, size, size);
  ctx.shadowBlur = 10;
  for (const [radius, color] of [[20, '#ffe7b8'], [44, '#ffce8699']] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, rimY, radius, radius * .17, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export async function createEchoPoster(options: PosterOptions): Promise<Blob> {
  const { names, rounds, headline, note } = buildEchoPosterModel(options);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !names.length) throw new Error('無法建立逐輪詞鏈圖。');

  const margin = 48, rowLabel = 114, gap = 14;
  const columnWidth = (WIDTH - 2 * margin - rowLabel - (names.length - 1) * gap) / names.length;
  const columnX = (index: number) => margin + rowLabel + index * (columnWidth + gap);
  const namesFont = font(26, 700);
  const nameLines = names.map(name => wrap(ctx, name, columnWidth - 24, namesFont));
  const namesHeight = 40 + Math.max(...nameLines.map(lines => lines.length)) * 32;
  const rows = rounds.map(round => {
    const style = font(round.matched ? 38 : 32, round.matched ? 750 : 550);
    const lineHeight = round.matched ? 48 : 42;
    const words = round.words.map(word => wrap(ctx, word, columnWidth - 30, style));
    const height = Math.max(round.matched ? 120 : 74, Math.max(...words.map(lines => lines.length)) * lineHeight + (round.matched ? 52 : 24));
    return { ...round, style, lineHeight, words, height };
  });
  const rowsHeight = rows.length ? rows.reduce((height, row) => height + row.height + gap, 0) : 96;
  const brandHeight = 130, footerHeight = 282;
  const naturalHeight = brandHeight + 188 + namesHeight + rowsHeight + footerHeight;
  const extra = Math.max(0, 1180 - naturalHeight);
  const headerOffset = brandHeight + Math.round(extra * .16);
  const rowExtra = rows.length ? Math.min(84, Math.floor(extra * .45 / rows.length)) : 0;
  const startRows = 188 + namesHeight + headerOffset;
  const footer = startRows + rowsHeight + rowExtra * rows.length + 18;
  canvas.width = WIDTH;
  canvas.height = naturalHeight + extra;

  const [tavern, logo, cup] = await Promise.all([loadArt(tavernArt), loadArt(endlessBarLogo), loadArt(openCup)]);
  drawTavern(ctx, canvas.height, tavern);
  if (logo) ctx.drawImage(logo, WIDTH / 2 - 78, headerOffset - 105, 156, 156);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  write(ctx, '未央酒肆 · 杯中回聲', WIDTH / 2, 54 + headerOffset, font(26, 700), GOLD);
  write(ctx, headline, WIDTH / 2, 120 + headerOffset, font(54, 750), TEXT);
  ctx.strokeStyle = '#a97951';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(310, 162 + headerOffset);
  ctx.lineTo(770, 162 + headerOffset);
  ctx.stroke();
  names.forEach((name, index) => {
    const x = columnX(index), palette = PALETTES[index];
    box(ctx, x + columnWidth / 2 - 14, 181 + headerOffset, 28, 10, palette.accent);
    nameLines[index].forEach((line, i) => write(ctx, line, x + columnWidth / 2, 212 + headerOffset + i * 32, namesFont, palette.accent));
  });

  let y = startRows;
  for (const row of rows) {
    const height = row.height + rowExtra;
    write(ctx, `第 ${row.number} 輪`, margin + (rowLabel - gap) / 2, y + height / 2, font(22, 600), row.matched ? GOLD : MUTED);
    row.words.forEach((lines, index) => {
      const x = columnX(index), palette = PALETTES[index];
      box(ctx, x, y, columnWidth, height, palette.card, row.matched ? GOLD : undefined);
      if (row.matched) write(ctx, '✦', x + columnWidth / 2, y + 24 + rowExtra / 2, font(24, 700), GOLD);
      const textCenter = y + height / 2 + (row.matched ? 16 : 0);
      lines.forEach((line, i) => write(ctx, line, x + columnWidth / 2,
        textCenter + (i - (lines.length - 1) / 2) * row.lineHeight, row.style, palette.accent));
    });
    y += height + gap;
  }
  if (!rows.length) write(ctx, '這局還沒有揭曉的詞。', WIDTH / 2, startRows + 40, font(28, 550), MUTED);
  write(ctx, note, WIDTH / 2, footer + 15, font(27, 650), GOLD);
  write(ctx, `共 ${rounds.length} 輪公開紀錄`, WIDTH / 2, footer + 51, font(21, 500), MUTED);
  drawEchoCup(ctx, footer + 26, cup);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('逐輪詞鏈圖產生失敗。')), 'image/png'));
}
