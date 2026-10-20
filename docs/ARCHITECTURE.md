# 架構與新增遊戲

專案將共用的房間功能與個別遊戲規則分開。第一款遊戲是 4～8 人的「太空維修站」；日後增加其他遊戲時，沿用邀請、座位、連線與部署方式，另加入規則與畫面模組。

## 組成

```text
React 前端
    ├─ 建房、邀請、等待室與連線狀態
    └─ 依遊戲識別碼選擇遊戲畫面
          │
          ├─ /api：房間、觀戰、復盤、分享與統計
          └─ /socket.io：遊戲同步與操作
                      │
Node.js 服務          ▼
    ├─ 房間層：建房、邀請、座位、房主權限
    ├─ 遊戲註冊表：遊戲定義與人數限制
    ├─ boardgame.io：規則執行、回合、狀態同步
    └─ 持久化：自訂本機 JSON adapter + 房間索引 JSON
```

遊戲註冊表是原始碼中的明確登錄機制，不提供上傳並執行任意遊戲程式的動態外掛功能。新增遊戲需要修改程式、通過測試並重新部署。

## 開發與正式執行

開發環境由 `npm run dev` 啟動 Vite 與 Node.js。瀏覽器連到 `localhost:5173`，Vite 將 API 與 Socket.IO 代理至 `127.0.0.1:3001`。

正式環境先執行 `npm run build`，並設定 `NODE_ENV=production`、HTTPS `PUBLIC_ORIGIN` 與建房密鑰。`npm start` 由 Node.js 同時提供 `dist/client` 和遊戲 API；Apache 將遊戲子網域的 HTTPS 請求代理至本機 Node.js。前端不需要知道對外的獨立 API 埠號。

## 房間與對局

房間層管理參與者與邀請，遊戲層管理對局進度。房號不能直接代表座位權限；座位名稱也不能作為身份憑證。

1. 建房請求先經過建房密鑰檢查，再由伺服器產生房號、邀請與座位 0 的玩家憑證；同一份憑證同時驗證房主操作。
2. 使用者提供邀請與該次加入的隨機 `requestID`，選擇入座或觀戰。新入座檢查邀請時效、房間狀態與容量；新觀戰檢查邀請時效與觀戰身份上限。相同身份類型的請求重送會回傳先前結果，避免手機網路遺失回應時重複分配。
3. 邀請 fragment 在頁面載入時已清除並暫存於 `sessionStorage`；加入成功後保存玩家或觀戰憑證並清除暫存的加入資料。玩家在正式對局建立遊戲連線，觀戰者透過唯讀 HTTP 輪詢取得狀態。
4. 玩家傳送操作；伺服器依遊戲規則與當前狀態判定結果，再向各玩家發送各自可見的狀態。
5. 重新連線時，以既有憑證要求最新狀態。瀏覽器畫面不應自行推斷斷線期間發生的結果。

邀請連結分享的是加入機會，不包含分享者的座位或房主權限。房主重設邀請與開始遊戲，都需由伺服器檢查房主權限。

## 遊戲規則與秘密資訊

規則程式應保持可測試的狀態轉移，將遊戲 UI 與 Node.js 檔案存取等副作用移出規則模組。時間、亂數與勝敗條件應由伺服器使用一致的規則處理，避免由玩家任意提交結果。

boardgame.io 的完整狀態保留於伺服器。每個玩家的 `playerView` 僅包含公開資訊與該玩家被允許取得的私人資訊；觀戰 HTTP 另外經過身份驗證及 `observerView` 投影。盲視角只回傳當時公開資訊，上帝視角在進行中即可回傳所有參與者的角色、設備組成與剩餘牌序，仍排除未發角色、亂數種子與框架內部資料。需要使用完整秘密狀態的操作應在伺服器執行，避免客戶端的樂觀更新使用不完整資料產生錯誤結果。

玩家憑證不能取得進行中的觀戰視角，但本版沒有帳號身分去重，不能阻止同一人用另一個瀏覽器取得觀戰憑證，或觀戰者私下轉告資訊。使用上帝觀戰功能需要朋友間的信任約定。

公開操作紀錄與內部保存資料具有不同可見範圍。遊戲結束是否公開角色或剩餘資訊，應是規則明確定義的行為，不能因為結束就直接回傳全部伺服器資料。

