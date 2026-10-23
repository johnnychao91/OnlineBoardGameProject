/** Feedback concerns wording, independently of the game's 1–10 strength cards. */
export const QUESTION_ASPECTS = ['topic', 'low', 'high'] as const;
export type QuestionAspect = typeof QUESTION_ASPECTS[number];
export type QuestionVote = 'up' | 'down';
export interface QuestionRating { up: number; down: number; vote: QuestionVote | null; }
export interface QuestionRatings {
  scope: 'builtin' | 'match' | 'test';
  ratings: Record<QuestionAspect, QuestionRating>;
}
