# 房間、觀戰與復盤 API

API 與網頁同源，正式環境使用 HTTPS；開發由 Vite 代理。POST 使用 `Content-Type: application/json`，body 為物件且不超過 4096 bytes，無參數時傳 `{}`。API 回應為 `Cache-Control: no-store`，錯誤為 `{"error":"可顯示的說明"}`。

## 身份與權限

| 身份 | 標頭 | 用途 |
| --- | --- | --- |
| 玩家 | `Authorization: Bearer <credentials>`、`X-Player-ID: <playerID>` | 自己的席位、操作、賽後復盤 |
| 觀戰 | `Authorization: Bearer <credentials>`、`X-Observer-ID: <observerID>` | 房間資訊、唯讀觀戰、賽後復盤 |
| 回放收件者 | `X-Replay-Token: <token>` | 指定終局歷史及發行者選定視角 |

不能同時傳玩家與觀戰身份標頭。房主是玩家 `"0"`，使用自己的玩家憑證；觀戰者沒有玩家席位。知道房號不等於授權。token 不能寫入日誌或分析服務。

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
| `POST /api/rooms/:id/ready` | 玩家 | `{ready:boolean}`，只在等待室；回 `RoomInfo` |
| `POST /api/rooms/:id/start` | 房主 | `{}`，實際 4～8 人全準備後開始；回 `RoomInfo` |
| `POST /api/rooms/:id/invite` | 房主 | `{}`，輪替入房邀請；回 `inviteUrl,expiresAt` |
| `GET /api/rooms/:id/view?perspective=blind` | 觀戰；終局亦可玩家 | `{G,stateID,perspective}`；視角也可為 `god` |
| `GET /api/rooms/:id/replay?perspective=blind` | 玩家／觀戰 | 終局限定 `{complete,frames}`；亦可 `god` |
| `POST /api/rooms/:id/share` | 玩家／觀戰 | 完整終局歷史限定，`{frameIndex,perspective}` → `{url,expiresAt}` |
| `POST /api/rooms/:id/revoke-shares` | 房主 | `{}` → `{revoked:true}`，撤銷全部回放連結 |
| `GET /api/replays/:id` | 回放 token | `{room,perspective,frameIndex,complete,frames}` |

沒有公開房間清單。boardgame.io 原始 Lobby／`games` 端點未掛載。

## 建房與動態人數

```json
{ "gameId": "space-station", "displayName": "小宇", "createKey": "填入建房密鑰" }
```

不傳 `numPlayers`，舊格式回 400。暱稱去空白後須 1～24 個 Unicode code points，不含控制字元。正式環境建房密鑰至少 16 字元；開發可留空。

建立時預留最大席位，等待室只顯示入座參與者。`ready` 更新自己的準備狀態。`start` 與加入請求共用房間序列佇列，檢查實際人數與準備狀態，用新的加密亂數種子初始化正確人數，保留既有席位憑證。觀戰者不進玩家 metadata，也不計配牌。

## 入座與觀戰

`join`、`watch` 接受 `{inviteToken,displayName,requestID?}`。邀請 token 是網址 `#invite=` 後的 43 字元值，有效 24 小時，房主可隨時輪替。開局後只能新增觀戰者。

`requestID` 選填 UUIDv4，但前端會為同一次加入保存並重用，以免手機重試多占席位。伺服器以原邀請、房號、身份類型及 UUID 產生 HMAC 憑證；已成功請求即使邀請輪替或到期，仍可重取原結果。參與與觀戰使用不同 domain，權限不共用。未提供 UUID 不保證冪等。

`inviteToken + requestID` 等同該次身份權限。前端讀取 fragment 後暫存並立即清除網址；加入成功保存 session 後清除加入資料。這不是跨裝置或清除資料後的身份找回服務。

玩家 session = `RoomInfo` + `{access:"player",playerID,credentials}`。觀戰 session = `RoomInfo` + `{access:"spectator",observerID,credentials}`，不含 `playerID`；伺服器只存觀戰憑證雜湊。建房另回 `inviteUrl,expiresAt`，其中期限為 Unix 毫秒。只分享邀請，不分享完整回應。

