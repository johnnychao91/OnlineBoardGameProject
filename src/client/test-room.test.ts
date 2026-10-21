import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthSession, type RoomInfo } from './api';
import { addVirtualPlayer } from './test-room';
import { TestRoomBadge, TestRoomBots } from './TestRoom';
import { RemovePlayer } from './RemovePlayer';

const info: RoomInfo = {
  roomId: 'testing-room', matchID: 'testing-match', gameName: 'encrypted-call', status: 'lobby',
  testRoom: true, numPlayers: 1, roomCapacity: 12, minPlayers: 2, maxPlayers: 4,
  players: [{ id: '0', name: '房主', isConnected: true, ready: false }],
  spectatorCount: 0, godViewAllowed: true, hostPlayerID: '0', hostObserverID: null,
};
const host: AuthSession = { ...info, playerID: '0', credentials: 'test-host-credential' };
const render = (room = info, seat: AuthSession = host, disabled = false) => renderToStaticMarkup(createElement(TestRoomBots, {
  seat, info: room, disabled, onAdd: () => {},
}));

describe('test-room controls', () => {
  it('limits bot controls to the waiting room and the currently authenticated host', () => {
    expect(render()).toContain('加入一位虛擬玩家');
    expect(render(info, { ...host, playerID: '1' })).not.toContain('<button');
    expect(render({ ...info, testRoom: false })).toBe('');
    expect(render({ ...info, status: 'playing' })).toBe('');
    const observerHost: AuthSession = { ...info, access: 'spectator', observerID: 'watch-host', credentials: 'test-watch-key' };
    expect(render({ ...info, hostPlayerID: null, hostObserverID: 'watch-host' }, observerHost)).toContain('加入一位虛擬玩家');
  });

  it('caps bots at the selected game limit, and shared capacity before choosing a game', () => {
    const four = { ...info, players: Array.from({ length: 4 }, (_, id) => ({ id, name: `成員 ${id}`, ready: true, isConnected: true })) };
    expect(render(four)).toContain('已達 4 位玩家上限');
    expect(render(four)).toContain('disabled=""');
    expect(render({ ...four, gameSelected: false })).toContain('還可加入 8 位');
    expect(render({ ...four, gameSelected: false })).not.toContain('disabled=""');
    expect(render(info, host, true)).toContain('disabled=""');
  });

  it('marks test rooms without displaying passwords and gives bots distinct removal instructions', () => {
    expect(renderToStaticMarkup(createElement(TestRoomBadge, { info }))).toContain('測試房間 · 不計戰績');
    expect(renderToStaticMarkup(createElement(TestRoomBadge, { info: { ...info, testRoom: undefined } }))).toBe('');
    const bot = renderToStaticMarkup(createElement(RemovePlayer, {
      player: { ...info.players[0], isBot: true, membershipID: 'test-member' }, busy: false, onRemove: async () => {},
    }));
    expect(bot).toContain('需要時，房主可再次新增虛擬玩家');
    expect(bot).not.toContain('對方仍可使用有效邀請重新加入');
    expect(render()).not.toContain(host.credentials);
  });
});

describe('idempotent virtual-player admission', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const ok = () => ({ ok: true, headers: new Headers(), json: async () => info });

  it('retries a lost response with the same UUID and creates a new one after success', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Network failure')).mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    await expect(addVirtualPlayer(host, info)).rejects.toThrow('Network failure');
    await addVirtualPlayer(host, info);
    await addVirtualPlayer(host, info);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1].requestID).not.toBe(bodies[2].requestID);
    expect(bodies[0]).toMatchObject({ matchID: info.matchID });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/rooms/${info.roomId}/bots`);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${host.credentials}`, 'X-Player-ID': '0' });
  });

  it('separates requests by match and host identity', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network failure'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(addVirtualPlayer(host, info)).rejects.toThrow();
    await expect(addVirtualPlayer(host, { ...info, matchID: 'next-match' })).rejects.toThrow();
    const watcher: AuthSession = { ...info, access: 'spectator', observerID: 'host-observer', credentials: 'watch-key' };
    await expect(addVirtualPlayer(watcher, info)).rejects.toThrow();
    const ids = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).requestID);
    expect(new Set(ids).size).toBe(3);
    expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ 'X-Observer-ID': 'host-observer' });
    expect(fetchMock.mock.calls[2][1].headers).not.toHaveProperty('X-Player-ID');
  });

  it('clears a definitely refused request but preserves uncertain server errors', async () => {
    const failure = (status: number) => ({ ok: false, status, headers: new Headers(), json: async () => ({ error: '失敗' }) });
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(409)).mockResolvedValueOnce(failure(500)).mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    await expect(addVirtualPlayer(host, info)).rejects.toThrow();
    await expect(addVirtualPlayer(host, info)).rejects.toThrow();
    await addVirtualPlayer(host, info);
    const ids = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).requestID);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
  });
});
