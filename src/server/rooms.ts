import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validRoomID } from './security';

export interface RoomRecord {
  roomId: string;
  gameId: string;
  numPlayers: number;
  inviteHash: string;
  inviteExpiresAt: number;
  createdAt: number;
  spectators?: Record<string, { name: string; credentialHash: string }>;
  replayShares?: { tokenHash: string; expiresAt: number; frameIndex: number; perspective: 'blind' | 'god' }[];
}
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
        if (!validRoomID(room.roomId) || typeof room.inviteHash !== 'string') throw new Error('房間索引格式錯誤');
        this.rooms.set(room.roomId, room);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async save(room: RoomRecord) {
    this.rooms.set(room.roomId, room);
    const snapshot = JSON.stringify([...this.rooms.values()]);
    const job = this.writes.then(async () => {
      await writeFile(this.file + '.tmp', snapshot, { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    });
    this.writes = job.catch(() => {});
    return job;
  }
}
