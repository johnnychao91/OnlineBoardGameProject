# 房間、觀戰與復盤 API

API 與網頁同源，正式環境使用 HTTPS；開發由 Vite 代理。POST 使用 `Content-Type: application/json`，body 為物件且不超過 4096 bytes，無參數時傳 `{}`。API 回應為 `Cache-Control: no-store`，錯誤為 `{"error":"可顯示的說明"}`。

## 身份與權限

| 身份 | 標頭 | 用途 |
| --- | --- | --- |
| 玩家 | `Authorization: Bearer <credentials>`、`X-Player-ID: <playerID>` | 自己的席位、操作、賽後復盤 |
| 觀戰 | `Authorization: Bearer <credentials>`、`X-Observer-ID: <observerID>` | 房間資訊、唯讀觀戰、賽後復盤；觀戰房主另有房間管理權 |
| 回放收件者 | `X-Replay-Token: <token>` | 指定終局歷史及發行者選定視角 |

不能同時傳玩家與觀戰身份標頭。玩家房主由 `RoomInfo.hostPlayerID` 指定，第一任為 `"0"`；房主切到觀戰後以 `hostObserverID` 指定，`hostPlayerID` 為 `null`，使用自己的觀戰憑證管理房間。切回玩家時改回玩家房主，`hostObserverID` 為 `null`。房主端點接受這兩種有效房主身分，普通觀戰者沒有管理權；所有觀戰者都沒有玩家席位。知道房號或房主 ID 不等於授權。token 不能寫入日誌或分析服務。

## 端點

| 方法／路徑 | 授權 | 回應／行為 |
| --- | --- | --- |
| `GET /api/health` | 無 | `{"status":"ok"}` |
| `GET /api/games` | 無 | `{games:[{id,name,description,minPlayers,maxPlayers}]}` |
| `GET /api/stats` | 無 | 全站彙整，無房號、姓名或私人資訊 |
| `POST /api/rooms` | body `createKey` | `201`，玩家 session + `inviteUrl,expiresAt` |
| `POST /api/rooms/:id/join` | body 邀請 | 玩家 session；開始後拒絕新玩家 |
| `POST /api/rooms/:id/watch` | body 邀請 | 觀戰 session；任何階段都可加入 |
| `GET /api/rooms/:id` | 玩家／觀戰 | `RoomInfo` |
| `POST /api/rooms/:id/switch-role` | 玩家／觀戰 | `{access,matchID,requestID}`，只在等待室切換參與／觀戰；回新身分 session |
| `POST /api/rooms/:id/game` | 房主 | `{matchID,gameId}`，只在等待室選擇或更換遊戲，重設準備；回 `RoomInfo` |
| `POST /api/rooms/:id/ready` | 玩家 | `{ready:boolean,matchID}`，只在等待室；回 `RoomInfo` |
| `POST /api/rooms/:id/remove` | 房主 | `{playerID,membershipID}`，只在等待室單次移出其他玩家；回 `RoomInfo` |
| `POST /api/rooms/:id/start` | 房主 | `{matchID}`，符合該遊戲的人數範圍且全員準備後開始；回 `RoomInfo` |
| `POST /api/rooms/:id/return` | 房主 | `{matchID}`，正常終局後返回等待室；通常由伺服器自動處理 |
| `POST /api/rooms/:id/abort` | 房主 | `{matchID}`，提前結束目前局，不計勝敗；回新等待室的 `RoomInfo` |
| `POST /api/rooms/:id/leave` | 玩家／觀戰 | `{}`，撤銷自己的身份，房主必要時交接；回 `{left:true}` |
| `POST /api/rooms/:id/heartbeat` | 玩家／觀戰 | `{sessionID:UUIDv4}`，更新目前分頁的在線期限；回 `{ok:true}` |
| `POST /api/rooms/:id/invite` | 房主 | `{}`，輪替入房邀請；回 `inviteUrl,expiresAt` |
| `GET /api/rooms/:id/view?perspective=blind` | 觀戰；終局亦可玩家 | `{G,stateID,perspective}`；視角也可為 `god` |
| `GET /api/rooms/:id/replay?perspective=blind&matchID=對局ID` | 玩家／觀戰 | 正常終局限定 `{room,complete,frames}`；亦可 `god`；`room` 是該歷史局的名單 |
| `POST /api/rooms/:id/share` | 玩家／觀戰 | 完整終局歷史限定，`{matchID,frameIndex,perspective}` → `{url,expiresAt}` |
| `POST /api/rooms/:id/revoke-shares` | 房主 | `{}` → `{revoked:true}`，撤銷這個房間全部局的回放連結 |
| `GET /api/replays/:id` | 回放 token | `{room,perspective,frameIndex,complete,frames}` |

