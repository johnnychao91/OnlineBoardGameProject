import type { FogState } from '../games/fog/game';

export interface FogPosterOptions { G: FogState; players: { id: string | number; name?: string }[]; step: number; totalSteps: number }
function clean(value: string, limit = 28) { return Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join(''); }
function integer(value: number | undefined, maximum: number, fallback = 0) { return Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.trunc(value!))) : fallback; }

/** Only public events are copied. No roles, private ballots, future bells, identifiers or access data enter a poster. */
export function buildFogPosterModel({ G, players, step, totalSteps }: FogPosterOptions) {
  const nameOf = (id: string) => clean(players.find(player => String(player.id) === id)?.name || '巡夜者');
  const latest = G.log.filter(event => event.type === 'quest' || event.type === 'vote' || event.type === 'assassination').at(-1);
  const total = Math.max(1, integer(totalSteps, 999999, 1));
  return {
    quest: integer(G.quest, 5),
    step: Math.min(Math.max(1, integer(step, 999999, 1)), total), totalSteps: total,
    rejections: integer(G.rejections, 5),
    lighthouses: G.questResults.slice(0, 5).map(result => ({ quest: integer(result.quest, 5), succeeded: result.succeeded === true, successes: integer(result.successes, 10), fails: integer(result.fails, 10) })),
    outcome: G.status === 'finished' && (G.winner === 'knights' || G.winner === 'apostles') ? G.winner : 'ongoing',
    latest: latest ? {
      type: latest.type as 'quest' | 'vote' | 'assassination',
      quest: integer(latest.quest, 5),
      team: latest.type === 'quest' ? (latest.team ?? []).slice(0, 10).map(nameOf) : [],
      succeeds: latest.type === 'quest' ? latest.succeeded === true : null,
      successes: latest.type === 'quest' ? integer(latest.successes, 10) : null,
      fails: latest.type === 'quest' ? integer(latest.fails, 10) : null,
      approved: latest.type === 'vote' ? latest.approved === true : null,
      approveCount: latest.type === 'vote' ? Object.values(latest.votes ?? {}).filter(value => value === true).length : null,
      rejectCount: latest.type === 'vote' ? Object.values(latest.votes ?? {}).filter(value => value === false).length : null,
      actor: latest.type === 'assassination' && latest.actorID ? nameOf(latest.actorID) : null,
      target: latest.type === 'assassination' && latest.targetID ? nameOf(latest.targetID) : null,
    } : null,
  };
}

const font = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
const ink = '#f1e9d7', muted = '#b5b9ab', gold = '#e7ce92', green = '#96d9bf', red = '#ee9299';
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = ink, weight = 500, maxWidth = 940) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const chars = Array.from(value); let fitted = value;
  while (chars.length && ctx.measureText(fitted).width > maxWidth) { chars.pop(); fitted = chars.join('') + '…'; }
  ctx.fillText(fitted, x, y);
}
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill = '#252e2d', stroke = '#656b59') {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 20); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
}

