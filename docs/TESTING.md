# 測試分工與精簡原則

以保留可驗證的情境與斷言為優先，不以減少測試數量為目標。同一功能經過規則、伺服器、瀏覽器與公開分享等不同入口時，每一層都可能出現自己的錯誤，不能互相取代。

## 測試分工

| 範圍 | 主要檔案 | 必須保留的差異 |
| --- | --- | --- |
| 四款遊戲規則 | `src/games/{station,cipher,fog,moon}/game.test.ts`、`station/view-model.test.ts` | 各人數、角色、模式、勝敗、非法／重複／過期操作、不同觀看身分及舊版存檔 |
| 全遊戲接入契約 | `src/server/framework.test.ts`、`src/client/framework-contract.test.ts` | 依目錄遍歷所有遊戲；伺服器與前端適配器、觀戰、房主、中止、重開、規則頁、音效 |
| 房間與身分 | `src/server/features.test.ts`、`role-switch.test.ts`、`game-switch.test.ts` | 真實 HTTP 授權、失效憑證、重試、競態、房主觀戰、容量及換遊戲 |
| 即時連線與生命週期 | `src/server/transport.test.ts`、`lifecycle.test.ts`、`room-isolation.test.ts` | 真實 Socket.IO、多分頁、重連寬限、離線中止、原房再開、多房並行與隔離 |
| 遊戲整合 | `src/server/station-round-review.test.ts`、`cipher.test.ts`、`fog-integration.test.ts`、`moon-integration.test.ts` | 各遊戲實際操作、完成局、回放、分享、統計、重啟恢復；銀月列車兩種模式與持久化計時 |
| 虛擬玩家 | `src/games/bots.test.ts`、`src/server/test-room.integration.test.ts` | 所有遊戲的合法操作與有限視角、房主管理、重啟、自動準備、測試房不計統計 |
| 儲存與服務邊界 | `src/server/atomic-file.test.ts`、`storage.test.ts`、`app.test.ts` | 原子改名失敗與重試、持久化及舊資料、路徑隔離、Windows 大小寫、正式環境設定 |
| 前端與公開輸出 | `src/client/*.test.ts`、`src/server/link-preview.test.ts` | 身分儲存、切換、秘密遮蔽、SSR、盲視角、戰報白名單、偏好、音效及公開預覽；規則路由依 `GAME_IDS` 檢查 |
| 公開儲存庫 | `scripts/check-public-repo.test.mjs` | 掃描規則本身及真正 Git 追蹤檔案的整合檢查，使用保留示範網址與測試資料 |

測試檔依序執行，避免多個整合測試伺服器爭用磁碟；同一案例中的多人／多房並行操作仍維持並行。真實連線與寫入可以等待完成，但遊戲內的 3 秒門檻、原始截止時間、改票取消、斷線寬限與輪末停留仍須檢查各自邊界，不能為了速度縮短遊戲時間或跳過斷言。

## 何時可以合併

- 同一層、同一前置狀態、同一操作路徑與觀察時點才是候選。不同人數、種子、角色、模式、版本、觀看者或重啟前後時點不直接視為重複。
- 刪除案例前，逐條指出其斷言由哪個保留案例負責；獨有斷言必須搬移。同輸入的純渲染或固定回應可保存結果，供多個斷言使用。
- 驗證重試、冪等、快取、多分頁或副作用的重複呼叫本身就是測試內容，不能快取掉。不同案例仍應各自建立乾淨資料，避免依賴執行順序。
- 保留失敗定位清楚的案例。不要為省一次準備就把不同持久化邊界合成一個大流程，也不要把真實 HTTP／Socket.IO 測試全部換成 mock。

## 本次精簡的覆蓋對應

| 原本重複工作 | 保留的驗證 |
| --- | --- |
| `features.test.ts` 額外建立一次 8 人房，觀戰、開局後拒絕再加入 | 既有 4～8 人參數化案例包含同一 8 人流程；觀戰者的 `access`、人數及沒有 `playerID` 的斷言移入每種人數。開局狀態、憑證與 HTTP 409 斷言保留 |
| `api.test.ts` 對固定 401 回應呼叫相同 API 兩次 | 同一 rejected promise 同時檢查錯誤名稱、狀態及 `ApiError` 型別 |
| `station-display.test.ts`、`host-identity.test.ts`、`test-room.test.ts` 對相同輸入重複 SSR | 每種輸入渲染一次，仍檢查不讀秘密、內容、禁用狀態與容量 |

同時將公開規則預覽的固定兩款遊戲清單改為 `GAME_IDS`，所有登錄遊戲都檢查 GET、HEAD、尾斜線、拒絕額外路徑／POST，以及不洩漏私人輸入、不改動房間。新增遊戲會自動加入這組檢查。

## 驗證方式

在專案目錄使用 Node.js 24：

```sh
npm run typecheck
npm test
npm run test:public
npm run check:public
npm run build
```

GitHub Actions 在 Windows 與 Ubuntu 執行相同流程。Windows 專屬路徑大小寫測試在其他平台略過，不應改成所有平台略過。

精簡前後應比對測試名稱及斷言對應，再執行完整測試。測試總數或單次耗時不能代表覆蓋完整度；時間會受磁碟與系統負載影響。若要保存 JSON 測試報告，輸出到 Git 外的私人工作目錄。

SSR 測試驗證產生的標記與資訊邊界；它不驗證真正瀏覽器的像素排版或點擊流程。修改介面時仍須依[遊戲框架驗收](GAME_FRAMEWORK.md)檢查桌機、手機、觀戰與回放。
