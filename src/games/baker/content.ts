import { BAKER_ART_SUBJECTS, type BakerArtKey } from './art-manifest';
import {
  COMMON_CLUES, COMMON_MEANS, INDUSTRIAL_CLUES, INDUSTRIAL_MEANS, VICTORIAN_CLUES, VICTORIAN_MEANS,
  WARTIME_CLUES, WARTIME_MEANS, MODERN_CLUES, MODERN_MEANS,
} from './card-lists';

export type BakerEra = 'industrial' | 'victorian' | 'wartime' | 'modern';
export interface BakerCard { id: string; kind: 'means' | 'clue'; era: BakerEra; name: string; art: BakerArtKey; description?: string }
export const BAKER_ERAS: Record<BakerEra, { name: string; minYear: number; maxYear: number; defaultYear: number; description: string }> = {
  industrial: { name: '工業革命', minYear: 1760, maxYear: 1836, defaultYear: 1800, description: '工場、運河與馬車穿過煤煙中的倫敦。年份依本遊戲分段，使用早期工業城市的物件。' },
  victorian: { name: '維多利亞時代', minYear: 1837, maxYear: 1901, defaultYear: 1890, description: '煤氣燈照亮劇院、莊園與貝克街，福爾摩斯在紙本檔案中追查真相。' },
  wartime: { name: '世界大戰時期', minYear: 1914, maxYear: 1945, defaultYear: 1939, description: '防空警報、配給與密電之間，一宗命案牽動被掩藏的戰時秘密。' },
  modern: { name: '2026 年現代', minYear: 2026, maxYear: 2026, defaultYear: 2026, description: '智慧型手機、門禁與數位紀錄留下新線索；這是福爾摩斯人物的現代平行案件。' },
};
export type BakerSpecialEffect = 'additional-mark' | 'replace-scene' | 'retrace-mark' | 'exclude-means' | 'exclude-clue' | 'restore-badge';
export interface BakerScene {
  id: string; kind: 'cause' | 'location' | 'scene' | 'special'; name: string;
  options: readonly string[]; eraOptions?: Partial<Record<BakerEra, readonly string[]>>;
  effect?: BakerSpecialEffect; description?: string;
}
export const sceneOptions = (scene: BakerScene, era: BakerEra): readonly string[] => scene.eraOptions?.[era] ?? scene.options;
export interface BakerRoleDefinition { id: string; name: string; description: string; faction: 'police' | 'criminal' | 'reserve' | 'story'; playable: boolean; count: number }
export const BAKER_ROLE_CATALOG: readonly BakerRoleDefinition[] = [
  { id: 'holmes', name: '福爾摩斯', faction: 'police', playable: true, count: 1, description: '公開的鑑證專家，掌握案件答案。以推演圖板上的西洋棋標記引導調查，不能用說話、文字或動作補充答案。' },
  { id: 'watson', name: '華生醫生', faction: 'police', playable: true, count: 1, description: '目擊兩名涉案者離開現場，知道是哪兩人，卻無法區分誰是執行者、誰是內應，也不知道作案手段與關鍵物證。' },
  { id: 'police', name: '倫敦警察', faction: 'police', playable: true, count: 8, description: '觀察物證、討論鑑證提示，並在手中仍有警徽時提交一次正式破案推論。' },
  { id: 'murderer', name: '莫里亞蒂的執行者', faction: 'criminal', playable: true, count: 1, description: '秘密選擇自己面前的一張作案手段與一張現場物證作為答案，並在調查時混淆方向。若華生在場，破案後仍有一次指認他的機會。' },
  { id: 'accomplice', name: '莫里亞蒂的內應', faction: 'criminal', playable: true, count: 1, description: '知道執行者與案件答案，協助誤導調查。自己的手段牌與物證牌不能成為案件答案。' },
  { id: 'mary', name: '瑪麗', faction: 'reserve', playable: false, count: 0, description: '預製人物身分牌。細心保管信件與舊物的訪客，尚未加入可選角色或額外技能。' },
  { id: 'irene', name: '艾琳', faction: 'reserve', playable: false, count: 0, description: '預製人物身分牌。善於察言觀色的舞台人物，尚未加入可選角色或額外技能。' },
  { id: 'mycroft', name: '邁克羅夫特', faction: 'reserve', playable: false, count: 0, description: '預製人物身分牌。從公文與人際關係整理線索的幕後分析者，尚未加入可選角色或額外技能。' },
  { id: 'lestrade', name: '雷斯垂德探長', faction: 'reserve', playable: false, count: 0, description: '預製人物身分牌。熟悉街區與警署程序的探長，尚未加入可選角色或額外技能。' },
  { id: 'gregson', name: '葛萊森探長', faction: 'reserve', playable: false, count: 0, description: '預製人物身分牌。重視證詞與筆錄的調查者，尚未加入可選角色或額外技能。' },
  { id: 'hopkins', name: '霍普金斯', faction: 'reserve', playable: false, count: 0, description: '預製人物身分牌。追查現場細節的年輕警探，尚未加入可選角色或額外技能。' },
  { id: 'moriarty', name: '莫里亞蒂', faction: 'story', playable: false, count: 0, description: '犯罪網絡的幕後主使。作為故事人物展示，不占參與席位，也不是額外的可抽身分。' },
];

