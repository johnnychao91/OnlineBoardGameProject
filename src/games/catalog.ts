/** Public, environment-free metadata shared by the room, rules pages and registries. */
export const gameCatalog = {
  'turing-test': { name: '圖靈測試', description: '用千奇百怪的回答校準人性，讓冰冷的機器看懂你們的默契。', minPlayers: 2, maxPlayers: 9,
    detail: '2～9 人 · 全員合作 · 語音回答與排序', intro: '機器混入人群的傳聞，讓整座城市啟動了人性檢測。你們透過語音軟體回答題目，從回答判斷秘密強度。2～3 人在共用桌面一起排序，4～9 人輪流擔任檢測員；可以完成五關校準，也可以用有限生命挑戰無盡模式。機器人是故事背景，玩家全員同隊。' },
  'space-station': { name: '太空維修站', description: '在未知與信任之間，讓太空站恢復運作。', minPlayers: 4, maxPlayers: 8,
    detail: '4～8 人 · 隱藏陣營 · 討論與推理', intro: '維修員要讓太空站恢復運作，干擾者則潛伏在隊伍中。你知道自己持有哪些設備，卻不知道它們的位置。' },
  'encrypted-call': { name: '加密通話', description: '潛伏諜報戰線，以沉默與默契完成遞增的訊號傳送。', minPlayers: 2, maxPlayers: 4,
    detail: '2～4 人 · 全員合作 · 8 歲以上', intro: '諜報戰線上，所有人都是友方特務。保持沉默，憑默契把訊號由小到大傳送，避開敵方監聽。' },
  'black-fog': { name: '黑霧襲城', description: '組隊點亮城郊燈塔，在黑霧與詛咒之鐘中辨認真正的同伴。', minPlayers: 5, maxPlayers: 10,
    detail: '5～10 人 · 隱藏陣營 · 組隊與表決', intro: '守夜騎士要點亮城郊燈塔，黑霧使徒則混入隊伍阻止任務。詛咒之鐘響起時，雙鐘騎士可能交換效忠陣營。' },
  'silver-moon': { name: '銀月列車', description: '夜行列車上，狼人混入乘客。以推理與秘密技能找出誰能平安抵達。', minPlayers: 6, maxPlayers: 12,
    detail: '6～12 人 · 狼人推理 · 線上／現場輔助', intro: '蒸汽列車穿越月下荒野，餐車是白天的討論席，熄燈後則各自行動。保留狼人、村民與神職名稱，可選警長規則；現場輔助模式由裝置代替裁判。' },
} as const;
export type GameID = keyof typeof gameCatalog;
export const GAME_IDS = Object.keys(gameCatalog) as GameID[];
export const ROOM_CAPACITY = Math.max(...Object.values(gameCatalog).map(game => game.maxPlayers));
export const isPlayerSeatID = (value: unknown): value is string => typeof value === 'string'
  && /^(0|[1-9][0-9]*)$/.test(value) && Number(value) < ROOM_CAPACITY;
export const isGameID = (value: string): value is GameID => Object.prototype.hasOwnProperty.call(gameCatalog, value);
