import standardA from './questions/standard-a.json';
import standardB from './questions/standard-b.json';
import protocolA from './questions/protocol-a.json';
import protocolB from './questions/protocol-b.json';
import type { TuringOptions, TuringQuestion } from './rules';

export const STANDARD_QUESTIONS: readonly TuringQuestion[] = [...standardA, ...standardB];
export const PROTOCOL_QUESTIONS: readonly TuringQuestion[] = [...protocolA, ...protocolB];

/** A fresh array per match; the engine snapshots the chosen question text. */
export function turingQuestionPool(options: TuringOptions): TuringQuestion[] {
  const builtIn = options.deck === 'standard' ? STANDARD_QUESTIONS : options.deck === 'protocol' ? PROTOCOL_QUESTIONS
    : options.deck === 'mixed' ? [...STANDARD_QUESTIONS, ...PROTOCOL_QUESTIONS] : [];
  const questions = [
    ...builtIn.map(question => ({ ...question })),
    ...options.customQuestions.map((question, index) => ({
      id: `custom-${String(index + 1).padStart(4, '0')}`, category: '自訂', ...question,
    })),
  ];
  // One semantic prompt gets one draw slot. A host's replacement deliberately
  // wins over an identically worded built-in card, including its new endpoints.
  return [...new Map(questions.map(question => [question.prompt.trim().normalize('NFKC').toLowerCase(), question])).values()];
}
