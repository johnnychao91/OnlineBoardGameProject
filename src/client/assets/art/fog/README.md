# 黑霧襲城美術素材

這組原創圖像於 2026-10-21 使用內建 `image_gen` 逐張生成。每個檔案使用一次獨立生成，未套用商業桌遊的圖像或角色造型參考。角色名對應遊戲中的身分；人物外觀與道具是本專案的新設計。

畫面使用手繪墨線、交叉排線、舊羊皮紙與木炭灰色調，守夜騎士以薄荷綠點綴，黑霧使徒以暗紅點綴。圖像不含規則文字，文字及數字由介面提供。所有圖片僅供「美術」模式使用。

## 素材清單

| 檔案 | 內容 | 背景 |
| --- | --- | --- |
| `city.webp` | 黑霧城鎮背景 | 不透明場景 |
| `merlin.webp` | 梅林 | 透明 alpha |
| `percival.webp` | 派西維爾 | 透明 alpha |
| `loyal.webp` | 亞瑟的忠臣／守夜騎士 | 透明 alpha |
| `assassin.webp` | 刺客 | 透明 alpha |
| `morgana.webp` | 莫甘娜 | 透明 alpha |
| `mordred.webp` | 莫德雷德 | 透明 alpha |
| `oberon.webp` | 奧伯倫 | 透明 alpha |
| `minion.webp` | 莫德雷德的爪牙／黑霧使徒 | 透明 alpha |
| `lancelot-good.webp` | 善蘭斯洛特 | 透明 alpha |
| `lancelot-evil.webp` | 惡蘭斯洛特 | 透明 alpha |
| `lighthouse.webp` | 城郊燈塔 | 透明 alpha |
| `lighthouse-unlit.webp` | 未點亮的燈塔 | 透明 alpha |
| `lighthouse-lit.webp` | 已點亮的燈塔 | 透明 alpha |
| `lighthouse-corrupted.webp` | 被侵蝕的燈塔 | 透明 alpha |
| `bell.webp` | 詛咒之鐘 | 透明 alpha |

角色圖的顯示必須遵循遊戲的玩家／觀戰視角資訊權限。不得以預載圖片、圖片名稱或裝飾圖間接顯示尚未公開的他人身分。

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

## 生成記錄

生成工具：內建 `image_gen`。沒有使用外部下載素材、API CLI、事後去背或合成。下列為各檔案的完整生成提示詞；人物及物件使用 `transparent_background: true`，城鎮背景使用 `false`。生成的 PNG 已使用 Pillow／libwebp 編碼為 WebP（quality 85、method 6、exact true）。編碼未裁切、縮放或更改構圖；城鎮保持 1536 × 1024，角色與物件保持 1254 × 1254。RGB 使用有損壓縮，12 張透明圖的 alpha 通道與原圖逐像素相同。儲存庫僅保留網頁使用的 WebP。

### city.webp

```text
Use case: stylized-concept. Asset type: original landscape 1536x1024 background for a medieval hidden-identity tabletop game. Scene: a crooked fortified medieval town at night, enormous black fog rolling around the city walls, winding cobbled streets and steep weathered rooftops. Beyond the walls stand a few lonely lighthouse watchtowers with restrained mint-green lamps. Composition: full-bleed wide setting, most distinctive architectural forms on left and right edges, broad quieter low-contrast fog and street area through center for game panels. No people. Palette: deep blue-charcoal, muted parchment stone, tiny mint lights. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail. Constraints: opaque full background, no interface, cards, letters, numbers, logos, watermark or recognizable franchise buildings.
```

