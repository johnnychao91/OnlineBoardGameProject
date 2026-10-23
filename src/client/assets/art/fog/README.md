# 黑霧襲城美術素材

場景與道具最初於 2026-10-21 使用內建 `image_gen` 逐張生成；十張角色圖於 2026-10-23 依原創名稱與背景重新生成。每張圖分別生成與檢視，未套用商業桌遊的圖像或角色造型參考。角色名對應遊戲中的身分；人物外觀與道具是本專案的新設計。

畫面使用手繪墨線、交叉排線、舊羊皮紙與木炭灰色調，守夜騎士以晨光、燈塔與星辰為意象，黑霧使徒加入深海、貝殼、潮汐與黑霧意象；色彩以薄荷綠、暗紅與氧化青銅點綴。圖像不含規則文字，文字及數字由介面提供。所有圖片僅供「美術」模式使用。

## 素材清單

| 檔案 | 內容 | 背景 |
| --- | --- | --- |
| `city.webp` | 黑霧城鎮背景 | 不透明場景 |
| `merlin.webp` | 逐星神諭者 | 透明 alpha |
| `percival.webp` | 聆諭騎士 | 透明 alpha |
| `loyal.webp` | 城郊守衛 | 透明 alpha |
| `assassin.webp` | 深海之刃 | 透明 alpha |
| `morgana.webp` | 幻淵祭司 | 透明 alpha |
| `mordred.webp` | 黑潮隱主 | 透明 alpha |
| `oberon.webp` | 離群信徒 | 透明 alpha |
| `minion.webp` | 迷霧信徒 | 透明 alpha |
| `lancelot-good.webp` | 晨鐘騎士 | 透明 alpha |
| `lancelot-evil.webp` | 沉鐘騎士 | 透明 alpha |
| `lighthouse.webp` | 城郊燈塔 | 透明 alpha |
| `lighthouse-unlit.webp` | 未點亮的燈塔 | 透明 alpha |
| `lighthouse-lit.webp` | 已點亮的燈塔 | 透明 alpha |
| `lighthouse-corrupted.webp` | 被侵蝕的燈塔 | 透明 alpha |
| `bell.webp` | 詛咒之鐘 | 透明 alpha |

角色圖的顯示必須遵循遊戲的玩家／觀戰視角資訊權限。不得以預載圖片、圖片名稱或裝飾圖間接顯示尚未公開的他人身分。

## 2026-10-23：原創角色與雙鐘誓約

十張角色皆重新生成為方形透明胸像。圖片檔名及角色代碼保持原值，以相容既有對局與回放；畫面使用目前的中文名稱。每張圖僅轉換成 WebP，保留原尺寸、構圖與透明 alpha；介面使用 contain 完整顯示頭冠與道具，不裁切圖像。美術風格及私人資訊授權沿用遊戲框架。

完整生成提示與角色設計分組記錄：

- [逐星神諭者、聆諭騎士、城郊守衛、幻淵祭司](THEMED-LIGHT-PROMPTS.md)
- [深海之刃、黑潮隱主、離群信徒、迷霧信徒](THEMED-DEEP-PROMPTS.md)
- [晨鐘騎士與沉鐘騎士](TWIN-KNIGHTS-PROMPTS.md)

## 2026-10-22：燈塔任務狀態

使用內建 `image_gen` 編輯流程，逐張生成三個狀態。`lighthouse-unlit.webp` 以本專案原有 `lighthouse.webp` 為編輯目標；`lighthouse-lit.webp` 與 `lighthouse-corrupted.webp` 分別以這次生成的未點亮 PNG 為編輯目標，維持同座塔與構圖。未使用 API CLI、外部素材、程式修圖、去背或合成。

三張均使用 `transparent_background: true`，保持 1254 × 1254 RGBA。原始 PNG 僅轉換為 WebP（quality 85、method 6、exact true），沒有裁切、縮放或改動構圖；逐像素驗證 alpha 與來源相同，且無 EXIF、XMP 或 ICC 中繼資料。

任務尚未結算使用未點亮狀態，成功使用金色點亮狀態，失敗使用破窗與紫黑霧侵蝕狀態。圖片僅在美術模式載入；介面另保留文字標示，不能只靠顏色辨識結果。

### lighthouse-unlit.webp（未點亮）

```text
Use case: precise-object-edit. Asset type: transparent game illustration, the UNLIT state of a medieval guardian lighthouse for a digital tabletop game. Input image: edit target and composition/style reference. Preserve this exact single tower's architecture, silhouette, centered full-height composition, pointed crooked slate roof, open lantern gallery, round stone shaft, winding exterior stone stair, arched wooden door and stone footing. Keep all edges comfortably inside a square canvas with a little transparent margin. Change only the illumination: extinguish the lantern completely; its chamber and all windows are dark, cold charcoal blue-gray, with NO green, yellow, orange or red light and NO luminous haze. Preserve the scratchy irregular black ink outlines, dense engraved cross-hatching, weathered parchment-colored stone and original dark storybook style. The entire recognizable tower should remain clear on a dark UI at 80–120 px. True transparent alpha background, no scenery, ground field, text, digits, symbols, labels, borders, logos or watermark.
```

