# 分享連結封面

瀏覽器分頁使用 `public/endless-bar-icon.svg` 的星光酒杯圖案。Open Graph／Twitter 使用有字封面 `public/social/endless-bar-cover-v2.jpg`。分享預覽整合測試會驗證 1200 × 630 JPEG 的尺寸與 HTTP GET／HEAD。

## 文案與輸出

- 標題：未央酒肆 Endless Bar
- 描述：免下載、免註冊的多人線上桌遊。開房分享連結，就能和朋友一起推理、合作、冒險，還能即時觀戰與賽後復盤。
- 圖片替代文字為「雲海酒館夜景上的金色標題『未央酒肆 Endless Bar』，前景有牌、骰子與酒杯」。

`index.html` 的 `image_src` 指向獨立封面。伺服器使用私有 `PUBLIC_ORIGIN` 產生圖片與頁面絕對網址，不將實際部署網址寫入原始碼。網站、邀請、房間、回放與全部已登錄遊戲的規則頁共用相同封面，不讀取房內玩家或遊戲狀態。Twitter 使用 `summary_large_image`，Open Graph 明確提供圖片格式、尺寸、替代文字與 HTTPS 圖片網址。

未登入的爬蟲可直接讀取 metadata 與圖片，不需執行 JavaScript，也不取得房間權限。查詢參數、邀請、暱稱及憑證不寫入預覽。favicon 不作為封面備援；遺漏分享封面設定或使用非本機圖片路徑時拒絕啟動，避免誤用品牌小圖示。

更換美術時新增版本檔名並同步修改 `image_src`；舊貼文是否重新擷取以及是否顯示描述，仍由各社群平台決定，部署成功不代表既有分享卡片立即更新。

## 未央酒肆插畫

有字分享封面使用內建 imagegen 編輯無字封面 `public/social/endless-bar-cover-v1.jpg`，參考 `public/social/boardgame-cover-v1.jpg` 的金色字體、分隔線與置中排版。

```text
Use case: precise-object-edit. Asset: a 1200 × 630 social sharing cover. The first image, endless-bar-cover-v1.jpg, is the edit target. The second image, boardgame-cover-v1.jpg, is a typography and layout reference only. Keep the first image's entire landscape crop, original lavender cloud tavern, moon, gold arc, lanterns, furniture and tabletop art, with their original positions and colors. Add a single large, centered Traditional Chinese title 「未央酒肆」 in warm ivory-gold Song/Ming serif lettering across the upper-middle open sky, matching the elegance and visual weight of the old cover. Beneath it place a thin gold ornamental divider and the smaller centered serif subtitle “Endless Bar”. The title is four exact characters, 未 央 酒 肆, without spaces or quotation marks in the artwork. Make it clearly legible at social thumbnail size. Keep all typography well inside the safe margins, and clear of the moon, tabletop, and gold arc. No other text, no logos, no panels, no border, no watermark. Preserve the wide 40:21 framing.
```

最後用同一工具微調字組的水平位置。

```text
Use case: precise-object-edit. Image 1 is the only edit target, the finished Endless Bar cover. Make a tiny typography alignment correction ONLY. Move the complete existing title/ornament/subtitle group horizontally LEFT by approximately 41 pixels on the attached 1731px canvas (2.4% of total width); align the midpoint of the Chinese title bounding box, the ornament's diamond center, and the midpoint of the English subtitle to the vertical centerline of the entire image, x=50%. Use equal left and right space from the image borders for each line; the window opening is not the alignment reference. Keep the group's existing vertical position, typography, scale, color, exact spelling '未央酒肆' and 'Endless Bar', and spacing. Make the same landscape canvas with the same aspect ratio, and preserve the background, composition, crop, cloud, moon, objects and lighting outside the typography. No guide line, no additional text.
```

首頁插圖與預設背景使用 `src/client/assets/art/endless-bar-tavern.webp`。原圖使用內建 imagegen 生成，以 Tolanir 的粉彩水彩地平線配色和未央酒肆的雲間酒館為美術參考。

