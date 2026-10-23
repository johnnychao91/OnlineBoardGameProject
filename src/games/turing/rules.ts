export interface TuringQuestion {
  id: string;
  category: string;
  prompt: string;
  low: string;
  high: string;
}
export interface TuringCustomQuestion { prompt: string; low: string; high: string }
export interface TuringOptions {
  deck: 'standard' | 'protocol' | 'mixed' | 'custom';
  customQuestions: TuringCustomQuestion[];
}

export const TURING_DECKS = {
  standard: '人性校準', protocol: '失控協定', mixed: '混合測試', custom: '自訂題庫',
} as const;
export const DEFAULT_TURING_OPTIONS: TuringOptions = { deck: 'standard', customQuestions: [] };
export const TURING_ROUNDS = 5;
export const TURING_ANSWER_MAX = 160;
export const TURING_CUSTOM_MAX = 50;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
const forbiddenControls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
function text(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string' || forbiddenControls.test(value)) throw new Error(`${label}格式不正確。`);
  const result = value.trim();
  if (result.length < min || result.length > max) throw new Error(`${label}需為 ${min}～${max} 字。`);
  return result;
}

/** Only public, bounded text is retained. Never silently truncate a question. */
export function normalizeTuringOptions(input: unknown): TuringOptions {
  if (input === undefined) return { deck: 'standard', customQuestions: [] };
  if (!record(input) || Object.keys(input).some(key => !['deck', 'customQuestions'].includes(key))) {
    throw new Error('圖靈測試設定格式不正確。');
  }
  const deck = input.deck === undefined ? 'standard' : input.deck;
  if (typeof deck !== 'string' || !Object.hasOwn(TURING_DECKS, deck)) throw new Error('題庫模式不正確。');
  const source = input.customQuestions === undefined ? [] : input.customQuestions;
  if (!Array.isArray(source) || source.length > TURING_CUSTOM_MAX) throw new Error('自訂題目最多 50 題，且必須為題目清單。');
  const prompts = new Set<string>();
  const customQuestions = source.map(item => {
    if (!record(item) || Object.keys(item).some(key => !['prompt', 'low', 'high'].includes(key))) {
      throw new Error('自訂題目只接受題幹與兩個量表端點。');
    }
    const prompt = text(item.prompt, 5, 200, '題幹');
    const low = text(item.low, 1, 50, '低端點');
    const high = text(item.high, 1, 50, '高端點');
    if (low.normalize('NFKC').toLowerCase() === high.normalize('NFKC').toLowerCase()) throw new Error('量表兩端必須不同。');
    const key = prompt.normalize('NFKC').toLowerCase();
    if (prompts.has(key)) throw new Error('自訂題目不能有重複題幹。');
    prompts.add(key);
    return { prompt, low, high };
  });
  return { deck: deck as TuringOptions['deck'], customQuestions };
}

export function validateTuringOptions(input: unknown, numPlayers?: number): string | undefined {
  if (numPlayers !== undefined && (!Number.isInteger(numPlayers) || numPlayers < 4 || numPlayers > 9)) {
    return '圖靈測試需要 4～9 位玩家。';
  }
  try {
    const options = normalizeTuringOptions(input);
    if (options.deck === 'custom' && options.customQuestions.length < TURING_ROUNDS) return '只使用自訂題庫時，至少需要 5 題不同的題目。';
  } catch (error) { return (error as Error).message; }
  return undefined;
}

export function normalizeTuringAnswer(value: unknown): string | undefined {
  try { return text(value, 1, TURING_ANSWER_MAX, '回答'); } catch { return undefined; }
}
