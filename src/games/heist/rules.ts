export * from './content';
export type HeistOptions = { hazardLimit: 2 | 3 };
export const DEFAULT_HEIST_OPTIONS: HeistOptions = { hazardLimit: 2 };
/** Old saved games have an empty options object and retain the original second-card rule. */
export const heistHazardLimit = (options?: Partial<HeistOptions>): 2 | 3 => options?.hazardLimit === 3 ? 3 : 2;
export function normalizeHeistOptions(input: unknown): HeistOptions {
  if (input === undefined) return { ...DEFAULT_HEIST_OPTIONS };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => key !== 'hazardLimit')) throw new Error('謝幕劫案設定格式不正確。');
  const value = (input as Record<string, unknown>).hazardLimit;
  if (value !== undefined && value !== 2 && value !== 3) throw new Error('請選擇同類第 2 張或第 3 張危機卡結束本幕。');
  return { hazardLimit: value === 3 ? 3 : 2 };
}
export function validateHeistOptions(input: unknown, numPlayers?: number): string | undefined {
  try { normalizeHeistOptions(input); } catch (error) { return (error as Error).message; }
  if (numPlayers !== undefined && (!Number.isInteger(numPlayers) || numPlayers < 3 || numPlayers > 8)) return '謝幕劫案需要 3～8 位玩家。';
  return undefined;
}
export const HEIST_ONLINE_RULINGS = [
  '每幕先翻開第一張牌，再由仍在場的玩家密封深入或撤退的選擇。沒有倒數，全部選擇到齊才一起揭露。送出後不能改選。',
  '同波選擇使用同一個階段代號，其他人的提交不會使你的正常選擇作廢。每幕結果由全員確認後才進入下一幕；第五幕確認後公布總分。',
  '保險箱內的一般贓物只讓本人查看，直到終局才公開成績。上帝觀戰可看各人的保險箱，但也看不到未揭露的決策或未來牌序。',
] as const;
