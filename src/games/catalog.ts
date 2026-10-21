/** Public, environment-free metadata shared by the room, rules pages and registries. */
export const gameCatalog = {
  'space-station': { name: '太空維修站', description: '在未知與信任之間，讓太空站恢復運作。', minPlayers: 4, maxPlayers: 8,
    detail: '4～8 人 · 隱藏陣營 · 討論與推理', intro: '維修員要讓太空站恢復運作，干擾者則潛伏在隊伍中。你知道自己持有哪些設備，卻不知道它們的位置。' },
  'encrypted-call': { name: '加密通話', description: '潛伏諜報戰線，以沉默與默契完成遞增的訊號傳送。', minPlayers: 2, maxPlayers: 4,
    detail: '2～4 人 · 全員合作 · 8 歲以上', intro: '諜報戰線上，所有人都是友方特務。保持沉默，憑默契把訊號由小到大傳送，避開敵方監聽。' },
  'black-fog': { name: '黑霧襲城', description: '組隊點亮城郊燈塔，在黑霧與詛咒之鐘中辨認真正的同伴。', minPlayers: 5, maxPlayers: 10,
    detail: '5～10 人 · 隱藏陣營 · 組隊與表決', intro: '守夜騎士要點亮城郊燈塔，黑霧使徒則混入隊伍阻止任務。詛咒之鐘響起時，兩位蘭斯洛特可能交換效忠陣營。' },
} as const;
export type GameID = keyof typeof gameCatalog;
export const GAME_IDS = Object.keys(gameCatalog) as GameID[];
export const ROOM_CAPACITY = Math.max(...Object.values(gameCatalog).map(game => game.maxPlayers));
export const isPlayerSeatID = (value: unknown): value is string => typeof value === 'string'
  && /^(0|[1-9][0-9]*)$/.test(value) && Number(value) < ROOM_CAPACITY;
export const isGameID = (value: string): value is GameID => Object.prototype.hasOwnProperty.call(gameCatalog, value);
