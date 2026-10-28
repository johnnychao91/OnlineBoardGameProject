/** Public metadata in the shared display order for game lists, rules and statistics. */
export const gameCatalog = {
  'space-station': { name: '太空維修站', description: '在未知與信任之間，讓太空站恢復運作。', minPlayers: 4, maxPlayers: 8,
    detail: '4～8 人 · 隱藏陣營 · 討論與推理', intro: '維修員要讓太空站恢復運作，干擾者則潛伏在隊伍中。你知道自己持有哪些設備，卻不知道它們的位置。' },
  'encrypted-call': { name: '加密通話', description: '潛伏諜報戰線，以沉默與默契完成遞增的訊號傳送。', minPlayers: 2, maxPlayers: 4,
    detail: '2～4 人 · 全員合作 · 8 歲以上', intro: '諜報戰線上，所有人都是友方特務。保持沉默，憑默契把訊號由小到大傳送，避開敵方監聽。' },
  'black-fog': { name: '黑霧襲城', description: '組隊點亮城郊燈塔，在黑霧與詛咒之鐘中辨認真正的同伴。', minPlayers: 5, maxPlayers: 10,
    detail: '5～10 人 · 隱藏陣營 · 組隊與表決', intro: '守夜騎士要點亮城郊燈塔，黑霧使徒則混入隊伍阻止任務。詛咒之鐘響起時，雙鐘騎士可能交換效忠陣營。' },
  'silver-moon': { name: '銀月列車', description: '夜行列車上，狼人混入乘客。以推理與秘密技能找出誰能平安抵達。', minPlayers: 6, maxPlayers: 12,
    detail: '6～12 人 · 狼人推理 · 線上／現場輔助', intro: '蒸汽列車穿越月下荒野，餐車是白天的討論席，熄燈後則各自行動。保留狼人、村民與神職名稱，可選警長規則；現場輔助模式由裝置代替裁判。' },
  'turing-test': { name: '圖靈測試', description: '用千奇百怪的回答校準人性，讓冰冷的機器看懂你們的默契。', minPlayers: 2, maxPlayers: 10,
    detail: '2～10 人 · 全員合作 · 語音回答與排序', intro: '機器混入人群的傳聞，讓整座城市啟動了人性檢測。你們透過語音軟體回答題目，從回答判斷秘密強度。「群體校準」讓 2～10 人各持一張牌、在共用桌面一起排序；4～9 人也能選擇輪流擔任檢測員的玩法。可以完成五關校準，也可以用有限生命挑戰無盡模式。機器人是故事背景，玩家全員同隊。' },
  'midnight-post': { name: '午夜郵局', description: '雨夜郵局亮起燈火，讓密函穿過查驗與調包，或聯手阻止黑函局長。', minPlayers: 2, maxPlayers: 8,
    detail: '2～8 人 · 密函推理 · 三種玩法', intro: '城市入睡後，一間不存在於地圖上的郵局才開始營業。3～4 人以密函投遞爭取信任，5～8 人在全城夜遞中運用額外人物；2～6 人也能挑戰黑函局長，由一人蒐集六封印，其餘午夜信使聯手守住郵路。' },
  'baker-street': { name: '貝克街迷霧', description: '福爾摩斯以無聲鑑證引導調查，莫里亞蒂的執行者與內應藏在倫敦警察之中。', minPlayers: 4, maxPlayers: 12,
    detail: '4～12 人 · 鑑證推理 · 四個案件年代', intro: '選擇工業革命、維多利亞、世界大戰或 2026 現代的案件。福爾摩斯只以推演圖板與西洋棋標記給出線索；倫敦警察必須找出作案手段及關鍵物證，並在三輪調查中識破莫里亞蒂的陰謀。' },
  'hundred-ghosts': { name: '百鬼夜宴', description: '夜宴只認面具，不認本人。交換身分、冒領供奉，在妖怪之間爭奪香火錢。', minPlayers: 4, maxPlayers: 12,
    detail: '4～12 人 · 面具交換 · 記憶與虛張聲勢', intro: '朱紅鳥居下，百鬼戴著面具入席。你可以暗換面具、查看自己，或宣稱某位妖怪的名號領取供奉；旁人若也認領，便當場翻牌驗明。先累積十三枚妖金，或在有人破產時成為最富有的妖怪，贏下這場夜宴。' },
  'curtain-heist': { name: '謝幕劫案', description: '以幻術表演掩護金庫劫案，繼續深入或帶著分紅提前謝幕。', minPlayers: 3, maxPlayers: 8,
    detail: '3～8 人 · 秘密決策 · 五幕風險與分紅', intro: '富豪劇院的地下藏著真正的壓軸節目。眾人沿途分取財物，每一步都秘密決定繼續深入或提前謝幕；同種危機累積到本局設定的門檻，還沒離場的人便失去手上的所得。只有獨自撤退，才能把路上的珍藏一併帶走。五幕之後，最豐厚的分紅就是最好的掌聲。' },
  'firewall-breach': { name: '潛入防火牆', description: '駭客小隊連向企業資料核心，偽裝的追蹤程式卻正架設死路、封鎖工具。', minPlayers: 2, maxPlayers: 12,
    detail: '2～12 人 · 秘密身分 · 網路路線與工具攻防', intro: '資料堡壘深處藏著真正的機密核心。你可以延伸連線、修復工具或干擾他人；藍域與綠域各有利益，企業追蹤程式則希望所有連線都失敗。橋接、權限門與跳躍節點讓每一條路都值得懷疑，三輪之後，以資料點數決定最終贏家。' },
  'star-workshop': { name: '星匠工坊', description: '收集五種星材，打造天體工藝，吸引星座守護者前來委託。', minPlayers: 2, maxPlayers: 4, detail: '2～4 人 · 資源引擎 · 工藝與聲望競賽', intro: '夜空是一座尚未完工的工坊。從透鏡、刻針與小熔爐起步，運用累積工藝減少未來作品的成本；保留心儀藍圖、調度星材，將聲望推向十五分，並在同一輪結束時決出最出色的星匠。' },
} as const;
export type GameID = keyof typeof gameCatalog;
export const GAME_IDS = Object.keys(gameCatalog) as GameID[];
export const ROOM_CAPACITY = Math.max(...Object.values(gameCatalog).map(game => game.maxPlayers));
export const isPlayerSeatID = (value: unknown): value is string => typeof value === 'string'
  && /^(0|[1-9][0-9]*)$/.test(value) && Number(value) < ROOM_CAPACITY;
export const isGameID = (value: string): value is GameID => Object.prototype.hasOwnProperty.call(gameCatalog, value);
