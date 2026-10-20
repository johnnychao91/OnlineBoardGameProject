import { rename } from 'node:fs/promises';
import { platform } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const RETRY_DELAYS_MS = [20, 40, 80, 160, 320] as const;
const WINDOWS_LOCK_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Replace a file atomically. Windows readers and scanners may briefly prevent
 * replacement even after the writer has closed its temporary file.
 *
 * Retry the same rename at most six times (620 ms of backoff). Never remove the
 * destination: exhausting retries must leave the previous committed file intact.
 */
export async function atomicReplace(temporary: string, destination: string): Promise<void> {
  const windows = platform() === 'win32';
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (!windows || !code || !WINDOWS_LOCK_ERRORS.has(code) || attempt >= RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(RETRY_DELAYS_MS[attempt]);
    }
  }
}