### lighthouse-lit.webp（已點亮）

```text
Use case: precise-object-edit. Asset type: transparent game illustration, the LIT/SUCCESS state of the same medieval guardian lighthouse. Input image: exact edit target. Preserve the exact architecture, shape, placement, full-height centered composition and proportions of this single tower: pointed crooked slate roof, lantern gallery, round stone shaft, winding exterior stairs, arched door and footing. Change only its operational state: ignite a powerful warm golden amber beacon inside the top lantern chamber, creating a very bright pale-gold center and warm honey-gold light through every top lantern pane, with a compact golden light aura hugging the gallery. The tower is intact, safe and victorious. A little warm golden light also shines from its narrow lower windows. Retain scratchy black ink outlines, engraved cross-hatching, parchment stone texture and dark storybook hand-drawn treatment. Strong warm-gold success beacon must read at 80–120 px. All tower edges inside square canvas. True transparent alpha outside the tower and small light aura; no scenery, ground plane, background field, text, letters, digits, border, logo or watermark. Do not introduce green, red, or purple light.
```

### lighthouse-corrupted.webp（被侵蝕）

```text
Use case: precise-object-edit. Asset type: transparent game illustration, the CORRUPTED/FAILED state of the same medieval guardian lighthouse. Input image: exact edit target. Keep the exact overall single-tower silhouette, centered full-height size, pointed slate roof, round stone shaft, exterior spiral stairs, arched door and stone footing, with all edges inside the square. Transform only its condition to visibly overtaken by black fog: the top lantern glass is broken into jagged panes, the beacon is extinguished into deep violet-black smoke, dark inky tendrils curl tightly around its gallery, and a few thin dull crimson fissures run through the upper stonework. Make cracks and battered missing pieces readable, but keep the tower upright and recognizable. Lower windows are shadowy dark purple, NOT warm or gold. The roof is slightly chipped but retains its shape. Main state cue: large violet-black cloud around a clearly broken lantern chamber, distinct from both a plain intact unlit tower and a golden success beacon. Preserve scratchy irregular black ink outlines, engraved cross-hatching, parchment stone texture and dark hand-drawn storybook style. True transparent alpha around the object and smoke contours; no opaque background field, scenery, text, letters, digits, icons, labels, borders, logo or watermark. No glowing gold, orange flame or green light.
```

## 原有場景與道具的生成記錄

生成工具：內建 `image_gen`。沒有使用外部下載素材、API CLI、事後去背或合成。下列為原有場景與道具的完整生成提示詞；物件使用 `transparent_background: true`，城鎮背景使用 `false`。生成的 PNG 已使用 Pillow／libwebp 編碼為 WebP（quality 85、method 6、exact true）。編碼未裁切、縮放或更改構圖；城鎮保持 1536 × 1024，物件保持 1254 × 1254。RGB 使用有損壓縮，透明圖的 alpha 通道與原圖逐像素相同。儲存庫僅保留網頁使用的 WebP。

### city.webp

```text
Use case: stylized-concept. Asset type: original landscape 1536x1024 background for a medieval hidden-identity tabletop game. Scene: a crooked fortified medieval town at night, enormous black fog rolling around the city walls, winding cobbled streets and steep weathered rooftops. Beyond the walls stand a few lonely lighthouse watchtowers with restrained mint-green lamps. Composition: full-bleed wide setting, most distinctive architectural forms on left and right edges, broad quieter low-contrast fog and street area through center for game panels. No people. Palette: deep blue-charcoal, muted parchment stone, tiny mint lights. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail. Constraints: opaque full background, no interface, cards, letters, numbers, logos, watermark or recognizable franchise buildings.
```

### lighthouse.webp

```text
Use case: stylized-concept. Asset type: square transparent isolated medieval object illustration for a digital tabletop token. Composition: one complete centered object, filling about 75 percent of canvas, clean complete silhouette with generous transparent margins. No character, scenery, frame or ground plane. Constraints: truly transparent alpha background, original design, no readable writing, letters, digits, logos, watermark or recognizable franchise prop. Subject: a crooked medieval stone beacon tower built of ancient worn blocks, small barred wooden door at bottom, narrow spiraling windows, an open wrought-iron lantern cage at top beneath a steep weathered shingle roof; a vivid but restrained mint-green magical light shines inside the cage with short soft rays. Compact sturdy silhouette, a few chipped stones forming its attached base, no broad cast shadow. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### bell.webp

```text
Use case: stylized-concept. Asset type: square transparent isolated medieval object illustration for a digital tabletop token. Composition: one complete centered object, filling about 75 percent of canvas, clean complete silhouette with generous transparent margins. No character, scenery, frame or ground plane. Constraints: truly transparent alpha background, original design, no readable writing, letters, digits, logos, watermark or recognizable franchise prop. Subject: a large antique bronze handbell with a warped dark wooden handle and a visible jagged crack along its bell, tarnished bronze raised ribs with no inscriptions or symbols; faint crimson light leaks from the crack and a few wisps of red-black cursed mist curl close to the bell silhouette. Tilted slightly for dramatic readable shape, complete handle and rim visible. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```