沒有公開房間清單。boardgame.io 原始 Lobby／`games` 端點未掛載。

## 建房與動態人數

```json
{ "displayName": "小宇", "createKey": "填入建房密鑰" }
```

不傳 `numPlayers`，舊格式回 400。暱稱去空白後須 1～24 個 Unicode code points，不含控制字元。正式環境建房密鑰至少 16 字元；開發可留空。

`gameId` 選填，省略時建立尚未選遊戲的等待室（`gameSelected:false`），不能準備或開局；底層 `gameName` 不表示房主已選定遊戲。仍接受舊客戶端傳入 `space-station`（太空維修站，4～8 人）或 `encrypted-call`（加密通話，2～4 人），完整列表以 `/api/games` 為準。`RoomInfo.status` 的 `lobby` 為共用等待室，其餘由遊戲決定；加密通話另有 `syncing`、`playing`、`pulse`、`intermission`、`finished`。

房主（包含觀戰房主）可用 `game` 端點選擇遊戲，須帶目前等待室的 `matchID`。換遊戲建立新等待室 ID、清除全員準備，保留房號、成員座位與憑證、房主、邀請和歷史；舊 ID 的操作不得套用到新等待室。對局中拒絕換遊戲。房間參與席容量 `roomCapacity` 為 8，與遊戲開局上限分開；換成 2～4 人遊戲仍保留所有成員，超過 4 人時不能開始，須自行改為觀戰或離開。

建立時預留房間容量，等待室顯示實際參與者與獨立觀戰名單。`ready` 更新自己的準備狀態。`start`、加入、移出、選遊戲與身分切換請求共用房間序列佇列，檢查實際人數與準備狀態，用新的加密亂數種子初始化正確人數，保留既有席位 ID 與憑證。席位不必連續；遊戲登錄的 `startSetupData(participantIDs)` 接收伺服器核對過的參與席位，遊戲依此建立角色、牌與行動順序。觀戰者不進玩家 metadata，也不計配牌。

## 等待室切換身分

`switch-role` 的 `access` 必須為 `"player"` 或 `"spectator"`；`matchID` 為目前等待室 ID，`requestID` 為必填 UUIDv4。使用目前身分的授權標頭，不需重新提供邀請或暱稱。只能在等待室轉為另一種身分；遊戲進行中、所選身分相同、參與席位或觀戰席已滿，均回 409。參與席上限為房間容量 8 位，觀戰席最多 128 位。

成功後回傳新的玩家或觀戰 session，保留房號、暱稱、邀請、歷史及其他成員憑證；原憑證立即失效。新入座玩家須重新準備，其他玩家的準備狀態保留。房主改為觀戰時保留管理權，更新為 `hostObserverID`；即使沒有玩家，也不會將房主交給下一位入座者。觀戰房主切回玩家後，管理權跟隨新的玩家身分。只有房主主動離開房間才交接給剩餘玩家；沒有玩家時兩個房主欄位皆為 `null`，下一位入座者接任。

