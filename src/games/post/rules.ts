import { isPlayerSeatID } from '../catalog';

export type MailMode = 'classic' | 'premium' | 'black-letter';
export interface MailOptions { mode: MailMode | 'auto'; directorID: string | 'random' }
export const DEFAULT_MAIL_OPTIONS: MailOptions = { mode: 'auto', directorID: 'random' };
export const MAIL_MODES: Record<MailMode, { name: string; minPlayers: number; maxPlayers: number; description: string }> = {
  classic: { name: '密函投遞', minPlayers: 3, maxPlayers: 4, description: '16 張密函，輪流抽一張、打一張，在查驗、護送與調包之間爭取收件人的信任。' },
  premium: { name: '全城夜遞', minPlayers: 5, maxPlayers: 8, description: '32 張密函與額外人物；預測、反制、指定轉遞及額外郵戳讓全城信使一起交鋒。' },
  'black-letter': { name: '黑函局長', minPlayers: 2, maxPlayers: 6, description: '一位黑函局長對抗其餘午夜信使。信使共享生命，局長以兩張手牌蒐集六封印。' },
};
export const MAIL_CLASSIC_ROLES = ['guard', 'priest', 'baron', 'handmaid', 'prince', 'king', 'countess', 'princess'] as const;
export type MailRole = typeof MAIL_CLASSIC_ROLES[number] | 'assassin' | 'jester' | 'cardinal' | 'baroness' | 'sycophant'
  | 'count' | 'constable' | 'dowager' | 'bishop' | 'courier-1' | 'courier-2' | 'courier-3' | 'courier-4' | 'courier-5' | 'courier-6'
  | 'director-1' | 'director-2' | 'director-3' | 'director-4' | 'director-5' | 'director' | 'seal-1' | 'seal-2' | 'seal-3' | 'seal-4' | 'seal-5' | 'seal-6';
export interface MailCardDefinition {
  name: string; value: number; description: string; deck: 'letter' | 'courier' | 'director';
  count: number; classicCount?: number; artRole?: string; seal?: boolean;
}
export const MAIL_CARDS: Record<MailRole, MailCardDefinition> = {
  guard: { name: '巡街郵差', value: 1, deck: 'letter', count: 8, classicCount: 5, description: '指定另一位可選信使並猜一個非 1 數字；猜中使對方退出本輪。' },
  priest: { name: '讀信師', value: 2, deck: 'letter', count: 2, classicCount: 2, description: '私下查看另一位可選信使的手牌，不向其他人公開。' },
  baron: { name: '封緘審官', value: 3, deck: 'letter', count: 2, classicCount: 2, description: '與另一位可選信使私下比牌，數字較小者退出本輪；相同則無事發生。' },
  handmaid: { name: '守燈人', value: 4, deck: 'letter', count: 2, classicCount: 2, description: '直到自己下回合開始，其他人的卡牌效果不能選擇你。' },
  prince: { name: '轉遞專員', value: 5, deck: 'letter', count: 2, classicCount: 2, description: '指定一位可選信使（可以是自己）棄掉手牌，再補一張；棄掉零號收件人仍會退出本輪。' },
  king: { name: '換袋總管', value: 6, deck: 'letter', count: 1, classicCount: 1, description: '與另一位可選信使交換手牌。' },
  countess: { name: '緘默夫人', value: 7, deck: 'letter', count: 1, classicCount: 1, description: '沒有打出效果；若另一張是轉遞專員或換袋總管，必須打出本牌。' },
  princess: { name: '零號收件人', value: 8, deck: 'letter', count: 1, classicCount: 1, description: '只要因任何原因打出或棄掉本牌，就退出本輪。' },
  assassin: { name: '斷郵客', value: 0, deck: 'letter', count: 1, description: '手持本牌被巡街郵差指認時，無論猜什麼都反制使郵差的玩家退出；公開棄掉本牌再補一張。主動打出沒有作用。' },
  jester: { name: '夜鈴小丑', value: 0, deck: 'letter', count: 1, description: '預測另一位可選信使；如果對方贏得本輪，你也獲得一枚信任郵戳。' },
  cardinal: { name: '紅印主事', value: 2, deck: 'letter', count: 2, description: '選擇兩位可選信使交換手牌，可以包括自己；交換後可私下查看其中一張。' },
  baroness: { name: '雙窗窺信人', value: 3, deck: 'letter', count: 2, description: '私下查看另外一位或兩位可選信使的手牌。' },
  sycophant: { name: '引路掮客', value: 4, deck: 'letter', count: 2, description: '指定一位可選信使（可以是自己）；下一張打出的牌若需選人，選擇中必須包含此人，無合法選擇時效果落空。' },
  count: { name: '集郵伯爵', value: 5, deck: 'letter', count: 2, description: '輪末比牌時，每張已棄置的集郵伯爵讓你的手牌比較值加 1；不影響其他比牌效果。' },
  constable: { name: '夜巡督察', value: 6, deck: 'letter', count: 1, description: '本牌已在自己的棄牌區時，若自己退出本輪，獲得一枚信任郵戳。' },
  dowager: { name: '霧巷遺孀', value: 7, deck: 'letter', count: 1, description: '與另一位可選信使私下比牌，數字較大者退出本輪；相同則無事發生。' },
  bishop: { name: '終宵大主事', value: 9, deck: 'letter', count: 1, description: '猜另一位可選信使的手牌數字；猜中獲一枚信任郵戳，對方可選擇棄牌補牌。輪末若仍有零號收件人，本牌不列入勝者候選；否則依 9 加集郵伯爵加成比較（網站判定）。' },
  'courier-1': { name: '巡街郵差', artRole: 'guard', value: 1, deck: 'courier', count: 3, description: '猜一個 1～7 的數字；局長手中若有該數字，擊退其中一張，使局長失去 1 點生命。' },
  'courier-2': { name: '讀信師', artRole: 'priest', value: 2, deck: 'courier', count: 3, description: '選擇另一位信使，由對方私下查看局長隨機一張手牌；雙人局由自己查看。' },
  'courier-3': { name: '封緘審官', artRole: 'baron', value: 3, deck: 'courier', count: 3, description: '可以與局長對決；使用自己的手牌，對上局長隨機一張手牌。' },
  'courier-4': { name: '守燈人', artRole: 'handmaid', value: 4, deck: 'courier', count: 3, description: '讓自己或另一位信使獲得 1 枚火漆力量。' },
  'courier-5': { name: '轉遞專員', artRole: 'prince', value: 5, deck: 'courier', count: 2, description: '私下查看信使牌堆頂三張，依自己決定的順序放回。需要時先重洗公開棄牌補足。' },
  'courier-6': { name: '換袋總管', artRole: 'king', value: 6, deck: 'courier', count: 2, description: '選擇自己或另一位信使，由被選者決定是否與局長對決。' },
  'director-1': { name: '斷郵客', artRole: 'assassin', value: 1, deck: 'director', count: 2, description: '選擇一位信使並猜數字，猜中擊退該手牌。' },
  'director-2': { name: '夜巡督察', artRole: 'constable', value: 2, deck: 'director', count: 1, description: '選擇一位信使；若對方手牌為 3 或以下，就擊退該牌。' },
  'director-3': { name: '霧巷遺孀', artRole: 'dowager', value: 3, deck: 'director', count: 1, description: '可以選擇一位信使對決，局長自行選擇使用哪張保留手牌。' },
  'director-4': { name: '集郵伯爵', artRole: 'count', value: 4, deck: 'director', count: 1, description: '獲得 1 枚火漆力量。' },
  'director-5': { name: '紅印主事', artRole: 'cardinal', value: 5, deck: 'director', count: 1, description: '抽 1 張局長牌，再將手中 1 張放到牌堆底。牌堆空時不抽也不放回。' },
  director: { name: '黑函局長', value: 7, deck: 'director', count: 1, description: '不能主動打出；被擊退時先補牌，再把本牌洗回局長牌堆。' },
  'seal-1': { name: '覘心封印', value: 1, deck: 'director', count: 1, seal: true, description: '猜一個數字，所有持有該數字的信使各被擊退一張。被擊退時先補牌，再將封印洗回。' },
  'seal-2': { name: '攝魂封印', value: 2, deck: 'director', count: 1, seal: true, description: '選擇一位信使，若對方手牌為 3 或以上，就擊退該牌。被擊退時先補牌，再將封印洗回。' },
  'seal-3': { name: '折界封印', value: 3, deck: 'director', count: 1, seal: true, description: '可依序與最多兩位不同信使對決；雙人局可連續對決同一人。被擊退時先補牌，再將封印洗回。' },
  'seal-4': { name: '巨力封印', value: 4, deck: 'director', count: 1, seal: true, description: '獲得 3 枚火漆力量。被擊退時先補牌，再將封印洗回。' },
  'seal-5': { name: '幻真封印', value: 5, deck: 'director', count: 1, seal: true, description: '最多抽 2 張局長牌，再將相同張數的手牌按自選順序放回牌堆底；全部完成後才能宣告六封印。' },
  'seal-6': { name: '逆時封印', value: 6, deck: 'director', count: 1, seal: true, description: '複製自己公開棄牌區另一張局長牌的效果。被擊退時先補牌，再將封印洗回。' },
};
export const cardDefinitions = MAIL_CARDS;

