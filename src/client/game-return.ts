import type { RoomInfo } from './api';
import { validAdUnit } from './adsense';

/** A live completed match returning to its own ordinary room creates one link. */
export function completedGameReturn(previous: RoomInfo | null, next: RoomInfo): string | null {
  if (!previous || previous.roomId !== next.roomId || previous.status === 'lobby'
    || next.status !== 'lobby' || previous.matchID === next.matchID
    || previous.testRoom || next.testRoom || next.advertising?.enabled !== true
    || !validAdUnit(next.advertising.client, next.advertising.slot)) return null;
  return next.history?.some(entry => entry.matchID === previous.matchID && entry.ending === 'completed')
    ? previous.matchID : null;
}

/** Only public room/match IDs enter the URL; navigation performs no mutation. */
export function completedReturnPath(roomId: string, matchID: string): string {
  return `/room/${encodeURIComponent(roomId)}?returned=${encodeURIComponent(matchID)}`;
}
