export type MoonRole = 'wolf' | 'villager' | 'seer' | 'witch' | 'hunter' | 'guard' | 'wolf-king' | 'white-wolf-king' | 'ghost-rider' | 'idiot';
export type MoonFaction = 'town' | 'wolves';
export interface MoonOptions {
  mode: 'online' | 'assisted';
  sheriff: boolean;
  speechSeconds: number;
  nightSeconds: number;
  voteSeconds: number;
  /** Missing fields in historical saves retain the classic configuration. */
  presetId?: string;
  doubleProtection?: 'preset' | 'survive' | 'die';
}
export const DEFAULT_MOON_OPTIONS: MoonOptions = { mode: 'online', sheriff: false, speechSeconds: 60, nightSeconds: 30, voteSeconds: 30, presetId: 'classic', doubleProtection: 'preset' };
export const MOON_TIME_LIMITS = {
  speechSeconds: { min: 5, max: 300 },
  nightSeconds: { min: 5, max: 120 },
  voteSeconds: { min: 5, max: 120 },
} as const;
export type MoonTimeOption = keyof typeof MOON_TIME_LIMITS;
/** Accept integer input only; both the room form and server use the same bounds. */
export function normalizeMoonSeconds(key: MoonTimeOption, input: unknown): number {
  const { min, max } = MOON_TIME_LIMITS[key];
  if (typeof input !== 'number' || !Number.isFinite(input) || !Number.isInteger(input)) {
    throw new Error(`${key === 'speechSeconds' ? '發言' : key === 'nightSeconds' ? '夜間階段' : '投票'}秒數必須是 ${min}～${max} 的整數。`);
  }
  return Math.max(min, Math.min(max, input));
}
export const MOON_FACTIONS: Record<MoonFaction, string> = { town: '好人', wolves: '狼人' };
export const MOON_ROLES: Record<MoonRole, { name: string; faction: MoonFaction; description: string }> = {
  wolf: { name: '狼人', faction: 'wolves', description: '你認得同車的狼人。夜間共同選擇襲擊對象，白天隱藏身分並影響放逐表決。能否襲擊狼隊或自爆依本局公開房規。' },
  villager: { name: '村民', faction: 'town', description: '你沒有夜間技能。仔細聆聽餐車中的發言、比對表決與遇害名單，協助找出潛伏的狼人。' },
  seer: { name: '預言家', faction: 'town', description: '每晚可以查驗一位其他存活乘客，得知他是不是狼人。只有你能看到查驗結果。' },
  witch: { name: '女巫', faction: 'town', description: '你有一瓶解藥與一瓶毒藥，每晚最多使用一瓶。持有解藥時能看見當晚狼人襲擊的對象；只有第一晚能用解藥救自己。' },
  hunter: { name: '獵人', faction: 'town', description: '遭狼人襲擊或被放逐後，可以開槍帶走一位存活乘客，也可以放棄。若死於毒藥則無法開槍。' },
  guard: { name: '守衛', faction: 'town', description: '每晚可以保護一位存活乘客免於狼人的襲擊，可以保護自己，但不能連續兩晚保護同一人。毒藥不受保護影響。' },
  'wolf-king': { name: '狼王（黑狼王）', faction: 'wolves', description: '你與狼隊相認並共同襲擊。被放逐、狼刀或其他玩家開槍帶走時，可再開槍帶走一位乘客；被毒殺或自行自爆不能開槍。' },
  'white-wolf-king': { name: '白狼王', faction: 'wolves', description: '你與狼隊相認並共同襲擊。白天發言期間可自爆，同時帶走一位其他存活乘客；被放逐、毒殺或開槍帶走時不發動。' },
  'ghost-rider': { name: '惡靈騎士', faction: 'wolves', description: '你與狼隊相認並共同襲擊，不能自爆或成為狼刀目標。夜間免傷；首次遭預言家查驗或女巫下毒時反傷施術者，天亮時對方死亡。全局只反傷一次，查驗先於下毒。' },
  idiot: { name: '白癡', faction: 'town', description: '第一次被投票放逐時，自動公開身分並留在車上，此後仍能發言但永久失去投票權。再被放逐、夜間遭襲擊或中毒時，仍會死亡。' },
};

export const isMoonWolf = (role: MoonRole): boolean => MOON_ROLES[role].faction === 'wolves';