每次成功切換會建立新的等待室 `matchID`，舊等待室不加入歷史、回放或戰績。新身分、觀戰名單及重試紀錄隨房間索引一起發布；發布失敗時舊身分仍可使用。客戶端收到新 session 後應完整替換身分，不能只更改 `access`。舊 Socket 關閉，舊 `matchID` 的操作不能套用至新等待室。

同一次請求遺失回應時，保留原身分授權與原 `access,matchID,requestID` 重試，可取回相同的新憑證；伺服器重啟或其他成員切換不會使這次恢復失效。若目標身分已離開、被移出或再次切換，舊重試回 401，不能復活它。舊憑證不能換用新的 UUID 或不同操作取得另一個身分，原加入請求也不能重新占位。重試取回的是既有切換結果，即使此後開局也不會執行第二次切換。

## 房主單次移出

房主對等待室內其他已入座玩家呼叫 `remove`，body 傳該列 `id` 作為 `playerID`，及該列 `membershipID`。`membershipID` 是這次入座的公開識別值，不能用於認證；若席位已換人，舊值回 409，避免過期畫面或重送請求誤移出新玩家。玩家房主不能移出自己；觀戰房主可管理玩家席位，普通觀戰者不能使用此端點；對局開始或結束後都回 409。

成功後原席位憑證立即失效、既有 Socket 斷線，清除準備狀態並釋出席位。憑證撤銷雜湊、席位及準備狀態在同一份對局檔案原子更新；重啟後仍有效。原本 `inviteToken + requestID` 的入座重試回 `403` 與 `{error:"說明",code:"ADMISSION_REMOVED"}`，不能恢復被移出的身份；前端清除該次加入請求識別碼，由使用者再次選擇加入，避免遺失回應後一直重試同一份已撤銷請求。既有身份讀取或操作回 401，前端清除失效身份並提示重新開啟邀請。

這是單次移出，沒有封鎖名單。同一人可重新開啟仍有效的邀請，以新的加入請求重新入座，取得全新憑證並重新準備。房主若不希望舊邀請繼續使用，可另外輪替邀請；其他已入座玩家不受影響。

## 同房再開局、離開與空房

`roomId` 是穩定的邀請／房間識別碼，`matchID` 是目前等待室或對局識別碼，不能假定兩者永遠相等。正常終局會自動封存並回到原房間；房主可提前 `abort`。兩者都建立新的 `matchID`、清除準備狀態，保留仍有效的成員與邀請。舊對局不會被新局覆蓋，舊 Socket 及操作也不能切換到新局。

`return` 與 `abort` 必須指定畫面確認時的 `matchID`，過期值回 409；`ready`、`start` 亦傳目前 ID，避免舊畫面操作新等待室。房主資格由伺服器重新檢查。`abort` 不產生勝方或戰績，只保存中止摘要，不開放未完成對局的回放。

版本 3 的太空維修站終局先保留至少 8 秒，再自動返回等待室。伺服器第一次偵測終局時保存對局 ID 與截止時間，輪詢與重啟不會延長期限；`RoomInfo.completedDisplayUntil` 是截止的 Unix 毫秒。在期限前呼叫 `return` 回 409，`abort` 也不能把已完成局變成中止；勝敗、觀戰快照與終局回放已成立，不必等返回等待室。其他遊戲及舊規則保持原本流程。

`leave` 撤銷整個玩家／觀戰身份，包括該身份的其他分頁；原加入重試不能恢復已離席的憑證。房主離開後交接給剩餘玩家。對局中離席不把角色和設備交給新人，原參與者暱稱仍保留在歷史。新玩家只在等待室加入。

前端每個分頁使用自己的隨機 `sessionID`，每 20 秒送出已認證的心跳，期限為 60 秒；玩家 Socket 連線也納入在線判斷。關閉分頁不呼叫 `leave`，單一分頁關閉不會撤銷其他分頁。所有玩家與觀戰者都逾重連期限後，伺服器自動中止進行中的對局；最後一位成員明確離席則可立即中止。服務重啟先保留同等重連寬限。公開分享的收件者不屬於房間在線成員，觀看分享不會延長對局。

