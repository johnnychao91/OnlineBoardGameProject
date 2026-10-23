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
export const FOG_TWIN_KNIGHTS_LORE = '晨鐘騎士與沉鐘騎士曾在同一座燈塔立誓。晨鐘騎士追隨破曉的鐘鳴，守護通往城門的燈火；沉鐘騎士回應海底的鐘聲，迎接黑霧中的低語。如今黑霧遮去了彼此的面容，兩人卻仍共繫於詛咒之鐘：每當鐘聲喚起詛咒，守燈與迎霧的誓約便可能交換。名字依舊，效忠卻未必如初。';
export const FOG_ROLES: Record<FogRole, { name: string; description: string; faction: FogFaction }> = {
  merlin: { name: '逐星神諭者', faction: 'knights', description: '你循城堡上方的星跡辨認開局的黑霧使徒，唯獨看不穿黑潮隱主。引導隊伍守住城郊燈塔，也要藏好自己的身分：三座燈塔點亮後，深海之刃仍能藉最後指認逆轉戰局。' },
  percival: { name: '聆諭騎士', faction: 'knights', description: '你聽見逐星神諭者的指引，卻也聽見幻淵祭司模仿的神諭。開局能看見這兩位候選，無法辨明誰是誰；若未加入幻淵祭司，便能直接辨認逐星神諭者。' },
  'loyal-servant': { name: '城郊守衛', faction: 'knights', description: '你巡守城門與燈塔之間的小徑，沒有額外的開局情報。觀察提名、發言與表決，找出同伴，一同守住城外的燈火。' },
  assassin: { name: '深海之刃', faction: 'apostles', description: '你帶著深海的殺意潛入巡夜隊，認得其他可互認的黑霧使徒。三座燈塔點亮後，你能進行最後指認，指定一位其他玩家；若命中逐星神諭者，黑霧使徒便逆轉獲勝。' },
  morgana: { name: '幻淵祭司', faction: 'apostles', description: '你將深淵低語編成神諭，在聆諭騎士的情報中偽裝成逐星神諭者。真正的逐星神諭者與其他可互認使徒仍能辨認你的初始陣營。' },
  mordred: { name: '黑潮隱主', faction: 'apostles', description: '你潛藏在星光照不到的黑潮之下，逐星神諭者的開局情報看不見你。其他可互認的黑霧使徒仍認得你的初始陣營。' },
  oberon: { name: '離群信徒', faction: 'apostles', description: '你獨自回應霧海的召喚，不知道其他使徒是誰，他們也看不見你。逐星神諭者仍能辨認你在開局時的黑霧陣營。' },
  minion: { name: '迷霧信徒', faction: 'apostles', description: '你混在巡夜隊中，與其他可互認使徒共享開局情報。出征時可秘密侵蝕燈塔，也可暫時守護燈火來掩飾身分。' },
  'good-lancelot': { name: '晨鐘騎士', faction: 'knights', description: '你循破曉鐘聲守燈，最初效忠守夜騎士，卻不知道沉鐘騎士是誰。詛咒之鐘可能交換兩人的效忠；名字仍是晨鐘騎士，任務限制與最終勝敗依目前效忠判定。' },
  'evil-lancelot': { name: '沉鐘騎士', faction: 'apostles', description: '你回應海底鐘聲，最初效忠黑霧使徒，卻不認識同伴與晨鐘騎士；可互認使徒認得最初的你。詛咒之鐘可能交換兩人的效忠；名字仍是沉鐘騎士，任務限制與最終勝敗依目前效忠判定。' },
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
  if (options.morgana && !options.percival) return '啟用幻淵祭司時也需要聆諭騎士。';
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
