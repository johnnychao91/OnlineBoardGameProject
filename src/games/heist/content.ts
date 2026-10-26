/** Incan Gold 2018+/2024 base-game numbers, presented as an original stage heist. */
export const HEIST_ROUND_COUNT = 5;
export const HEIST_LOOT_VALUES = [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17] as const;
export const HEIST_HAZARDS = {
  camera: { name: '監視鏡頭', description: '鏡頭再次捕捉到你們，仍在金庫中的人丟失本幕攜帶的全部贓物。' },
  laser: { name: '雷射網', description: '第二道同類雷射網封住去路，仍在金庫中的人丟失本幕攜帶的全部贓物。' },
  patrol: { name: '巡邏保全', description: '第二批保全包圍金庫，仍在金庫中的人丟失本幕攜帶的全部贓物。' },
  lockdown: { name: '封鎖閘門', description: '同類閘門再次落下，仍在金庫中的人丟失本幕攜帶的全部贓物。' },
  alarm: { name: '感應警報', description: '同類警報第二次響起，仍在金庫中的人丟失本幕攜帶的全部贓物。' },
} as const;
export type HeistHazard = keyof typeof HEIST_HAZARDS;
export const HEIST_HAZARD_IDS = Object.keys(HEIST_HAZARDS) as HeistHazard[];
export const HEIST_ARTIFACTS = {
  'sapphire-eye': { name: '藍寶石之眼', value: 5, round: 1 },
  'moon-watch': { name: '月相懷錶', value: 7, round: 2 },
  'ruby-mask': { name: '緋紅假面', value: 8, round: 3 },
  'glass-crown': { name: '水晶王冠', value: 10, round: 4 },
  'prism-heart': { name: '稜鏡之心', value: 12, round: 5 },
} as const;
export type HeistArtifact = keyof typeof HEIST_ARTIFACTS;
export const HEIST_ARTIFACT_IDS = Object.keys(HEIST_ARTIFACTS) as HeistArtifact[];
export type HeistCard = { kind: 'loot'; value: number } | { kind: 'hazard'; hazard: HeistHazard } | { kind: 'artifact'; artifact: HeistArtifact };
export const createHeistBaseDeck = (): HeistCard[] => [
  ...HEIST_LOOT_VALUES.map(value => ({ kind: 'loot' as const, value })),
  ...HEIST_HAZARD_IDS.flatMap(hazard => Array.from({ length: 3 }, () => ({ kind: 'hazard' as const, hazard }))),
];
export const HEIST_RULE_SOURCES = {
  publisher: 'https://www.eagle-gryphon.com/products/incan-gold-2024',
  rules: 'https://drive.google.com/file/d/1g9iStN6y5m0VZFrQFYN3a2RFztps4W6s/view',
  previousRules: 'https://drive.google.com/file/d/1dUqSh-rCYACXEGvL4Hn-wKSthLfwzzks/view',
  designer: 'https://faidutti.com/blog/blog/2018/10/29/incan-gold-new-edition/',
} as const;
