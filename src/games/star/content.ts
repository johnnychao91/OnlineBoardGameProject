export const STAR_COLORS = ['white', 'blue', 'green', 'red', 'black'] as const;
export const STAR_TOKENS = [...STAR_COLORS, 'gold'] as const;
export const STAR_TIERS = [1, 2, 3] as const;
export type StarColor = typeof STAR_COLORS[number];
export type StarToken = typeof STAR_TOKENS[number];
export type StarTier = typeof STAR_TIERS[number];
export type StarBonuses = Record<StarColor, number>;
export type StarTokenCounts = Record<StarToken, number>;
export interface StarCard { id: string; tier: StarTier; bonus: StarColor; prestige: number; cost: StarBonuses; variant: 1 | 2; number: number; name: string }
export interface StarGuardian { id: string; name: string; prestige: 3; requirements: StarBonuses }
export const STAR_MATERIALS: Record<StarToken, { name: string; symbol: string }> = {
  white: { name: '月銀', symbol: '☾' }, blue: { name: '星晶', symbol: '✦' }, green: { name: '翠核', symbol: '❖' },
  red: { name: '日焰', symbol: '☀' }, black: { name: '夜鐵', symbol: '⬟' }, gold: { name: '萬用星砂', symbol: '✧' },
};
export const STAR_CRAFT_FAMILIES: Record<StarColor, Record<StarTier, string>> = {
  white: { 1: '月銀透鏡', 2: '月軌儀', 3: '月潮穹頂' }, blue: { 1: '星晶刻針', 2: '星圖投影儀', 3: '群星天球儀' },
  green: { 1: '翠核培育匣', 2: '星藤穹架', 3: '生命星環' }, red: { 1: '日焰熔爐', 2: '耀斑引擎', 3: '恆星鍛造爐' },
  black: { 1: '夜鐵齒輪', 2: '暗軌機構', 3: '引力錨' },
};
export const starEmptyBonuses = (): StarBonuses => ({ white: 0, blue: 0, green: 0, red: 0, black: 0 });
export const starEmptyTokens = (): StarTokenCounts => ({ ...starEmptyBonuses(), gold: 0 });
export const starTokenTotal = (counts: StarTokenCounts) => STAR_TOKENS.reduce((sum, color) => sum + counts[color], 0);

