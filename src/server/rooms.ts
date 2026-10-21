import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validRoomID } from './security';
import { atomicReplace } from './atomic-file';
export { ROOM_CAPACITY } from '../games/catalog';

/** Retry receipts contain only credential hashes; they never authorize normal room requests. */
export interface RoleSwitchReceipt {
  requestID: string;
  sourceMatchID: string;
  sourceAccess: 'player' | 'spectator';
  sourceID: string;
  sourceCredentialHash: string;
  targetAccess: 'player' | 'spectator';
  targetID: string;
  targetCredentialHash: string;
}

export interface RoomRecord {
  roomId: string;
  currentMatchID?: string;
  hostPlayerID?: string | null;
  /** The host can stay in the room as an observer instead of occupying a seat. */
  hostObserverID?: string | null;
  departedPlayerIDs?: string[];
  history?: RoomHistory[];
  completedDisplay?: { matchID: string; until: number };
  gameId: string;
  /** Undefined on legacy rooms, which already selected a game at creation. */
  gameSelected?: boolean;
  gameOptions?: Record<string, unknown>;
  numPlayers: number;
  inviteHash: string;
  inviteExpiresAt: number;
  createdAt: number;
  spectators?: Record<string, { name: string; credentialHash: string }>;
  roleSwitchReceipts?: RoleSwitchReceipt[];
  revokedObserverAdmissions?: string[];
  replayShares?: { matchID?: string; tokenHash: string; expiresAt: number; frameIndex: number; perspective: 'blind' | 'god' }[];
}
export interface RoomHistory {
  matchID: string;
  /** Registry id of this historical match; absent only on pre-switching records. */
  gameName?: string;
  endedAt: number;
  ending: 'completed' | 'host-ended' | 'empty';
  numPlayers: number;
  winner?: string;
  reason?: string;
}
export const currentMatchID = (room: RoomRecord) => room.currentMatchID ?? room.roomId;
export const hostObserverID = (room: RoomRecord) => room.hostObserverID ?? null;
export const hostPlayerID = (room: RoomRecord) => hostObserverID(room) !== null
  ? null : room.hostPlayerID === undefined ? '0' : room.hostPlayerID;
export const roomMatchIDs = (room: RoomRecord) => [...new Set([...(room.history || []).map((entry) => entry.matchID), currentMatchID(room)])];
export const matchGameID = (room: RoomRecord, matchID: string) =>
  room.history?.find(entry => entry.matchID === matchID)?.gameName ?? room.gameId;
export class RoomStore {
  readonly rooms = new Map<string, RoomRecord>();
  private file: string;
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory: string) { this.file = join(directory, 'rooms.json'); }
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const records: RoomRecord[] = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(records)) throw new Error('房間索引格式錯誤');
      for (const room of records) {
        if (!validRoomID(room.roomId) || typeof room.inviteHash !== 'string'
          || (room.gameSelected !== undefined && typeof room.gameSelected !== 'boolean')
          || (room.currentMatchID !== undefined && !validRoomID(room.currentMatchID))
          || (room.hostObserverID != null && (!validRoomID(room.hostObserverID)
            || !Object.prototype.hasOwnProperty.call(room.spectators ?? {}, room.hostObserverID)
            || room.hostPlayerID != null))
          || (room.completedDisplay !== undefined && (!validRoomID(room.completedDisplay.matchID)
            || !Number.isFinite(room.completedDisplay.until) || room.completedDisplay.until < 0))
          || (room.history !== undefined && (!Array.isArray(room.history) || room.history.some((entry) => !validRoomID(entry.matchID))))) throw new Error('房間索引格式錯誤');
        this.rooms.set(room.roomId, room);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async save(room: RoomRecord) {
    const incoming: RoomRecord = JSON.parse(JSON.stringify(room));
    const job = this.writes.then(async () => {
      const records = new Map(this.rooms);
      records.set(incoming.roomId, incoming);
      const snapshot = JSON.stringify([...records.values()]);
      await writeFile(this.file + '.tmp', snapshot, { mode: 0o600 });
      await atomicReplace(this.file + '.tmp', this.file);
      this.rooms.set(incoming.roomId, incoming);
    });
    this.writes = job.catch(() => {});
    return job;
  }
  findByMatch(matchID: string) {
    return [...this.rooms.values()].find((room) => roomMatchIDs(room).includes(matchID));
  }
}
