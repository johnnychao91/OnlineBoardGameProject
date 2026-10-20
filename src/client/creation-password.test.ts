import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberedCreateKey, rememberCreateKey } from './creation-password';

describe('optional browser creation password', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts empty, remembers only on request and supports forgetting', () => {
    expect(rememberedCreateKey()).toBe('');
    expect(rememberCreateKey('test-only-memory-passphrase')).toBe(true);
    expect(rememberedCreateKey()).toBe('test-only-memory-passphrase');
    rememberCreateKey('');
    expect(rememberedCreateKey()).toBe('');
  });

  it('does not break creation when browser storage is disabled', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage unavailable'); },
      setItem: () => { throw new Error('storage unavailable'); },
      removeItem: () => { throw new Error('storage unavailable'); },
    });
    expect(rememberedCreateKey()).toBe('');
    expect(rememberCreateKey('test-only-memory-passphrase')).toBe(false);
    expect(rememberCreateKey('')).toBe(false);
  });
});
