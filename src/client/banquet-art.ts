/** Shared original illustrations. This lookup never derives a face from hidden state. */
import type { BanquetRole } from '../games/banquet/content';

const images = import.meta.glob<string>('./assets/banquet/**/*.{webp,png}', { eager: true, import: 'default', query: '?url' });
export function banquetArt(name: string): string {
  return images[`./assets/banquet/${name}.webp`] ?? images[`./assets/banquet/${name}.png`] ?? '';
}
export function banquetPortrait(role: BanquetRole): string { return banquetArt(`roles/${role}`) || banquetArt('card-back'); }