## 持久化與重啟

遊戲狀態使用 `src/server/storage.ts` 的 `FileStorage`，繼承 boardgame.io 的非同步儲存介面。每個對局存成 `DATA_DIR/matches/<16字元房號>.json`，包含格式版本、對局識別碼、`initialState`、`state`、`metadata`、完整 `log` 與回放欄位。房間層另將房號、遊戲識別碼、建立時的容量、邀請雜湊與期限、觀戰身份，以及回放分享雜湊與授權範圍存於 `DATA_DIR/rooms.json`。實際入座人數從玩家 metadata 計算，不能以房間索引的 `numPlayers` 容量欄位代替。

採用自訂 adapter，是為了避開既有 FlatFile 實作依賴 `node-persist` 共用預設 instance 與定時寫入佇列的等待。這裡使用 Node.js 原生檔案 API，每房的讀寫依 Promise 佇列序列化，不需等待固定的寫入掃描週期。這不代表磁碟 I/O 沒有延遲；仍需在 Pi 5 上量測。

寫入會先建立同目錄的暫存檔，以 `flush: true` 同步檔案內容，再以 rename 替換完整對局檔。讀取重新解析 JSON，呼叫端不能透過修改回傳物件改到另一個請求的記憶體資料。狀態更新會保留 metadata 並追加 deltalog；metadata 更新則保留狀態與紀錄。

此原子替換僅處理單一對局檔的更新，不保證斷電存活，也沒有對局檔與 `rooms.json` 之間的交易。兩部分共同構成一個可恢復的對局，備份時需保留完整 `DATA_DIR`。

目前採單一 Node.js 程序，每份資料目錄只由一個 adapter instance 使用；沒有跨程序檔案鎖。不要啟動多個程序或多個 instance 同時寫入同一份資料。資料格式或遊戲規則變更時，要評估舊資料相容性；未設計遷移程序前，優先等進行中的對局結束再更新。舊 FlatFile 資料不會自動轉換成此格式。

0.2 版的 schema 1 增加 `replayFrames` 與 `replayComplete`。從正式開局起，每個有效狀態版本保存 `{stateID, at, G}`，與目前狀態一起原子寫入；等待室不加入回放，重複／較舊版本不會再次加入。舊資料缺乏完整歷史時保持 `complete: false`，不根據現在的牌面補造過去；正式對局版本跳號也會標為不完整。回放 API 僅在終局開放，依遊戲的 `observerView` 過濾，完全不傳出 metadata、RNG、plugins 或座位憑證。不完整歷史仍可供 API 識別，但前端不提供完整時間軸或發行分享。

等待室由 HTTP 的 ready/start 操作管理；建立時只預留最大容量，真正開局才以當時入座且全員準備的 4～8 人重建初始對局。`startMatch` 在單一檔案內原子替換初始狀態、目前狀態、玩家 metadata 與回放；與入座使用相同房間佇列。Socket.IO 不接受 `startGame`，避免繞過 HTTP 的實際參與者檢查。前端在進入正式對局後才掛載 boardgame.io client。

觀戰者使用獨立 HTTP 輪詢及憑證，不加入 boardgame.io 的玩家 metadata。全站統計由 `collectStatistics` 逐局讀取已完成結果，不另保存可重複累加的計數器；未完成局不計，舊版完整勝敗結果可納入。統計按遊戲、勝方、原因與實際玩家人數彙整，不提供房號、暱稱、個人戰績或排名。這適合朋友的小型單程序服務，大量歷史資料時應另建可重建的統計索引。

分享回放限已結束且 `complete: true` 的對局，另發行 7 天有效的獨立隨機 token，索引只存雜湊、到期時間、起始步驟與視角。`/api/replays/:roomId` 僅按儲存的視角回傳整局的過濾歷史；指定步驟是初始播放位置，不是裁切片段，收件者不能升級視角或取得其他權限。房主可整批撤銷連結。戰報圖片由前端 canvas 只取所選快照的公開事件、暱稱與進度繪製，無論目前是否使用上帝視角都不含秘密牌面、網址或憑證，也不需外部圖片、字型或上傳服務。

短暫斷線重新同步與服務重啟後恢復，是不同驗收項目。後者同時依賴完整持久化、檔案權限、啟動載入流程及原本玩家仍保存憑證。備份還原也要獨立測試。

