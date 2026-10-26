import { describe, expect, it } from 'vitest';
import { BAKER_ART_SUBJECTS } from '../games/baker/art-manifest';
import { BAKER_DECKS, BAKER_ERAS, BAKER_ROLE_CATALOG } from '../games/baker/content';
import { bakerImage, bakerObject, bakerPortrait } from './BakerArtwork';

describe('Baker Street delivered artwork', () => {
  it('resolves every dealt evidence card to its own object illustration', () => {
    const objects = new Map(Object.keys(BAKER_ART_SUBJECTS).map(key => [key, bakerImage(`objects/${key}`)]));
    expect([...objects].filter(([, url]) => !url).map(([key]) => key), 'Missing object illustrations').toEqual([]);
    expect(new Set(objects.values()).size).toBe(objects.size);
    for (const deck of Object.values(BAKER_DECKS)) {
      for (const card of [...deck.means, ...deck.clues]) expect(bakerObject(card), card.id).toBe(objects.get(card.art));
    }
  });

  it('includes all playable, prepared and story portraits, four eras and both tokens', () => {
    for (const role of BAKER_ROLE_CATALOG) expect(bakerPortrait(role.id), role.name).not.toBe('');
    expect(bakerPortrait('police')).toBe(bakerPortrait('investigator'));
    for (const era of Object.keys(BAKER_ERAS)) expect(bakerImage(`scene-${era}`), era).not.toBe('');
    for (const token of ['badge', 'chess-marker', 'card-back']) expect(bakerImage(token), token).not.toBe('');
  });
});
