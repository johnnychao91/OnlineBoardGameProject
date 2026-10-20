import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSeat, saveSeat, type ObserverSession, type RoomInfo, type SeatSession } from './api';
import { clearRoleSwitch, completeRoleSwitch, isIdentityStorageKey, prepareRoleSwitch, readRoleSwitch, roleSwitchKey, withRoleSwitchLock } from './role-switch';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const room: RoomInfo = {
  roomId: 'role-test-room', matchID: 'role-test-match', gameName: 'encrypted-call', status: 'lobby',
  numPlayers: 2, minPlayers: 2, maxPlayers: 4,
  players: [{ id: '0', name: '特務', ready: true, isConnected: true }],
  spectatorCount: 0, spectators: [], godViewAllowed: true,
};
const player: SeatSession = { ...room, playerID: '0', credentials: 'role-test-player' };
const spectator: ObserverSession = {
  ...room, access: 'spectator', observerID: 'role-test-observer', credentials: 'role-test-spectator',
};

describe('recoverable room role changes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('reuses the persisted UUID and original match after a lost response, including after a match change', () => {
    const first = prepareRoleSwitch(player, room.matchID);
    expect(first.requestID).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
    expect(first.access).toBe('spectator');
    expect(JSON.parse(localStorage.getItem(roleSwitchKey(room.roomId))!)).toEqual(first);
    expect(prepareRoleSwitch({ ...player }, room.matchID)).toEqual(first);
    expect(prepareRoleSwitch({ ...player, matchID: 'next-match' }, 'next-match')).toEqual(first);
  });

  it('scopes pending recovery to source credentials and chooses the opposite target role', () => {
    const previous = prepareRoleSwitch(player, room.matchID);
    expect(readRoleSwitch(spectator)).toBeNull();
    const next = prepareRoleSwitch(spectator, room.matchID);
    expect(next).toMatchObject({ access: 'player', sourceCredentials: spectator.credentials });
    expect(next.requestID).not.toBe(previous.requestID);
    expect(readRoleSwitch(player)).toBeNull();
    expect(readRoleSwitch(spectator)).toEqual(next);
  });

  it('keeps requests isolated between rooms', () => {
    const first = prepareRoleSwitch(player, room.matchID);
    const other = { ...player, roomId: 'other-role-room' };
    const second = prepareRoleSwitch(other, room.matchID);
    expect(second.requestID).not.toBe(first.requestID);
    expect(readRoleSwitch(player)).toEqual(first);
    expect(readRoleSwitch(other)).toEqual(second);
  });

  it('replaces player authorization with observer authorization without persisting an invite in the seat', () => {
    saveSeat(player);
    const pending = prepareRoleSwitch(player, room.matchID);
    const result = completeRoleSwitch(player, pending, {
      ...spectator, inviteUrl: 'https://example.test/join/role-test-room#invite=test-invite',
    });
    expect(result).toEqual(spectator);
    expect(loadSeat(room.roomId)).toEqual(spectator);
    expect(loadSeat(room.roomId)).not.toHaveProperty('playerID');
    expect(loadSeat(room.roomId)).not.toHaveProperty('inviteUrl');
    expect(readRoleSwitch(player)).toBeNull();
  });

  it('replaces observer authorization with player authorization without retaining the old observer ID', () => {
    saveSeat(spectator);
    const pending = prepareRoleSwitch(spectator, room.matchID);
    const result = completeRoleSwitch(spectator, pending, { ...player, access: 'player' });
    expect(result).toMatchObject({ access: 'player', playerID: player.playerID, credentials: player.credentials });
    expect(result).not.toHaveProperty('observerID');
    expect(loadSeat(room.roomId)).toEqual(result);
    expect(readRoleSwitch(spectator)).toBeNull();
  });

  it('does not overwrite a newer identity or its pending request with a delayed response from an earlier tab', () => {
    saveSeat(player);
    const oldPending = prepareRoleSwitch(player, room.matchID);
    saveSeat(spectator);
    const newPending = prepareRoleSwitch(spectator, room.matchID);
    const staleResult = { ...spectator, credentials: 'delayed-old-result' };
    expect(completeRoleSwitch(player, oldPending, staleResult)).toEqual(spectator);
    expect(loadSeat(room.roomId)).toEqual(spectator);
    expect(readRoleSwitch(spectator)).toEqual(newPending);
  });

  it('does not restore a session after another tab has removed its local identity', () => {
    saveSeat(player);
    const pending = prepareRoleSwitch(player, room.matchID);
    localStorage.removeItem(`friends-table.seat.${room.roomId}`);
    expect(completeRoleSwitch(player, pending, spectator)).toBeNull();
    expect(loadSeat(room.roomId)).toBeNull();
    expect(readRoleSwitch(player)).toBeNull();
  });

  it('only clears the matching request, preserving a later request for the same source identity', () => {
    const oldPending = prepareRoleSwitch(player, room.matchID);
    clearRoleSwitch(player, oldPending.requestID);
    const newPending = prepareRoleSwitch(player, room.matchID);
    expect(newPending.requestID).not.toBe(oldPending.requestID);
    clearRoleSwitch(player, oldPending.requestID);
    expect(readRoleSwitch(player)).toEqual(newPending);
    clearRoleSwitch(player, newPending.requestID);
    expect(readRoleSwitch(player)).toBeNull();
  });

  it('rejects a response for another room or target role without saving or clearing recovery data', () => {
    saveSeat(player);
    const pending = prepareRoleSwitch(player, room.matchID);
    expect(() => completeRoleSwitch(player, pending, { ...spectator, roomId: 'different-room' })).toThrow();
    expect(() => completeRoleSwitch(player, pending, { ...player, access: 'player' })).toThrow();
    expect(loadSeat(room.roomId)).toEqual(player);
    expect(readRoleSwitch(player)).toEqual(pending);
  });

  it('ignores malformed, unrelated, or invalid recovery records', () => {
    const pending = prepareRoleSwitch(player, room.matchID);
    const malformed = [
      '{', 'null', '[]', 'false',
      JSON.stringify({ ...pending, access: 'player' }),
      JSON.stringify({ ...pending, sourceCredentials: 'other-identity' }),
      JSON.stringify({ ...pending, matchID: 7 }),
      JSON.stringify({ ...pending, requestID: 'not-a-uuid' }),
      JSON.stringify({ ...pending, requestID: '00000000-0000-1000-8000-000000000000' }),
    ];
    for (const value of malformed) {
      localStorage.setItem(roleSwitchKey(room.roomId), value);
      expect(readRoleSwitch(player), value).toBeNull();
    }
    const fresh = prepareRoleSwitch(player, room.matchID);
    expect(readRoleSwitch(player)).toEqual(fresh);
    expect(fresh.requestID).not.toBe(pending.requestID);
  });

  it('throws before a caller can send the request when durable browser storage is denied', () => {
    const send = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage denied'); },
      setItem: () => { throw new Error('storage denied'); },
      removeItem: () => { throw new Error('storage denied'); },
    });
    expect(readRoleSwitch(player)).toBeNull();
    expect(() => {
      const pending = prepareRoleSwitch(player, room.matchID);
      send(pending);
    }).toThrow('storage denied');
    expect(send).not.toHaveBeenCalled();
  });

  it('recognizes identity and recovery storage events but ignores unrelated preferences', () => {
    expect(isIdentityStorageKey(`friends-table.seat.${room.roomId}`)).toBe(true);
    expect(isIdentityStorageKey(roleSwitchKey(room.roomId))).toBe(true);
    expect(isIdentityStorageKey(null)).toBe(true);
    expect(isIdentityStorageKey('friends-table.name')).toBe(false);
    expect(isIdentityStorageKey('unrelated')).toBe(false);
  });

  it('uses the same exclusive cross-tab lock for one room and independent locks for different rooms', async () => {
    const request = vi.fn(async (_name: string, _options: { mode: string }, operation: () => unknown) => operation());
    vi.stubGlobal('navigator', { locks: { request } });
    await expect(withRoleSwitchLock(room.roomId, () => 'first-result')).resolves.toBe('first-result');
    await expect(withRoleSwitchLock(room.roomId, async () => 'next-result')).resolves.toBe('next-result');
    await expect(withRoleSwitchLock('other-role-room', () => 'other-result')).resolves.toBe('other-result');
    expect(request.mock.calls[0].slice(0, 2)).toEqual([roleSwitchKey(room.roomId), { mode: 'exclusive' }]);
    expect(request.mock.calls[1].slice(0, 2)).toEqual(request.mock.calls[0].slice(0, 2));
    expect(request.mock.calls[2][0]).not.toBe(request.mock.calls[0][0]);
  });

  it('propagates lock failures and operation failures instead of running outside the lock', async () => {
    const blocked = new Error('lock denied');
    const operation = vi.fn();
    vi.stubGlobal('navigator', { locks: { request: vi.fn().mockRejectedValue(blocked) } });
    await expect(withRoleSwitchLock(room.roomId, operation)).rejects.toBe(blocked);
    expect(operation).not.toHaveBeenCalled();

    const failed = new Error('switch failed');
    vi.stubGlobal('navigator', {
      locks: { request: async (_name: string, _options: { mode: string }, action: () => unknown) => action() },
    });
    await expect(withRoleSwitchLock(room.roomId, () => { throw failed; })).rejects.toBe(failed);
    await expect(withRoleSwitchLock(room.roomId, async () => { throw failed; })).rejects.toBe(failed);
  });

  it('reports unsupported browser locking before invoking any role-change operation', async () => {
    const operation = vi.fn();
    for (const unavailable of [undefined, {}, { locks: {} }]) {
      vi.stubGlobal('navigator', unavailable);
      await expect(withRoleSwitchLock(room.roomId, operation)).rejects.toThrow('此瀏覽器不支援跨分頁身分切換，尚未送出操作');
    }
    expect(operation).not.toHaveBeenCalled();
  });
});