```text
Use case: stylized-concept. Asset type: ultra-wide website background for 未央酒肆 / Endless Bar, a fantasy board-game tavern in the clouds. Create a new original 16:9 landscape painting, a nocturnal counterpart to Tolanir's pastel watercolor horizon: grainy watercolor paper, sweeping lilac mist, indigo sky, lavender waves of clouds and a delicate thin champagne-gold celestial arc. View from inside an elegant intimate fantasy tavern above the clouds. Wide open arched window with dark violet layered cloud sea and a distant moon on the upper right, warm small hanging lanterns, shelves of bottles, wooden table in lower foreground with dice, cards, and two small goblets. Welcoming, literary and dreamlike. Strong edge framing, calmer lower-contrast central area for white web UI text, rich dark indigo/lavender values and sparing gold lights. Artwork only, no people, text, logos, watermark, or UI.
```

## 捷寶桌遊室無字版本

`src/client/assets/art/home-table-v1.jpg` 是可選背景「捷寶桌遊室」的獨立插圖。先前使用內建 imagegen 從原分享封面移除文字和分隔線，保留桌遊室構圖，再輸出為 1200 × 630 JPEG。

編輯提示：

```text
Use case: precise-object-edit. Edit target: the provided original boardgame-cover-v1.jpg, a 1200 by 630 warm fantasy board game room illustration. Primary request: produce the identical image WITHOUT ANY OVERLAID TEXT. Remove both the large Chinese title 捷寶桌遊室 and the smaller Chinese slogan 朋友到齊，隨時開一桌, and remove the thin gold decorative divider / flourish between those two lines. Seamlessly reconstruct only the room background previously hidden by that lettering and line. Preserve the same composition, camera, full landscape framing, blue nighttime castle through the left window, warm lanterns, shelves, wood table, maps, cards, dice, game pieces, coins, chair, emerald and amber palette and all existing objects and lighting. Do not add new foreground objects to fill the removed text. Keep everything outside the text and divider area unchanged as closely as possible. No typography, no characters, no logo, no watermark, no graphic ornaments in the erased region. Opaque background. Output the full edited landscape artwork.
```

## 美術來源與提示

以內建 imagegen 工具生成原創插畫；交付 JPEG 保留原始構圖，僅縮放至分享尺寸並壓縮。沒有使用截圖或 JB 圖示作為輸入。

生成提示：

```text
Use case: ads-marketing. Asset type: original social sharing / Open Graph cover for a Traditional Chinese browser board game website named 捷寶桌遊室. Create a finished beautiful wide landscape social card, approximately 1200x630 aspect ratio (1.905:1), no rounded card border. Art direction: premium atmospheric hand-painted fantasy illustration, inviting rather than sinister, deep emerald green and dark navy, warm brass and gold highlights, softly glowing amber tabletop lamps. Scene: an elegant wooden board-game table seen from a slightly raised three-quarter perspective, tactile ivory dice, patterned face-down playing cards, a few little chess-like tokens and a beautiful miniature exploration board. An inviting room and softly blurred shelves behind, suggesting friends gathering for mystery, cooperation and adventure. No people necessary, no recognizable commercial board-game art. Refined and uncluttered composition with generous breathing room. Large elegant Traditional Chinese typography is the focus and must be clean, sharp and perfectly legible at small link-preview size. Text (verbatim), centered in upper/left safe area: main heading "捷寶桌遊室"; second line "朋友到齊，隨時開一桌". Avoid any other text. Keep all text and important objects inside the central 85% so thumbnail cropping is safe. Main title in warm ivory/gold, not metallic 3D lettering, tasteful literary serif style. Use soft light and rich painted materials rather than a tech dashboard. This replaces a giant JB logo preview: absolutely no JB letters, no monogram, no site logo, no URLs, no watermark. A complete original illustrated social cover, not a browser or UI screenshot.
```
