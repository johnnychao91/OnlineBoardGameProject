# 美術模式原創素材

所有插畫使用內建 `image_gen` 工具生成並經人工檢視。兩張場景原始 PNG 為 1536 × 1024，保留不透明背景；環境不代表任何玩家身分、設備位置、訊號數字或對局狀態。設備與身分插畫只裝飾已授權顯示的內容，文字、數字與操作仍由程式繪製。

- `ink-space-station.png`：太空維修站場景，用於美術模式的頁面背景與主題卡片。
- `ink-cipher-room.png`：諜報通訊室場景，用於美術模式的頁面背景與主題卡片。
- `ink-stable-equipment.png`、`ink-repair-module.png`、`ink-reactor-crisis.png`：透明設備插畫，用於授權牌面、私人組成與公開檢修紀錄。[完整設備提示](DEVICE-PROMPTS.md)。
- `ink-engineer.png`、`ink-saboteur.png`：透明角色插畫，僅出現在已知身分欄。
- `ink-cipher-card.png`：無數字的諜報紙張牌框，數字 1～100 由介面顯示。
- `ink-cover.png`、`ink-silent-pulse.png`：透明掩護／靜默脈衝道具插畫，用於公開資源欄及脈衝操作。[完整角色、牌框與道具提示](ROLE-CIPHER-PROMPTS.md)。

精簡模式不使用這些裝飾圖。美術模式應在圖片上方保留足夠對比的操作面板；任何圖片下載失敗都不應妨礙遊戲。

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