/** Public starting rules, copied into each new match; never contains seat assignments. */
export interface MoonConfiguration {
  presetId: string;
  name: string;
  roles: MoonRole[];
  victory: 'parity' | 'city' | 'edge';
  revealOnDeath: boolean;
  firstNightPeace: boolean;
  forcedHunter: boolean;
  doubleProtectionKills: boolean;
  allowWolfSelfAttack: boolean;
  allowWolfExplosion: boolean;
  sheriffAllowed: boolean;
}
export interface MoonPreset extends Omit<MoonConfiguration, 'presetId' | 'roles'> {
  id: string;
  /** null means the classic automatic 6–12 player composition. */
  count: number | null;
  roles: readonly MoonRole[];
  kind: 'classic' | 'custom' | 'variant';
}
type PresetOverrides = Partial<Omit<MoonPreset, 'id' | 'name' | 'count' | 'roles'>>;
function preset(id: string, name: string, roles: MoonRole[], overrides: PresetOverrides = {}): MoonPreset {
  return Object.freeze({ id, name, count: roles.length, roles: Object.freeze(roles), kind: 'custom', victory: 'city',
    revealOnDeath: false, firstNightPeace: false, forcedHunter: false, doubleProtectionKills: true,
    allowWolfSelfAttack: true, allowWolfExplosion: true, sheriffAllowed: true, ...overrides });
}

