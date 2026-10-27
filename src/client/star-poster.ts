import { STAR_CARDS, STAR_COLORS, STAR_GUARDIANS, STAR_MATERIALS, STAR_TIERS, STAR_TOKENS, type StarCard, type StarTokenCounts } from '../games/star/content';
import type { StarState } from '../games/star/types';
import type { PosterOptions } from './game-types';
import { starArt, starCraftArt } from './star-art';
const clean = (value: string, limit = 50) => Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
const integer = (value: number) => Number.isFinite(value) ? Math.min(99999, Math.max(0, Math.trunc(value))) : 0;
const cardModel = (card: StarCard) => ({ name: card.name, tier: card.tier, bonus: card.bonus, prestige: card.prestige, cost: { ...card.cost }, asset: starCraftArt(card.bonus, card.tier, card.id) });
const tokenModel = (tokens: StarTokenCounts) => Object.fromEntries(STAR_TOKENS.map(color => [color, integer(tokens[color])])) as StarTokenCounts;
/** Public whitelist only. No projection can export a blind reservation or future design. */
export function buildStarPosterModel({ G: state, info, step, totalSteps }: PosterOptions) {
  const G = state as StarState, finished = G.status === 'finished', nameOf = (id: string) => clean(info.players.find(player => String(player.id) === id)?.name || '星匠', 24), total = Math.max(1, integer(totalSteps));
  return {
    round: integer(G.round), turn: integer(G.turnNumber), finished, step: Math.min(Math.max(1, integer(step)), total), totalSteps: total,
    bank: tokenModel(G.bank), endTriggeredBy: G.endTriggeredBy ? nameOf(G.endTriggeredBy) : null,
    market: STAR_TIERS.map(tier => ({ tier, remaining: integer(G.deckCounts[tier]), cards: G.market[tier].map(id => id ? cardModel(STAR_CARDS[id]) : null) })),
    players: G.turnOrder.map(id => ({ name: nameOf(id), tokens: tokenModel(G.players[id].tokens), bonuses: { ...G.players[id].bonuses },
      prestige: integer(G.players[id].prestige), purchased: G.players[id].purchased.length, guardians: G.players[id].guardians.map(guardianID => STAR_GUARDIANS[guardianID].name),
      reserved: G.players[id].reserved.map(reserve => ({ tier: reserve.tier, name: reserve.knownCardID ? STAR_CARDS[reserve.knownCardID].name : null })),
      winner: finished && G.winnerIDs.includes(id) })),
    guardians: G.guardians.map(id => ({ name: STAR_GUARDIANS[id].name, requirements: { ...STAR_GUARDIANS[id].requirements } })),
    events: G.log.slice(-3).map(event => ({ round: integer(event.round), action: ({ start: '工坊開門，市場設計已備妥', take: '星匠取得共用星材', reserve: '星匠保留一張設計', purchase: '新的作品完成打造', return: '多出的星材已歸還', guardian: '星座守護者來訪', 'forced-pass': '無可用行動，結束本回合', 'final-round': '十五聲望已達成，完成當輪後結算', finish: '星匠競逐完成，聲望總帳公開' } as Record<string, string>)[event.type] ?? '公開工坊事件' })),
    winners: finished ? G.winnerIDs.map(nameOf) : [], outcome: finished ? G.winReason === 'stalemate' ? '全桌無可用行動，按目前聲望結算' : '星匠競逐完成，群星為作品加冕' : G.endTriggeredBy ? '最後一輪，讓每位星匠完成作品' : '從一件小器具，打造整片星空',
  };
}
const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
function write(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = '#e3dfd1', weight = 500, width = 950) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; const chars = Array.from(clean(value, 150)); let fitted = chars.join('');
  while (chars.length && ctx.measureText(fitted).width > width) { chars.pop(); fitted = `${chars.join('')}…`; } ctx.fillText(fitted, x, y);
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill = '#172942ed', stroke = '#cbb37b66') { ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
async function loadArt(key: string) { const src = starArt(key); if (!src) return null; return new Promise<HTMLImageElement | null>(resolve => { const img = new Image(); let done = false; const finish = (value: HTMLImageElement | null) => { if (!done) { done = true; window.clearTimeout(timer); resolve(value); } }; const timer = window.setTimeout(() => finish(null), 4000); img.onload = () => finish(img); img.onerror = () => finish(null); img.src = src; }); }
const colors = { white: '#e5e5db', blue: '#92c6dc', green: '#8ec5a6', red: '#dc9984', black: '#676d83', gold: '#e0c883' };
export async function createStarPoster(options: PosterOptions): Promise<Blob> {
  const model = buildStarPosterModel(options), canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立星匠戰報。');
  const keys = [...new Set(['background', ...model.market.flatMap(level => level.cards.filter(card => card !== null).map(card => card.asset))])], loaded = await Promise.all(keys.map(loadArt)), art = Object.fromEntries(keys.map((key, index) => [key, loaded[index]]));
  ctx.fillStyle = '#101e35'; ctx.fillRect(0, 0, 1080, 1350); const background = art.background;
  if (background) { const scale = Math.max(1080 / background.width, 1350 / background.height); ctx.globalAlpha = .25; ctx.drawImage(background, (1080 - background.width * scale) / 2, (1350 - background.height * scale) / 2, background.width * scale, background.height * scale); ctx.globalAlpha = 1; }
  ctx.strokeStyle = '#ccb77d70'; ctx.lineWidth = 2; ctx.strokeRect(25, 25, 1030, 1300); ctx.strokeRect(33, 33, 1014, 1284);
  write(ctx, 'THE STARSMITH WORKSHOP', 65, 89, 19, '#d9c48c', 650); write(ctx, '星匠工坊', 61, 172, 76, '#f0e5c2', 750); write(ctx, `第 ${model.round} 輪　·　第 ${model.turn} 回合　·　復盤 ${model.step} / ${model.totalSteps}`, 66, 214, 23, '#b4c0c6');
  panel(ctx, 64, 235, 952, 61); write(ctx, '星材供應', 82, 272, 19, '#d7c68e', 650); STAR_TOKENS.forEach((color, index) => { const x = 218 + index * 132; ctx.fillStyle = colors[color]; ctx.beginPath(); ctx.arc(x, 264, 12, 0, Math.PI * 2); ctx.fill(); write(ctx, `${STAR_MATERIALS[color].name.replace('萬用', '')} ${model.bank[color]}`, x + 20, 271, 17, '#d7e1df', 500, 109); });
  const colWidth = 304, colGap = 20, cardWidth = 137, cardHeight = 205;
  model.market.forEach((level, levelIndex) => { const ox = 64 + levelIndex * (colWidth + colGap); write(ctx, `${level.tier} 級設計`, ox + 2, 330, 23, '#e0c98c', 650, 185); write(ctx, `餘 ${level.remaining}`, ox + 223, 329, 18, '#acbec3', 500, 80);
    level.cards.forEach((card, index) => { const x = ox + index % 2 * 151, y = 346 + Math.floor(index / 2) * 220; panel(ctx, x, y, cardWidth, cardHeight, '#142840', '#c7af7788'); if (!card) { write(ctx, '設計已用盡', x + 20, y + 110, 18, '#aebcc3', 500, 110); return; }
      const image = art[card.asset]; if (image) { ctx.save(); ctx.beginPath(); ctx.roundRect(x + 2, y + 2, cardWidth - 4, cardHeight - 4, 10); ctx.clip(); const ratio = Math.min((cardWidth - 4) / image.width, (cardHeight - 4) / image.height); ctx.drawImage(image, x + (cardWidth - image.width * ratio) / 2, y + (cardHeight - image.height * ratio) / 2, image.width * ratio, image.height * ratio); ctx.restore(); }
      ctx.fillStyle = '#0c1929cc'; ctx.fillRect(x + 2, y + 147, cardWidth - 4, 56); write(ctx, String(card.prestige), x + 10, y + 35, 30, '#fff0ba', 750, 60); ctx.fillStyle = colors[card.bonus]; ctx.beginPath(); ctx.arc(x + 115, y + 23, 12, 0, Math.PI * 2); ctx.fill();
      const costs = STAR_COLORS.filter(color => card.cost[color] > 0); costs.forEach((color, costIndex) => { const cx = x + 13 + costIndex * 30; ctx.fillStyle = colors[color]; ctx.beginPath(); ctx.arc(cx, y + 163, 7, 0, Math.PI * 2); ctx.fill(); write(ctx, String(card.cost[color]), cx + 9, y + 168, 13, '#fff0d6', 650, 17); }); write(ctx, card.name, x + 8, y + 192, 14, '#f4e7c7', 600, cardWidth - 16);
    });
  });
  const cols = model.players.length <= 2 ? 2 : 4, gap = 11, width = (952 - gap * (cols - 1)) / cols;
  model.players.forEach((player, index) => { const x = 64 + index * (width + gap), y = 798; panel(ctx, x, y, width, 141, player.winner ? '#3b3d39ed' : '#1b2e46ed', player.winner ? '#e0c991' : '#c8b37a66'); write(ctx, player.name, x + 12, y + 27, 20, '#e1e4d8', 650, width - 24); write(ctx, `${player.prestige} 聲望${player.winner ? ' · 勝者' : ''}`, x + 12, y + 59, 24, '#e4c982', 700, width - 24); write(ctx, `作品 ${player.purchased}　守護者 ${player.guardians.length}`, x + 12, y + 85, 16, '#b9c8c8', 500, width - 24); const bonuses = STAR_COLORS.map(color => `${STAR_MATERIALS[color].name.slice(0, 1)}${player.bonuses[color]}`).join(' '); write(ctx, bonuses, x + 12, y + 109, 14, '#d7d6ba', 500, width - 24); write(ctx, `保留 ${player.reserved.length} / 3　星材 ${STAR_TOKENS.reduce((sum, color) => sum + player.tokens[color], 0)}`, x + 12, y + 130, 14, '#aebfc4', 500, width - 24); });
  panel(ctx, 64, 957, 952, 98); write(ctx, '公開星匠手札', 86, 985, 19, '#d8c58d', 650); model.events.forEach((event, index) => write(ctx, `第 ${event.round} 輪 · ${event.action}`, 87, 1009 + index * 19, 16, '#bdcbd0', 500, 905));
  panel(ctx, 64, 1075, 952, 145, '#30394aed', '#d9bf7e88'); write(ctx, model.outcome, 89, 1123, 32, '#efe0ae', 700, 900); write(ctx, model.winners.length ? `獲勝者：${model.winners.join('、')}` : '每一次打造，都讓下一片星空更近。', 91, 1166, 23, '#d6d8d3', 500, 890); write(ctx, '僅呈現公開資訊，不含盲抽保留設計或未來牌堆。', 91, 1199, 18, '#acbbc1');
  write(ctx, '星匠工坊 · 公開戰報', 66, 1270, 20, '#aebbc1'); write(ctx, '永久工藝，點亮星座的委託。', 670, 1270, 18, '#aebbc1', 500, 345);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('星匠戰報產生失敗。')), 'image/png'));
}
