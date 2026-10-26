import { MAIL_CARDS, type MailRole } from '../games/post/rules';

/** Artwork is chosen only after the caller has an authorized, visible role. */
const portraits = import.meta.glob<string>('./assets/post/roles/*.{webp,svg}', {
  eager: true, import: 'default', query: '?url',
});
const resources = import.meta.glob<string>('./assets/post/*.webp', {
  eager: true, import: 'default', query: '?url',
});

export function mailPortrait(role: string): string {
  const artRole = MAIL_CARDS[role as MailRole]?.artRole ?? role;
  return portraits[`./assets/post/roles/${artRole}.webp`]
    ?? portraits[`./assets/post/roles/${artRole}.svg`]
    ?? (artRole === 'director' ? resources['./assets/post/director.webp'] : undefined) ?? '';
}

export function MailArtwork({ role, hidden = false }: { role?: string; hidden?: boolean }) {
  const image = hidden ? resources['./assets/post/card-back.webp'] : role ? mailPortrait(role) : undefined;
  return <span className={`mail-art ${hidden ? 'mail-art-back' : ''}`} aria-hidden="true">
    {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : <span className="mail-art-seal">✉</span>}
  </span>;
}
