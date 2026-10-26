import type { BakerCard } from '../games/baker/content';

const assets = import.meta.glob<string>('./assets/baker/**/*.{webp,png}', { eager: true, import: 'default', query: '?url' });

export function bakerImage(key: string): string {
  return assets[`./assets/baker/${key}.webp`] ?? assets[`./assets/baker/${key}.png`] ?? '';
}

export const bakerPortrait = (role: string) => bakerImage(`roles/${role === 'police' ? 'investigator' : role}`);
export const bakerObject = (card: Pick<BakerCard, 'art'>) => bakerImage(`objects/${card.art}`);

/** Callers choose portraits only after applying the current privacy projection. */
export function BakerArtwork({ card, role, token, hidden = false }: {
  card?: BakerCard; role?: string; token?: 'badge' | 'chess-marker'; hidden?: boolean;
}) {
  const src = hidden ? bakerImage('card-back') : card ? bakerObject(card) : role ? bakerPortrait(role) : token ? bakerImage(token) : '';
  return <span className={`baker-art${card ? ' baker-object-art' : ''}${token ? ' baker-token-art' : ''}${hidden ? ' baker-back-art' : ''}`} aria-hidden="true">
    {src && <img src={src} alt="" loading="lazy" decoding="async" />}
  </span>;
}
