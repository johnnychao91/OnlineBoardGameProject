/** Per-tab leases and per-socket connections; disconnecting one tab cannot hide another. */
export class RoomPresence {
  private readonly entries = new Map<string, Map<string, { identity: string; until: number; connected: boolean }>>();
  private readonly bootGraceUntil: number;
  constructor(private readonly leaseMs = 60000) {
    this.bootGraceUntil = Date.now() + leaseMs;
  }
  touch(roomId: string, identity: string, sessionID: string) {
    this.set(roomId, identity, `tab:${sessionID}`, false);
  }
  connect(roomId: string, identity: string, socketID: string) {
    this.set(roomId, identity, `socket:${socketID}`, true);
  }
  remove(roomId: string, identity: string) {
    const entries = this.entries.get(roomId);
    if (entries) for (const [key, value] of entries) if (value.identity === identity) entries.delete(key);
  }
  private set(roomId: string, identity: string, key: string, connected: boolean) {
    let entries = this.entries.get(roomId);
    if (!entries) this.entries.set(roomId, entries = new Map());
    const now = Date.now();
    for (const [entryKey, entry] of entries) if (!entry.connected && entry.until <= now) entries.delete(entryKey);
    entries.set(`${identity}:${key}`, { identity, until: now + this.leaseMs, connected });
  }
  disconnectSocket(roomId: string, identity: string, socketID: string) {
    const entry = this.entries.get(roomId)?.get(`${identity}:socket:${socketID}`);
    if (entry) { entry.connected = false; entry.until = Date.now() + this.leaseMs; }
  }
  hasAnyone(roomId: string) {
    const now = Date.now();
    const entries = this.entries.get(roomId);
    if (entries) for (const [key, value] of entries) if (!value.connected && value.until <= now) entries.delete(key);
    return now < this.bootGraceUntil || [...(entries?.values() || [])].some((entry) => entry.connected || entry.until > now);
  }
}