function cards(era: BakerEra, kind: BakerCard['kind'], rows: string): BakerCard[] {
  return rows.trim().split('\n').filter(row => row.trim()).flatMap(row => {
    const [art, ...names] = row.trim().split('|');
    if (!Object.hasOwn(BAKER_ART_SUBJECTS, art) || names.length === 0 || names.some(name => !name.trim())) {
      throw new Error(`Invalid Baker Street card row: ${era}/${kind}/${art}`);
    }
    return names.map(name => ({ name, art: art as BakerArtKey }));
  }).map((card, i) => ({ ...card, era, kind, id: `${era}-${kind}-${String(i + 1).padStart(3, '0')}` }));
}
export const BAKER_DECKS: Record<BakerEra, { means: BakerCard[]; clues: BakerCard[] }> = {
  industrial: { means: cards('industrial', 'means', COMMON_MEANS + INDUSTRIAL_MEANS), clues: cards('industrial', 'clue', COMMON_CLUES + INDUSTRIAL_CLUES) },
  victorian: { means: cards('victorian', 'means', COMMON_MEANS + VICTORIAN_MEANS), clues: cards('victorian', 'clue', COMMON_CLUES + VICTORIAN_CLUES) },
  wartime: { means: cards('wartime', 'means', COMMON_MEANS + WARTIME_MEANS), clues: cards('wartime', 'clue', COMMON_CLUES + WARTIME_CLUES) },
  modern: { means: cards('modern', 'means', COMMON_MEANS + MODERN_MEANS), clues: cards('modern', 'clue', COMMON_CLUES + MODERN_CLUES) },
};

const ordinary = (id: string, name: string, options: string): BakerScene => ({ id, kind: 'scene', name, options: options.split('|') });
const special = (id: string, name: string, effect: BakerSpecialEffect, description: string): BakerScene => ({ id, kind: 'special', name, effect, description, options: [] });

