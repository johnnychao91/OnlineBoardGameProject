import type { BakerState } from '../games/baker/game';
import { BAKER_ERAS } from '../games/baker/rules';
import { BAKER_SCENES, sceneOptions } from '../games/baker/content';
import type { PosterOptions } from './game-types';

function clean(value: string, limit = 60): string {
  return Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
}
const integer = (value: number, maximum = 99999) => Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.trunc(value))) : 0;
const eventLabels: Record<string, string> = {
  start: '案件開始', case: '案件開始', crime: '秘密案情已建立', investigation: '秘密案情已建立',
  location: '案發地點圖板確認', scene: '現場推演圖板展開', mark: '留下鑑證線索',
  discussion: '開始案情研討', presentation: '開始輪流發言', speech: '完成發言', round: '進入下一輪調查',
  replace: '更新一份鑑證', special: '案件事件', 'special-skip': '案件事件無須處理', exclude: '排除一張證物', badge: '歸還破案警徽',
  'special-mark': '案件事件追加鑑證', 'special-replace': '案件事件替換圖板',
  accusation: '提交破案推論', 'witness-hunt': '進入最後指認', identify: '完成目擊者指認', finish: '案件結束',
};

/** Public fields only: no role lookup through private data or future decks. */
export function buildBakerPosterModel({ G: state, info, step, totalSteps }: PosterOptions) {
  const G = state as BakerState;
  const nameOf = (id: string) => clean(info.players.find(player => String(player.id) === id)?.name || '倫敦警員', 24);
  const publicCards = Object.values(G.players).flatMap(player => [...player.means, ...player.clues]);
  const cardName = (id: string) => publicCards.find(card => card.id === id)?.name ?? '';
  const total = Math.max(1, integer(totalSteps));
  return {
    era: BAKER_ERAS[G.options.era].name, year: integer(G.options.year), round: integer(G.round, 3),
    step: Math.min(Math.max(1, integer(step)), total), totalSteps: total,
    holmes: G.holmesID ? nameOf(G.holmesID) : '',
    players: Object.entries(G.players).map(([id, player]) => ({ name: nameOf(id), holmes: id === G.holmesID, badge: player.badge })),
    scenes: G.scenes.slice(0, 6).map(slot => ({ name: slot.tile.name, clues: slot.marks.map(index => sceneOptions(slot.tile, G.options.era)[index]).filter(Boolean) })),
    events: G.log.slice(-5).map(event => {
      const tile = event.tileID ? BAKER_SCENES.find(item => item.id === event.tileID) : undefined;
      return {
        round: integer(event.round, 3), actor: event.actorID ? nameOf(event.actorID) : '',
        action: eventLabels[event.type] ?? '公開調查事件',
        detail: event.type === 'accusation' ? event.correct ? '推論成立' : '推論不成立'
          : tile && typeof event.option === 'number' ? `${tile.name}：${sceneOptions(tile, G.options.era)[event.option] ?? ''}` : '',
      };
    }),
    outcome: G.status === 'finished' ? G.winner === 'police' ? '真相大白 · 調查陣營獲勝' : '迷霧未散 · 莫里亞蒂陣營獲勝' : '調查仍在進行',
    solution: G.status === 'finished' && G.solution ? { murderer: nameOf(G.solution.murdererID), means: cardName(G.solution.meansID), clue: cardName(G.solution.clueID) } : null,
  };
}

const W = 1080, H = 1440, FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
function write(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = '#ede0bd', weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.fillText(text, x, y);
}
function fit(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, color = '#ede0bd', weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const chars = Array.from(clean(text, 150)); let fitted = chars.join('');
  while (chars.length && ctx.measureText(fitted).width > width) { chars.pop(); fitted = `${chars.join('')}…`; }
  write(ctx, fitted, x, y, size, color, weight);
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill = '#233b31', stroke = '#b39b6366') {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, 13); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
}

