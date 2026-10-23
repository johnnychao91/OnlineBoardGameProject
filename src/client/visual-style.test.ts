import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseVisualStyle, readVisualStyle, saveVisualStyle, VISUAL_STYLE_KEY } from './visual-style';

afterEach(() => vi.unstubAllGlobals());

describe('local visual style preference', () => {
  it('defaults to art for missing, malformed or unknown preferences and preserves saved choices', () => {
    for (const value of [null, undefined, '', 'ART', ' art ', 'future-style', '{}', 1]) {
      expect(parseVisualStyle(value)).toBe('art');
    }
    expect(parseVisualStyle('simple')).toBe('simple');
    expect(parseVisualStyle('art')).toBe('art');
  });

  it('stores only the style preference and restores the selected appearance', () => {
    const values = new Map<string, string>();
    const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => values.set(key, value)) };
    vi.stubGlobal('localStorage', storage);
    expect(readVisualStyle()).toBe('art');
    expect(saveVisualStyle('art')).toBe('art');
    expect(storage.setItem).toHaveBeenCalledWith(VISUAL_STYLE_KEY, 'art');
    expect(readVisualStyle()).toBe('art');
    expect(saveVisualStyle('simple')).toBe('simple');
    expect(readVisualStyle()).toBe('simple');
    expect([...values.keys()]).toEqual([VISUAL_STYLE_KEY]);
  });

  it('keeps style switching available when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readVisualStyle()).toBe('art');
    expect(saveVisualStyle('art')).toBe('art');
    expect(saveVisualStyle('simple')).toBe('simple');
  });
});
