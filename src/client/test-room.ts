import { api, ApiError, isPlayer, type AuthSession, type RoomInfo } from './api';

/** Keep one add request across a lost response or a waiting-room reload. */
export async function addVirtualPlayer(seat: AuthSession, info: RoomInfo): Promise<RoomInfo> {
  const identity = isPlayer(seat) ? `player.${seat.playerID}` : `spectator.${seat.observerID}`;
  const key = `friends-table.bot-request.${info.roomId}.${info.matchID}.${identity}`;
  const requestID = sessionStorage.getItem(key) || crypto.randomUUID();
  sessionStorage.setItem(key, requestID);
  try {
    const next = await api<RoomInfo>(`/api/rooms/${info.roomId}/bots`, {
      method: 'POST', body: JSON.stringify({ matchID: info.matchID, requestID }),
    }, seat);
    sessionStorage.removeItem(key);
    return next;
  } catch (error) {
    // A definite refusal cannot have added a seat. Network / server errors may
    // have lost a successful response, so those retries retain their UUID.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) sessionStorage.removeItem(key);
    throw error;
  }
}
