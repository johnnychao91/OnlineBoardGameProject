import { FIREWALL_ROLES, type FirewallDirection } from '../games/firewall/content';
import type { FirewallState } from '../games/firewall/types';
import { firewallTileTopology } from '../games/firewall/topology';
import type { PosterOptions } from './game-types';
import { firewallArt } from './firewall-art';

const clean = (value: string, limit = 50) => Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
const integer = (value: number) => Number.isFinite(value) ? Math.min(99999, Math.max(0, Math.trunc(value))) : 0;

/** Explicit public whitelist. Even an authorized god-view cannot add secrets to PNG. */
export function buildFirewallPosterModel({ G: state, info, step, totalSteps }: PosterOptions) {
  const G = state as FirewallState, finished = G.status === 'finished';
  const nameOf = (id: string) => clean(info.players.find(player => String(player.id) === id)?.name || '滲透節點', 24);
  const total = Math.max(1, integer(totalSteps));
  return {
    round: integer(G.round), turn: integer(G.turnNumber), deckCount: integer(G.deckCount), finished,
    step: Math.min(Math.max(1, integer(step)), total), totalSteps: total,
    players: G.turnOrder.map(id => ({ name: nameOf(id), handCount: integer(G.players[id].handCount),
      role: G.players[id].publicRole ? FIREWALL_ROLES[G.players[id].publicRole!].name : null,
      score: finished ? integer(G.finalScores[id]) : null, winner: finished && G.winnerIDs.includes(id),
      impaired: G.players[id].broken.length, trapped: G.players[id].trapped, theft: G.players[id].theftOrder !== null })),
    tiles: G.board.map(tile => {
      const hidden = tile.kind === 'goal' && !tile.revealed;
      if (hidden) return { id: tile.id, x: tile.x, y: tile.y, kind: tile.kind, hidden, topology: null, asset: 'card-back' };
      const topology = firewallTileTopology(tile);
      return { id: tile.id, x: tile.x, y: tile.y, kind: tile.kind, hidden,
        topology: topology ? { components: topology.components.map(component => [...component]), door: topology.door ? { ...topology.door } : undefined,
          ladderComponent: topology.ladderComponent, crystals: topology.crystals, feature: topology.feature } : null,
        asset: tile.kind === 'start' ? 'nodes/start' : tile.kind === 'goal' ? tile.pathID === 'goal_gold' ? 'nodes/core' : 'nodes/decoy' : 'route-base' };
    }),
    events: G.log.slice(-5).map(event => ({ round: integer(event.round),
      action: ({ 'round-start': '新一輪滲透開始', path: '線路部署完成', action: '公開程式已執行', discard: '棄牌後補充程式', 'clear-effect': '節點自行解除效果', 'goal-reveal': '未知目標已揭曉', 'round-end': '本輪分紅已結算', theft: '竊取後門已執行', finish: '三輪總帳公開' } as Record<string, string>)[event.type] ?? '公開網路事件' })),
    winners: finished ? G.winnerIDs.map(nameOf) : [], outcome: finished ? '三輪滲透完成，資產總帳公開' : G.status === 'review' ? '本輪結算完成' : '企業核心仍在迷網深處',
  };
}

const FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif';
function write(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = '#d2e7dd', weight = 500, width = 950) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const chars = Array.from(clean(value, 150)); let fitted = chars.join('');
  while (chars.length && ctx.measureText(fitted).width > width) { chars.pop(); fitted = `${chars.join('')}…`; }
  ctx.fillText(fitted, x, y);
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill = '#122b34ed', stroke = '#83cbb866') {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
}
async function loadArt(key: string) {
  const src = firewallArt(key); if (!src) return null;
  return new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image(); let done = false;
    const finish = (value: HTMLImageElement | null) => { if (!done) { done = true; window.clearTimeout(timer); resolve(value); } };
    const timer = window.setTimeout(() => finish(null), 4000); img.onload = () => finish(img); img.onerror = () => finish(null); img.src = src;
  });
}
export async function createFirewallPoster(options: PosterOptions): Promise<Blob> {
  const model = buildFirewallPosterModel(options), canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立滲透戰報。');
  const keys = [...new Set(['background', ...model.tiles.map(tile => tile.asset)])], loaded = await Promise.all(keys.map(loadArt));
  const art = Object.fromEntries(keys.map((key, index) => [key, loaded[index]]));
  ctx.fillStyle = '#0a1a25'; ctx.fillRect(0, 0, 1080, 1350);
  const background = art.background; if (background) { const scale = Math.max(1080 / background.width, 1350 / background.height); ctx.globalAlpha = .22; ctx.drawImage(background, (1080 - background.width * scale) / 2, (1350 - background.height * scale) / 2, background.width * scale, background.height * scale); ctx.globalAlpha = 1; }
  ctx.strokeStyle = '#73c7ac70'; ctx.lineWidth = 2; ctx.strokeRect(25, 25, 1030, 1300); ctx.strokeRect(33, 33, 1014, 1284);
  write(ctx, 'FIREWALL BREACH', 65, 90, 20, '#86d5b5', 650); write(ctx, '潛入防火牆', 61, 174, 72, '#e4f0dc', 750); write(ctx, '核心越近，同行者的目的越難辨認。', 66, 221, 25, '#a9c4ba');
  panel(ctx, 64, 252, 952, 82); write(ctx, `第 ${model.round} / 3 輪　｜　第 ${model.turn} 回合　｜　未抽程式 ${model.deckCount}`, 89, 287, 25, '#d3e9d9', 650); write(ctx, `公開網路快照　·　復盤 ${model.step} / ${model.totalSteps}`, 90, 317, 19, '#9fbeb1');
  panel(ctx, 64, 353, 952, 340, '#0c202ce8');
  if (model.tiles.length) {
    const minX = Math.min(...model.tiles.map(tile => tile.x)), maxX = Math.max(...model.tiles.map(tile => tile.x)), minY = Math.min(...model.tiles.map(tile => tile.y)), maxY = Math.max(...model.tiles.map(tile => tile.y));
    const scale = Math.min(910 / ((maxX - minX + 1) * 100), 303 / ((maxY - minY + 1) * 150));
    const ox = 540 - ((maxX + minX + 1) * 100 * scale) / 2, oy = 523 - ((maxY + minY + 1) * 150 * scale) / 2;
    const edge: Record<FirewallDirection, [number, number]> = { N: [50, 0], E: [100, 75], S: [50, 150], W: [0, 75] }, stop: Record<FirewallDirection, [number, number]> = { N: [50, 45], E: [73, 75], S: [50, 105], W: [27, 75] };
    for (const tile of model.tiles) {
      ctx.save(); ctx.translate(ox + tile.x * 100 * scale, oy + tile.y * 150 * scale); ctx.scale(scale, scale);
      ctx.fillStyle = '#122c36'; ctx.fillRect(1, 1, 98, 148); ctx.strokeStyle = tile.kind === 'goal' ? '#c987aa' : '#5a8e79'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, 98, 148);
      const image = art[tile.asset]; if (image) { ctx.globalAlpha = tile.hidden ? .9 : .18; const ratio = Math.min(100 / image.width, 150 / image.height); ctx.drawImage(image, (100 - image.width * ratio) / 2, (150 - image.height * ratio) / 2, image.width * ratio, image.height * ratio); ctx.globalAlpha = 1; }
      if (tile.hidden) { ctx.textAlign = 'center'; write(ctx, '?', 50, 93, 44, '#e0c9df', 750, 95); ctx.restore(); continue; }
      const topology = tile.topology;
      if (topology) {
        topology.components.forEach((component, index) => {
          ctx.beginPath();
          if (component.length === 1) { const a = edge[component[0]], b = topology.ladderComponent === index ? [50, 75] : stop[component[0]]; ctx.moveTo(...a); ctx.lineTo(b[0], b[1]); }
          else if (component.length === 2) { const [a, b] = component.map(side => edge[side]); ctx.moveTo(...a); if (a[0] === b[0] || a[1] === b[1]) ctx.lineTo(...b); else { const first = stop[component[0]], last = stop[component[1]]; ctx.lineTo(...first); ctx.quadraticCurveTo(50, 75, ...last); ctx.lineTo(...b); } }
          else for (const side of component) { ctx.moveTo(...edge[side]); ctx.lineTo(50, 75); }
          ctx.strokeStyle = '#101e29'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke(); ctx.strokeStyle = '#9fe8d5'; ctx.lineWidth = 7; ctx.stroke();
        });
        if (topology.feature === 'bridge') { ctx.beginPath(); ctx.moveTo(50, 54); ctx.lineTo(50, 96); ctx.strokeStyle = '#122c36'; ctx.lineWidth = 20; ctx.stroke(); ctx.strokeStyle = '#9fe8d5'; ctx.lineWidth = 7; ctx.stroke(); }
        topology.components.forEach((component, index) => { if (component.length !== 1 || topology.ladderComponent === index) return; const [x, y] = stop[component[0]], vertical = component[0] === 'N' || component[0] === 'S'; ctx.beginPath(); ctx.moveTo(x - (vertical ? 7 : 0), y - (vertical ? 0 : 7)); ctx.lineTo(x + (vertical ? 7 : 0), y + (vertical ? 0 : 7)); ctx.strokeStyle = '#e4a990'; ctx.lineWidth = 4; ctx.stroke(); });
        const marker = (index: number) => { const component = topology.components[index]; if (component.length === 2) { const [a, b] = component.map(side => edge[side]); if (a[0] !== b[0] && a[1] !== b[1]) return [50 + (a[0] + b[0] - 100) / 10, 75 + (a[1] + b[1] - 150) / 10]; } return [50, 75]; };
        if (topology.door) { const [x, y] = marker(topology.door.component); ctx.fillStyle = topology.door.color === 'blue' ? '#4795e2' : '#5acb99'; ctx.fillRect(x - 8, y - 12, 16, 24); }
        if (topology.ladderComponent !== undefined) { const [x, y] = marker(topology.ladderComponent); ctx.strokeStyle = '#ffe5ac'; ctx.lineWidth = 3; ctx.strokeRect(x - 8, y - 12, 16, 24); }
        if (topology.crystals) { ctx.fillStyle = '#d7abf6'; ctx.fillRect(72, 15, 12, 17); }
      }
      ctx.restore();
    }
  }
  const cols = Math.min(4, Math.max(1, model.players.length)), rows = Math.ceil(model.players.length / cols), gap = 11, width = (952 - gap * (cols - 1)) / cols, rowHeight = rows === 3 ? 83 : 99;
  model.players.forEach((player, index) => { const x = 64 + index % cols * (width + gap), y = 714 + Math.floor(index / cols) * (rowHeight + 10); panel(ctx, x, y, width, rowHeight, player.winner ? '#354a35ef' : '#152b35ed', player.winner ? '#e0d292' : '#76b49d55'); write(ctx, player.name, x + 12, y + 27, 20, '#d4e5dd', 650, width - 24); write(ctx, player.score !== null ? `${player.score} 點${player.winner ? ' · 勝者' : ''}` : `手牌 ${player.handCount}　${player.trapped ? '隔離中' : player.impaired ? '器材故障' : '節點在線'}`, x + 12, y + 55, 20, '#a7dfb7', 650, width - 24); if (player.role) write(ctx, player.role, x + 12, y + rowHeight - 10, 14, '#a8bdb3', 500, width - 24); });
  const eventTop = 714 + rows * (rowHeight + 10) + 8, eventHeight = Math.max(84, 1051 - eventTop); panel(ctx, 64, eventTop, 952, eventHeight); write(ctx, '公開行動檔案', 88, eventTop + 29, 19, '#9adab9', 650);
  model.events.slice(-Math.max(1, Math.floor((eventHeight - 39) / 23))).forEach((event, index) => write(ctx, `第 ${event.round} 輪 · ${event.action}`, 89, eventTop + 54 + index * 23, 18, '#c0d4c8', 500, 900));
  panel(ctx, 64, 1075, 952, 145, '#223a35ed', '#9bd0ac88'); write(ctx, model.outcome, 89, 1124, 32, '#e1e8be', 700, 900); write(ctx, model.winners.length ? `獲勝者：${model.winners.join('、')}` : '每一條連線，都可能替另一個目的鋪路。', 91, 1166, 23, '#c9dbcc', 500, 890); write(ctx, '僅呈現已公開資訊，未知目標維持隱藏。', 91, 1199, 18, '#9eb8ab');
  write(ctx, '潛入防火牆 · 公開戰報', 66, 1270, 20, '#98b4a6'); write(ctx, '三輪競逐，最高累積資產勝出。', 640, 1270, 18, '#98b4a6', 500, 370);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('滲透戰報產生失敗。')), 'image/png'));
}