export async function createBakerPoster(options: PosterOptions): Promise<Blob> {
  const model = buildBakerPosterModel(options);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立案件戰報。');
  const gradient = ctx.createLinearGradient(0, 0, W, H); gradient.addColorStop(0, '#243b31'); gradient.addColorStop(.6, '#102725'); gradient.addColorStop(1, '#0c1c20');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#bda16d66'; ctx.lineWidth = 1.5; ctx.strokeRect(24, 24, W - 48, H - 48); ctx.strokeRect(31, 31, W - 62, H - 62);
  write(ctx, 'THE BAKER STREET FILES', 66, 92, 21, '#bca16c', 650);
  write(ctx, '貝克街迷霧', 61, 181, 73, '#f2dfaf', 750);
  write(ctx, '每一件留下的物證，都在等待正確的解釋。', 67, 229, 25, '#bac6b7');
  ctx.save(); ctx.translate(938, 133); ctx.rotate(-.28); ctx.strokeStyle = '#c8ae78'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(0, -10, 39, 0, Math.PI * 2); ctx.moveTo(0, 29); ctx.lineTo(0, 94); ctx.stroke(); ctx.restore();
  panel(ctx, 64, 270, 952, 114);
  write(ctx, `${model.year} · ${model.era}`, 91, 316, 29, '#e9cd8e', 700);
  write(ctx, `第 ${model.round} / 3 輪　復盤 ${model.step} / ${model.totalSteps}`, 93, 360, 21, '#c2c8b5');
  ctx.save(); ctx.textAlign = 'right'; fit(ctx, model.holmes ? `福爾摩斯：${model.holmes}` : '案件待開卷', 984, 356, 380, 21, '#dbc797'); ctx.restore();
  write(ctx, '鑑證線索', 65, 434, 24, '#d9be83', 650);
  model.scenes.forEach((scene, index) => {
    const x = 64 + index % 3 * 322, y = 460 + Math.floor(index / 3) * 116;
    panel(ctx, x, y, 308, 100, '#d9c69d', '#e8d8ad99');
    fit(ctx, scene.name, x + 17, y + 34, 274, 22, '#3b4933', 650);
    fit(ctx, scene.clues.length ? scene.clues.join('、') : '等待鑑證', x + 17, y + 76, 274, 25, '#1b4035', 750);
  });
  if (!model.scenes.length) write(ctx, '推理棋子尚未落下。', 87, 519, 25, '#b8c7b2');
  panel(ctx, 64, 713, 952, 172);
  write(ctx, '參與調查', 88, 752, 21, '#d9be83', 650);
  model.players.forEach((player, index) => {
    const x = 88 + index % 4 * 232, y = 794 + Math.floor(index / 4) * 32;
    fit(ctx, `${player.holmes ? '⌕' : player.badge ? '◆' : '◇'} ${player.name}`, x, y, 214, 19, player.holmes ? '#e7ce98' : '#d0d5c2');
  });
  panel(ctx, 64, 908, 952, 244);
  write(ctx, '公開案件紀錄', 89, 951, 22, '#d9be83', 650);
  model.events.forEach((event, index) => fit(ctx, `第 ${event.round} 輪　${[event.actor, event.action, event.detail].filter(Boolean).join(' · ')}`, 89, 991 + index * 31, 902, 20, '#c9d0bb'));
  if (!model.events.length) write(ctx, '案件開卷後，公開紀錄會留在這裡。', 90, 1006, 23, '#b6c2ac');
  panel(ctx, 64, 1176, 952, 163, '#314434', '#d1af70aa');
  fit(ctx, model.outcome, 91, 1224, 898, 31, '#f1d69d', 750);
  if (model.solution) {
    fit(ctx, `執行者：${model.solution.murderer}`, 92, 1264, 900, 22, '#d8dec7');
    fit(ctx, `${model.solution.means} ＋ ${model.solution.clue}`, 92, 1306, 900, 24, '#e1cea2', 650);
  } else write(ctx, '秘密身分與未公開案情不會出現在公開戰報。', 92, 1284, 21, '#c4cfb9');
  write(ctx, '捷寶桌遊室', 65, 1392, 23, '#ede0bd', 650);
  ctx.save(); ctx.textAlign = 'right'; write(ctx, '貝克街迷霧 / PUBLIC CASE REPORT', 1014, 1389, 14, '#9bac9a'); ctx.restore();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('案件戰報產生失敗，請重試。')), 'image/png'));
}
