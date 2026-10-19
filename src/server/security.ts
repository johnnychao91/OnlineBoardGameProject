import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** A browser's unguessable request nonce plus its invite is a recoverable admission. */
export const admissionCredential = (roomId: string, invite: string, requestID: string) =>
  createHmac('sha256', invite).update(`station-admission-v1:${roomId}:${requestID}`).digest('base64url');
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export const validRoomID = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{16}$/.test(id);
export const validCredential = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

/** In-memory limits are intentionally for a single Node process. */
export class RateLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  allow(key: string, limit: number, periodMs: number, now = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry || now >= entry.until) {
      if (this.entries.size >= 10000) {
        for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id);
        if (this.entries.size >= 10000) return false;
      }
      this.entries.set(key, { count: 1, until: now + periodMs });
      return true;
    }
    return ++entry.count <= limit;
  }
}
