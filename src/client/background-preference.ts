import { useEffect, useState } from 'react';
import { GAME_IDS, isGameID, type GameID } from '../games/catalog';

export const BACKGROUND_KEY = 'friends-table.background.v1';
export type BackgroundID = 'jiebao-studio' | GameID;
export const BACKGROUND_IDS: BackgroundID[] = ['jiebao-studio', ...GAME_IDS];
const isBackgroundID = (value: string): value is BackgroundID => value === 'jiebao-studio' || isGameID(value);
const DEFAULT_BACKGROUND: BackgroundID = 'jiebao-studio';

export function rememberedBackground(): BackgroundID {
  try {
    const value = localStorage.getItem(BACKGROUND_KEY);
    return value && isBackgroundID(value) ? value : DEFAULT_BACKGROUND;
  } catch { return DEFAULT_BACKGROUND; }
}

export function rememberBackground(value: string): value is BackgroundID {
  if (!isBackgroundID(value)) return false;
  try { localStorage.setItem(BACKGROUND_KEY, value); } catch { /* Optional preference; keep the current page usable. */ }
  return true;
}

/** Public pages and unselected waiting rooms opt in; selected games keep their own art. */
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
