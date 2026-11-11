export const ECHO_TIMES = [15, 30, 60, 120, 0] as const;
export const ECHO_ROUND_LIMIT = 1000;
export const ECHO_ROUND_OPTIONS = [5, 10, 15, 30, ECHO_ROUND_LIMIT] as const;
export interface EchoOptions {
  roundLimit: typeof ECHO_ROUND_OPTIONS[number] | 8 | 12;
  seconds: typeof ECHO_TIMES[number];
  allowChanges: boolean;
  allowRepeats?: boolean;
}

export function normalizeEchoOptions(input: unknown = {}): EchoOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['roundLimit', 'seconds', 'allowChanges', 'allowRepeats'].includes(key))) throw new Error('杯中回聲設定不正確。');
  const { roundLimit = ECHO_ROUND_LIMIT, seconds: storedSeconds = 60, allowChanges = true, allowRepeats = true } = input as Partial<Omit<EchoOptions, 'seconds'> & { seconds: EchoOptions['seconds'] | 12 }>;
  const seconds = storedSeconds === 12 ? 15 : storedSeconds;
  if (roundLimit !== 8 && roundLimit !== 12 && !ECHO_ROUND_OPTIONS.includes(roundLimit)) throw new Error('杯中回聲輪數上限不正確。');
  if (!ECHO_TIMES.includes(seconds)) throw new Error('請選擇 15、30、60、120 秒或不限時。');
  if (typeof allowChanges !== 'boolean') throw new Error('請選擇提交後能否更改。');
  if (typeof allowRepeats !== 'boolean') throw new Error('請選擇能否重複詞語。');
  return { roundLimit, seconds, allowChanges, allowRepeats };
}

export function normalizeNewEchoOptions(input?: unknown): EchoOptions {
  const options = normalizeEchoOptions(input);
  return options.roundLimit === 8 || options.roundLimit === 12 ? { ...options, roundLimit: ECHO_ROUND_LIMIT } : options;
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

export function echoUsedWordKeys(history: readonly { words: Record<string, string> }[]) {
  return new Set(history.flatMap(round => Object.values(round.words).map(echoWordKey)));
}
