/** Mascarade, 2021 edition (17 masks / 16 powers), with original yokai names.
 * Rules: https://www.rprod.com/en/games/mascarade
 * Official scenarios: EN/03_CONTENT/_RULES/MAS_EN02_Scenario_Sheets.pdf in
 * https://cdn.svc.asmodee.net/production-rprod/storage/downloads/games/mascarade-v2/masc-press-en-1628086915Vlehk.zip
 * The English and French rules agree that Trickster excludes its owner.
 */
export const BANQUET_ROLES = {
  empress: { name: '玉藻前', referenceName: '女皇', englishName: 'Empress', minPlayers: 4, producesCoins: true, count: 1, description: '從金庫取得 3 枚妖金。' },
  king: { name: '酒吞童子', referenceName: '國王', englishName: 'King', minPlayers: 4, producesCoins: true, count: 1, description: '從金庫取得 2 枚妖金。' },
  judge: { name: '閻魔', referenceName: '法官', englishName: 'Judge', minPlayers: 4, producesCoins: false, count: 1, description: '收取裁決堂現有的全部妖金。本次錯誤認領的罰款在能力後才繳入。' },
  guru: { name: '白澤', referenceName: '宗師', englishName: 'Guru', minPlayers: 8, producesCoins: false, count: 1, description: '選另一位賓客猜自己的面具，再公開驗證。猜錯者交給你 4 枚妖金；不足則交出全部。' },
  beggar: { name: '垢嘗', referenceName: '乞丐', englishName: 'Beggar', minPlayers: 4, producesCoins: false, count: 1, description: '由左鄰起依座次逐一比較財富。當下妖金比你多的人，交給你 1 枚。' },
  patron: { name: '招財貓', referenceName: '資助者', englishName: 'Patron', minPlayers: 6, producesCoins: true, count: 1, description: '你從金庫取得 3 枚妖金，左右鄰各取得 1 枚。' },
  cheater: { name: '天邪鬼', referenceName: '騙徒', englishName: 'Cheater', minPlayers: 4, producesCoins: false, count: 1, description: '能力生效時若已有至少 10 枚妖金，立即獲勝。僅持有面具不會自動獲勝。' },
  fool: { name: '唐傘小僧', referenceName: '弄臣', englishName: 'Fool', minPlayers: 4, producesCoins: true, count: 1, description: '從金庫取得 1 枚妖金，再選其他兩位賓客，盲換或假換他們的面具。' },
  widow: { name: '雪女', referenceName: '寡婦', englishName: 'Widow', minPlayers: 4, producesCoins: true, count: 1, description: '從金庫補足到 10 枚妖金；已有 10 枚或更多時，財富不變。' },
  spy: { name: '百目鬼', referenceName: '間諜', englishName: 'Spy', minPlayers: 6, producesCoins: false, count: 1, description: '選另一位賓客，私下查看自己和對方的面具，再決定交換或假換。' },
  puppeteer: { name: '絡新婦', referenceName: '操偶師', englishName: 'Puppeteer', minPlayers: 6, producesCoins: false, count: 1, description: '選其他兩位賓客，各向你交 1 枚妖金，再交換座位。面具與剩餘財富留在原位。' },
  princess: { name: '青行燈', referenceName: '公主', englishName: 'Princess', minPlayers: 6, producesCoins: true, count: 1, description: '從金庫取得 2 枚妖金，再選另一位賓客亮出面具，讓除了他本人之外的所有人看見。' },
  sorceress: { name: '山姥', referenceName: '女巫', englishName: 'Sorceress', minPlayers: 4, producesCoins: false, count: 1, description: '可以與另一位賓客交換全部財富，也可以不換。本次認領罰款在能力後才繳納。' },
  peasant: { name: '小豆洗', referenceName: '農民', englishName: 'Peasant', minPlayers: 8, producesCoins: true, count: 2, description: '從金庫取得 1 枚妖金。若本次認領揭出兩張小豆洗，兩位持有者各取得 2 枚。' },
  thief: { name: '煙煙羅', referenceName: '小偷', englishName: 'Thief', minPlayers: 4, producesCoins: false, count: 1, description: '左右鄰各交給你 1 枚妖金。' },
  trickster: { name: '河童', referenceName: '魔術師', englishName: 'Trickster', minPlayers: 4, producesCoins: false, count: 1, description: '向其他賓客中最富有的一人收取 2 枚妖金；並列時由你選擇一人。' },
} as const;
export type BanquetRole = keyof typeof BANQUET_ROLES;
export const BANQUET_ROLE_IDS = Object.keys(BANQUET_ROLES) as BanquetRole[];
export type BanquetScenario = 'A' | 'B' | 'custom';
type Preset = Record<'A' | 'B', BanquetRole[]>;
const small: Preset = {
  A: ['cheater', 'empress', 'judge', 'king', 'thief', 'trickster'],
  B: ['beggar', 'empress', 'fool', 'judge', 'sorceress', 'widow'],
};
export const BANQUET_PRESETS: Record<number, Preset> = {
  4: small, 5: { A: [...small.A], B: [...small.B] },
  6: {
    A: ['cheater', 'judge', 'patron', 'princess', 'sorceress', 'trickster'],
    B: ['beggar', 'empress', 'judge', 'king', 'thief', 'widow'],
  },
  7: {
    A: ['empress', 'fool', 'judge', 'patron', 'sorceress', 'thief', 'trickster'],
    B: ['beggar', 'cheater', 'judge', 'king', 'princess', 'trickster', 'widow'],
  },
  8: {
    A: ['cheater', 'judge', 'king', 'princess', 'sorceress', 'spy', 'thief', 'trickster'],
    B: ['beggar', 'judge', 'peasant', 'peasant', 'princess', 'puppeteer', 'trickster', 'widow'],
  },
  9: {
    A: ['cheater', 'empress', 'judge', 'patron', 'princess', 'sorceress', 'spy', 'thief', 'trickster'],
    B: ['beggar', 'guru', 'judge', 'patron', 'peasant', 'peasant', 'princess', 'puppeteer', 'widow'],
  },
  10: {
    A: ['cheater', 'empress', 'judge', 'patron', 'princess', 'sorceress', 'spy', 'thief', 'trickster', 'widow'],
    B: ['beggar', 'guru', 'judge', 'patron', 'peasant', 'peasant', 'princess', 'sorceress', 'trickster', 'widow'],
  },
  11: {
    A: ['empress', 'fool', 'judge', 'patron', 'peasant', 'peasant', 'princess', 'puppeteer', 'sorceress', 'thief', 'trickster'],
    B: ['cheater', 'guru', 'judge', 'patron', 'peasant', 'peasant', 'princess', 'puppeteer', 'sorceress', 'spy', 'trickster'],
  },
  12: {
    A: ['beggar', 'cheater', 'fool', 'guru', 'judge', 'patron', 'peasant', 'peasant', 'princess', 'sorceress', 'trickster', 'widow'],
    B: ['cheater', 'empress', 'guru', 'judge', 'patron', 'peasant', 'peasant', 'princess', 'puppeteer', 'sorceress', 'spy', 'trickster'],
  },
};
export const BANQUET_RULE_SOURCES = {
  rules: 'https://cdn.svc.asmodee.net/production-rprod/storage/games/mascarade-v2/mas-en02-rules-1626341519Kzvpd.pdf',
  playerAid: 'https://cdn.svc.asmodee.net/production-rprod/storage/games/mascarade-v2/mas-en02-player-aid-1626341517GKfE8.pdf',
  scenarios: 'https://cdn.svc.asmodee.net/production-rprod/storage/downloads/games/mascarade-v2/masc-press-en-1628086915Vlehk.zip',
} as const;

