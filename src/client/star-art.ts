/** Original celestial subjects; rules, costs and prestige are rendered separately. */
const images = import.meta.glob<string>('./assets/star/**/*.{webp,png}', { eager: true, import: 'default', query: '?url' });
export function starArt(key: string): string { return images[`./assets/star/${key}.webp`] ?? images[`./assets/star/${key}.png`] ?? ''; }
export function starCraftArt(color: string, tier: number, id: string): string {
  const suffix = Number(id.match(/(\d+)$/)?.[1] ?? 0);
  return `crafts/${color}-${tier}-${suffix % 2 ? 'a' : 'b'}`;
}
