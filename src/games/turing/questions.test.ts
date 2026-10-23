import { describe, expect, it } from 'vitest';
import { PROTOCOL_QUESTIONS, STANDARD_QUESTIONS, turingQuestionPool } from './questions';
import { normalizeTuringOptions } from './rules';

describe('圖靈測試原創題庫', () => {
  it.each([
    ['standard', STANDARD_QUESTIONS], ['protocol', PROTOCOL_QUESTIONS],
  ] as const)('%s has exactly 1,000 complete, individually addressable questions', (prefix, questions) => {
    expect(questions).toHaveLength(1000);
    expect(questions.map(question => question.id).sort()).toEqual(Array.from({ length: 1000 }, (_, index) => `${prefix}-${String(index + 1).padStart(4, '0')}`));
    for (const question of questions) {
      expect(Object.keys(question).sort(), question.id).toEqual(['category', 'high', 'id', 'low', 'prompt']);
      expect(question.category.trim().length, question.id).toBeGreaterThan(0);
      expect(() => normalizeTuringOptions({ customQuestions: [{ prompt: question.prompt, low: question.low, high: question.high }] }), question.id).not.toThrow();
    }
  });
  it('contains no repeated prompt or copied full card across either collection', () => {
    const questions = [...STANDARD_QUESTIONS, ...PROTOCOL_QUESTIONS];
    const prompts = questions.map(question => question.prompt.trim().normalize('NFKC').toLowerCase());
    const duplicates = prompts.filter((prompt, index) => prompts.indexOf(prompt) !== index);
    expect(duplicates).toEqual([]);
    expect(new Set(questions.map(question => question.id)).size).toBe(2000);
  });
  it('selects the requested collection and appends independent custom question snapshots', () => {
    const customQuestions = [{ prompt: '寫一句向迷路機器人提供的建議。', low: '完全沒幫助', high: '立刻找到方向' }];
    expect(turingQuestionPool(normalizeTuringOptions({ deck: 'standard' }))).toHaveLength(1000);
    expect(turingQuestionPool(normalizeTuringOptions({ deck: 'protocol' }))).toHaveLength(1000);
    expect(turingQuestionPool(normalizeTuringOptions({ deck: 'mixed' }))).toHaveLength(2000);
    const options = normalizeTuringOptions({ deck: 'custom', customQuestions });
    const pool = turingQuestionPool(options);
    expect(pool).toEqual([{ ...customQuestions[0], id: 'custom-0001', category: '自訂' }]);
    pool[0].prompt = '此變更只在這份題目快照';
    expect(options.customQuestions[0].prompt).toBe(customQuestions[0].prompt);
    expect(turingQuestionPool(normalizeTuringOptions({ customQuestions }))).toHaveLength(1001);
    const standard = turingQuestionPool(normalizeTuringOptions(undefined));
    standard[0].prompt = '只修改拷貝';
    expect(STANDARD_QUESTIONS[0].prompt).not.toBe('只修改拷貝');
  });
  it('prioritizes a custom card over the same normalized built-in prompt without duplicate draw slots', () => {
    const original = { ...STANDARD_QUESTIONS[0] };
    const customized = { prompt: `  ${original.prompt}  `, low: '自訂的低端點', high: '自訂的高端點' };
    const pool = turingQuestionPool(normalizeTuringOptions({ customQuestions: [customized] }));
    expect(pool).toHaveLength(STANDARD_QUESTIONS.length);
    const samePrompt = pool.filter(question => question.prompt === original.prompt);
    expect(samePrompt).toEqual([{ id: 'custom-0001', category: '自訂', prompt: original.prompt, low: customized.low, high: customized.high }]);
    expect(STANDARD_QUESTIONS[0]).toEqual(original);
  });
});
