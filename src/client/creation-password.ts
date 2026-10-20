const storageKey = 'friends-table.create-key';

export function rememberedCreateKey(): string {
  try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
}

/** Call only after successful creation and explicit opt-in on this browser. */
export function rememberCreateKey(key: string): boolean {
  try {
    if (key) localStorage.setItem(storageKey, key);
    else localStorage.removeItem(storageKey);
    return true;
  } catch { return false; }
}
