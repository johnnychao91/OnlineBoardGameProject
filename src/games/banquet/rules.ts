import { BANQUET_PRESETS, BANQUET_ROLES, type BanquetRole, type BanquetScenario } from './content';
export { BANQUET_ROLES, BANQUET_ROLE_IDS, BANQUET_PRESETS, BANQUET_RULE_SOURCES } from './content';
export type { BanquetRole, BanquetScenario } from './content';

export interface BanquetOptions { scenario: BanquetScenario; customRoles: BanquetRole[] }
export const DEFAULT_BANQUET_OPTIONS: BanquetOptions = { scenario: 'A', customRoles: [] };
export const isBanquetRole = (value: unknown): value is BanquetRole => typeof value === 'string' && Object.hasOwn(BANQUET_ROLES, value);
export function normalizeBanquetOptions(input: unknown): BanquetOptions {
  if (input === undefined) return { scenario: 'A', customRoles: [] };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('百鬼夜宴設定格式不正確。');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => key !== 'scenario' && key !== 'customRoles')) throw new Error('百鬼夜宴設定含有不支援的選項。');
  const scenario = data.scenario ?? 'A';
  if (data.scenario === null || !['A', 'B', 'custom'].includes(scenario as string)) throw new Error('請選擇 A、B 或自訂場景。');
  const customRoles = data.customRoles === undefined ? [] : data.customRoles;
  if (!Array.isArray(customRoles) || customRoles.length > 17 || customRoles.some(role => !isBanquetRole(role))) throw new Error('面具配置包含不支援的角色。');
  const counts: Partial<Record<BanquetRole, number>> = {};
  for (const role of customRoles) {
    counts[role as BanquetRole] = (counts[role as BanquetRole] ?? 0) + 1;
    if (counts[role as BanquetRole]! > BANQUET_ROLES[role as BanquetRole].count) throw new Error('每種面具只能一張，小豆洗最多兩張。');
  }
  return { scenario: scenario as BanquetScenario, customRoles: [...customRoles] };
}
export function banquetRoleSet(options: BanquetOptions, numPlayers: number): BanquetRole[] {
  return options.scenario === 'custom' ? [...options.customRoles] : [...(BANQUET_PRESETS[numPlayers]?.[options.scenario] ?? [])];
}
export function validateBanquetOptions(input: unknown, numPlayers?: number): string | undefined {
  let options: BanquetOptions;
  try { options = normalizeBanquetOptions(input); } catch (error) { return (error as Error).message; }
  if (numPlayers !== undefined && (!Number.isInteger(numPlayers) || numPlayers < 4 || numPlayers > 12)) return '百鬼夜宴需要 4～12 位玩家。';
  if (options.scenario !== 'custom') return undefined;
  const roles = options.customRoles;
  if (!roles.includes('judge')) return '自訂配置必須包含閻魔。';
  if (roles.filter(role => role === 'peasant').length === 1) return '小豆洗必須同時放入兩張，或兩張都不放。';
  if (roles.filter(role => BANQUET_ROLES[role].producesCoins).length < Math.ceil(roles.length / 3)) return '至少三分之一的面具必須能從金庫帶入妖金。';
  if (roles.length < 6 || roles.length > 14) return '自訂配置須有 6～14 張面具。';
  if (numPlayers === undefined) return undefined;
  if (numPlayers <= 5 ? roles.length !== 6 : roles.length < numPlayers || roles.length > numPlayers + 2) return numPlayers <= 5 ? '4～5 人必須使用 6 張面具。' : '面具張數須等於玩家人數，或多一至兩張放在中央。';
  const unavailable = roles.find(role => BANQUET_ROLES[role].minPlayers > numPlayers);
  if (unavailable) return `${BANQUET_ROLES[unavailable].name}需要至少 ${BANQUET_ROLES[unavailable].minPlayers} 位玩家。`;
  return undefined;
}

/** Deterministic online rulings for the printed rules' simultaneous payments.
 * One multi-recipient instruction is atomic (Patron, Thief, Puppeteer payment,
 * two Peasants, and all fines). Check victory after that instruction, before
 * any following instruction. Beggar visits are explicitly sequential.
 * If Puppeteer moves the turn initiator, clockwise continuation is from that
 * player's new position. Authentication IDs never change.
 */
export const BANQUET_ONLINE_RULINGS = [
  '同一指令的多方付款一併結算；若多人同批達到 13 枚妖金，共享勝利。有人破產時，以當時最多妖金者共同獲勝。',
  '分段能力在每段金幣變更後檢查終局。已獲勝便不再換牌、亮牌或收取後續罰款。垢嘗則每向一人收取後檢查。',
  '絡新婦換位後，從本回合發起者的新位置順時針輪到下一人。帳號、房間席位與私人記憶始終屬於原玩家。',
  '記憶只保存當時所見。盲換或假換都會把相關記憶標成可能已改變；百目鬼可記住自己看過的兩張牌及交換結果。',
] as const;