export function normalizeMailOptions(input: unknown): MailOptions {
  if (input === undefined) return { ...DEFAULT_MAIL_OPTIONS };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('午夜郵局設定格式不正確。');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !Object.hasOwn(DEFAULT_MAIL_OPTIONS, key))) throw new Error('午夜郵局設定含有不支援的選項。');
  const mode = data.mode === undefined ? 'auto' : data.mode, directorID = data.directorID === undefined ? 'random' : data.directorID;
  if (mode !== 'auto' && !Object.hasOwn(MAIL_MODES, mode as string)) throw new Error('郵局玩法不正確。');
  if (directorID !== 'random' && !isPlayerSeatID(directorID)) throw new Error('請選擇有效的黑函局長席位或隨機分配。');
  return { mode: mode as MailOptions['mode'], directorID: directorID as string };
}
export function resolveMailMode(options: MailOptions, count: number): MailMode {
  return options.mode === 'auto' ? count === 2 ? 'black-letter' : count <= 4 ? 'classic' : 'premium' : options.mode;
}
export function validateMailOptions(input: unknown, numPlayers?: number, participantIDs?: string[]): string | undefined {
  let options: MailOptions;
  try { options = normalizeMailOptions(input); } catch (error) { return (error as Error).message; }
  if (numPlayers === undefined) return undefined;
  if (!Number.isInteger(numPlayers) || numPlayers < 2 || numPlayers > 8) return '午夜郵局需要 2～8 位玩家。';
  const definition = MAIL_MODES[resolveMailMode(options, numPlayers)];
  if (numPlayers < definition.minPlayers || numPlayers > definition.maxPlayers) return `${definition.name}需要 ${definition.minPlayers}～${definition.maxPlayers} 位玩家。`;
  if (resolveMailMode(options, numPlayers) === 'black-letter' && participantIDs && options.directorID !== 'random' && !participantIDs.includes(options.directorID)) return '黑函局長必須在本局參與名單中。';
  return undefined;
}
export function mailWinningScore(numPlayers: number): number { return numPlayers === 3 ? 5 : 4; }
