export type FogFaction = 'knights' | 'apostles';
export type FogRole = 'merlin' | 'percival' | 'loyal-servant' | 'assassin' | 'morgana'
  | 'mordred' | 'oberon' | 'minion' | 'good-lancelot' | 'evil-lancelot';
export type FogLancelotMode = 'off' | 'random' | 'forecast';

export interface FogOptions {
  lancelotMode: FogLancelotMode;
  percival: boolean;
  morgana: boolean;
  mordred: boolean;
  oberon: boolean;
}

export const DEFAULT_FOG_OPTIONS: FogOptions = {
  lancelotMode: 'random', percival: false, morgana: false, mordred: false, oberon: false,
};
export const FOG_FACTIONS: Record<FogFaction, string> = { knights: '守夜騎士', apostles: '黑霧使徒' };
export const FOG_ROLES: Record<FogRole, { name: string; description: string; faction: FogFaction }> = {
  merlin: { name: '梅林', faction: 'knights', description: '你能辨認最初潛伏的黑霧使徒，唯獨看不穿莫德雷德。引導隊伍守住城郊燈塔，也要藏好自己的身分：三座燈塔點亮後，刺客仍能逆轉戰局。' },
  percival: { name: '派西維爾', faction: 'knights', description: '你能看見梅林與莫甘娜的身影，卻無法區分誰是真正的引路人。若沒有莫甘娜，你便能直接辨認梅林。' },
  'loyal-servant': { name: '忠臣', faction: 'knights', description: '你沒有額外的夜間情報。觀察提名與表決，與守夜騎士一同點亮城郊燈塔。' },
  assassin: { name: '刺客', faction: 'apostles', description: '你認得其他可見的黑霧使徒。若守夜騎士點亮三座燈塔，你有最後一次機會指認梅林；命中便由黑霧使徒獲勝。' },
  morgana: { name: '莫甘娜', faction: 'apostles', description: '你在派西維爾的眼中與梅林呈現相同的輪廓，能利用這份混淆誤導守夜騎士。你仍會被梅林與其他可見使徒辨認。' },
  mordred: { name: '莫德雷德', faction: 'apostles', description: '你隱藏在最濃的黑霧中，梅林的夜間情報無法看見你；其他可見的黑霧使徒仍認得你。' },
  oberon: { name: '奧伯倫', faction: 'apostles', description: '你獨自行動，不知道其他使徒是誰，他們也看不見你。梅林仍能在夜間辨認你的黑霧陣營。' },
  minion: { name: '爪牙', faction: 'apostles', description: '你與其他可見的黑霧使徒共享夜間情報，可在燈塔任務中選擇暗中破壞或暫時協助。' },
  'good-lancelot': { name: '正義蘭斯洛特', faction: 'knights', description: '你最初效忠守夜騎士。詛咒之鐘可能改變你的陣營；角色名稱保留，任務限制與最終勝敗則依目前陣營判定。你不知道另一位蘭斯洛特是誰。' },
  'evil-lancelot': { name: '邪惡蘭斯洛特', faction: 'apostles', description: '你最初效忠黑霧使徒，但不知道其他使徒與另一位蘭斯洛特是誰；可見使徒認得最初的你。詛咒之鐘可能改變你的陣營與任務限制。' },
};

/** Strict shape checking keeps malformed lobby options out of saved matches. */
export function normalizeFogOptions(input: unknown): FogOptions {
  if (input === undefined) return { ...DEFAULT_FOG_OPTIONS };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('黑霧襲城設定格式不正確。');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some((key) => !Object.hasOwn(DEFAULT_FOG_OPTIONS, key))) throw new Error('黑霧襲城設定含有不支援的選項。');
  const result = { ...DEFAULT_FOG_OPTIONS };
  if (data.lancelotMode !== undefined) {
    if (!['off', 'random', 'forecast'].includes(data.lancelotMode as string)) throw new Error('詛咒之鐘模式不正確。');
    result.lancelotMode = data.lancelotMode as FogLancelotMode;
  }
  for (const key of ['percival', 'morgana', 'mordred', 'oberon'] as const) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== 'boolean') throw new Error('角色選項必須為開啟或關閉。');
      result[key] = data[key];
    }
  }
  return result;
}

export function fogFactionCounts(numPlayers: number): Record<FogFaction, number> {
  const counts: Record<number, [number, number]> = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
  const pair = counts[numPlayers];
  if (!pair) throw new RangeError('黑霧襲城需要 5～10 位玩家。');
  return { knights: pair[0], apostles: pair[1] };
}

export function fogTeamSizes(numPlayers: number): number[] {
  const sizes: Record<number, number[]> = {
    5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5],
  };
  if (!sizes[numPlayers]) throw new RangeError('黑霧襲城需要 5～10 位玩家。');
  return [...sizes[numPlayers]];
}

export function validateFogOptions(options: FogOptions, numPlayers: number): string | undefined {
  if (!Number.isInteger(numPlayers) || numPlayers < 5 || numPlayers > 10) return '黑霧襲城需要 5～10 位玩家。';
  try { normalizeFogOptions(options); } catch (error) { return (error as Error).message; }
  if (options.morgana && !options.percival) return '啟用莫甘娜時也需要派西維爾。';
  const counts = fogFactionCounts(numPlayers);
  const lancelots = options.lancelotMode === 'off' ? 0 : 1;
  if (1 + Number(options.percival) + lancelots > counts.knights) return '選擇的守夜騎士角色超過目前玩家人數可容納的席位。';
  if (1 + Number(options.morgana) + Number(options.mordred) + Number(options.oberon) + lancelots > counts.apostles) {
    return '選擇的黑霧使徒角色超過目前玩家人數可容納的席位，請關閉部分角色或增加玩家。';
  }
  return undefined;
}

export function fogRoleDeck(numPlayers: number, options: FogOptions): FogRole[] {
  const error = validateFogOptions(options, numPlayers);
  if (error) throw new Error(error);
  const counts = fogFactionCounts(numPlayers);
  const knights: FogRole[] = ['merlin'];
  const apostles: FogRole[] = ['assassin'];
  if (options.percival) knights.push('percival');
  for (const role of ['morgana', 'mordred', 'oberon'] as const) if (options[role]) apostles.push(role);
  if (options.lancelotMode !== 'off') { knights.push('good-lancelot'); apostles.push('evil-lancelot'); }
  while (knights.length < counts.knights) knights.push('loyal-servant');
  while (apostles.length < counts.apostles) apostles.push('minion');
  return [...knights, ...apostles];
}
