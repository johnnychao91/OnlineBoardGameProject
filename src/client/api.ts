export interface RoomPlayer { id: number | string; name?: string; isConnected: boolean; ready: boolean; membershipID?: string; departed?: boolean; }
export interface RoomSpectator { id: string; name: string; }
export interface RoomHistoryEntry {
  matchID: string;
  endedAt: number;
  ending: 'completed' | 'host-ended' | 'empty';
  numPlayers: number;
  winner?: string;
  reason?: string;
}
export interface RoomInfo {
  roomId: string;
  matchID: string;
  gameName: string;
  /** lobby / finished are shared; each game defines its active phase names. */
  status: string;
  numPlayers: number;
  minPlayers: number;
  maxPlayers: number;
  players: RoomPlayer[];
  spectatorCount: number;
  /** Optional only for browser sessions saved before spectator rosters were added. */
  spectators?: RoomSpectator[];
  godViewAllowed: boolean;
  hostPlayerID?: string | null;
  /** A host may manage the room from the spectator seats without counting as a player. */
  hostObserverID?: string | null;
  history?: RoomHistoryEntry[];
  /** Earliest automatic lobby return for the completed live match, in Unix milliseconds. */
  completedDisplayUntil?: number;
}
export interface SeatSession extends RoomInfo { access?: 'player'; playerID: string; credentials: string; }
export interface ObserverSession extends RoomInfo { access: 'spectator'; observerID: string; credentials: string; }
export type AuthSession = SeatSession | ObserverSession;
export type Admission = AuthSession & { inviteUrl?: string };
export interface GameInfo { id: string; name: string; description: string; minPlayers: number; maxPlayers: number; }
export type Perspective = 'blind' | 'god';
export function isPlayer(session: AuthSession): session is SeatSession { return session.access !== 'spectator'; }
export function roomHostPlayerID(info: RoomInfo): string | null {
  if (info.hostObserverID != null) return null;
  if (typeof info.hostPlayerID === 'string' && info.hostPlayerID) return info.hostPlayerID;
  return info.hostPlayerID === undefined && info.hostObserverID === undefined ? '0' : null;
}
export function isRoomHost(session: AuthSession, info: RoomInfo) {
  if (session.roomId !== info.roomId) return false;
  if (session.access === 'spectator') {
    return typeof session.observerID === 'string' && !!session.observerID
      && typeof info.hostObserverID === 'string' && session.observerID === info.hostObserverID;
  }
  return (session.access === undefined || session.access === 'player')
    && typeof session.playerID === 'string' && !!session.playerID
    && session.playerID === roomHostPlayerID(info);
}

const seatKey = (roomId: string) => `friends-table.seat.${roomId}`;
const tokenKey = (roomId: string) => `friends-table.invite.${roomId}`;
const inviteKey = (roomId: string) => `friends-table.share.${roomId}`;
const requestKey = (roomId: string, mode = 'player') => `friends-table.join-request.${roomId}.${mode}`;
const legacyRequestKey = (roomId: string) => `friends-table.join-request.${roomId}`;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'ApiError'; }
}

export async function api<T>(path: string, init: RequestInit = {}, seat?: AuthSession): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(seat ? { Authorization: `Bearer ${seat.credentials}`, ...(isPlayer(seat) ? { 'X-Player-ID': seat.playerID } : { 'X-Observer-ID': seat.observerID }) } : {}),
      ...init.headers,
    },
    credentials: 'same-origin',
    referrerPolicy: 'no-referrer',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || '連線暫時沒有成功，請稍後重試。', response.status,
    typeof body.code === 'string' ? body.code : undefined);
  return body as T;
}

export function saveSeat(value: Admission): AuthSession {
  const { inviteUrl, ...seat } = value;
  // A seat credential never enters an invitation URL, analytics or the visible UI.
  localStorage.setItem(seatKey(seat.roomId), JSON.stringify(seat));
  sessionStorage.removeItem(tokenKey(seat.roomId));
  sessionStorage.removeItem(requestKey(seat.roomId));
  sessionStorage.removeItem(requestKey(seat.roomId, 'spectator'));
  sessionStorage.removeItem(legacyRequestKey(seat.roomId));
  if (inviteUrl) sessionStorage.setItem(inviteKey(seat.roomId), inviteUrl);
  return seat;
}

export function loadSeat(roomId: string): AuthSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(seatKey(roomId)) || 'null');
    return value?.roomId === roomId && typeof value.credentials === 'string'
      && (value.access === 'spectator' ? typeof value.observerID === 'string' : typeof value.playerID === 'string')
      && typeof value.matchID === 'string' ? value : null;
  } catch { return null; }
}

/** An old tab must not clear a replacement identity saved by another tab. */
export function forgetSeat(roomId: string, credentials?: string) {
  if (credentials && loadSeat(roomId)?.credentials !== credentials) return;
  localStorage.removeItem(seatKey(roomId));
  sessionStorage.removeItem(requestKey(roomId));
  sessionStorage.removeItem(requestKey(roomId, 'spectator'));
  sessionStorage.removeItem(legacyRequestKey(roomId));
}
export function pendingToken(roomId: string) { return sessionStorage.getItem(tokenKey(roomId)); }
/** Use only after the server confirms the old admission was revoked, not on network failures. */
export function resetAdmission(roomId: string, mode: 'player' | 'spectator') {
  sessionStorage.removeItem(requestKey(roomId, mode));
  if (mode === 'player') sessionStorage.removeItem(legacyRequestKey(roomId));
}
/** Reuse across retries so a lost admission response cannot consume another seat. */
export function pendingRequestID(roomId: string, mode: 'player' | 'spectator' = 'player') {
  const existing = sessionStorage.getItem(requestKey(roomId, mode));
  if (existing) return existing;
  const legacy = mode === 'player' ? sessionStorage.getItem(legacyRequestKey(roomId)) : null;
  const requestID = legacy || crypto.randomUUID();
  sessionStorage.setItem(requestKey(roomId, mode), requestID);
  return requestID;
}
export function savedInvite(roomId: string) { return sessionStorage.getItem(inviteKey(roomId)); }
export function saveInvite(roomId: string, url: string) { sessionStorage.setItem(inviteKey(roomId), url); }

/** Run before React renders: fragments never reach HTTP requests or our access logs. */
export function captureInvite() {
  const match = location.pathname.match(/^\/join\/([A-Za-z0-9_-]+)\/?$/);
  if (!match || !location.hash) return;
  const token = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (token && token.length <= 256) {
    if (sessionStorage.getItem(tokenKey(match[1])) !== token) {
      sessionStorage.removeItem(requestKey(match[1]));
      sessionStorage.removeItem(requestKey(match[1], 'spectator'));
      sessionStorage.removeItem(legacyRequestKey(match[1]));
    }
    sessionStorage.setItem(tokenKey(match[1]), token);
  }
  history.replaceState(null, '', location.pathname);
}

export function rememberedName() {
  try { return localStorage.getItem('friends-table.name') || ''; } catch { return ''; }
}
export function rememberName(name: string) { localStorage.setItem('friends-table.name', name); }
