import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOON_OPTIONS, MOON_PRESETS, MOON_ROLES, isMoonWolf, moonConfiguration,
  moonCountsFromDeck, moonNightSteps, moonRoleCounts, moonRoleDeck, normalizeMoonOptions,
  validateMoonOptions, type MoonRole,
} from './rules';

// Acceptance matrix comes from the requested compositions, independent of deck ordering.
const compositions: [string, number, Partial<Record<MoonRole, number>>, number[]][] = [
  ['six-open', 6, { wolf: 2, seer: 1, hunter: 1, villager: 2 }, [1, 2]],
  ['six-hidden', 6, { wolf: 2, seer: 1, guard: 1, villager: 2 }, [0, 1, 2]],
  ['six-witch', 6, { wolf: 2, seer: 1, witch: 1, villager: 2 }, [1, 2, 3]],
  ['six-simple', 6, { wolf: 2, seer: 1, villager: 3 }, [1, 2]],
  ['six-hunters', 6, { wolf: 2, hunter: 4 }, [1]],
  ['six-idiot', 6, { wolf: 2, seer: 1, idiot: 1, villager: 2 }, [1, 2]],
  ['six-wolf-king', 6, { wolf: 1, 'wolf-king': 1, seer: 1, witch: 1, hunter: 1, villager: 1 }, [1, 2, 3]],
  ['six-ghost-rider', 6, { wolf: 1, 'ghost-rider': 1, seer: 1, witch: 1, hunter: 1, villager: 1 }, [1, 2, 3]],
  ['six-gods', 6, { 'wolf-king': 1, 'ghost-rider': 1, seer: 1, witch: 1, hunter: 1, idiot: 1 }, [1, 2, 3]],
  ['seven-witch', 7, { wolf: 2, seer: 1, witch: 1, villager: 3 }, [1, 2, 3]],
  ['seven-guard', 7, { wolf: 2, seer: 1, guard: 1, villager: 3 }, [0, 1, 2]],
  ['seven-three-gods', 7, { wolf: 2, seer: 1, witch: 1, hunter: 1, villager: 2 }, [1, 2, 3]],
  ['seven-survivor', 7, { wolf: 1, 'white-wolf-king': 1, seer: 1, witch: 1, hunter: 1, guard: 1, villager: 1 }, [0, 1, 2, 3]],
  ['seven-idiot', 7, { wolf: 2, seer: 1, witch: 1, idiot: 1, villager: 2 }, [1, 2, 3]],
  ['seven-wolf-king', 7, { wolf: 1, 'wolf-king': 1, seer: 1, witch: 1, hunter: 1, villager: 2 }, [1, 2, 3]],
  ['seven-ghost-rider', 7, { wolf: 1, 'ghost-rider': 1, seer: 1, witch: 1, hunter: 1, guard: 1, villager: 1 }, [0, 1, 2, 3]],
  ['seven-king-idiot', 7, { wolf: 1, 'wolf-king': 1, seer: 1, witch: 1, idiot: 1, villager: 2 }, [1, 2, 3]],
  ['seven-ghost-idiot', 7, { wolf: 1, 'ghost-rider': 1, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 1 }, [1, 2, 3]],
  ['seven-gods', 7, { 'wolf-king': 1, 'ghost-rider': 1, seer: 1, witch: 1, hunter: 1, guard: 1, idiot: 1 }, [0, 1, 2, 3]],
  ['eight-ragnarok', 8, { 'wolf-king': 1, 'white-wolf-king': 1, 'ghost-rider': 1, seer: 1, witch: 1, hunter: 1, guard: 1, idiot: 1 }, [0, 1, 2, 3]],
];

