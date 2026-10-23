import { isGameID } from '../games/catalog';
import { isRoomHost, type AuthSession, type RoomInfo } from './api';

const key = (gameId: string) => `friends-table.game-options.v1.${gameId}`;
// Matches the server's bounded public options payload, including custom questions.
const MAX_LENGTH = 64 * 1024;
const isOptions = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A preference is only an initial suggestion. Existing rooms remain authoritative. */
export function rememberedGameOptions(gameId: string): Record<string, unknown> | undefined {
  if (!isGameID(gameId)) return undefined;
  try {
    const text = localStorage.getItem(key(gameId));
    if (!text || text.length > MAX_LENGTH) return undefined;
    const value: unknown = JSON.parse(text);
    return isOptions(value) ? value : undefined;
  } catch { return undefined; }
}

/** Store only acknowledged public room options, never credentials or game secrets. */
export function rememberGameOptions(seat: AuthSession, info: RoomInfo) {
  if (!isRoomHost(seat, info) || info.gameSelected === false || !isGameID(info.gameName) || !isOptions(info.gameOptions)) return;
  try {
    const value = JSON.stringify(info.gameOptions);
    if (value.length <= MAX_LENGTH && localStorage.getItem(key(info.gameName)) !== value) {
      localStorage.setItem(key(info.gameName), value);
    }
  } catch { /* Storage disabled or full must not interrupt the live room. */ }
}
