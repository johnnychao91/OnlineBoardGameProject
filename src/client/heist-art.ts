/** Every URL refers to original locally generated artwork, never a hidden card. */
const images = import.meta.glob<string>('./assets/heist/**/*.{webp,png}', { eager: true, import: 'default', query: '?url' });
export function heistArt(key: string): string {
  return images[`./assets/heist/${key}.webp`] ?? images[`./assets/heist/${key}.png`] ?? '';
}