## 入座與觀戰

`join`、`watch` 接受 `{inviteToken,displayName,requestID?}`。邀請 token 是網址 `#invite=` 後的 43 字元值，有效 24 小時，房主可隨時輪替。開局後只能新增觀戰者。

`requestID` 選填 UUIDv4，但前端會為同一次加入保存並重用，以免手機重試多占席位。伺服器以原邀請、房號、身份類型及 UUID 產生 HMAC 憑證；仍有效的已成功請求即使邀請輪替或到期，仍可重取原結果，被房主移出的入座除外。參與與觀戰使用不同 domain，權限不共用。未提供 UUID 不保證冪等。

`inviteToken + requestID` 等同該次身份權限。前端讀取 fragment 後暫存並立即清除網址；加入成功保存 session 後清除加入資料。這不是跨裝置或清除資料後的身份找回服務。

玩家 session = `RoomInfo` + `{access:"player",playerID,credentials}`。觀戰 session = `RoomInfo` + `{access:"spectator",observerID,credentials}`，不含 `playerID`；伺服器只存觀戰憑證雜湊。建房另回 `inviteUrl,expiresAt`，其中期限為 Unix 毫秒。只分享邀請，不分享完整回應。

`RoomInfo`：

| 欄位 | 說明 |
| --- | --- |
| `roomId`, `matchID` | 16 字元 base64url 識別碼；房號穩定，返回等待室或切換身分時目前對局 ID 更新 |
| `gameName` | 登錄的遊戲識別碼 |
| `gameSelected` | 是否已選定遊戲；舊資料缺省視為 `true`，`false` 時不可準備／開局 |
| `roomCapacity` | 房間參與席容量 8；與所選遊戲的 `maxPlayers` 不同 |
| `numPlayers` | 實際入座參與者數，開局後固定 |
| `minPlayers`, `maxPlayers` | 遊戲人數範圍 |
| `status` | 共用 `lobby`；太空維修站另有 `briefing`, `claiming`, `playing`, `round-review`, `finished`，其他遊戲依自身定義 |
| `players` | 等待室為有效入座者；對局中保留原參與者的 `id,name,isConnected,ready,departed,membershipID?`，無憑證，ID 可能缺號；歷史投影不含目前連線／管理識別值 |
| `spectatorCount` | 已發行觀戰身份數，不代表在線人數 |
| `spectators` | 有效觀戰身分的 `{id,name}` 名單，不含憑證或憑證雜湊；僅已認證房間成員可讀取，歷史投影為 `[]` |
| `godViewAllowed` | 本版 true；不授予進行中玩家觀戰權限 |
| `hostPlayerID` | 目前房主座位字串；沒有玩家時為 `null` |
| `completedDisplayUntil` | 選填；目前終局牌桌的最早自動返回時間，Unix 毫秒，歷史投影不帶此欄位 |
| `history` | 依結束順序的 `{matchID,gameName,endedAt,ending,numPlayers,winner?,reason?}`；`ending` 為 `completed`、`host-ended` 或 `empty`。每局依自身遊戲渲染與統計，沒有秘密牌面 |

## 視角與回放

`perspective` 預設 `blind`，僅接受 `blind`、`god`。盲視角 `G.private` 為空且無 `secret`，角色在終局快照才公開。上帝視角有全部參與者的角色、設備組成與剩餘牌序；不含未發角色、亂數種子、metadata、plugins 或憑證。等待室尚未配發角色與設備，任何視角都沒有這些秘密。進行中的玩家以自己憑證呼叫 `/view` 回 403；本版無法阻止同一人持邀請另建觀戰身份，需依賴朋友間的信任約定。

