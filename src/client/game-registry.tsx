import type { ComponentType } from 'react';
import { FirewallGame } from '../games/firewall/game';
import { FirewallBoard, FirewallSnapshot } from './FirewallBoard';
import { FirewallRules, FirewallRuleSummary, firewallChapters } from './FirewallRules';
import { createFirewallPoster } from './firewall-poster';
import { firewallSoundAdapter } from './firewall-sounds';
import { HeistGame } from '../games/heist/game';
import { HeistBoard, HeistSnapshot } from './HeistBoard';
import { HeistRules, HeistRuleSummary, heistChapters } from './HeistRules';
import { createHeistPoster } from './heist-poster';
import { heistSoundAdapter } from './heist-sounds';
import { Client } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { StationGame, type StationObserverState } from '../games/station/game';
import { RuleSummary, StationBoard } from './StationBoard';
import { StationSnapshot } from './StationSnapshot';
import type { SnapshotProps, PosterOptions, LobbyOptionsProps } from './game-types';
import { CipherGame, type CipherState } from '../games/cipher/game';
import { CipherBoard, CipherRuleSummary } from './CipherBoard';
import { CipherSnapshot } from './CipherSnapshot';
import { Icon } from './ui';
import { gameCatalog, type GameID } from '../games/catalog';
import { FogGame, type FogState } from '../games/fog/game';
import { FogBoard } from './FogBoard';
import { FogSnapshot } from './FogSnapshot';
import { FogRules } from './FogRules';
import { FogOptions } from './FogOptions';
import { createFogPoster } from './fog-poster';
import { MoonGame, type MoonState } from '../games/moon/game';
import { MoonBoard } from './MoonBoard';
import { MoonSnapshot } from './MoonSnapshot';
import { MoonRules } from './MoonRules';
import { MoonOptions } from './MoonOptions';
import { normalizeMoonOptions, validateMoonOptions } from '../games/moon/rules';
import { createMoonPoster } from './moon-poster';
import { createReplayPoster } from './replay-poster';
import { createCipherPoster } from './cipher-poster';
import { StationRules, CipherRules } from './game-rules';
import type { SoundAdapter } from './sound-cues';
import { isTuringSharedTable, TuringGame, type TuringState } from '../games/turing/game';
import { TuringBoard, TuringRuleSummary } from './TuringBoard';
import { TuringSnapshot } from './TuringSnapshot';
import { TuringOptions } from './TuringOptions';
import { TuringRules } from './TuringRules';
import { validateTuringOptions } from '../games/turing/rules';
import { createTuringPoster } from './turing-poster';
import { MailGame, type MailState } from '../games/post/game';
import { validateMailOptions } from '../games/post/rules';
import { MailBoard } from './MailBoard';
import { MailSnapshot } from './MailSnapshot';
import { MailOptions } from './MailOptions';
import { MailRules, MailRuleSummary, mailChapters } from './MailRules';
import { createMailPoster } from './mail-poster';
import { BakerGame, type BakerState } from '../games/baker/game';
import { validateBakerOptions } from '../games/baker/rules';
import { BakerBoard } from './BakerBoard';
import { BakerSnapshot } from './BakerSnapshot';
import { BakerOptions } from './BakerOptions';
import { BakerRules, BakerRuleSummary, bakerChapters } from './BakerRules';
import { createBakerPoster } from './baker-poster';
import { BanquetGame } from '../games/banquet/game';
import { validateBanquetOptions } from '../games/banquet/rules';
import { BanquetBoard, BanquetSnapshot } from './BanquetBoard';
import { BanquetLobbyOptions } from './BanquetLobbyOptions';
import { BanquetRules, BanquetRuleSummary, banquetChapters } from './BanquetRules';
import { createBanquetPoster } from './banquet-poster';
import { banquetSoundAdapter } from './banquet-sounds';

function ConnectingGame() {
  return <main className="narrow"><section className="panel center" role="status" aria-live="polite"><span className="large-orbit"><Icon type="signal" size={38} /></span><h2>正在連線到遊戲伺服器…</h2><p className="muted">正在同步你的座位與最新對局，請稍候。</p><p className="small muted">若持續停在這裡，請確認網路連線，並請房主檢查遊戲伺服器是否正常運作。保留此頁面，連線恢復後會自動繼續。</p></section></main>;
}