/** 1 cause + 4 locations + 47 ordinary boards + 12 optional original event boards. */
export const BAKER_SCENES: readonly BakerScene[] = [
  { id: 'cause', kind: 'cause', name: '死因鑑證', options: ['窒息', '身體重創', '大量失血', '疾病發作', '毒物影響', '意外事故'] },
  { id: 'location-streets', kind: 'location', name: '倫敦街區', options: ['貝克街公寓', '泰晤士碼頭', '鐵路車站', '市場巷弄', '工廠街', '劇院後巷'],
    eraOptions: { industrial: ['貝克街寓所', '運河碼頭', '客運驛站', '市場巷弄', '紡織工場', '酒館後巷'], wartime: ['貝克街公寓', '軍用碼頭', '撤離車站', '配給商店', '軍需工廠', '防空巷道'], modern: ['貝克街公寓', '河岸步道', '地鐵站', '購物商場', '辦公大樓', '停車場'] } },
  { id: 'location-private', kind: 'location', name: '私人建築', options: ['書房', '臥室', '餐廳', '地窖', '溫室', '馬廄'],
    eraOptions: { industrial: ['帳房', '閣樓', '廚房', '地窖', '工棚', '馬廄'], wartime: ['軍官辦公室', '臨時寢室', '食堂', '地下防空室', '機房', '車庫'], modern: ['居家辦公室', '套房', '開放式廚房', '地下室', '設備機房', '私人車庫'] } },
  { id: 'location-public', kind: 'location', name: '公共場所', options: ['警署', '醫院', '教堂', '博物館', '旅館', '私人俱樂部'],
    eraOptions: { industrial: ['治安所', '診療所', '教堂', '集會廳', '驛站旅店', '商人會館'], wartime: ['警備所', '救護站', '教堂', '避難所', '臨時旅舍', '軍人俱樂部'], modern: ['警局', '醫療中心', '教堂', '博物館', '連鎖旅館', '健身中心'] } },
  { id: 'location-outskirts', kind: 'location', name: '城郊暗角', options: ['莊園花園', '荒廢磨坊', '河岸倉庫', '墓園', '樹林', '石橋下'],
    eraOptions: { industrial: ['莊園田地', '磨坊', '運河倉庫', '墓園', '採石場', '木橋下'], wartime: ['疏散莊園', '廢棄工事', '補給倉庫', '墓園', '野戰營地', '毀損橋梁'], modern: ['郊區庭院', '廢棄工廠', '物流倉庫', '墓園', '城市公園', '高架橋下'] } },
  ordinary('weather', '天空與天候', '晴朗|細雨|暴雨|濃霧|降雪|強風'),
  ordinary('time-of-day', '街燈與時刻', '黎明前|清晨|正午|午後|黃昏|深夜'),
  ordinary('lighting', '光線觀察', '完全漆黑|微弱亮光|明亮清楚|忽明忽暗|逆光|有遮蔽物'),
  ordinary('temperature', '冷暖線索', '冰冷|偏涼|常溫|溫暖|灼熱|忽冷忽熱'),
  ordinary('humidity', '水分痕跡', '乾燥|微濕|浸透|有水珠|已乾涸|霜雪覆蓋'),
  ordinary('air-odor', '空氣中的氣味', '煙味|香氣|食物味|藥味|腐臭|沒有明顯氣味'),
  ordinary('sound', '街區聽聞', '撞擊聲|腳步聲|叫喊聲|機械聲|音樂聲|寂靜'),
  ordinary('tidiness', '現場秩序', '井然有序|散落物件|翻找痕跡|剛被清理|堆積雜物|刻意擺放'),
  ordinary('scene-density', '往來人群', '獨處|兩人相處|少數熟人|人來人往|群眾聚集|無法判斷'),
  ordinary('surface', '地面觀察', '泥土地|石板地|木地板|地毯|碎石地|水面'),
  ordinary('entry', '進入現場', '正門|後門|窗戶|屋頂|地下通道|原本就在裡面'),
  ordinary('escape-route', '離去方向', '往街上|往樓上|往地下|往河邊|往庭院|沒有離開'),
  ordinary('trace', '遺留痕跡', '腳印|指印|拖曳痕|液體痕|纖維|粉塵'),
  ordinary('color', '顯眼色澤', '紅色|藍色|綠色|黃銅色|黑灰色|白色'),
  ordinary('material', '材質判斷', '金屬|木材|玻璃|布料|紙張|石材'),
  ordinary('size', '大小輪廓', '細小|可握在手中|約手臂長|需雙手抱住|比人更大|大小不固定'),
  ordinary('shape', '形狀印象', '尖銳|圓形|扁平|細長|有稜角|柔軟可變形'),
  ordinary('texture', '表面觸感', '光滑|粗糙|黏稠|濕滑|鬆軟|堅硬'),
  ordinary('condition', '保存狀態', '全新|經常使用|殘破|剛修補|生鏽|缺少零件'),
  ordinary('use-frequency', '使用情形', '每日使用|偶爾使用|紀念收藏|工作專用|臨時借用|久未使用'),
  ordinary('portability', '攜帶方式', '藏在口袋|握在手中|放入提袋|穿戴身上|需搬運工具|固定在原處'),
  ordinary('value', '物件價值', '幾乎無價值|日常用品|價格不低|奢侈珍品|情感價值|難以估價'),
  ordinary('owner', '來源線索', '屬於自己|向人借來|意外拾獲|別人贈送|工作配發|偷取而來'),
  { ...ordinary('profession', '職業關聯', '勞工|醫療人員|商人|表演者|執法人員|無特定職業'),
    eraOptions: { industrial: ['工匠', '醫師', '商販', '劇團演員', '治安人員', '無特定職業'], modern: ['工程人員', '醫療人員', '金融商務', '影音工作者', '執法人員', '無特定職業'] } },
  ordinary('relationship', '人際關係', '家人|朋友|同事|戀人|仇人|陌生人'),
  ordinary('motive', '可能動機', '金錢利益|報復怨恨|掩蓋秘密|嫉妒|恐懼|無心之失'),
  ordinary('emotion', '情緒跡象', '憤怒|慌張|悲傷|冷靜|興奮|麻木'),
  ordinary('duration', '發生經過', '一瞬間|短暫接觸|持續片刻|長時間|反覆發生|無法判斷'),
  ordinary('distance', '接觸距離', '緊貼身體|伸手可及|同一房間|隔著障礙|遠距離|沒有直接接觸'),
  ordinary('body-position', '發現時姿態', '仰躺|趴伏|側躺|坐著|蜷縮|受到支撐'),
  ordinary('body-area', '注意部位', '頭頸|胸背|腹部|雙手|腿腳|全身'),
  ordinary('body-state', '遺體觀察', '尚有餘溫|冰冷|僵硬|有明顯外傷|衣物凌亂|外表完整'),
  ordinary('clothing', '衣著細節', '正式服裝|工作服|居家服|厚重衣物|裝扮特殊|衣物缺失'),
  ordinary('meal', '飲食關聯', '早餐|正餐|點心|飲酒|飲藥|未進食'),
  ordinary('storage', '原本放置處', '抽屜|櫥櫃|桌面|衣袋|行李|地上'),
  ordinary('contact', '接觸留下的線索', '握持|踩踏|拖拉|擦拭|包覆|沒有接觸'),
  ordinary('force', '力量方向', '推擠|拉扯|敲擊|旋轉|擠壓|墜落'),
  ordinary('liquid', '液體判斷', '清水|酒類|油脂|藥液|墨水|血跡'),
  ordinary('fire-sign', '熱與燃燒', '焦黑|煙灰|熔化|燙痕|仍有熱度|沒有熱痕'),
  ordinary('damage', '損壞形式', '斷裂|穿孔|凹陷|割開|磨損|沒有損壞'),
  ordinary('movement', '物件的移動', '被拿走|被送來|掉落|調換位置|藏起來|仍在原位'),
  ordinary('writing', '文字紀錄', '姓名|日期|地址|數字|圖記|沒有文字'),
  ordinary('room-detail', '室內細節', '門窗緊閉|窗簾拉上|爐火未熄|桌上有餐具|床鋪凌亂|物件被移走'),
  ordinary('witness-impression', '旁人的印象', '行色匆忙|刻意等待|衣著醒目|掩飾面容|攜帶包裹|沒有被看見'),
  ordinary('preparation', '事前準備', '臨時起意|預先安排|熟悉環境|攜帶工具|等待機會|無法判斷'),
  ordinary('arrival', '來訪緣由', '接受邀約|例行工作|偶然經過|尋找某人|交付物品|追查消息'),
  ordinary('departure', '離場情形', '匆忙離去|從容離去|有人接應|留下物品|清理現場|未能離場'),
  special('extra-observation', '華生的補充觀察', 'additional-mark', '福爾摩斯在一塊普通推演板上增加第二枚標記，必須選擇不同的線索。'),
  special('second-magnifier', '第二道放大鏡', 'additional-mark', '福爾摩斯在一塊普通推演板上補充一項不同線索；原有標記仍然保留。'),
  special('new-dossier', '檔案室新卷宗', 'replace-scene', '福爾摩斯額外更換一塊普通推演板並重新標記，之後照常更換本輪的推演板。'),
  special('returned-page', '遺失頁面歸檔', 'replace-scene', '從新資料中更換一塊普通推演板，福爾摩斯在新板標記；本輪正常換板仍會進行。'),
  special('reconsideration', '重新排列的推演', 'retrace-mark', '福爾摩斯可改動一塊只有一枚標記的普通推演板；死因與地點維持原樣。'),
  special('ash-notes', '煤灰下的筆記', 'retrace-mark', '修正一塊只有一枚標記的普通推演板，移至另一項線索。'),
  special('armorer-report', '兵器匠的鑑定', 'exclude-means', '福爾摩斯公開排除一張不是案件答案的作案手段牌；該牌留在原位供大家查看。'),
  special('sealed-means', '封存手段清單', 'exclude-means', '福爾摩斯選一張非答案的作案手段牌，標記為已排除。'),
  special('evidence-origin', '物證來源查核', 'exclude-clue', '福爾摩斯公開排除一張不是關鍵物證的線索牌；該牌留在原位。'),
  special('pawn-ledger', '典當簿對照', 'exclude-clue', '福爾摩斯選一張非答案的現場物證牌，標記為已排除。'),
  special('lestrade-permit', '雷斯垂德的特許', 'restore-badge', '福爾摩斯選擇一位已用掉警徽的玩家，恢復其一次正式破案機會；無人符合時略過。'),
  special('replacement-badge', '警署補發徽章', 'restore-badge', '把警徽補發給一位已失去破案機會的玩家；無適用對象時不改變狀態。'),
];