完整回放僅終局開放。`frames` 為 `{stateID:number,at:number,G:遊戲觀戰視角}` 陣列，含初始分配、確認、宣稱、預選／取消、揭牌及各輪重新分配後的狀態。`at` 是伺服器記錄時間（毫秒），不是影片時間碼；無效操作、重複版本不新增一步。

`complete:false` 表示舊局缺歷史或正式對局版本不連續；終局 API 仍會回傳此標示與實際保存的片段，前端顯示無完整復盤，不能以片段假裝整局，也不能建立回放分享。既有 schema 1 對局及身份仍可載入，更新後從等待室開始的新局才重設為完整回放。

返回等待室後，讀取歷史必須帶 `history` 中的 `matchID`；省略時仍選目前對局，等待室沒有終局回放，會回 409。任何歷史 ID 都必須屬於已認證的同一房間，不能藉由改參數跨房。房間復盤與分享回應的歷史 `room` 只含原局玩家名單，`history` 與 `spectators` 為空陣列、`hostPlayerID` 為 `null`、`spectatorCount` 為 0，不透露目前觀戰者或後來的房間活動。

## 分享精彩操作

`POST .../share` 傳歷史 `matchID`、零起算 `frameIndex`、`perspective`。限正常結束、完整歷史、有效步驟。回傳 `url`（`https://game.example.com/replay/房號#share=token`）與 `expiresAt`（發行後 7 天的 Unix 毫秒）。獨立 32-byte token 只存雜湊，並綁定原對局、步驟及視角；頁面立即清除 fragment 並使用 `X-Replay-Token` 讀取。下一局不會改變舊連結的內容。

收件者從指定步驟觀看整局，`frameIndex` 是初始播放位置，不是裁切片段；但只能看發行者選定的視角，不能升級、入座或操作。API 使用儲存的視角與步驟，忽略收件者附加的視角或步驟參數。房主可撤銷所有回放分享，不影響入房邀請或既有身份。每房最多 64 個未過期分享，失效回 403。

PNG 戰報由瀏覽器 canvas 產生，只取公開事件、暱稱與任務進度；即使目前是上帝視角，也不含秘密角色、暗牌順序、憑證與網址。沒有上傳 API；支援時呼叫手機檔案分享，否則下載。撤銷連結不能收回已下載的圖片或資料。

## 全站統計

```ts
{
  completedGames: number;
  totalPlayerParticipations: number;
  byGame: {
    gameId: string; name: string; completed: number;
    wins: Record<string, number>;
    reasons: Record<string, number>;
    byPlayerCount: { numPlayers: number; completed: number; wins: Record<string, number> }[];
  }[];
}
```

只依持久化且有合法終局結果的對局計算，每個對局 ID 一次；同一房間完成兩局就計兩局。中止、未完成、觀戰、回放及重新整理不增加勝敗。`totalPlayerParticipations` 是參與人次，不是獨立人數；沒有個人戰績或暱稱排名。

## Socket.IO 與限制

正式對局使用 boardgame.io client 的 `matchID,playerID,credentials`，同源 `/socket.io`、namespace `/space-station`。帶 Origin 時須符合允許來源；同源 polling 可不帶 Origin，仍須驗證席位。單一連線綁定一個席位。

Socket 只接受白名單 `MAKE_MOVE`，強制拒絕 `startGame`（走 HTTP）、框架事件、聊天、undo、redo、reset、plugin。保留 `setReady` 規則相容性，新等待室使用 HTTP。

太空維修站新局使用 `rulesVersion: 3`，正式操作如下：