const StationClient = Client({ game: StationGame, board: StationBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const CipherClient = Client({ game: CipherGame, board: CipherBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const FogClient = Client({ game: FogGame, board: FogBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const MoonClient = Client({ game: MoonGame, board: MoonBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const TuringClient = Client({ game: TuringGame, board: TuringBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const MailClient = Client({ game: MailGame, board: MailBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const BakerClient = Client({ game: BakerGame, board: BakerBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const BanquetClient = Client({ game: BanquetGame, board: BanquetBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const HeistClient = Client({ game: HeistGame, board: HeistBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });
const FirewallClient = Client({ game: FirewallGame, board: FirewallBoard, loading: ConnectingGame, multiplayer: SocketIO({ server: typeof window === 'undefined' ? undefined : window.location.origin }), debug: false });

export interface ClientGameDefinition {
  name: string;
  PlayerClient: ComponentType<{ matchID: string; playerID: string; credentials: string }>;
  /** A separate read-only renderer is used for live observation and historical replay. */
  Snapshot: ComponentType<SnapshotProps>;
  Rules?: ComponentType;
  DetailedRules: ComponentType;
  chapters: readonly (readonly [string, string])[];
  /** Every game exposes a public role, equipment or card gallery in its rulebook. */
  gallery: { chapter: string; label: string };
  createPoster: (options: PosterOptions) => Promise<Blob>;
  soundAdapter: SoundAdapter;
  LobbyOptions?: ComponentType<LobbyOptionsProps>;
  validateLobby?: (options: unknown, count: number) => string | undefined;
  lobbyTitle?: string;
  lobbyDescription?: string;
  factionLabels: Record<string, string>;
  reasonLabels: Record<string, string>;
  /** Cooperative games have one player team, including when the mission fails. */
  cooperative?: boolean;
  resultLabels?: Record<string, string>;
  competitionLabels?: { title: string; description: string; roundsLabel: string; roundUnit: string; modes: Record<string, string> };
  individualCompetition?: boolean;
}

/** Add each game's player client, snapshot renderer and statistics labels together. */
export const clientGames: Record<GameID, ClientGameDefinition> & Record<string, ClientGameDefinition> = {
  'firewall-breach': {
    name: gameCatalog['firewall-breach'].name,
    PlayerClient: props => <FirewallClient {...props} />,
    Snapshot: FirewallSnapshot, Rules: FirewallRuleSummary, DetailedRules: FirewallRules,
    chapters: firewallChapters, gallery: { chapter: 'gallery', label: '身分、程式與拓撲圖鑑' },
    createPoster: createFirewallPoster, soundAdapter: firewallSoundAdapter,
    lobbyTitle: '連線通往核心，同行者各有目的。', lobbyDescription: gameCatalog['firewall-breach'].description,
    factionLabels: { hackers: '駭客' }, resultLabels: { wealth: '三輪滲透競賽完成' },
    individualCompetition: true,
    competitionLabels: { title: '滲透競賽紀錄', description: '每位駭客各自累積資產，依人數記錄完成的三輪滲透。', roundsLabel: '平均輪數', roundUnit: '輪', modes: { combined: '基本＋擴充' } },
    reasonLabels: { 'three-rounds': '三輪累積資產結算' },
  },
  'curtain-heist': {
    name: gameCatalog['curtain-heist'].name,
    PlayerClient: props => <HeistClient {...props} />,
    Snapshot: HeistSnapshot, Rules: HeistRuleSummary, DetailedRules: HeistRules,
    chapters: heistChapters, gallery: { chapter: 'gallery', label: '贓物、警戒與珍藏圖鑑' },
    createPoster: createHeistPoster, soundAdapter: heistSoundAdapter,
    lobbyTitle: '掌聲是掩護，分紅才是壓軸。', lobbyDescription: gameCatalog['curtain-heist'].description,
    factionLabels: { illusionists: '幻術師' }, resultLabels: { heist: '五幕劫案競賽完成' },
    individualCompetition: true,
    competitionLabels: { title: '劫案競賽紀錄', description: '每位幻術師各自累積分紅，依人數記錄完成的五幕劫案。', roundsLabel: '平均幕數', roundUnit: '幕', modes: { 'five-acts': '五幕劫案' } },
    reasonLabels: { score: '五幕分紅與珍藏結算' },
  },
  'hundred-ghosts': {
    name: gameCatalog['hundred-ghosts'].name,
    PlayerClient: props => <BanquetClient {...props} />,
    Snapshot: BanquetSnapshot, Rules: BanquetRuleSummary, DetailedRules: BanquetRules, LobbyOptions: BanquetLobbyOptions,
    validateLobby: (options, count) => validateBanquetOptions(options, count >= 4 ? count : undefined),
    chapters: banquetChapters, gallery: { chapter: 'roles', label: '妖怪面具與供奉圖鑑' },
    createPoster: createBanquetPoster, soundAdapter: banquetSoundAdapter,
    lobbyTitle: '夜宴只認面具，不認本人。', lobbyDescription: gameCatalog['hundred-ghosts'].description,
    factionLabels: { guests: '夜宴賓客' }, resultLabels: { wealth: '夜宴財富競賽完成' },
    individualCompetition: true,
    competitionLabels: { title: '夜宴競賽紀錄', description: '每位賓客各自爭取妖金，依場景與人數記錄已完成的夜宴。', roundsLabel: '平均夜宴數', roundUnit: '場', modes: { A: '場景 A', B: '場景 B', custom: '自訂場景' } },
    reasonLabels: { 'thirteen-coins': '累積十三枚妖金', bankruptcy: '有人破產，以最多妖金決勝', cheater: '天邪鬼以十枚妖金勝出' },
  },
  'baker-street': {
    name: gameCatalog['baker-street'].name,
    PlayerClient: props => <BakerClient {...props} />,
    Snapshot: BakerSnapshot, Rules: BakerRuleSummary, DetailedRules: BakerRules, LobbyOptions: BakerOptions,
    validateLobby: (options, count) => validateBakerOptions(options, count >= 4 ? count : undefined),
    chapters: bakerChapters, gallery: { chapter: 'roles', label: '人物、證物與圖板圖鑑' },
    createPoster: createBakerPoster,
    soundAdapter: (G: BakerState, id) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.filter(event => ['mark', 'accusation', 'finish', 'round'].includes(event.type)).map(event => JSON.stringify(event)),
      attention: id && G.players[id] && ((G.status === 'briefing' && !G.players[id].acknowledged)
        || G.status === 'crime'
        || (G.private[id]?.role === 'murderer' && G.status === 'witness-hunt')
        || G.speakerID === id || (G.holmesID === id && ['scene-setup', 'evidence', 'discussion', 'replacement', 'special'].includes(G.status)))
        ? `${G.epoch}:${G.status}:${id}` : undefined }),
    lobbyTitle: '霧中每一件物證，都有人希望你看錯。', lobbyDescription: gameCatalog['baker-street'].description,
    factionLabels: { police: '倫敦調查組', criminals: '莫里亞蒂犯罪網' },
    resultLabels: { police: '真相大白', criminals: '莫里亞蒂的計畫得逞' },
    reasonLabels: { 'crime-solved': '作案手段與關鍵物證均被識破', 'witness-found': '華生遭到指認', 'witness-protected': '華生身分保密，罪證成立', 'badges-exhausted': '正式破案機會耗盡', 'investigation-expired': '三輪調查結束' },
  },
  'midnight-post': {
    name: gameCatalog['midnight-post'].name,
    PlayerClient: props => <MailClient {...props} />,
    Snapshot: MailSnapshot, Rules: MailRuleSummary, DetailedRules: MailRules, LobbyOptions: MailOptions,
    validateLobby: (options, count) => validateMailOptions(options, count >= 2 ? count : undefined),
    chapters: mailChapters,
    gallery: { chapter: 'roles', label: '人物與封印圖鑑' },
    createPoster: createMailPoster,
    soundAdapter: (G: MailState, id) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.filter(event => ['round', 'defeat', 'finish'].includes(event.type)).map(event => JSON.stringify(event)),
      attention: id && G.players[id] && ((G.status === 'playing' && (G.pending ? G.pending.actorID === id : G.activePlayer === id))
        || (['briefing', 'round-review'].includes(G.status) && !G.players[id].acknowledged)) ? `${G.epoch}:${G.status}:${id}` : undefined }),
    lobbyTitle: '地圖上找不到，夜裡總會亮起一盞燈。', lobbyDescription: gameCatalog['midnight-post'].description,
    factionLabels: { couriers: '午夜信使', director: '黑函局長' },
    competitionLabels: { title: '投遞競賽紀錄', description: '每位信使各自爭取冠軍，依玩法與人數記錄完成局數及平均夜數。', roundsLabel: '平均夜數', roundUnit: '夜', modes: { classic: '密函投遞', premium: '全城夜遞' } },
    resultLabels: { delivery: '投遞競賽完成', couriers: '午夜信使獲勝', director: '黑函局長獲勝' },
    reasonLabels: { 'delivery-champion': '信任郵戳決出最終投遞冠軍', 'director-defeated': '局長生命耗盡', 'couriers-defeated': '信使生命耗盡', 'six-seals': '集齊六封印並封鎖郵路' },
  },
  'turing-test': {
    name: gameCatalog['turing-test'].name,
    PlayerClient: props => <TuringClient {...props} />,
    Snapshot: TuringSnapshot, Rules: TuringRuleSummary, DetailedRules: TuringRules, LobbyOptions: TuringOptions,
    validateLobby: (options, count) => validateTuringOptions(options, count >= 2 ? count : undefined),
    chapters: [['setup', '人數與語音'], ['gallery', '檢測設備圖鑑'], ['answer', '口頭作答'], ['sort', '排序與誤差'], ['round', '五關挑戰'], ['small', '群體校準'], ['endless', '無盡挑戰'], ['questions', '題庫與自訂'], ['privacy', '觀戰與復盤']],
    gallery: { chapter: 'gallery', label: '檢測設備圖鑑' },
    createPoster: createTuringPoster,
    soundAdapter: (G: TuringState, id) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.filter(event => event.type === 'reveal' || event.type === 'round-complete' || event.type === 'finish').map(event => JSON.stringify(event)),
      attention: id && G.players[id] && ((G.status === 'sorting' && (isTuringSharedTable(G) ? !(G.orderApprovals ?? []).includes(id) : G.examinerID === id)) || ((G.status === 'briefing' || G.status === 'round-review') && !G.players[id].acknowledged)) ? `${G.round}:${G.status}:${id}` : undefined }),
    lobbyTitle: '用聲音校準，靠默契過關。', lobbyDescription: gameCatalog['turing-test'].description,
    cooperative: true, factionLabels: { humans: '校準小隊' },
    resultLabels: { humans: '全隊校準成功', system: '全隊檢測失敗' },
    reasonLabels: { calibrated: '完成五關人性校準', 'integrity-lost': '生命耗盡', 'endless-exhausted': '無盡挑戰生命耗盡', 'endless-stopped': '房主結算無盡挑戰成績' },
  },
  'silver-moon': {
    name: gameCatalog['silver-moon'].name,
    PlayerClient: props => <MoonClient {...props} />,
    Snapshot: MoonSnapshot, DetailedRules: MoonRules, LobbyOptions: MoonOptions,
    validateLobby: (options, count) => { try { return validateMoonOptions(normalizeMoonOptions(options), count); } catch (error) { return (error as Error).message; } },
    Rules: () => <p>狼人夜間秘密選擇襲擊目標，神職依序行動；白天依發言倒數討論並投票放逐。房主可選擇警長規則與現場輔助模式，夜間每個人都有不影響結果的掩護操作。</p>,
    chapters: [['setup', '人數與模式'], ['roles', '角色圖鑑與技能'], ['night', '夜間與掩護'], ['day', '發言與放逐'], ['sheriff', '警長規則'], ['end', '勝負與復盤']],
    gallery: { chapter: 'roles', label: '角色圖鑑' },
    createPoster: ({ G, info, step, totalSteps }) => createMoonPoster({ G: G as MoonState, players: info.players, step, totalSteps }),
    // Night sounds are identical for all roles. Never cue a private skill or result.
    soundAdapter: (G: MoonState) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.map(entry => JSON.stringify(entry)) }),
    lobbyTitle: '下一站，誰能平安抵達？',
    lobbyDescription: gameCatalog['silver-moon'].description,
    factionLabels: { town: '好人', wolves: '狼人' },
    reasonLabels: { 'wolves-eliminated': '狼人全數離場', 'wolves-dominate': '狼人數量達到或超過其餘乘客', 'town-eliminated': '全部好人離場', 'villagers-eliminated': '全部村民離場', 'specials-eliminated': '全部神職離場', 'mutual-elimination': '雙方全數離場' },
    resultLabels: { town: '好人獲勝', wolves: '狼人獲勝', draw: '平局' },
  },
  'space-station': {
    name: '太空維修站',
    PlayerClient: props => <StationClient {...props} />,
    Snapshot: StationSnapshot,
    Rules: RuleSummary,
    DetailedRules: StationRules,
    chapters: [['setup', '人數與配置'], ['goals', '角色與設備圖鑑'], ['round', '每輪流程'], ['inspect', '如何檢修'], ['review', '換輪與結束']],
    gallery: { chapter: 'goals', label: '角色與設備圖鑑' },
    createPoster: ({ G, info, step, totalSteps }) => createReplayPoster({ G: G as StationObserverState, players: info.players, step, totalSteps }),
    soundAdapter: (G, id) => ({ revision: G.round * 1000 + G.log.length, events: G.log.map((entry: unknown) => JSON.stringify(entry)),
      attention: id && G.status === 'playing' && G.activePlayer === id ? `${G.round}:${G.log.length}:${id}` : undefined }),
    lobbyTitle: '這裡，每個人都有秘密。',
    lobbyDescription: '維修員要找齊維修模組；干擾者要讓反應爐危機被揭開，或讓維修拖過第四輪。',
    factionLabels: { engineer: '維修員', saboteur: '干擾者' },
    reasonLabels: { 'all-repairs': '完成全部維修', hazard: '揭開反應爐危機', 'round-limit': '四輪時間用盡' },
  },
  'encrypted-call': {
    name: '加密通話',
    PlayerClient: props => <CipherClient {...props} />,
    Snapshot: CipherSnapshot,
    Rules: CipherRuleSummary,
    DetailedRules: CipherRules,
    chapters: [['setup', '人數與配牌'], ['gallery', '訊號與道具圖鑑'], ['silence', '通訊限制'], ['transmit', '同步與傳送'], ['mistakes', '順序錯誤'], ['pulse', '靜默脈衝'], ['levels', '進階與補給']],
    gallery: { chapter: 'gallery', label: '訊號與道具圖鑑' },
    createPoster: ({ G, info, step, totalSteps }) => createCipherPoster({ G: G as CipherState, players: info.players, step, totalSteps }),
    // No ticking or transmission cue: audio must not become a timing guide.
    soundAdapter: (G: CipherState, id) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.filter(entry => entry.type === 'level-complete').map(entry => JSON.stringify(entry)),
      attention: id && G.players[id] && G.status === 'syncing' && !G.players[id].acknowledged ? `${G.level}:${G.epoch}:sync` : undefined }),
    lobbyTitle: '保持沉默，接通同一個頻率。',
    lobbyDescription: '所有人都是友方特務。不能透露訊號數字、打暗號或約定節奏，靠默契由小到大傳送。',
    cooperative: true,
    factionLabels: { agents: '特務小隊' },
    resultLabels: { agents: '全隊任務成功', intercepted: '全隊任務失敗' },
    reasonLabels: { 'all-levels': '所有頻段完成同步', 'cover-blown': '掩護耗盡，通訊遭到攔截' },
  },
  'black-fog': {
    name: gameCatalog['black-fog'].name,
    PlayerClient: props => <FogClient {...props} />,
    Snapshot: FogSnapshot, DetailedRules: FogRules, LobbyOptions: FogOptions,
    Rules: () => <p>輪流組隊前往城郊燈塔，全員表決後由隊員秘密執行任務。守夜騎士要完成三次任務並保住逐星神諭者，黑霧使徒則要破壞任務或找出逐星神諭者。雙鐘騎士可能隨詛咒之鐘交換陣營。</p>,
    chapters: [['setup', '人數與配置'], ['roles', '角色圖鑑與情報'], ['flow', '組隊、表決與任務'], ['bell', '詛咒之鐘'], ['end', '勝敗與刺殺']],
    gallery: { chapter: 'roles', label: '角色圖鑑' },
    createPoster: ({ G, info, step, totalSteps }) => createFogPoster({ G: G as FogState, players: info.players, step, totalSteps }),
    soundAdapter: (G: FogState, id) => ({ revision: G.epoch * 1000 + G.log.length,
      events: G.log.filter(entry => ['vote', 'quest', 'bell', 'finish'].includes(entry.type)).map(entry => JSON.stringify(entry)),
      attention: id && ((G.status === 'nomination' && G.leaderID === id)
        || (G.status === 'assassination' && G.private?.[id]?.role === 'assassin')) ? `${G.epoch}:${G.status}:${id}` : undefined }),
    lobbyTitle: '誰會帶隊點亮下一座燈塔？',
    lobbyDescription: gameCatalog['black-fog'].description,
    factionLabels: { knights: '守夜騎士', apostles: '黑霧使徒' },
    reasonLabels: { 'three-fails': '三次燈塔任務失敗', 'five-rejections': '連續五次否決組隊', 'merlin-found': '深海之刃找出逐星神諭者', 'merlin-safe': '點亮三座燈塔並保住逐星神諭者' },
  },
};

export function gameResultLabel(gameID: string, winner?: string) {
  const definition = clientGames[gameID];
  if (!winner) return '任務完成';
  return definition?.resultLabels?.[winner] ?? `${definition?.factionLabels[winner] ?? winner}陣營獲勝`;
}
