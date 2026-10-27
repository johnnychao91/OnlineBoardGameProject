/** Original card subjects only; network connectivity is rendered from verified topology. */
import { FIREWALL_ACTIONS, FIREWALL_PATHS, type FirewallActionID, type FirewallCard, type FirewallPathDefinition } from '../games/firewall/content';
const images = import.meta.glob<string>('./assets/firewall/**/*.{webp,png}', { eager: true, import: 'default', query: '?url' });
export function firewallArt(key: string): string {
  return images[`./assets/firewall/${key}.webp`] ?? images[`./assets/firewall/${key}.png`] ?? '';
}
export function firewallActionArt(action: FirewallActionID): string[] {
  if (action.startsWith('repair_')) return FIREWALL_ACTIONS[action].tools.map(tool => `tools/${tool}`);
  const key = action === 'freedom' ? 'free' : action === 'change_roles' ? 'change-role' : action.replaceAll('_', '-');
  return [`actions/${key}`];
}
export function firewallPathName(path: FirewallPathDefinition): string {
  if (path.id === 'start') return '起始節點';
  if (path.id === 'goal_gold') return '核心資料';
  if (path.id.startsWith('goal_')) return '空核心';
  if (path.door) return path.door.color === 'blue' ? '藍域閘門' : '綠域閘門';
  if (path.ladderComponent !== undefined) return '跳板線路';
  if (path.crystals) return '資料晶簇線路';
  if (path.feature === 'bridge') return '跨線橋';
  if (path.feature === 'double_bend') return '雙彎隔離線路';
  if (path.components.every(component => component.length === 1)) return '終止線路';
  return path.components.length > 1 ? '分隔線路' : '連通線路';
}
export const firewallCardName = (card: FirewallCard) => card.kind === 'action' ? FIREWALL_ACTIONS[card.action].name : firewallPathName(FIREWALL_PATHS[card.pathID]);
export const FIREWALL_ACTION_HELP: Record<FirewallActionID, string> = {
  break_lantern: '停用另一人的偵察模組。任一器材故障時，該玩家不能放置線路。',
  break_pickaxe: '停用另一人的解密器。任一器材故障時，該玩家不能放置線路。',
  break_cart: '停用另一人的傳輸器。任一器材故障時，該玩家不能放置線路。',
  repair_lantern: '修復自己或另一人已故障的偵察模組，不能預先施加保護。',
  repair_pickaxe: '修復自己或另一人已故障的解密器，不能預先施加保護。',
  repair_cart: '修復自己或另一人已故障的傳輸器，不能預先施加保護。',
  repair_lantern_or_pickaxe: '在偵察模組與解密器中選一種，修復一位玩家的一項故障。只修復一項。',
  repair_lantern_or_cart: '在偵察模組與傳輸器中選一種，修復一位玩家的一項故障。只修復一項。',
  repair_pickaxe_or_cart: '在解密器與傳輸器中選一種，修復一位玩家的一項故障。只修復一項。',
  map: '私下查看一個尚未公開的目標，記錄的是這一輪的核心情報。',
  rockfall: '移除版圖上一張普通線路；不能移除起始節點或三個目標。',
  theft: '在自己面前部署竊取後門。輪末分紅後，若未遭監禁，可向另一人偷取 1 點資產。',
  hands_off: '移除任一玩家面前的竊取後門，也可移除自己的。',
  trapped: '隔離另一位玩家。監禁期間不能放線路；輪末仍被監禁則不能分紅或偷竊。',
  freedom: '解除自己或另一位玩家的隔離監禁。',
  inspection: '私下查看另一人的當前身分；不會公開給其他玩家。',
  change_roles: '讓自己或另一人從身分堆頂取得新身分，原身分放回堆底。',
  swap_hands: '打出此牌後，與另一人交換全部剩餘手牌。這回合由對方補抽 1 張。',
};
