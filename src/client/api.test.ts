import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, captureInvite, loadSeat, pendingRequestID, pendingToken, saveSeat, type ObserverSession, type RoomInfo, type SeatSession } from './api';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
const room: RoomInfo = {
  roomId: 'room-test', matchID: 'room-test', gameName: 'space-station', status: 'lobby',
  numPlayers: 1, minPlayers: 4, maxPlayers: 8, players: [{ id: '0', name: '隊員', ready: false, isConnected: true }],
  spectatorCount: 0, godViewAllowed: true,
};
const player: SeatSession = { ...room, playerID: '0', credentials: 'player-test-credential' };
const observer: ObserverSession = { ...room, access: 'spectator', observerID: 'watch-test', credentials: 'observer-test-credential' };

describe('browser identity and invite boundaries', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('history', { replaceState: vi.fn() });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('authenticates observers with an observer ID and never a player ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await api('/api/rooms/room-test/view?perspective=blind', {}, observer);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).not.toContain(observer.credentials);
    expect(options.headers).toMatchObject({ Authorization: `Bearer ${observer.credentials}`, 'X-Observer-ID': observer.observerID });
    expect(options.headers).not.toHaveProperty('X-Player-ID');
  });

  it('keeps existing player sessions compatible without an access property', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await api('/api/rooms/room-test/ready', { method: 'POST', body: '{"ready":true}' }, player);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-Player-ID': '0' });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Observer-ID');
    saveSeat(player);
    expect(loadSeat(room.roomId)).toMatchObject({ playerID: '0', credentials: player.credentials });
  });

  it('reuses a request UUID within one admission mode but separates player and observer requests', () => {
    const joining = pendingRequestID(room.roomId, 'player');
    const watching = pendingRequestID(room.roomId, 'spectator');
    expect(joining).toMatch(/^[0-9a-f-]{36}$/);
    expect(pendingRequestID(room.roomId, 'player')).toBe(joining);
    expect(pendingRequestID(room.roomId, 'spectator')).toBe(watching);
    expect(joining).not.toBe(watching);
  });

  it('strips an invite fragment and resets pending request IDs when the invite changes', () => {
    const oldRequest = pendingRequestID(room.roomId);
    vi.stubGlobal('location', { pathname: '/join/room-test', hash: '#invite=new-test-invite' });
    captureInvite();
    expect(pendingToken(room.roomId)).toBe('new-test-invite');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/join/room-test');
    expect(pendingRequestID(room.roomId)).not.toBe(oldRequest);
  });

  it('migrates a v0.1 pending player UUID without sharing it with observers and clears the legacy key', () => {
    const legacyKey = `friends-table.join-request.${room.roomId}`;
    const legacyUUID = '7f9115ba-542d-4ee5-97b4-24e2090bdc8d';
    sessionStorage.setItem(legacyKey, legacyUUID);
    expect(pendingRequestID(room.roomId, 'spectator')).not.toBe(legacyUUID);
    expect(pendingRequestID(room.roomId, 'player')).toBe(legacyUUID);
    expect(pendingRequestID(room.roomId, 'player')).toBe(legacyUUID);
    saveSeat(player);
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
    sessionStorage.setItem(legacyKey, legacyUUID);
    vi.stubGlobal('location', { pathname: '/join/room-test', hash: '#invite=rotated-invite' });
    captureInvite();
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
    expect(pendingRequestID(room.roomId, 'player')).not.toBe(legacyUUID);
  });

  it('keeps one identity per room and clears admission data without storing an invite in the identity', () => {
    saveSeat(player);
    const oldRequest = pendingRequestID(room.roomId, 'spectator');
    vi.stubGlobal('location', { pathname: '/join/room-test', hash: '#invite=friend-invite' });
    captureInvite();
    saveSeat({ ...observer, inviteUrl: 'https://example.test/join/room-test#invite=friend-invite' });
    const loaded = loadSeat(room.roomId);
    expect(loaded).toMatchObject({ access: 'spectator', observerID: 'watch-test' });
    expect(loaded).not.toHaveProperty('playerID');
    expect(loaded).not.toHaveProperty('inviteUrl');
    expect(pendingToken(room.roomId)).toBeNull();
    expect(pendingRequestID(room.roomId, 'spectator')).not.toBe(oldRequest);
  });
});
