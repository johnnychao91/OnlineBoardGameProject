import { isPlayerSeatID } from '../catalog';
import { BAKER_ERAS, type BakerEra } from './content';

export type { BakerEra } from './content';
export { BAKER_ERAS } from './content';
export type BakerRole = 'holmes' | 'watson' | 'investigator' | 'murderer' | 'accomplice';
export type BakerFaction = 'police' | 'criminals';
export interface BakerOptions {
  era: BakerEra; year: number; cardsPerType: 3 | 4 | 5;
  roleSet: 'auto' | 'basic' | 'accomplice' | 'all'; specialScenes: boolean; holmesID: string;
}
export const BAKER_ROLES: Record<BakerRole, { name: string; faction: BakerFaction; description: string }> = {
  holmes: { name: '福爾摩斯', faction: 'police', description: '公開身分並掌握案情；只透過圖板上的西洋棋標記提供線索，不用語音、文字或暗號解釋。' },
  watson: { name: '華生醫生', faction: 'police', description: '知道離開現場的兩位涉案者，但不知道誰是執行者、誰是內應，也不知道作案手段與關鍵物證。' },
  investigator: { name: '倫敦警察', faction: 'police', description: '結合圖板提示與公開證物，提交正確的作案手段及關鍵物證。' },
  murderer: { name: '莫里亞蒂的執行者', faction: 'criminals', description: '秘密選擇自己面前的一張手法與一張線索，混入調查並使犯罪真相無法成立。' },
  accomplice: { name: '莫里亞蒂的內應', faction: 'criminals', description: '知道執行者與完整案情，協助誤導調查；有華生時也可討論最後的指認。' },
};
export const DEFAULT_BAKER_OPTIONS: BakerOptions = { era: 'victorian', year: 1890, cardsPerType: 4, roleSet: 'auto', specialScenes: false, holmesID: 'random' };

export function normalizeBakerOptions(input: unknown): BakerOptions {
  if (input === undefined) return { ...DEFAULT_BAKER_OPTIONS };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('貝克街案件設定格式不正確。');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !Object.hasOwn(DEFAULT_BAKER_OPTIONS, key))) throw new Error('案件設定含有不支援的選項。');
  const era = data.era === undefined ? DEFAULT_BAKER_OPTIONS.era : data.era;
  if (typeof era !== 'string' || !Object.hasOwn(BAKER_ERAS, era)) throw new Error('請選擇有效的案件年代。');
  const definition = BAKER_ERAS[era as BakerEra];
  const year = data.year === undefined ? definition.defaultYear : data.year;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < definition.minYear || year > definition.maxYear) throw new Error(`此年代的案發年份須介於 ${definition.minYear}～${definition.maxYear} 年。`);
  const cardsPerType = data.cardsPerType === undefined ? 4 : data.cardsPerType;
  if (cardsPerType !== 3 && cardsPerType !== 4 && cardsPerType !== 5) throw new Error('每人每類牌數須為 3、4 或 5 張。');
  const roleSet = data.roleSet === undefined ? 'auto' : data.roleSet;
  if (roleSet !== 'auto' && roleSet !== 'basic' && roleSet !== 'accomplice' && roleSet !== 'all') throw new Error('身分配置不正確。');
  const specialScenes = data.specialScenes === undefined ? false : data.specialScenes;
  if (typeof specialScenes !== 'boolean') throw new Error('特別圖板設定不正確。');
  const holmesID = data.holmesID === undefined ? 'random' : data.holmesID;
  if (holmesID !== 'random' && !isPlayerSeatID(holmesID)) throw new Error('請選擇有效的福爾摩斯席位。');
  return { era: era as BakerEra, year, cardsPerType, roleSet, specialScenes, holmesID: holmesID as string };
}
export function resolveBakerRoleSet(options: BakerOptions, count: number): Exclude<BakerOptions['roleSet'], 'auto'> {
  return options.roleSet === 'auto' ? count >= 6 ? 'all' : 'basic' : options.roleSet;
}
export function validateBakerOptions(input: unknown, count?: number, participants?: string[]): string | undefined {
  let options: BakerOptions;
  try { options = normalizeBakerOptions(input); } catch (error) { return (error as Error).message; }
  if (count === undefined) return undefined;
  if (!Number.isInteger(count) || count < 4 || count > 12) return '貝克街迷霧需要 4～12 位玩家。';
  if (resolveBakerRoleSet(options, count) !== 'basic' && count < 6) return '內應與華生配置需要至少 6 位玩家。';
  if (participants && options.holmesID !== 'random' && !participants.includes(options.holmesID)) return '福爾摩斯必須在本局參與名單中。';
  return undefined;
}
