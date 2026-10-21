import { describe, expect, it } from 'vitest';
import { moonTimeFromDraft } from './MoonOptions';
import { MOON_TIME_LIMITS, type MoonTimeOption } from '../games/moon/rules';

describe('Moon room time drafts', () => {
  it('clamps each field only when committing the draft', () => {
    for (const key of Object.keys(MOON_TIME_LIMITS) as MoonTimeOption[]) {
      expect(moonTimeFromDraft(key, '1', 30)).toBe(5);
      expect(moonTimeFromDraft(key, '500', 30)).toBe(MOON_TIME_LIMITS[key].max);
      expect(moonTimeFromDraft(key, '12.9', 30)).toBe(30);
      expect(moonTimeFromDraft(key, '20', 30)).toBe(20);
    }
  });
  it('restores the current draft value for an empty or incomplete number', () => {
    for (const text of ['', ' ', '-', '1e', 'NaN', 'Infinity']) {
      expect(moonTimeFromDraft('nightSeconds', text, 25)).toBe(25);
    }
  });
});
