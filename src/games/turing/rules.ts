export interface TuringQuestion {
  id: string;
  category: string;
  prompt: string;
  low: string;
  high: string;
}
export interface TuringCustomQuestion { prompt: string; low: string; high: string }
export type TuringApproval = 'host' | 'all' | 'any';
export interface TuringOptions {
  deck: 'standard' | 'protocol' | 'mixed' | 'custom';
  customQuestions: TuringCustomQuestion[];
  /** Optional only for saved games created before voice play was introduced. */
  mode?: 'standard' | 'endless';
  lives?: number;
  /** Absent in older saved games, which retain unanimous participant approval. */
  redrawApproval?: TuringApproval;
  orderApproval?: TuringApproval;
  nextApproval?: TuringApproval;
}

export const TURING_APPROVAL_KEYS = ['redrawApproval', 'orderApproval', 'nextApproval'] as const;
export type TuringPolicies = Pick<TuringOptions, typeof TURING_APPROVAL_KEYS[number]>;
export function normalizeTuringPolicies(input: unknown): TuringPolicies {
  if (!record(input) || !Object.keys(input).length || Object.keys(input).some(key => !TURING_APPROVAL_KEYS.includes(key as typeof TURING_APPROVAL_KEYS[number]))) throw new Error('同意方式設定格式不正確。');
  for (const value of Object.values(input)) if (value !== 'host' && value !== 'all' && value !== 'any') throw new Error('同意方式不正確。');
  return { ...input } as TuringPolicies;
}

export const TURING_DECKS = {
  standard: '人性校準', protocol: '失控協定', mixed: '混合測試', custom: '自訂題庫',
} as const;
export const DEFAULT_TURING_OPTIONS: TuringOptions = { deck: 'standard', customQuestions: [], mode: 'standard', lives: 5,
  redrawApproval: 'all', orderApproval: 'all', nextApproval: 'all' };
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
  if (input === undefined) return { ...DEFAULT_TURING_OPTIONS, customQuestions: [] };
  if (!record(input) || Object.keys(input).some(key => !['deck', 'customQuestions', 'mode', 'lives', ...TURING_APPROVAL_KEYS].includes(key))) {
    throw new Error('圖靈測試設定格式不正確。');
  }
  const deck = input.deck === undefined ? 'standard' : input.deck;
  if (typeof deck !== 'string' || !Object.hasOwn(TURING_DECKS, deck)) throw new Error('題庫模式不正確。');
  const mode = input.mode === undefined ? 'standard' : input.mode;
  if (mode !== 'standard' && mode !== 'endless') throw new Error('挑戰模式不正確。');
  const redrawApproval = input.redrawApproval === undefined ? 'all' : input.redrawApproval;
  const orderApproval = input.orderApproval === undefined ? 'all' : input.orderApproval;
  const nextApproval = input.nextApproval === undefined ? 'all' : input.nextApproval;
  for (const policy of [redrawApproval, orderApproval, nextApproval]) {
    if (policy !== 'host' && policy !== 'all' && policy !== 'any') throw new Error('同意方式不正確。');
  }
  const requestedLives = input.lives === undefined ? 5 : input.lives;
  if (typeof requestedLives !== 'number' || !Number.isSafeInteger(requestedLives)) throw new Error('起始生命需為整數。');
  const lives = Math.max(1, Math.min(20, requestedLives));
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
  return { deck: deck as TuringOptions['deck'], customQuestions, mode, lives,
    redrawApproval: redrawApproval as TuringApproval, orderApproval: orderApproval as TuringApproval, nextApproval: nextApproval as TuringApproval };
}

export function validateTuringOptions(input: unknown, numPlayers?: number): string | undefined {
  if (numPlayers !== undefined && (!Number.isInteger(numPlayers) || numPlayers < 2 || numPlayers > 9)) {
    return '圖靈測試需要 2～9 位玩家。';
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
