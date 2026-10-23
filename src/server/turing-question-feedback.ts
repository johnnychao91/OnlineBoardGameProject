import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TuringQuestion } from '../games/turing/rules';
import { atomicReplace } from './atomic-file';
import { hashToken } from './security';

export type QuestionVote = 'up' | 'down';
export interface QuestionFeedback {
  up: number;
  down: number;
  vote: QuestionVote | null;
  scope: 'builtin' | 'match' | 'test';
}
interface FeedbackContext {
  roomId: string;
  matchID: string;
  playerID: string;
  testRoom: boolean;
  question: TuringQuestion;
}
interface FeedbackRecord {
  version: 1;
  scope: QuestionFeedback['scope'];
  question: TuringQuestion;
  votes: Record<string, QuestionVote>;
}

/** Canonical snapshot identity is independent of property order and future deck edits. */
export const questionSnapshot = (question: TuringQuestion) => JSON.stringify([
  question.id, question.category, question.prompt, question.low, question.high,
]);

/** Private feedback is separate from gameplay, replay frames and win statistics. */
export class TuringQuestionFeedbackStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private dataDir: string) {}

  async feedback(context: FeedbackContext, vote?: QuestionVote | null): Promise<QuestionFeedback> {
    const { roomId, matchID, playerID, testRoom, question } = context;
    const scope: QuestionFeedback['scope'] = testRoom ? 'test' : /^(?:standard|protocol)-\d{4}$/.test(question.id) ? 'builtin' : 'match';
    const snapshot = questionSnapshot(question);
    const key = hashToken(JSON.stringify([scope, scope === 'builtin' ? '' : [roomId, matchID], snapshot]));
    const voter = hashToken(JSON.stringify([roomId, matchID, playerID, snapshot]));
    // Different room queues can reach the same built-in question concurrently.
    // Serialize the entire read/modify/replace transaction by snapshot identity.
    const job = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const directory = join(this.dataDir, 'question-feedback');
      const file = join(directory, `${key}.json`);
      let record: FeedbackRecord = { version: 1, scope, question: { ...question }, votes: {} };
      try {
        record = JSON.parse(await readFile(file, 'utf8'));
        if (record.version !== 1 || record.scope !== scope || questionSnapshot(record.question) !== snapshot
          || !record.votes || typeof record.votes !== 'object' || Array.isArray(record.votes)
          || Object.entries(record.votes).some(([id, value]) => !/^[a-f0-9]{64}$/.test(id) || !['up', 'down'].includes(value))) {
          throw new Error('題目評分資料格式錯誤');
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (vote !== undefined && (record.votes[voter] ?? null) !== vote) {
        const votes = { ...record.votes };
        if (vote === null) delete votes[voter]; else votes[voter] = vote;
        record = { ...record, votes };
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
        await atomicReplace(`${file}.tmp`, file);
      }
      const votes = Object.values(record.votes);
      return { scope, up: votes.filter(value => value === 'up').length,
        down: votes.filter(value => value === 'down').length, vote: record.votes[voter] ?? null };
    });
    this.queues.set(key, job);
    try { return await job; }
    finally { if (this.queues.get(key) === job) this.queues.delete(key); }
  }
}
