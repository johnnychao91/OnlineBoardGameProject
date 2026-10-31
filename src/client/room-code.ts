const storageKey = 'friends-table.room-code';
const legacyStorageKey = 'friends-table.create-key';

export function rememberedRoomCode(): string {
  try { localStorage.removeItem(legacyStorageKey); return localStorage.getItem(storageKey) || ''; } catch { return ''; }
}

/** Call only after successful creation and explicit opt-in on this browser. */
export function rememberRoomCode(key: string): boolean {
  try {
    if (key) localStorage.setItem(storageKey, key);
    else localStorage.removeItem(storageKey);
    return true;
  } catch { return false; }
}