`RoomInfo`：

| 欄位 | 說明 |
| --- | --- |
| `roomId`, `matchID` | 16 字元 base64url 識別碼，兩者目前相同 |
| `gameName` | 登錄的遊戲識別碼 |
| `numPlayers` | 實際入座參與者數，開局後固定 |
| `minPlayers`, `maxPlayers` | 遊戲人數範圍 |
| `status` | `lobby`, `briefing`, `playing`, `finished` |
| `players` | 已入座者的 `id,name,isConnected,ready`；無憑證 |
| `spectatorCount` | 已發行觀戰身份數，不代表在線人數 |
| `godViewAllowed` | 本版 true；不授予進行中玩家觀戰權限 |

## 視角與回放

`perspective` 預設 `blind`，僅接受 `blind`、`god`。盲視角 `G.private` 為空且無 `secret`，角色在終局快照才公開。上帝視角有全部參與者的角色、設備組成與剩餘牌序；不含未發角色、亂數種子、metadata、plugins 或憑證。等待室尚未配發角色與設備，任何視角都沒有這些秘密。進行中的玩家以自己憑證呼叫 `/view` 回 403；本版無法阻止同一人持邀請另建觀戰身份，需依賴朋友間的信任約定。

完整回放僅終局開放。`frames` 為 `{stateID:number,at:number,G:遊戲觀戰視角}` 陣列，含初始分配、確認、揭牌及各輪重新分配後的狀態。`at` 是伺服器記錄時間（毫秒），不是影片時間碼；無效操作、重複版本不新增一步。

`complete:false` 表示舊局缺歷史或正式對局版本不連續；終局 API 仍會回傳此標示與實際保存的片段，前端顯示無完整復盤，不能以片段假裝整局，也不能建立回放分享。既有 schema 1 對局及身份仍可載入，更新後從等待室開始的新局才重設為完整回放。

## 分享精彩操作

`POST .../share` 傳零起算 `frameIndex`、`perspective`。限已結束、完整歷史、有效步驟。回傳 `url`（`https://game.example.com/replay/房號#share=token`）與 `expiresAt`（發行後 7 天的 Unix 毫秒）。獨立 32-byte token 只存雜湊，頁面立即清除 fragment 並使用 `X-Replay-Token` 讀取。

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

只依持久化且有合法終局結果的對局計算，每個房號一次。未完成、觀戰、回放及重新整理不增加勝敗。`totalPlayerParticipations` 是參與人次，不是獨立人數；沒有個人戰績或暱稱排名。

## Socket.IO 與限制

正式對局使用 boardgame.io client 的 `matchID,playerID,credentials`，同源 `/socket.io`、namespace `/space-station`。帶 Origin 時須符合允許來源；同源 polling 可不帶 Origin，仍須驗證席位。單一連線綁定一個席位。

Socket 只接受白名單 `MAKE_MOVE`，強制拒絕 `startGame`（走 HTTP）、框架事件、聊天、undo、redo、reset、plugin。正式遊戲使用 `acknowledge` 與 `reveal`；保留 `setReady` 規則相容性，新等待室使用 HTTP。

每 IP 的 `GET /api/rooms/:id` 與 `GET /api/rooms/:id/view` 共用獨立的 1200 次／分輪詢額度，其他 API 共用 240 次／分額度，避免同一 Wi-Fi 的房間輪詢占用操作額度。另有限制：統計 30 次／分、`join` 與 `watch` 合計 30 次／分、建房 12 次／10 分。這些請求頻率限制為單程序記憶體計數，重啟歸零。

Socket 每連線 180 包／分、單包 16 KiB。每房最多 128 份觀戰身份與 64 個尚未過期的回放分享；這些資料會保存，重啟不會清空。

400 格式錯誤；401 身份無效；403 權限／邀請／分享失效；404 未知端點／房號；409 狀態／人數／準備衝突；410 缺對局；413 過大；415 非 JSON；429 過頻；500 未公開的內部錯誤。

尚無原房再開局、離席釋放、踢人、席位轉移、身份找回、刪除房間、自動清理 API；下一局新建房間。
