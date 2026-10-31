import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberedRoomCode, rememberRoomCode } from './room-code';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoomCode } from './RoomCode';

describe('optional browser room code', () => {
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
    expect(rememberedRoomCode()).toBe('');
    expect(rememberRoomCode('test-only-memory-room-code')).toBe(true);
    expect(rememberedRoomCode()).toBe('test-only-memory-room-code');
    rememberRoomCode('');
    expect(rememberedRoomCode()).toBe('');
  });

  it('does not break creation when browser storage is disabled', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage unavailable'); },
      setItem: () => { throw new Error('storage unavailable'); },
      removeItem: () => { throw new Error('storage unavailable'); },
    });
    expect(rememberedRoomCode()).toBe('');
    expect(rememberRoomCode('test-only-memory-room-code')).toBe(false);
    expect(rememberRoomCode('')).toBe(false);
  });

  it('does not reuse a remembered creation password as an optional room code', () => {
    localStorage.setItem('friends-table.create-key','legacy-password-fixture');
    expect(rememberedRoomCode()).toBe('');
    expect(localStorage.getItem('friends-table.create-key')).toBeNull();
    rememberRoomCode('test-only-memory-room-code');
    expect(rememberedRoomCode()).toBe('test-only-memory-room-code');
  });

  it('presents a private optional code field without requiring it for creation', () => {
    const html=renderToStaticMarkup(createElement(RoomCode,{value:'',remember:false,saved:false,
      onChange:()=>{},onRemember:()=>{},onForget:()=>{}}));
    expect(html).toContain('房間暗語（選填）');expect(html).toContain('留空即可開房');
    expect(html).toContain('type="password"');expect(html).toContain('name="roomCode"');
    expect(html).not.toContain('required');expect(html).not.toContain('開房密碼');
  });
});