export async function createFogPoster(options: FogPosterOptions): Promise<Blob> {
  const model = buildFogPosterModel(options);
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立巡夜戰報。');
  const background = ctx.createLinearGradient(0, 0, 1080, 1350); background.addColorStop(0, '#253033'); background.addColorStop(1, '#0e171e'); ctx.fillStyle = background; ctx.fillRect(0, 0, 1080, 1350);
  // Original procedural skyline stays independent of private roles and remote assets.
  ctx.fillStyle = '#111c23';
  for (let x = 0; x < 1080; x += 90) { const top = 180 + (x / 90 % 3) * 30; ctx.fillRect(x, top, 76, 230); ctx.beginPath(); ctx.moveTo(x - 10, top); ctx.lineTo(x + 38, top - 65); ctx.lineTo(x + 86, top); ctx.fill(); }
  text(ctx, 'NIGHT WATCH / 公開巡夜戰報', 68, 91, 19, gold, 650);
  text(ctx, '黑霧襲城', 66, 191, 76, ink, 750);
  text(ctx, '有些人點亮燈塔，有些人等待黑暗。', 70, 244, 26, muted);
  ctx.save(); ctx.textAlign = 'right'; text(ctx, `復盤 ${model.step} / ${model.totalSteps}`, 1010, 91, 18, muted); ctx.restore();
  const lit = model.lighthouses.filter(result => result.succeeded).length, lost = model.lighthouses.length - lit;
  [['點亮燈塔', String(lit), green], ['失守燈塔', String(lost), red], ['連續否決', `${model.rejections} / 5`, gold]].forEach(([label, value, color], index) => { const x = 66 + index * 324; box(ctx, x, 292, 302, 124); text(ctx, label, x + 24, 333, 20, muted); text(ctx, value, x + 24, 391, 44, color, 750); });
  box(ctx, 66, 446, 948, 464, '#252f31', '#8b815f'); text(ctx, `城郊燈塔 ${model.latest?.quest ?? model.quest} · 這一刻`, 98, 494, 23, gold, 650);
  const latest = model.latest;
  if (latest?.type === 'quest') {
    text(ctx, latest.succeeds ? '黑霧中，守住這一道光。' : '霧裡的背叛，終於現形。', 98, 579, 43, latest.succeeds ? green : red, 750, 870);
    text(ctx, `守護 ${latest.successes} 張   ／   侵蝕 ${latest.fails} 張`, 98, 650, 34, ink, 650);
    text(ctx, '出征隊伍', 98, 714, 20, muted);
    for (let i = 0; i < Math.min(latest.team.length, 5); i++) text(ctx, latest.team[i], 98 + i % 2 * 430, 755 + Math.floor(i / 2) * 37, 24, ink, 550, 405);
  } else if (latest?.type === 'vote') {
    text(ctx, latest.approved ? '這支隊伍，獲得了信任。' : '這次提名，沒能說服大家。', 98, 587, 43, latest.approved ? green : red, 750, 870);
    text(ctx, `贊成 ${latest.approveCount} 票   ／   反對 ${latest.rejectCount} 票`, 98, 663, 37, ink, 650);
    text(ctx, '每一張公開的票，都是下一次推理的線索。', 98, 758, 26, muted);
    text(ctx, '密票尚未揭曉前，戰報不會顯示選擇。', 98, 811, 23, muted);
  } else if (latest?.type === 'assassination') {
    text(ctx, '最後一次指認，決定城中命運。', 98, 585, 40, gold, 750, 865);
    text(ctx, `${latest.actor ?? '深海之刃'}  →  ${latest.target ?? '巡夜者'}`, 98, 666, 39, ink, 650, 865);
    text(ctx, model.outcome === 'apostles' ? '逐星神諭者被找出，黑霧使徒逆轉。' : '逐星神諭者安全，守夜騎士守住城門。', 98, 755, 29, model.outcome === 'apostles' ? red : green, 650, 865);
  } else {
    text(ctx, '巡夜隊已集結。', 98, 596, 48, gold, 750);
    text(ctx, '燈塔之外，是黑霧；身旁的人，未必是同伴。', 98, 681, 27, muted, 500, 865);
    text(ctx, '第一段公開行動，正要開始。', 98, 773, 29, ink);
  }
  box(ctx, 66, 940, 948, 247);
  text(ctx, '五座燈塔的紀錄', 98, 984, 20, muted, 650);
  for (let q = 1; q <= 5; q++) { const result = model.lighthouses.find(item => item.quest === q); const x = 107 + (q - 1) * 177; box(ctx, x, 1010, 151, 68, result ? result.succeeded ? '#254039' : '#453039' : '#202b32', '#657164'); text(ctx, `${q} · ${result ? result.succeeded ? '點亮' : '失守' : '待命'}`, x + 18, 1053, 25, result ? result.succeeded ? green : red : muted, 650); }
  text(ctx, model.outcome === 'knights' ? '守夜騎士獲勝 · 城門仍有光' : model.outcome === 'apostles' ? '黑霧使徒獲勝 · 黑霧已入城' : '巡夜尚未結束 · 每一步都值得推敲', 98, 1145, 31, model.outcome === 'apostles' ? red : gold, 700, 860);
  ctx.strokeStyle = '#64705e'; ctx.beginPath(); ctx.moveTo(74, 1235); ctx.lineTo(1006, 1235); ctx.stroke();
  text(ctx, '捷寶桌遊室', 74, 1290, 25, ink, 650); ctx.save(); ctx.textAlign = 'right'; text(ctx, '公開事件戰報 / BLACK FOG', 1006, 1288, 17, muted); ctx.restore();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('巡夜戰報產生失敗，請重試。')), 'image/png'));
}
