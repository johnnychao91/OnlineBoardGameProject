const key = 'friends-table.cup-echo.identity.v1';

export function echoBrowserToken(): string | undefined {
  try {
    const current = localStorage.getItem(key);
    if (current && /^[a-f0-9]{64}$/.test(current)) return current;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(key, token);
    return token;
  } catch { return undefined; }
}