// Numeric inventory only: tier, bonus, family number, prestige, W/B/G/R/K costs.
// All ninety factual tuples were independently cross-checked before retheming.
type CardTuple = readonly [StarTier, StarColor, number, number, number, number, number, number, number];
const CARD_FACTS: readonly CardTuple[] = [
  [1,'black',1,0,1,1,1,1,0],[1,'black',2,0,1,2,1,1,0],[1,'black',3,0,2,2,0,1,0],[1,'black',4,0,0,0,1,3,1],
  [1,'black',5,0,0,0,2,1,0],[1,'black',6,0,2,0,2,0,0],[1,'black',7,0,0,0,3,0,0],[1,'black',8,1,0,4,0,0,0],
  [1,'blue',1,0,1,0,1,1,1],[1,'blue',2,0,1,0,1,2,1],[1,'blue',3,0,1,0,2,2,0],[1,'blue',4,0,0,1,3,1,0],
  [1,'blue',5,0,1,0,0,0,2],[1,'blue',6,0,0,0,2,0,2],[1,'blue',7,0,0,0,0,0,3],[1,'blue',8,1,0,0,0,4,0],
  [1,'white',1,0,0,1,1,1,1],[1,'white',2,0,0,1,2,1,1],[1,'white',3,0,0,2,2,0,1],[1,'white',4,0,3,1,0,0,1],
  [1,'white',5,0,0,0,0,2,1],[1,'white',6,0,0,2,0,0,2],[1,'white',7,0,0,3,0,0,0],[1,'white',8,1,0,0,4,0,0],
  [1,'green',1,0,1,1,0,1,1],[1,'green',2,0,1,1,0,1,2],[1,'green',3,0,0,1,0,2,2],[1,'green',4,0,1,3,1,0,0],
  [1,'green',5,0,2,1,0,0,0],[1,'green',6,0,0,2,0,2,0],[1,'green',7,0,0,0,0,3,0],[1,'green',8,1,0,0,0,0,4],
  [1,'red',1,0,1,1,1,0,1],[1,'red',2,0,2,1,1,0,1],[1,'red',3,0,2,0,1,0,2],[1,'red',4,0,1,0,0,1,3],
  [1,'red',5,0,0,2,1,0,0],[1,'red',6,0,2,0,0,2,0],[1,'red',7,0,3,0,0,0,0],[1,'red',8,1,4,0,0,0,0],
  [2,'black',1,1,3,2,2,0,0],[2,'black',2,1,3,0,3,0,2],[2,'black',3,2,0,1,4,2,0],[2,'black',4,2,0,0,5,3,0],
  [2,'black',5,2,5,0,0,0,0],[2,'black',6,3,0,0,0,0,6],[2,'blue',1,1,0,2,2,3,0],[2,'blue',2,1,0,2,3,0,3],
  [2,'blue',3,2,5,3,0,0,0],[2,'blue',4,2,2,0,0,1,4],[2,'blue',5,2,0,5,0,0,0],[2,'blue',6,3,0,6,0,0,0],
  [2,'white',1,1,0,0,3,2,2],[2,'white',2,1,2,3,0,3,0],[2,'white',3,2,0,0,1,4,2],[2,'white',4,2,0,0,0,5,3],
  [2,'white',5,2,0,0,0,5,0],[2,'white',6,3,6,0,0,0,0],[2,'green',1,1,3,0,2,3,0],[2,'green',2,1,2,3,0,0,2],
  [2,'green',3,2,4,2,0,0,1],[2,'green',4,2,0,5,3,0,0],[2,'green',5,2,0,0,5,0,0],[2,'green',6,3,0,0,6,0,0],
  [2,'red',1,1,2,0,0,2,3],[2,'red',2,1,0,3,0,2,3],[2,'red',3,2,1,4,2,0,0],[2,'red',4,2,3,0,0,0,5],
  [2,'red',5,2,0,0,0,0,5],[2,'red',6,3,0,0,0,6,0],[3,'black',1,3,3,3,5,3,0],[3,'black',2,4,0,0,0,7,0],
  [3,'black',3,4,0,0,3,6,3],[3,'black',4,5,0,0,0,7,3],[3,'blue',1,3,3,0,3,3,5],[3,'blue',2,4,7,0,0,0,0],
  [3,'blue',3,4,6,3,0,0,3],[3,'blue',4,5,7,3,0,0,0],[3,'white',1,3,0,3,3,5,3],[3,'white',2,4,0,0,0,0,7],
  [3,'white',3,4,3,0,0,3,6],[3,'white',4,5,3,0,0,0,7],[3,'green',1,3,5,3,0,3,3],[3,'green',2,4,0,7,0,0,0],
  [3,'green',3,4,3,6,3,0,0],[3,'green',4,5,0,7,3,0,0],[3,'red',1,3,3,5,3,0,3],[3,'red',2,4,0,0,7,0,0],
  [3,'red',3,4,0,3,6,3,0],[3,'red',4,5,0,0,7,3,0],
];
export const STAR_CARD_LIST: readonly StarCard[] = CARD_FACTS.map(([tier, bonus, number, prestige, white, blue, green, red, black]) => ({
  id: `star-${tier}-${bonus}-${number}`, tier, bonus, number, prestige, cost: { white, blue, green, red, black },
  variant: number % 2 === 0 ? 2 : 1, name: `${STAR_CRAFT_FAMILIES[bonus][tier]} ${number} 型`,
}));
export const STAR_CARDS = Object.fromEntries(STAR_CARD_LIST.map(card => [card.id, card])) as Record<string, StarCard>;
const GUARDIAN_FACTS = [
  ['lyra','天琴織夢者',0,0,4,4,0],['cygnus','天鵝巡星者',0,4,4,0,0],['draco','天龍司儀',4,4,0,0,0],
  ['orion','獵戶鑄星師',4,0,0,0,4],['andromeda','仙女引路者',0,0,0,4,4],['pegasus','飛馬航星者',0,3,3,3,0],
  ['phoenix','鳳凰守爐者',3,3,3,0,0],['lupus','天狼巡夜者',3,3,0,0,3],['corona','北冕冠星者',3,0,0,3,3],
  ['aquila','天鷹觀測者',0,0,3,3,3],
] as const;
export const STAR_GUARDIAN_LIST: readonly StarGuardian[] = GUARDIAN_FACTS.map(([id, name, white, blue, green, red, black]) => ({
  id, name, prestige: 3, requirements: { white, blue, green, red, black },
}));
export const STAR_GUARDIANS = Object.fromEntries(STAR_GUARDIAN_LIST.map(guardian => [guardian.id, guardian])) as Record<string, StarGuardian>;
export const starCardName = (card: StarCard | string) => typeof card === 'string' ? STAR_CARDS[card]?.name ?? '未知作品' : card.name;
export const STAR_TARGET_PRESTIGE = 15;
export const STAR_TOKEN_LIMIT = 10;
export const STAR_RESERVE_LIMIT = 3;
export const STAR_RULE_SOURCES = ['https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2022/01/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf'] as const;
