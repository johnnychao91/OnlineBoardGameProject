import { useSyncExternalStore } from 'react';

export type VisualStyle = 'simple' | 'art';
export const VISUAL_STYLE_KEY = 'friends-table.visual-style';
const DEFAULT_VISUAL_STYLE: VisualStyle = 'art';

export function parseVisualStyle(value: unknown): VisualStyle {
  return value === 'simple' ? 'simple' : DEFAULT_VISUAL_STYLE;
}

export function readVisualStyle(): VisualStyle {
  try { return parseVisualStyle(localStorage.getItem(VISUAL_STYLE_KEY)); }
  catch { return DEFAULT_VISUAL_STYLE; }
}

export function saveVisualStyle(value: VisualStyle): VisualStyle {
  const style = parseVisualStyle(value);
  try { localStorage.setItem(VISUAL_STYLE_KEY, style); }
  catch { /* The current tab can switch styles even if storage is unavailable. */ }
  return style;
}

let currentStyle: VisualStyle = DEFAULT_VISUAL_STYLE;
let initialized = false;
const listeners = new Set<() => void>();
const getSnapshot = () => currentStyle;
const getServerSnapshot = (): VisualStyle => DEFAULT_VISUAL_STYLE;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function applyVisualStyle(style: VisualStyle) {
  if (typeof document !== 'undefined') document.documentElement.dataset.visualStyle = style;
  if (style === currentStyle) return;
  currentStyle = style;
  listeners.forEach(listener => listener());
}

/** Called once before React mounts; switching only changes presentation, never the game client. */
export function initializeVisualStyle() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  applyVisualStyle(readVisualStyle());
  window.addEventListener('storage', event => {
    if (event.key !== VISUAL_STYLE_KEY && event.key !== null) return;
    try { if (event.storageArea !== localStorage) return; }
    catch { return; }
    applyVisualStyle(readVisualStyle());
  });
}

export function VisualStyleSwitch() {
  const style = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <div className="visual-style-switch" role="group" aria-label="介面風格" title="介面風格切換（暫時試用）">
    <button type="button" className="visual-style-option" aria-pressed={style === 'simple'}
      title="精簡風格：原本的清楚介面" onClick={() => applyVisualStyle(saveVisualStyle('simple'))}>精簡</button>
    <button type="button" className="visual-style-option" aria-pressed={style === 'art'}
      title="美術風格（試用）：原創手繪主題插畫" onClick={() => applyVisualStyle(saveVisualStyle('art'))}>美術</button>
  </div>;
}
