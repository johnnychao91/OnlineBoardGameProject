# 美術模式原創素材

所有插畫使用內建 `image_gen` 工具生成並經人工檢視。兩張場景原始 PNG 為 1536 × 1024，保留不透明背景；環境不代表任何玩家身分、設備位置、訊號數字或對局狀態。設備與身分插畫只裝飾已授權顯示的內容，文字、數字與操作仍由程式繪製。

- `ink-space-station.png`：太空維修站場景，用於美術模式的頁面背景與主題卡片。
- `home-table-v1.jpg`：「捷寶桌遊室」背景使用的 1200 × 630 無字桌遊室插圖，由分享封面去字製作；原本的有字社群封面保留。[來源與編輯提示](../../../../docs/SHARING_PREVIEW.md#首頁無字版本)。
- `ink-cipher-room.png`：諜報通訊室場景，用於美術模式的頁面背景與主題卡片。
- `ink-stable-equipment.png`、`ink-repair-module.png`、`ink-reactor-crisis.png`：透明設備插畫，用於授權牌面、私人組成與公開檢修紀錄。[完整設備提示](DEVICE-PROMPTS.md)。
- `ink-engineer.png`、`ink-saboteur.png`：透明角色插畫，僅出現在已知身分欄。
- `ink-cipher-card.png`：無數字的諜報紙張牌框，數字 1～100 由介面顯示。
- `ink-cover.png`、`ink-silent-pulse.png`：透明掩護／靜默脈衝道具插畫，用於公開資源欄及脈衝操作。[完整角色、牌框與道具提示](ROLE-CIPHER-PROMPTS.md)。

美術畫面在圖片上方保留足夠對比的操作面板；任何圖片下載失敗都不應妨礙遊戲。

## 角色與道具卡圖製作流程

1. **先生成主體。** 角色與道具預設各做成可獨立使用的透明插畫。單張只放當前角色或道具，保留完整輪廓和安全留白。生成時指定真正的透明 alpha，邊緣保持乾淨，陰影由介面處理。
2. **背景另外生成。** 需要場景、材質或卡面底圖時，另存一張獨立背景。卡背與共用圖框可使用獨立素材，角色、道具、背景、牌框與遊戲文字分層呈現。卡名、數值、提示與狀態由介面繪製。
3. **轉檔與驗收。** 成品採保留 alpha 的 WebP 或 PNG。確認四角透明、主體與背景確實分離，並在深淺兩種底色及手機牌面尺寸下檢查邊緣、輪廓、裁切與可讀性。
4. **接回使用場景。** 實戰、觀戰、復盤與圖鑑可重用同一份主體。先通過既有權限投影，再決定何時顯示角色或牌面。舊卡若已把主體與場景合成，重製時先分離主體再組回介面。

### 舊牌面保真分層

維持舊牌面時，以原尺寸、原座標擷取主體，背景保留所有原本可見的像素，只補出原本被主體遮住的區域。輸出兩層後重新疊合，逐像素比對原始牌面。網站以原牌檔作為已驗證的合成版本，沿用同一個縮放及裁切流程，避免瀏覽器分別縮放兩層時產生接縫。

`source-layers/` 依照遊戲及原素材的路徑收錄 `subject.webp` 與 `background.webp`，索引 `manifest.json` 紀錄原圖尺寸、檔案雜湊與比對結果。獨立背景在原本被遮住的位置使用估算像素。若要將角色或道具挪到其他位置，需重新檢查露出的補繪區與主體輪廓。

《貝克街迷霧》的角色與證物卡改用透明主體和共用羊皮紙 `baker/card-paper.webp`。分層索引以 `background` 記錄共用卡底的路徑。新版皮靴主體位於 `baker/objects/boot.webp`。

### 杯中回聲封詞杯

`echo/open-cup.webp` 與 `echo/sealed-cup.webp` 是 704 × 704 的透明 WebP。用內建 ImageGen 同時生成分離的陶杯與杯蓋，兩張圖共用同一張杯身及相同座標。開蓋時杯蓋在右前方，闔蓋時放在杯口。杯腳中心維持於 (351.5, 578)，供逐輪詞鏈圖對齊桌面波紋。

```text
Create a new production sprite sheet for Cup Echo using the two pictured old cup variants as design references. Change material decisively from glossy porcelain and shiny metal to rustic handmade kiln-fired stoneware: matte dusty plum-violet clay, visible fine clay grog, horizontal throwing rings, irregular dark speckles, brown terracotta showing through at the unglazed foot, soft diffuse amber light. Retain the recognizable flared handleless bowl profile, pale hand-painted plum blossom twig, and a restrained ochre slip line as a matte rim accent. Crucial layout: exactly TWO separate objects in ONE wide transparent image, side by side, with a broad vertical completely transparent gutter through the center, no overlap. Left half: one upright OPEN bowl with no lid, fully visible oval mouth and foot, same front view as references. Right half: one detached matching convex lid by itself with small blunt teardrop clay knob, seen at the SAME camera angle, with a broad horizontal elliptical lip as if ready to fit atop the bowl. No other cup and no assembled variant. Both objects completely within their respective halves with generous transparent margins. Preserve the warm hand-painted fantasy board game art style. No ground, shadow outside objects, text, background, saucer, reflective glaze, gold metal, or props. True transparent alpha.
```

### 杯中回聲詞鏈紙條

`echo/word-slip.webp` 是原版透明梅花紙條，由內建 ImageGen 生成，轉為 1086 × 362 的 WebP。

```text
Use case: stylized-concept. Generate a single standalone blank horizontal handwritten-note paper slip asset for the Taiwanese fantasy tavern game Cup Echo (杯中回聲). Direct overhead view, almost rectangular and very flat, roughly 3:1 width-to-height, gently uneven hand-torn deckle edges, no curls or rolled ends. Muted warm antique wheat and light honey paper, softly lit by amber lantern light, subtle fine mulberry fibers in hand-painted gouache. A little delicate pale plum blossom watermark confined to a far corner. Center 85% calm, matte, consistently medium-light and fully opaque so dark runtime Chinese text will be readable. Whole uninterrupted paper silhouette, centered in a wide canvas, with true transparent alpha and a modest empty margin on all four sides. One slip only. No lettering, symbols, lines, printed borders, stamp, background, scene, table, props or cast shadow.
```

`echo/word-slip-aged.webp` 是逐輪詞鏈 PNG 使用的微作舊版本。紙邊有少量自然缺口、外露纖維和淡褐色磨痕，保留右上角梅花與中央題字區。

```text
Refine the ORIGINAL flat honey-colored Cup Echo mulberry paper slip in the supplied reference. Keep its exact broad horizontal 3:1 composition, quiet honey-toned writing surface, faint upper-right plum blossoms, near-straight overall silhouette, and thin flat paper. The desired effect is elegant, lightly timeworn handmade paper from a well-kept East Asian tavern. The silhouette should stay quite close to the reference, with subtle naturally feathered edges and just 3 tiny, asymmetrically placed chipped nicks the size of a grain of rice. Place one small angular flake near the upper left quarter, one small fine nick near the lower right quarter, and a very shallow loss on the right edge. Each indentation less than 2% of paper height; preserve every corner and a clean intact rectangular reading area. Very delicate short fibers visible on some sections, natural unevenness along the edges, slight warm aging near edges, no large bites, no undulating valleys, no fuzzy fringe, no rounded corners with heavy shadows, no burned edge, no stains, no heavy distress, no text or curl. Photorealistically believable paper fibers within the original soft illustration style. The full sheet has genuine transparent alpha around it, with empty safe margins and no exterior glow.
```

## 太空維修站生成提示

```text
Use case: stylized-concept.
Asset type: original illustrated background for an online tabletop game, landscape 1536 x 1024.
Primary request: an atmospheric, crooked, hand-inked space maintenance station interior, slightly eerie and whimsical, fragile but repairable. The scene must feel like an illustrated dark storybook with jagged irregular black ink outlines, expressive angular shapes, dense cross-hatching, scratchy pen strokes, and subtle aged paper grain rather than polished 3D.
Scene: an old metal orbital repair bay, bundled cables, a battered toolbox, peculiar maintenance instruments, pipes, a small mint-green reactor glow and a starfield glimpsed through a crooked porthole. No people or creatures.
Composition: one coherent full-bleed environment, wide landscape. Put the most distinctive equipment around the left and right edges; keep the broad central area low-contrast and quieter for translucent interface panels. Interesting silhouette and handcrafted detail around the borders, not a frame or vignette cutout.
Palette: deep ink navy, charcoal, warm gray and restrained parchment beige, with a very small mint-green light accent. Dim moody lighting and readable silhouettes.
Constraints: entirely new scene and original prop designs. No existing franchise characters, logos, interface elements, card faces, readable writing, letters, digits, symbols implying game state, watermarks or signatures. Do not generate any UI. Opaque full background.
```

## 加密通話生成提示

```text
Use case: stylized-concept.
Asset type: original illustrated background for an online tabletop game, landscape 1536 x 1024.
Primary request: a clandestine nighttime spy radio room, full of fragile secrecy and quiet teamwork. Hand-inked dark storybook illustration with jagged irregular black ink outlines, crooked angular shapes, dense cross-hatching, scratchy pen strokes, subtle aged paper grain, and restrained muted colors; not realistic photography or polished 3D.
Scene: a strange old shortwave radio with blank analog dials, headphones, coiled wire, a brass desk lamp, loose cipher papers with only abstract non-readable hatching, a battered communications desk and distant searchlight beams beyond an angular window. No people or creatures.
Composition: one coherent full-bleed room, wide landscape. Storytelling objects concentrated along the left and right borders; broad quiet low-contrast central space suitable behind translucent interface panels. No graphic frame.
Palette: moss green, deep ink navy, charcoal and parchment gray, with a small warm amber lamp accent. Moody indirect light, strong handcrafted silhouettes.
Constraints: entirely new scene and original prop designs. No existing franchise characters, logos, interface elements, card faces, readable writing, letters, digits, symbols implying game state, watermarks or signatures. Do not generate any UI. Opaque full background.
```
