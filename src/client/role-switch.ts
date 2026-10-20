import { isPlayer, loadSeat, saveSeat, type Admission, type AuthSession } from './api';

export interface PendingRoleSwitch {
  access: 'player' | 'spectator';
  matchID: string;
  requestID: string;
  sourceCredentials: string;
}
export const roleSwitchKey = (roomId: string) => `friends-table.role-switch.${roomId}`;
export const isIdentityStorageKey = (key: string | null) =>
  key === null || key.startsWith('friends-table.seat.') || key.startsWith('friends-table.role-switch.');

/** Serialize the entire switch across tabs so its recovery UUID cannot be replaced mid-request. */
export async function withRoleSwitchLock<T>(roomId: string, operation: () => T | Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') {
    throw new Error('此瀏覽器不支援跨分頁身分切換，尚未送出操作。請使用新版瀏覽器，並以 HTTPS 開啟網站後再試。');
  }
  return navigator.locks.request(roleSwitchKey(roomId), { mode: 'exclusive' }, operation);
}

/** Persist before sending: a lost response must be recoverable after reload or in another tab. */
export function readRoleSwitch(seat: AuthSession): PendingRoleSwitch | null {
  try {
    const value = JSON.parse(localStorage.getItem(roleSwitchKey(seat.roomId)) || 'null');
    return value?.sourceCredentials === seat.credentials
      && value.access === (isPlayer(seat) ? 'spectator' : 'player')
      && typeof value.matchID === 'string' && typeof value.requestID === 'string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.requestID)
      ? value : null;
  } catch { return null; }
}

export function prepareRoleSwitch(seat: AuthSession, matchID: string): PendingRoleSwitch {
  const previous = readRoleSwitch(seat);
  if (previous) return previous;
  const pending: PendingRoleSwitch = {
    access: isPlayer(seat) ? 'spectator' : 'player', matchID,
    requestID: crypto.randomUUID(), sourceCredentials: seat.credentials,
  };
  localStorage.setItem(roleSwitchKey(seat.roomId), JSON.stringify(pending));
  return pending;
}

export function clearRoleSwitch(seat: AuthSession, requestID: string) {
  const pending = readRoleSwitch(seat);
  if (pending?.requestID === requestID) localStorage.removeItem(roleSwitchKey(seat.roomId));
}

/** A delayed tab response cannot overwrite a newer identity issued by another switch. */
export function completeRoleSwitch(source: AuthSession, pending: PendingRoleSwitch, result: Admission): AuthSession | null {
  if (result.roomId !== source.roomId || result.access !== pending.access) throw new Error('身分切換回應不正確');
  const current = loadSeat(source.roomId);
  if (current?.credentials !== source.credentials) {
    clearRoleSwitch(source, pending.requestID);
    return current;
  }
  const next = saveSeat(result);
  clearRoleSwitch(source, pending.requestID);
  return next;
}
