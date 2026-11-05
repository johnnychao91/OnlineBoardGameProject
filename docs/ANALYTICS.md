# Google Analytics 4

`GA_MEASUREMENT_ID` 是選填的伺服器環境設定。未設定時不載入 Analytics；填入與主站相同的 GA4 `G-` 衡量 ID，即使用同一個資料串流。實際 ID 只放 Git 外的私人環境設定，不寫進 HTML 或公開文件。衡量 ID 是供瀏覽器載入的識別值，並非 API 密鑰；本站不需要 Analytics API secret。

## 啟用前的 GA4 設定

本平台自行傳送已去除房間資訊的 `page_view`。請在 Google Analytics「管理 → 資料串流 → 原本主站的網頁串流」複製衡量 ID，並**關閉該串流的「加強型評估」（Enhanced measurement）**，防止自動換頁、表單、點擊等事件另行讀取完整網址。這是啟用前必做的設定，也會影響共用串流的主站：一般 Google tag 頁面載入統計仍可運作，但原本依賴加強型評估的互動事件會停止。若主站本身是 SPA，須確認主站原有換頁統計另有手動處理。

網站每次載入均設 `send_page_view:false`，只自行發送首次開啟及應用程式換頁事件。Google 官方指出，僅設定此值不會停止加強型評估的歷史換頁事件，因此仍須完成上一步。不要另外安裝重複的 Google tag 或 GTM 換頁觸發器。

## Pi 私人設定

先更新程式，再編輯 `/etc/boardgame.env`：

```bash
sudo nano /etc/boardgame.env
```

加入 `GA_MEASUREMENT_ID=`，等號後貼入主站原本的完整衡量 ID。不更動既有 AdSense、房間暗語及其他環境值。儲存後在適合重啟的時間執行：

```bash
sudo systemctl restart boardgame
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 \
  http://127.0.0.1:3001/api/health
```

此值於服務啟動時讀取，之後變更只需重啟，不必重新建置。既有 Git 更新流程不覆寫 `/etc/boardgame.env`。留空並重啟可停用新開頁面的 Analytics；已開啟的頁面需重新整理。

## 報表與資料範圍

- 共用衡量 ID 時，以 GA4 的「主機名稱」（Hostname）維度或比較條件區分主站與子網域。單看路徑 `/` 會合併兩站首頁；也可使用完整頁面網址維度。
- 首頁、規則、隱私權、房間、加入及復盤入口共用 Analytics。它獨立於廣告資格；免廣告、VIP 及測試房不代表停用流量統計，也不會改變遊戲成績統計。
- 公開規則保留各遊戲路徑；房間、加入及復盤統一為 `/room`、`/join`、`/replay`。移除查詢字串與 fragment，來源網址最多保留 origin；頁面標題使用固定名稱，不讀取暱稱、房間設定或遊戲狀態，不送自訂玩家 ID。
- 只計換頁，不因輪次、排序、秘密資訊展開、輪詢、同路徑的查詢及 fragment 變化增加 page view。
- 關閉 Google signals 與廣告個人化訊號；Analytics 仍可能建立分析 Cookie 並處理瀏覽器、裝置與連線資訊。網站隱私權頁已有相應說明。
- 配置請求或 Google tag 被阻擋不影響遊戲；未啟用時維持原 CSP，啟用時只補 Analytics 所需來源，不加入 inline script 權限。

啟用後開啟網站並在 GA4「即時」查看主機名稱與路徑。房間事件應只顯示 `/room`，不含房號、查詢字串或邀請權杖。一般報表處理時間由 Google 決定。

參考：[手動頁面瀏覽與停止歷史自動偵測](https://developers.google.com/analytics/devguides/collection/ga4/views)、[報表維度](https://developers.google.com/analytics/devguides/reporting/data/v1/exploration-api-schema)、[Google tag CSP](https://developers.google.com/tag-platform/security/guides/csp)。
