export type FirewallOptions = Record<string, never>;
export function normalizeFirewallOptions(value?: unknown): FirewallOptions {
  return {};
}
export function validateFirewallOptions(value: unknown, count?: number): string | undefined {
  if (count !== undefined && (!Number.isInteger(count) || count < 2 || count > 12)) return '潛入防火牆需要 2 至 12 位玩家。';
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0)) return '潛入防火牆使用固定三輪完整規則。';
  return undefined;
}
/** Explicit resolutions for uncommon cases not fully specified by the printed rules. */
export const FIREWALL_EDGE_RULES = [
  '監禁中的角色不參與分紅；晶簇只由未監禁的資料採樣師均分，捨去餘數。',
  '同時接觸多個未知核心時，由上至下揭示；空核心方向優先接通觸發的可達邊，再使相鄰配邊最多，平手保持原方向。',
  '空手玩家暫時跳過；若交換手牌後重新持牌，便恢復回合。',
  '分紅扣減最低為零，不會扣除先前累積的資產。',
  '偷竊可選任何其他玩家；對方沒有資產時本次取得零點，不以可選名單透露金額。',
  '第一輪依房間席位順序先手；其後由上一輪最後出牌者的下一位先手。',
] as const;
