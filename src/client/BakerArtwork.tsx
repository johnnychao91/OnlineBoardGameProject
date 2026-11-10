import type { BakerCard } from '../games/baker/content';

const assets = import.meta.glob<string>('./assets/baker/**/*.{webp,png}', { eager: true, import: 'default', query: '?url' });
const subjects = import.meta.glob<string>('./assets/art/source-layers/baker/**/subject.webp', { eager: true, import: 'default', query: '?url' });

export function bakerImage(key: string): string {
  return assets[`./assets/baker/${key}.webp`] ?? assets[`./assets/baker/${key}.png`] ?? '';
}

function bakerSubject(key: string): string {
  return subjects[`./assets/art/source-layers/baker/${key}/subject.webp`] ?? bakerImage(key);
}

export const bakerPortrait = (role: string) => bakerSubject(`roles/${role === 'police' ? 'investigator' : role}`);
export const bakerObject = (card: Pick<BakerCard, 'art'>) => bakerSubject(`objects/${card.art}`);

/** Callers choose portraits only after applying the current privacy projection. */
export function BakerArtwork({ card, role, token, hidden = false }: {
  card?: BakerCard; role?: string; token?: 'badge' | 'chess-marker'; hidden?: boolean;
}) {
  const src = hidden ? bakerImage('card-back') : card ? bakerObject(card) : role ? bakerPortrait(role) : token ? bakerImage(token) : '';
  const paper = !hidden && (card || role);
  return <span className={`baker-art${card ? ' baker-object-art' : ''}${token ? ' baker-token-art' : ''}${hidden ? ' baker-back-art' : ''}${paper ? ' baker-card-paper' : ''}`} aria-hidden="true">
    {src && <img src={src} alt="" loading="lazy" decoding="async" />}
  </span>;
}