### merlin.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original elderly prophetic scholar with a deeply lined wise face, long silver beard, crooked worn hood and layered medieval robes; holding a small weathered mint-lit oil lamp at chest level, thoughtful watchful eyes. Subtle mint-green light accents and warm parchment skin. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### percival.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original young medieval scout knight, keen alert expression, short practical hair, a light worn hood pushed back and asymmetrical leather-and-mail shoulders; holding a plain brass compass with no letters or numbers. A restrained mint-green scarf distinguishes the vigilant guardian. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### loyal.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original ordinary medieval town guard, dependable middle-aged face beneath a simple kettle helmet, quilted armor and a weathered wooden shield with no emblem at chest. A small mint-green cloth tie signals loyalty. Humble and sturdy, distinct broad silhouette, not royal. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### assassin.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original covert medieval knife bearer in a deep charcoal hood, severe sharp-eyed face partly concealed by a scarf; one gloved hand holds a short unornamented dagger low across the chest, worn leather straps and an oxblood red scarf. Cunning dangerous atmosphere without gore, asymmetrical lean silhouette. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### morgana.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original enigmatic medieval sorceress with a composed ambiguous expression, long tangled dark hair, a crooked high hood and layered old robes; her two hands cradle a small ancient cloudy orb at chest height, one side glowing faint mint-green and the other deep crimson. No crown, no symbols, no writing. Pale parchment face, subtle dual light, elegant triangular silhouette. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### mordred.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original imposing medieval shadow commander in battered dark plate armor and a fully closed angular mask with narrow shadowed eye slits; broad asymmetrical pauldrons, a ragged black cloak and restrained oxblood-red cloth strips. The armor has no crests or emblems, concealment and cold authority, deep charcoal silhouette outlined in worn parchment highlights. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### oberon.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original solitary medieval exile from the wild moors, a gaunt wary middle-aged man with tangled hair, short wild beard and a ragged patchwork hood, twig fragments and rough fur at shoulders; holding a crude iron lantern with dim crimson light against chest. Isolated and stubborn, not a king, no antlers or crown. Charcoal, old parchment, restrained red glow. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### minion.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original anonymous medieval fog cult servant in a deep low hood with a simple plain cloth face wrap, a ragged charcoal robe cinched by rough rope, only watchful eyes visible; holding a small rusty ritual key without writing at chest, a muted oxblood-red cord across the shoulder. A humble subordinate, slim huddled silhouette and no armor or crown. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### lancelot-good.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original noble cursed medieval knight, clean-shaven angular adult face with short swept dark hair and a single pale streak, battered asymmetrical steel armor and a high collar, holding a plain sword vertically at chest with both hands around the hilt. Fine dark cracks run through armor and subtle mint light glimmers from them, a faded mint shoulder sash. Resolute but troubled expression, upright heroic silhouette, no crest or recognizable commercial design. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### lancelot-evil.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for a digital tabletop role card. Composition: centered single bust filling about 80 percent of square, complete silhouette with transparent margins, no frame or scenery. Constraints: truly transparent alpha background, entirely original character design, no readable writing, letters, digits, logos, watermark, modern technology or copied commercial character design. Subject: an original cursed medieval knight, clean-shaven angular adult face with short swept dark hair and a single pale streak, battered asymmetrical steel armor and a high collar, holding a plain sword vertically at chest with both hands around the hilt. Fine dark cracks run through armor and restrained crimson light glimmers from them, a faded oxblood-red shoulder sash. Haunted conflicted expression and shadowed face, upright counterpart knight silhouette, no crest or recognizable commercial design. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### lighthouse.webp

```text
Use case: stylized-concept. Asset type: square transparent isolated medieval object illustration for a digital tabletop token. Composition: one complete centered object, filling about 75 percent of canvas, clean complete silhouette with generous transparent margins. No character, scenery, frame or ground plane. Constraints: truly transparent alpha background, original design, no readable writing, letters, digits, logos, watermark or recognizable franchise prop. Subject: a crooked medieval stone beacon tower built of ancient worn blocks, small barred wooden door at bottom, narrow spiraling windows, an open wrought-iron lantern cage at top beneath a steep weathered shingle roof; a vivid but restrained mint-green magical light shines inside the cage with short soft rays. Compact sturdy silhouette, a few chipped stones forming its attached base, no broad cast shadow. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```

### bell.webp

```text
Use case: stylized-concept. Asset type: square transparent isolated medieval object illustration for a digital tabletop token. Composition: one complete centered object, filling about 75 percent of canvas, clean complete silhouette with generous transparent margins. No character, scenery, frame or ground plane. Constraints: truly transparent alpha background, original design, no readable writing, letters, digits, logos, watermark or recognizable franchise prop. Subject: a large antique bronze handbell with a warped dark wooden handle and a visible jagged crack along its bell, tarnished bronze raised ribs with no inscriptions or symbols; faint crimson light leaks from the crack and a few wisps of red-black cursed mist curl close to the bell silhouette. Tilted slightly for dramatic readable shape, complete handle and rim visible. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink outlines, dense engraved cross-hatching, angular handmade silhouettes, worn parchment hues inside the subject, charcoal and desaturated bronze, no glossy 3D or photorealism. Bold silhouette readable as a small game thumbnail.
```
