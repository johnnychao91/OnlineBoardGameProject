# 分享連結封面

網站小圖示與社群封面分開：favicon 沿用既有品牌圖，Open Graph／Twitter 使用 `public/social/boardgame-cover-v1.jpg`。封面為 1200 × 630 JPEG，235 KB 左右，維持低於 512 KB；圖片實際尺寸與 HTTP GET／HEAD 由分享預覽整合測試驗證。

## 文案與輸出

- 標題：捷寶桌遊室｜揪朋友，隨時開一桌
- 描述：免下載、免註冊的多人線上桌遊。開房分享連結，就能和朋友一起推理、合作、冒險，還能即時觀戰與賽後復盤。
- 圖片替代文字：暖燈下的卡牌、骰子與冒險地圖，搭配捷寶桌遊室與朋友到齊，隨時開一桌標題

`index.html` 的 `image_src` 指向獨立封面。伺服器使用私有 `PUBLIC_ORIGIN` 產生圖片與頁面絕對網址，不將實際部署網址寫入原始碼。網站、邀請、房間、回放與全部已登錄遊戲的規則頁共用相同封面，不讀取房內玩家或遊戲狀態。Twitter 使用 `summary_large_image`，Open Graph 明確提供圖片格式、尺寸、替代文字與 HTTPS 圖片網址。

未登入的爬蟲可直接讀取 metadata 與圖片，不需執行 JavaScript，也不取得房間權限。查詢參數、邀請、暱稱及憑證不寫入預覽。favicon 不作為封面備援；遺漏分享封面設定或使用非本機圖片路徑時拒絕啟動，避免誤用品牌小圖示。

更換美術時新增版本檔名並同步修改 `image_src`；舊貼文是否重新擷取以及是否顯示描述，仍由各社群平台決定，部署成功不代表既有分享卡片立即更新。

## 美術來源與提示

以內建 imagegen 工具生成原創插畫；交付 JPEG 保留原始構圖，僅縮放至分享尺寸並壓縮。沒有使用截圖或 JB 圖示作為輸入。

生成提示：

```text
Use case: ads-marketing. Asset type: original social sharing / Open Graph cover for a Traditional Chinese browser board game website named 捷寶桌遊室. Create a finished beautiful wide landscape social card, approximately 1200x630 aspect ratio (1.905:1), no rounded card border. Art direction: premium atmospheric hand-painted fantasy illustration, inviting rather than sinister, deep emerald green and dark navy, warm brass and gold highlights, softly glowing amber tabletop lamps. Scene: an elegant wooden board-game table seen from a slightly raised three-quarter perspective, tactile ivory dice, patterned face-down playing cards, a few little chess-like tokens and a beautiful miniature exploration board. An inviting room and softly blurred shelves behind, suggesting friends gathering for mystery, cooperation and adventure. No people necessary, no recognizable commercial board-game art. Refined and uncluttered composition with generous breathing room. Large elegant Traditional Chinese typography is the focus and must be clean, sharp and perfectly legible at small link-preview size. Text (verbatim), centered in upper/left safe area: main heading "捷寶桌遊室"; second line "朋友到齊，隨時開一桌". Avoid any other text. Keep all text and important objects inside the central 85% so thumbnail cropping is safe. Main title in warm ivory/gold, not metallic 3D lettering, tasteful literary serif style. Use soft light and rich painted materials rather than a tech dashboard. This replaces a giant JB logo preview: absolutely no JB letters, no monogram, no site logo, no URLs, no watermark. A complete original illustrated social cover, not a browser or UI screenshot.
```