| 操作 | 參數與限制 |
| --- | --- |
| `acknowledge()` | `briefing` 階段確認自己的資訊；全員完成進入 `claiming` |
| `declareRepairs(count, round)` | `claiming` 階段，整數 0～`min(players[id].cardCount, repairsRequired - repairsFound)`，每人一次；必須帶當輪編號，允許同輪多人並行宣稱及與真實牌數不同，全員完成進入 `playing` |
| `acknowledgeBriefing(round)` | 版本 3 的 `briefing` 階段，帶目前輪次確認自己的資訊；允許多人同時確認，過期輪次及重複確認拒絕 |
| `selectCard(targetID, slot)` | 目前檢修者預選別人的未翻牌，`slot` 為本輪固定的零起算牌位 |
| `clearSelection()` | 目前檢修者取消公開預選 |
| `reveal(targetID, slot, selectionID)` | 目前檢修者確認與伺服器 `pendingReveal` 完全一致的預選；過期／缺少識別值、已翻牌、自選均拒絕 |
| `acknowledgeRound(round)` | 版本 3 的 `round-review` 階段，參與玩家各確認一次；須傳目前輪次，允許同輪並行確認，全員完成後重新發牌 |

`G.publicCards[playerID]` 是本輪固定牌位的陣列，未翻為 `null`，已翻為設備種類；`cardCount` 只計剩餘暗牌。`G.players[playerID].claim` 是本輪起始時的宣稱，不代表真實剩餘牌數。未提交時為 `null`；宣稱階段尚未提交的玩家收到他人的數字也為 `null`，應使用投影欄位 `claimSubmitted` 判斷對方是否已提交。自己提交後即可取得其他人的已提交數字，觀戰與賽後復盤保持可見。`claimSubmitted` 只用於傳送進度，不另存入原始遊戲狀態。

`G.pendingReveal` 包含 `actorID,targetID,slot,round,selectionID`，不帶暗牌種類；預選序號在同一局遞增，取消、換人、換輪或終局會清除預選。這些欄位依各自可見範圍同步給玩家、觀戰及對應歷史步驟。

版本 3 非終局的最後一次揭牌進入 `round-review`，保留本輪 `publicCards`、`log`、宣稱及最後被揭牌者，使用 `players[id].reviewAcknowledged` 表示確認進度。未全員確認前不洗牌，也不允許選牌或揭牌；確認最後一人後才進入下一輪 `briefing`。直接產生勝負時進入 `finished`，不等待輪末確認。

玩家仍只收到自己的秘密陣營與剩餘組成。上帝視角的 `secret.cards` 在版本 2、3 都保留本輪完整固定牌序，配合 `publicCards` 區分已翻與未翻。版本 2 在輪末仍立即重新發牌；未帶 `rulesVersion` 的舊局保留兩參數 `reveal`、緊縮牌列及確認後直接行動。新版介面能讀取各版本歷史，不會重寫舊回放。

每個房間有自己的狀態、亂數種子、操作佇列與持久化檔案。玩家、觀戰及分享憑證都在指定房間內驗證，Socket 綁定一個房間的一個席位。全站戰績按設計彙整不同房間的已完成對局，各局只算一次。

每 IP 的 `GET /api/rooms/:id` 與 `GET /api/rooms/:id/view` 共用獨立的 1200 次／分輪詢額度，其他 API 共用 240 次／分額度，避免同一 Wi-Fi 的房間輪詢占用操作額度。另有限制：統計 30 次／分、`join` 與 `watch` 合計 30 次／分、建房 12 次／10 分。這些請求頻率限制為單程序記憶體計數，重啟歸零。

Socket 每連線 180 包／分、單包 16 KiB。每房最多 128 份觀戰身份與 64 個尚未過期的回放分享；這些資料會保存，重啟不會清空。

400 格式錯誤；401 身份無效；403 權限／邀請／分享失效；404 未知端點／房號；409 狀態／人數／準備衝突；410 缺對局；413 過大；415 非 JSON；429 過頻；500 未公開的內部錯誤。

尚無房主在進行中移出玩家、移出觀戰者、將角色交接給新人、身份找回、刪除房間或自動清理歷史 API。全員離線中止只結束當前局，不刪除房間與回放。