describe('銀月列車公開配置', () => {
  it('有 20 個獨立配置與原本經典配置，ID 唯一且不接受任意配置', () => {
    expect(MOON_PRESETS).toHaveLength(21);
    expect(new Set(MOON_PRESETS.map(p => p.id)).size).toBe(21);
    expect(MOON_PRESETS.filter(p => p.count === 6)).toHaveLength(9);
    expect(MOON_PRESETS.filter(p => p.count === 7)).toHaveLength(10);
    expect(MOON_PRESETS.filter(p => p.count === 8)).toHaveLength(1);
    expect(MOON_PRESETS.filter(p => p.count === null).map(p => p.id)).toEqual(['classic']);
    expect(compositions.map(c => c[0]).sort()).toEqual(MOON_PRESETS.filter(p => p.id !== 'classic').map(p => p.id).sort());
    for (const value of ['', 'unknown', '__proto__', 'toString', null, 6, [], {}]) {
      expect(() => normalizeMoonOptions({ presetId: value })).toThrow();
    }
    for (const value of ['unknown', null, true, {}, 1]) expect(() => normalizeMoonOptions({ doubleProtection: value })).toThrow();
    expect(() => normalizeMoonOptions({ roles: ['wolf'], victory: 'city' })).toThrow();
  });

  it.each(compositions)('%s 的角色、人數、夜序及人數驗證符合配置', (presetId, count, expected, steps) => {
    const options = normalizeMoonOptions({ presetId });
    const configuration = moonConfiguration(count, options);
    const expectedCounts = Object.fromEntries(Object.keys(MOON_ROLES).map(role => [role, expected[role as MoonRole] ?? 0]));
    expect(configuration.roles).toHaveLength(count);
    expect(moonCountsFromDeck(configuration.roles)).toEqual(expectedCounts);
    expect(moonRoleCounts(count, options)).toEqual(expectedCounts);
    expect(moonNightSteps(count, 3, configuration)).toEqual(steps);
    expect(configuration.roles.filter(isMoonWolf)).toHaveLength(count === 8 ? 3 : 2);
    expect(validateMoonOptions(options, count)).toBeUndefined();
    expect(validateMoonOptions(options, count === 6 ? 7 : 6)).toContain(`需要 ${count}`);
    expect(() => moonRoleDeck(count === 6 ? 7 : 6, options)).toThrow();
    expect(configuration.victory).toBe(presetId === 'seven-survivor' ? 'edge' : 'city');
    expect(configuration.doubleProtectionKills).toBe(true);
    expect(configuration.allowWolfSelfAttack).toBe(true);
    expect(configuration.allowWolfExplosion).toBe(true);
  });

  it('只有指定明牌、首夜無刀與強制開槍配置啟用該規則', () => {
    const enabled = (key: 'revealOnDeath' | 'firstNightPeace' | 'forcedHunter') => MOON_PRESETS.filter(p => p[key]).map(p => p.id);
    expect(enabled('revealOnDeath')).toEqual(['six-open', 'six-hunters', 'six-gods', 'seven-gods', 'eight-ragnarok']);
    expect(enabled('firstNightPeace')).toEqual(['six-simple', 'six-hunters', 'six-ghost-rider', 'six-gods']);
    expect(enabled('forcedHunter')).toEqual(['six-hunters']);
    for (const p of MOON_PRESETS) {
      if (p.count === null) continue;
      const options = normalizeMoonOptions({ presetId: p.id, sheriff: true });
      expect(validateMoonOptions(options, p.count)).toBe(p.sheriffAllowed ? undefined : `${p.name}固定不啟用警長。`);
    }
    expect(MOON_PRESETS.filter(p => !p.sheriffAllowed).map(p => p.id)).toEqual(['seven-survivor', 'eight-ragnarok']);
    const edge = MOON_PRESETS.filter(p => p.victory === 'edge');
    expect(edge).toHaveLength(1);
    expect(edge[0].roles).toContain('villager');
    expect(edge[0].roles.some(role => !isMoonWolf(role) && role !== 'villager')).toBe(true);
  });

  it('經典呼叫與缺少新欄位的存檔保留舊規則，舊時段版本不讀新配置', () => {
    const legacy = { mode: 'online' as const, sheriff: false, speechSeconds: 60, nightSeconds: 30, voteSeconds: 30 };
    expect(normalizeMoonOptions(legacy)).toEqual(DEFAULT_MOON_OPTIONS);
    for (let count = 6; count <= 12; count += 1) {
      const configuration = moonConfiguration(count, legacy);
      expect(moonRoleDeck(count)).toEqual(configuration.roles);
      expect(configuration.victory).toBe('parity');
      expect(configuration.doubleProtectionKills).toBe(false);
      expect(configuration.allowWolfSelfAttack).toBe(false);
      expect(configuration.allowWolfExplosion).toBe(false);
      expect(configuration.roles.filter(isMoonWolf)).toHaveLength(count === 12 ? 4 : count >= 9 ? 3 : 2);
      expect(configuration.roles.includes('guard')).toBe(count === 8 || count >= 10);
      expect(configuration.roles.includes('hunter')).toBe(count >= 7);
      expect(moonNightSteps(count, 1)).toEqual([0, 1, 2, 3]);
    }
    const hunters = moonConfiguration(6, normalizeMoonOptions({ presetId: 'six-hunters' }));
    expect(moonNightSteps(6, 1, hunters)).toEqual([0, 1, 2, 3]);
    expect(moonNightSteps(6, 2, hunters)).toEqual([1, 2, 3]);
  });

  it('同守同救選項明確覆寫預設，配置快照與牌組彼此獨立', () => {
    for (const presetId of ['classic', 'seven-survivor']) {
      const count = presetId === 'classic' ? 6 : 7;
      expect(moonConfiguration(count, normalizeMoonOptions({ presetId, doubleProtection: 'survive' })).doubleProtectionKills).toBe(false);
      expect(moonConfiguration(count, normalizeMoonOptions({ presetId, doubleProtection: 'die' })).doubleProtectionKills).toBe(true);
    }
    const options = normalizeMoonOptions({ presetId: 'six-open' });
    const first = moonConfiguration(6, options);
    first.roles[0] = 'villager';
    first.victory = 'parity';
    const next = moonConfiguration(6, options);
    expect(next.roles[0]).toBe('wolf');
    expect(next.victory).toBe('city');
    expect(MOON_PRESETS.find(p => p.id === 'six-open')!.roles[0]).toBe('wolf');
    expect(moonRoleDeck(6, options)).not.toBe(next.roles);
  });
});