邀請 24 小時到期只阻止新的入座與觀戰身份，不會撤銷既有身份、移除房間或終止進行中的對局。已成功加入的冪等請求仍可重取原結果。目前沒有房間自動清理程序。同一房間也不支援重置或重新開局，下一局須建立新房間。

## 新增遊戲的責任分工

伺服器端登錄位置是 `src/games/registry.ts`。`gameDefinitions` 的每個項目符合下列欄位，由 `getGameDefinition(id)` 查詢；`publicGameDefinitions()` 僅提供前端可展示的資訊，不回傳遊戲函式。

```ts
interface GameDefinition {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  game: Game<any>;
  isJoinable: (state: any) => boolean;
  startSetupData: (participantIDs: string[]) => Record<string, unknown>;
  observerView: (state: any, perspective: 'blind' | 'god') => unknown;
  getOutcome: (state: any) => { winner: string; reason: string; roles: Record<string, string> } | null;
}
```

`isJoinable` 是必填函式，收到的是該遊戲的 `G` 狀態。太空維修站只在 `G.status === 'lobby'` 時回傳 `true`；伺服器以此判斷能否加入新玩家、修改準備狀態或開始對局。它不限制重設邀請或加入觀戰。公開遊戲列表只回傳 `id`、`name`、`description`、`minPlayers`、`maxPlayers`，不回傳函式。

`startSetupData(participantIDs)` 讓伺服器用實際座位清單與正確人數直接初始化正式對局。清單由伺服器 metadata 取得，不採用客戶端傳值；移出玩家後可能為 `['0', '2', '3', '4']`，不能假定編號連續，也不能改號導致既有憑證對到別人的座位。遊戲 setup、回合 playOrder、配牌與視角必須使用這份清單，`ctx.numPlayers` 則是實際參與人數。

`observerView` 明確列出允許的觀戰／回放欄位；`getOutcome` 僅在合法終局回傳結果，供統計及賽後分享授權。房主重設邀請不再受開局限制，但開始後邀請只能建立新觀戰身份。新遊戲也需提供前端唯讀快照 renderer；等待室的共用狀態約定為 `G.status`、`G.players[id].ready`。

將規則放進自己的 `src/games/<遊戲目錄>/`，在登錄表新增定義，再於 `src/client` 的遊戲畫面選擇層加入同一個 `id` 對應的 React 元件。伺服器規則模組不要匯入瀏覽器專用元件。

每款遊戲至少需提供穩定的識別碼、顯示名稱、人數範圍、boardgame.io 遊戲定義、玩家視角過濾與前端畫面。登錄新遊戲時，伺服器與前端應使用一致的識別碼；不能只在前端新增按鈕而未註冊伺服器規則。

新增遊戲應驗證：

- 所有允許人數的開局條件與完整勝敗流程。
- 每個操作在錯誤回合、錯誤階段、錯誤操作者或不合法參數時被拒。
- 各玩家與沒有合法身份者都只能取得允許的資訊。
- 重新整理、重連、服務重啟與重複操作不破壞進度。
- 素材來源、授權、手機操作與無障礙基本需求。

共用房間層應維持對遊戲規則的最少了解；個別遊戲專屬條件放在自己的規則中。需要擴充共用介面時，應一次更新伺服器、前端與對應測試，避免同一識別碼在兩端代表不同規則。

## 健康檢查

`GET /api/health` 回傳 `{"status":"ok"}`，供部署後確認 HTTP 服務存活。它不驗證一整局遊戲能否完成、持久化資料是否可恢復，或所有外部玩家是否能建立 WebSocket 連線。

## 版本選擇

boardgame.io 發布套件與 GitHub main 的內容可能不同，不能僅憑 `package.json` 的版本字串推定行為一致。本專案以依賴鎖定檔與測試結果為準。更新 Node.js、boardgame.io、React 或 Socket.IO 時，重新檢查建置、連線、憑證、秘密資訊與持久化相容性。

## 參考資料

- [boardgame.io 多人模式](https://boardgame.io/documentation/#/multiplayer)
- [boardgame.io 秘密資訊](https://boardgame.io/documentation/#/secret-state)
- [boardgame.io 儲存](https://boardgame.io/documentation/#/storage)
