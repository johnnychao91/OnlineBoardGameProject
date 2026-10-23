import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TuringQuestion } from '../games/turing/rules';
import { QUESTION_ASPECTS, type QuestionAspect, type QuestionRating, type QuestionRatings, type QuestionVote } from '../games/turing/feedback';
import { atomicReplace } from './atomic-file';
import { hashToken } from './security';

export type { QuestionVote } from '../games/turing/feedback';
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
  version: 1 | 2;
  scope: QuestionFeedback['scope'];
  question: TuringQuestion;
  votes: Record<string, QuestionVote>;
  /** Original overall votes are never reclassified as topic votes. */
  ratings?: Record<QuestionAspect, Record<string, QuestionVote>>;
}

const validVotes = (votes: unknown): votes is Record<string, QuestionVote> => !!votes && typeof votes === 'object'
  && !Array.isArray(votes) && Object.entries(votes).every(([id, value]) => /^[a-f0-9]{64}$/.test(id) && ['up', 'down'].includes(value));
const summarize = (votes: Record<string, QuestionVote>, voter: string): QuestionRating => ({
  up: Object.values(votes).filter(value => value === 'up').length,
  down: Object.values(votes).filter(value => value === 'down').length, vote: votes[voter] ?? null,
});

/** Canonical snapshot identity is independent of property order and future deck edits. */
export const questionSnapshot = (question: TuringQuestion) => JSON.stringify([
  question.id, question.category, question.prompt, question.low, question.high,
]);

/** Private feedback is separate from gameplay, replay frames and win statistics. */
export class TuringQuestionFeedbackStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private dataDir: string) {}

  async feedback(context: FeedbackContext, vote?: QuestionVote | null): Promise<QuestionFeedback> {
    return (await this.transaction(context, vote)).legacy;
  }

  async ratings(context: FeedbackContext, aspect?: QuestionAspect, vote?: QuestionVote | null): Promise<QuestionRatings> {
    const result = await this.transaction(context, vote, aspect);
    return { scope: result.legacy.scope, ratings: result.ratings };
  }

  private async transaction(context: FeedbackContext, vote?: QuestionVote | null, aspect?: QuestionAspect) {
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
        if (![1, 2].includes(record.version) || record.scope !== scope || questionSnapshot(record.question) !== snapshot
          || !validVotes(record.votes)
          || (record.version === 2 && (!record.ratings || Object.keys(record.ratings).length !== QUESTION_ASPECTS.length
            || QUESTION_ASPECTS.some(key => !validVotes(record.ratings?.[key]))))) {
          throw new Error('題目評分資料格式錯誤');
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const dimensions = record.version === 2 ? record.ratings! : { topic: {}, low: {}, high: {} };
      const selectedVotes = aspect ? dimensions[aspect] : record.votes;
      if (vote !== undefined && (selectedVotes[voter] ?? null) !== vote) {
        const votes = { ...selectedVotes };
        if (vote === null) delete votes[voter]; else votes[voter] = vote;
        record = { ...record, version: 2, votes: aspect ? record.votes : votes,
          ratings: aspect ? { ...dimensions, [aspect]: votes } : dimensions };
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
        await atomicReplace(`${file}.tmp`, file);
      }
      const ratings = record.version === 2 ? record.ratings! : dimensions;
      return { legacy: { scope, ...summarize(record.votes, voter) }, ratings: {
        topic: summarize(ratings.topic, voter), low: summarize(ratings.low, voter), high: summarize(ratings.high, voter),
      } };
    });
    this.queues.set(key, job);
    try { return await job; }
    finally { if (this.queues.get(key) === job) this.queues.delete(key); }
  }
}
