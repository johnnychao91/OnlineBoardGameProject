import { useEffect, useState } from 'react';
import { isGameID, type GameID } from '../games/catalog';

export const BACKGROUND_KEY = 'friends-table.background.v1';
const DEFAULT_BACKGROUND: GameID = 'space-station';

export function rememberedBackground(): GameID {
  try {
    const value = localStorage.getItem(BACKGROUND_KEY);
    return value && isGameID(value) ? value : DEFAULT_BACKGROUND;
  } catch { return DEFAULT_BACKGROUND; }
}

export function rememberBackground(value: string): value is GameID {
  if (!isGameID(value)) return false;
  try { localStorage.setItem(BACKGROUND_KEY, value); } catch { /* Optional preference; keep the current page usable. */ }
  return true;
}

/** Only public landing pages opt in; room and detailed-rule art stays game-specific. */
export function useBackgroundPreference() {
  const [background, setBackground] = useState(rememberedBackground);
  useEffect(() => {
    function sync(event: StorageEvent) {
      try {
        if (event.storageArea === localStorage && (event.key === BACKGROUND_KEY || event.key === null)) {
          setBackground(rememberedBackground());
        }
      } catch { /* Storage access can be revoked while the page is open. */ }
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function selectBackground(value: string) {
    if (rememberBackground(value)) setBackground(value);
  }
  return { background, selectBackground };
}