/** Variant labels describe this platform's rules; they do not claim an official edition. */
export const MOON_PRESETS: readonly MoonPreset[] = Object.freeze([
  Object.freeze({ id: 'classic', name: '經典自動配置', count: null, roles: Object.freeze([] as MoonRole[]), kind: 'classic',
    victory: 'parity', revealOnDeath: false, firstNightPeace: false, forcedHunter: false, doubleProtectionKills: false,
    allowWolfSelfAttack: false, allowWolfExplosion: false, sheriffAllowed: true } as MoonPreset),
  preset('six-open', '明牌局', ['wolf', 'wolf', 'seer', 'hunter', 'villager', 'villager'], { kind: 'variant', revealOnDeath: true }),
  preset('six-hidden', '暗牌局', ['wolf', 'wolf', 'seer', 'guard', 'villager', 'villager'], { kind: 'variant' }),
  preset('six-witch', '女巫局', ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager']),
  preset('six-simple', '簡易局', ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager'], { firstNightPeace: true }),
  preset('six-hunters', '獵殺潛狼', ['wolf', 'wolf', 'hunter', 'hunter', 'hunter', 'hunter'], { kind: 'variant', revealOnDeath: true, firstNightPeace: true, forcedHunter: true }),
  preset('six-idiot', '白癡局', ['wolf', 'wolf', 'seer', 'idiot', 'villager', 'villager']),
  preset('six-wolf-king', '狼王局', ['wolf', 'wolf-king', 'seer', 'witch', 'hunter', 'villager']),
  preset('six-ghost-rider', '惡靈騎士局', ['wolf', 'ghost-rider', 'seer', 'witch', 'hunter', 'villager'], { firstNightPeace: true }),
  preset('six-gods', '小諸神局', ['wolf-king', 'ghost-rider', 'seer', 'witch', 'hunter', 'idiot'], { revealOnDeath: true, firstNightPeace: true }),
  preset('seven-witch', '標準女巫局', ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager', 'villager']),
  preset('seven-guard', '守衛局', ['wolf', 'wolf', 'seer', 'guard', 'villager', 'villager', 'villager']),
  preset('seven-three-gods', '三神局', ['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager']),
  preset('seven-survivor', '生還者', ['wolf', 'white-wolf-king', 'seer', 'witch', 'hunter', 'guard', 'villager'], { kind: 'variant', victory: 'edge', sheriffAllowed: false }),
  preset('seven-idiot', '白癡局', ['wolf', 'wolf', 'seer', 'witch', 'idiot', 'villager', 'villager']),
  preset('seven-wolf-king', '狼王局', ['wolf', 'wolf-king', 'seer', 'witch', 'hunter', 'villager', 'villager']),
  preset('seven-ghost-rider', '惡靈騎士局', ['wolf', 'ghost-rider', 'seer', 'witch', 'hunter', 'guard', 'villager']),
  preset('seven-king-idiot', '狼王白癡局', ['wolf', 'wolf-king', 'seer', 'witch', 'idiot', 'villager', 'villager']),
  preset('seven-ghost-idiot', '惡靈白癡局', ['wolf', 'ghost-rider', 'seer', 'witch', 'hunter', 'idiot', 'villager']),
  preset('seven-gods', '七人小諸神', ['wolf-king', 'ghost-rider', 'seer', 'witch', 'hunter', 'guard', 'idiot'], { revealOnDeath: true }),
  preset('eight-ragnarok', '諸神黃昏', ['wolf-king', 'white-wolf-king', 'ghost-rider', 'seer', 'witch', 'hunter', 'guard', 'idiot'], { kind: 'variant', revealOnDeath: true, sheriffAllowed: false }),
]);

/** Public room settings are strict and never contain identities or deployment data. */
export function normalizeMoonOptions(input: unknown): MoonOptions {
  if (input === undefined) return { ...DEFAULT_MOON_OPTIONS };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('銀月列車設定格式不正確。');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !Object.hasOwn(DEFAULT_MOON_OPTIONS, key))) throw new Error('銀月列車設定含有不支援的選項。');
  const result = { ...DEFAULT_MOON_OPTIONS };
  if (data.presetId !== undefined) {
    if (typeof data.presetId !== 'string' || !MOON_PRESETS.some(p => p.id === data.presetId)) throw new Error('請選擇有效的銀月列車配置。');
    result.presetId = data.presetId;
  }
  if (data.doubleProtection !== undefined) {
    if (data.doubleProtection !== 'preset' && data.doubleProtection !== 'survive' && data.doubleProtection !== 'die') throw new Error('同守同救設定不正確。');
    result.doubleProtection = data.doubleProtection;
  }
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
    result[key] = normalizeMoonSeconds(key, data[key]);
  }
  return result;
}
export function validateMoonOptions(options: MoonOptions, count: number): string | undefined {
  if (!Number.isInteger(count) || count < 6 || count > 12) return '銀月列車需要 6～12 位玩家。';
  try {
    const normalized = normalizeMoonOptions(options);
    const selected = MOON_PRESETS.find(p => p.id === normalized.presetId)!;
    if (selected.count !== null && selected.count !== count) return `${selected.name}需要 ${selected.count} 位參與玩家，目前有 ${count} 位。`;
    if (normalized.sheriff && !selected.sheriffAllowed) return `${selected.name}固定不啟用警長。`;
    if (selected.victory === 'edge' && (!selected.roles.includes('villager') || !selected.roles.some(role => !isMoonWolf(role) && role !== 'villager'))) return '屠邊配置必須同時包含村民與神職。';
  } catch (error) { return (error as Error).message; }
  return undefined;
}
export function moonConfiguration(count: number, options: MoonOptions = DEFAULT_MOON_OPTIONS): MoonConfiguration {
  const normalized = normalizeMoonOptions(options);
  const error = validateMoonOptions(normalized, count);
  if (error) throw new Error(error);
  const selected = MOON_PRESETS.find(p => p.id === normalized.presetId)!;
  return { presetId: selected.id, name: selected.name, roles: selected.count === null ? classicDeck(count) : [...selected.roles],
    victory: selected.victory, revealOnDeath: selected.revealOnDeath, firstNightPeace: selected.firstNightPeace,
    forcedHunter: selected.forcedHunter, doubleProtectionKills: normalized.doubleProtection === 'preset' ? selected.doubleProtectionKills : normalized.doubleProtection === 'die',
    allowWolfSelfAttack: selected.allowWolfSelfAttack, allowWolfExplosion: selected.allowWolfExplosion, sheriffAllowed: selected.sheriffAllowed };
}
function classicDeck(count: number): MoonRole[] {
  const wolves = count === 12 ? 4 : count >= 9 ? 3 : 2;
  const roles: MoonRole[] = [...Array<MoonRole>(wolves).fill('wolf'), 'seer', 'witch'];
  if (count >= 7) roles.push('hunter');
  if (count === 8 || count >= 10) roles.push('guard');
  while (roles.length < count) roles.push('villager');
  return roles;
}
export function moonRoleDeck(count: number, options: MoonOptions = DEFAULT_MOON_OPTIONS): MoonRole[] {
  return moonConfiguration(count, options).roles;
}
export function moonCountsFromDeck(roles: readonly MoonRole[]): Record<MoonRole, number> {
  const counts = Object.fromEntries(Object.keys(MOON_ROLES).map(role => [role, 0])) as Record<MoonRole, number>;
  for (const role of roles) counts[role] += 1;
  return counts;
}
export function moonRoleCounts(count: number, options: MoonOptions = DEFAULT_MOON_OPTIONS): Record<MoonRole, number> {
  return moonCountsFromDeck(moonRoleDeck(count, options));
}

/** Stable role IDs; use the public starting composition, never living players. */
export function moonNightSteps(count: number, rulesVersion: 1 | 2 | 3, configuration?: MoonConfiguration): number[] {
  if (rulesVersion === 1) return [0, 1, 2, 3];
  const deck = rulesVersion === 3 && configuration ? configuration.roles : classicDeck(count);
  const counts = moonCountsFromDeck(deck);
  const roles: MoonRole[] = ['guard', 'wolf', 'seer', 'witch'];
  return roles.flatMap((role, step) => (role === 'wolf' ? deck.some(isMoonWolf) : counts[role] > 0) ? [step] : []);
}
