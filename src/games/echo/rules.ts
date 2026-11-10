export interface EchoOptions { roundLimit: 5 | 8 | 12; seconds: 0 | 12 | 30 | 60; allowChanges: boolean }

export function normalizeEchoOptions(input: unknown = {}): EchoOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => key !== 'roundLimit' && key !== 'seconds' && key !== 'allowChanges')) throw new Error('杯中回聲設定不正確。');
  const { roundLimit = 8, seconds = 60, allowChanges = true } = input as Partial<EchoOptions>;
  if (roundLimit !== 5 && roundLimit !== 8 && roundLimit !== 12) throw new Error('請選擇 5、8 或 12 輪。');
  if (seconds !== 0 && seconds !== 12 && seconds !== 30 && seconds !== 60) throw new Error('請選擇 12 秒、30 秒、60 秒或不限時。');
  if (typeof allowChanges !== 'boolean') throw new Error('請選擇提交後能否更改。');
  return { roundLimit, seconds, allowChanges };
}

export function validateEchoOptions(options: unknown, count?: number): string | undefined {
  try { normalizeEchoOptions(options); } catch (error) { return (error as Error).message; }
  if (count !== undefined && (!Number.isInteger(count) || count < 2 || count > 4)) return '杯中回聲需要 2～4 位玩家。';
  return undefined;
}

export const ECHO_WORD_LIMIT = 32;
export const ECHO_REVIEW_SECONDS = 30;

export function echoWord(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > ECHO_WORD_LIMIT * 2
    || /[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u.test(value)) return undefined;
  const word = value.trim();
  return word && [...word].length <= ECHO_WORD_LIMIT ? word : undefined;
}

export const echoWordKey = (word: string) => word.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
