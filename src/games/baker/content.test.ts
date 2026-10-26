import { describe, expect, it } from 'vitest';
import { BAKER_ART_SUBJECTS } from './art-manifest';
import { BAKER_DECKS, BAKER_ERAS, BAKER_ROLE_CATALOG, BAKER_SCENES, sceneOptions, type BakerEra } from './content';

const eras = Object.keys(BAKER_ERAS) as BakerEra[];
const allCards = eras.flatMap(era => [...BAKER_DECKS[era].means, ...BAKER_DECKS[era].clues]);

describe('Baker Street original era card libraries', () => {
  it.each(eras)('%s supplies a full distinct 400-clue / 180-means deck at every supported deal size', era => {
    const deck = BAKER_DECKS[era];
    expect(deck.clues).toHaveLength(400);
    expect(deck.means).toHaveLength(180);
    const cards = [...deck.means, ...deck.clues];
    expect(new Set(cards.map(card => card.name)).size).toBe(580);
    expect(cards.every(card => card.era === era)).toBe(true);
    expect(deck.clues.every(card => card.kind === 'clue')).toBe(true);
    expect(deck.means.every(card => card.kind === 'means')).toBe(true);
    // Twelve players have eleven public suspect rows; the scientist gets no cards.
    for (const count of [3, 4, 5]) {
      expect(deck.clues.length).toBeGreaterThanOrEqual(11 * count);
      expect(deck.means.length).toBeGreaterThanOrEqual(11 * count);
    }
    for (const card of cards) {
      expect(card.id).toMatch(new RegExp(`^${era}-${card.kind}-[0-9]{3}$`));
      expect(card.name).toBe(card.name.trim());
      expect(card.name.length).toBeGreaterThanOrEqual(2);
      expect(card.name.length).toBeLessThanOrEqual(24);
      expect(card.name).not.toMatch(/未命名|待補|範例|TODO|\$\{|[<>]/);
      expect(Object.hasOwn(BAKER_ART_SUBJECTS, card.art)).toBe(true);
    }
  });

  it('keeps all 2,320 card IDs separate while intentionally sharing real object illustrations', () => {
    expect(allCards).toHaveLength(2320);
    expect(new Set(allCards.map(card => card.id)).size).toBe(2320);
    const illustrations = new Set(allCards.map(card => card.art));
    expect(illustrations.size).toBeGreaterThanOrEqual(150);
    expect([...illustrations].sort()).toEqual(Object.keys(BAKER_ART_SUBJECTS).sort());
    const illustratedNames = new Map<string, string>();
    for (const card of allCards) {
      const previousArt = illustratedNames.get(card.name);
      if (previousArt) expect(card.art).toBe(previousArt);
      illustratedNames.set(card.name, card.art);
    }
    // Every era also has a substantial set of its own explicitly written subjects.
    for (const era of eras) {
      const otherNames = new Set(allCards.filter(card => card.era !== era).map(card => card.name));
      expect([...BAKER_DECKS[era].means, ...BAKER_DECKS[era].clues].filter(card => !otherNames.has(card.name)).length).toBeGreaterThanOrEqual(200);
    }
  });

  it('keeps modern electronics and disposable medical imagery out of historical decks', () => {
    const modernOnly = new Set(['phone', 'laptop', 'usb', 'keyboard', 'headphones', 'access-card', 'sim-card', 'cctv', 'drone', 'scooter', 'remote', 'plug', 'syringe', 'plasticbag', 'mask', 'spray-can', 'fire-extinguisher', 'car']);
    for (const era of ['industrial', 'victorian', 'wartime'] as const) {
      expect([...BAKER_DECKS[era].means, ...BAKER_DECKS[era].clues].filter(card => modernOnly.has(card.art))).toEqual([]);
    }
    const industrial = [...BAKER_DECKS.industrial.means, ...BAKER_DECKS.industrial.clues];
    expect(industrial.some(card => card.art === 'flintlock')).toBe(true);
    expect(industrial.some(card => ['pistol', 'radio', 'telephone', 'film', 'camera', 'gas-mask'].includes(card.art))).toBe(false);
    expect(BAKER_DECKS.wartime.means.some(card => card.art === 'wartime-truck')).toBe(true);
    expect(BAKER_DECKS.modern.means.some(card => card.art === 'car')).toBe(true);
    expect(BAKER_DECKS.modern.clues.some(card => card.art === 'phone')).toBe(true);
  });

  it('describes the selected eras and keeps 2026 modern rather than speculative', () => {
    expect(eras).toEqual(['industrial', 'victorian', 'wartime', 'modern']);
    expect(BAKER_ERAS.industrial).toMatchObject({ minYear: 1760, maxYear: 1836, defaultYear: 1800 });
    expect(BAKER_ERAS.victorian).toMatchObject({ minYear: 1837, maxYear: 1901, defaultYear: 1890 });
    expect(BAKER_ERAS.wartime).toMatchObject({ minYear: 1914, maxYear: 1945, defaultYear: 1939 });
    expect(BAKER_ERAS.modern).toMatchObject({ minYear: 2026, maxYear: 2026, defaultYear: 2026 });
    expect([...BAKER_DECKS.modern.means, ...BAKER_DECKS.modern.clues].map(card => card.name).join('|')).not.toMatch(/雷射槍|傳送門|反重力|讀心機|時間機器/);
  });
});

describe('Baker Street scene boards and identity inventory', () => {
  it('supplies 52 six-option forensic boards and exactly 12 optional original events', () => {
    expect(BAKER_SCENES).toHaveLength(64);
    expect(new Set(BAKER_SCENES.map(scene => scene.id)).size).toBe(64);
    expect(new Set(BAKER_SCENES.map(scene => scene.name)).size).toBe(64);
    expect(BAKER_SCENES.filter(scene => scene.kind === 'cause')).toHaveLength(1);
    expect(BAKER_SCENES.filter(scene => scene.kind === 'location')).toHaveLength(4);
    expect(BAKER_SCENES.filter(scene => scene.kind === 'scene')).toHaveLength(47);
    const effects = new Map<string, number>();
    for (const scene of BAKER_SCENES) {
      if (scene.kind === 'special') {
        expect(scene.options).toHaveLength(0);
        expect(scene.description!.length).toBeGreaterThan(20);
        expect(scene.effect).toBeDefined();
        effects.set(scene.effect!, (effects.get(scene.effect!) ?? 0) + 1);
      } else {
        expect(scene.effect).toBeUndefined();
        for (const era of eras) {
          const options = sceneOptions(scene, era);
          expect(options).toHaveLength(6);
          expect(new Set(options).size).toBe(6);
          expect(options.every(option => typeof option === 'string' && option.length > 0)).toBe(true);
        }
      }
    }
    expect(Object.fromEntries(effects)).toEqual({
      'additional-mark': 2, 'replace-scene': 2, 'retrace-mark': 2,
      'exclude-means': 2, 'exclude-clue': 2, 'restore-badge': 2,
    });
  });

  it('changes location vocabulary for the selected era without putting modern places into old London', () => {
    const locations = BAKER_SCENES.filter(scene => scene.kind === 'location');
    const industrial = locations.flatMap(scene => sceneOptions(scene, 'industrial')).join('|');
    const modern = locations.flatMap(scene => sceneOptions(scene, 'modern')).join('|');
    expect(industrial).toContain('運河碼頭');
    expect(industrial).toContain('客運驛站');
    expect(industrial).not.toMatch(/地鐵|停車場|醫療中心|設備機房|辦公大樓/);
    expect(modern).toContain('地鐵站');
    expect(modern).toContain('物流倉庫');
    expect(modern).not.toMatch(/馬廄|紡織工場|客運驛站/);
  });

  it('has the twelve-card base identity set, six prepared portraits and a non-player Moriarty', () => {
    const active = BAKER_ROLE_CATALOG.filter(role => role.playable);
    expect(active.map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 'holmes', count: 1 }, { id: 'watson', count: 1 }, { id: 'police', count: 8 }, { id: 'murderer', count: 1 }, { id: 'accomplice', count: 1 },
    ]);
    expect(active.reduce((count, role) => count + role.count, 0)).toBe(12);
    expect(BAKER_ROLE_CATALOG.filter(role => role.faction === 'reserve').map(role => role.id)).toEqual(['mary', 'irene', 'mycroft', 'lestrade', 'gregson', 'hopkins']);
    expect(BAKER_ROLE_CATALOG.filter(role => !role.playable).every(role => role.count === 0)).toBe(true);
    expect(BAKER_ROLE_CATALOG.find(role => role.id === 'moriarty')).toMatchObject({ faction: 'story', playable: false, count: 0 });
    expect(BAKER_ROLE_CATALOG.find(role => role.id === 'watson')!.description).toContain('無法區分');
    expect(BAKER_ROLE_CATALOG.find(role => role.id === 'watson')!.description).toContain('不知道作案手段');
  });
});
