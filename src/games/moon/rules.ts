export type MoonRole = 'wolf' | 'villager' | 'seer' | 'witch' | 'hunter' | 'guard';
export type MoonFaction = 'town' | 'wolves';
export interface MoonOptions {
  mode: 'online' | 'assisted';
  sheriff: boolean;
  speechSeconds: number;
  nightSeconds: number;
  voteSeconds: number;
}
export const DEFAULT_MOON_OPTIONS: MoonOptions = { mode: 'online', sheriff: false, speechSeconds: 60, nightSeconds: 30, voteSeconds: 30 };
export const MOON_FACTIONS: Record<MoonFaction, string> = { town: '好人', wolves: '狼人' };
export const MOON_ROLES: Record<MoonRole, { name: string; faction: MoonFaction; description: string }> = {
  wolf: { name: '狼人', faction: 'wolves', description: '你認得同車的狼人。夜間共同選擇一位非狼人乘客襲擊，白天隱藏身分並影響放逐表決。' },
  villager: { name: '村民', faction: 'town', description: '你沒有夜間技能。仔細聆聽餐車中的發言、比對表決與遇害名單，協助找出潛伏的狼人。' },
  seer: { name: '預言家', faction: 'town', description: '每晚可以查驗一位其他存活乘客，得知他是不是狼人。只有你能看到查驗結果。' },
  witch: { name: '女巫', faction: 'town', description: '你有一瓶解藥與一瓶毒藥，每晚最多使用一瓶。持有解藥時能看見當晚狼人襲擊的對象；只有第一晚能用解藥救自己。' },
  hunter: { name: '獵人', faction: 'town', description: '遭狼人襲擊或被放逐後，可以開槍帶走一位存活乘客，也可以放棄。若死於毒藥則無法開槍。' },
  guard: { name: '守衛', faction: 'town', description: '每晚可以保護一位存活乘客免於狼人的襲擊，可以保護自己，但不能連續兩晚保護同一人。毒藥不受保護影響。' },
};

/** Public room settings are strict and never contain identities or deployment data. */
export function normalizeMoonOptions(input: unknown): MoonOptions {
  if (input === undefined) return { ...DEFAULT_MOON_OPTIONS };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('銀月列車設定格式不正確。');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !Object.hasOwn(DEFAULT_MOON_OPTIONS, key))) throw new Error('銀月列車設定含有不支援的選項。');
  const result = { ...DEFAULT_MOON_OPTIONS };
  if (data.sheriff !== undefined) {
    if (typeof data.sheriff !== 'boolean') throw new Error('警長選項必須為開啟或關閉。');
    result.sheriff = data.sheriff;
  }
  if (data.mode !== undefined) {
    if (data.mode !== 'online' && data.mode !== 'assisted') throw new Error('請選擇線上模式或現場輔助模式。');
    result.mode = data.mode;
  }
  for (const key of ['speechSeconds', 'nightSeconds', 'voteSeconds'] as const) {
    if (data[key] === undefined) continue;
    const maximum = key === 'speechSeconds' ? 300 : 120;
    if (!Number.isInteger(data[key]) || (data[key] as number) < 15 || (data[key] as number) > maximum) {
      throw new Error(`${key === 'speechSeconds' ? '發言' : key === 'nightSeconds' ? '夜間階段' : '投票'}秒數必須是 15～${maximum} 的整數。`);
    }
    result[key] = data[key] as number;
  }
  return result;
}
export function validateMoonOptions(options: MoonOptions, count: number): string | undefined {
  if (!Number.isInteger(count) || count < 6 || count > 12) return '銀月列車需要 6～12 位玩家。';
  try { normalizeMoonOptions(options); } catch (error) { return (error as Error).message; }
  return undefined;
}
export function moonRoleDeck(count: number): MoonRole[] {
  const error = validateMoonOptions(DEFAULT_MOON_OPTIONS, count);
  if (error) throw new Error(error);
  const wolves = count === 12 ? 4 : count >= 9 ? 3 : 2;
  const roles: MoonRole[] = [...Array<MoonRole>(wolves).fill('wolf'), 'seer', 'witch'];
  if (count >= 7) roles.push('hunter');
  if (count === 8 || count >= 10) roles.push('guard');
  while (roles.length < count) roles.push('villager');
  return roles;
}
export function moonRoleCounts(count: number): Record<MoonRole, number> {
  const counts: Record<MoonRole, number> = { wolf: 0, villager: 0, seer: 0, witch: 0, hunter: 0, guard: 0 };
  for (const role of moonRoleDeck(count)) counts[role] += 1;
  return counts;
}
