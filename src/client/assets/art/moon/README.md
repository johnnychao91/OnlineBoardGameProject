# 銀月列車美術素材

本組原創素材於 2026-10-22 使用內建 `image_gen` 逐張生成。人物與道具外觀為本專案設計，未使用商業桌遊圖像、角色造型或外部下載素材。

畫風延續手繪墨線、交叉排線與舊紙質感，以蒸汽列車、煤油燈、紅絨座椅和銀色月光呈現夜行旅程。素材不含規則文字；介面負責顯示角色名稱、數字與操作說明。

## 素材清單

| 檔案 | 用途 | 背景 |
| --- | --- | --- |
| `train.webp` | 夜行列車餐車場景 | 不透明 |
| `wolf.webp` | 狼人 | 透明 alpha |
| `villager.webp` | 村民 | 透明 alpha |
| `seer.webp` | 預言家 | 透明 alpha |
| `witch.webp` | 女巫 | 透明 alpha |
| `hunter.webp` | 獵人 | 透明 alpha |
| `guard.webp` | 守衛 | 透明 alpha |
| `ticket.webp` | 車票與掩護操作裝飾 | 透明 alpha |
| `lantern.webp` | 公共夜間階段裝飾 | 透明 alpha |

只在「美術」模式載入。角色圖須依伺服器授權的私人資訊或已公開角色選擇，不能預載他人未公開的角色圖。掩護操作區應在不同身分之間維持相同大小與節奏，不以角色圖或音效暴露夜間行動者。

## 生成與編碼

使用內建 `image_gen`，每個素材一次獨立呼叫；場景 `transparent_background: false`，其餘素材 `true`。原始 PNG 以 Pillow／libwebp 轉成 WebP，quality 85、method 6、exact true，未裁切、縮放、合成或事後去背。場景維持 1536 × 1024，其餘八張維持 1254 × 1254。RGB 使用有損壓縮；透明素材的 alpha 通道逐像素保留。成品不含 EXIF、XMP 或 ICC 中繼資料。

以下為完整生成提示詞。

### train.webp

```text
Use case: stylized-concept. Asset type: original wide 1536x1024 setting illustration for a digital hidden-identity tabletop game named Silver Moon Train. Scene: an empty vintage steam train dining carriage travelling through wilderness at night, dark red velvet bench seats, polished worn timber panels and brass rails, hanging kerosene lamps casting warm amber pools, cloudy full moon visible through tall windows, faint steam outside. Composition: cinematic wide view down the aisle with handcrafted angular perspective; detailed seats and lamps at edges, broad dark low-contrast area through middle for game UI panels. No people. Style/medium: original dark whimsical storybook illustration with scratchy irregular black ink contours, dense engraved cross-hatching, angular rustic silhouettes, charcoal and parchment texture, hand-painted muted colors, no glossy 3D or photorealism. Palette: deep blue-charcoal, burgundy velvet, desaturated bronze, silver moonlight and restrained amber. Constraints: opaque full background, no text, letters, digits, logos, watermark, UI elements or recognizable commercial franchise designs.
```

### wolf.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for an original digital werewolf tabletop role card set aboard a nineteenth-century night steam train. Composition: single centered bust filling about 80 percent of square, complete head and shoulder silhouette with transparent margins, no scenery or frame. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink contours, dense engraved cross-hatching, angular handmade shapes, worn parchment skin and cloth, charcoal and desaturated bronze palette, muted accent colors, no glossy 3D or photorealism. Bold readable silhouette. Constraints: truly transparent alpha background, no readable writing, letters, digits, logos, watermark or recognizable commercial character design. Subject: a sinister gray-furred werewolf disguised in a torn charcoal railway traveller's frock coat and burgundy waistcoat, elongated wolf muzzle and upright ears, intelligent amber eyes, one clawed hand adjusting a shabby bow tie. Restrained menace with no blood or gore. Oxblood red cloth accents.
```

### villager.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for an original digital werewolf tabletop role card set aboard a nineteenth-century night steam train. Composition: single centered bust filling about 80 percent of square, complete head and shoulder silhouette with transparent margins, no scenery or frame. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink contours, dense engraved cross-hatching, angular handmade shapes, worn parchment skin and cloth, charcoal and desaturated bronze palette, muted accent colors, no glossy 3D or photorealism. Bold readable silhouette. Constraints: truly transparent alpha background, no readable writing, letters, digits, logos, watermark or recognizable commercial character design. Subject: an ordinary kindly adult woman passenger, alert slightly worried face, practical pinned-up hair under a small worn travelling hat, simple wool coat and faded teal scarf, holding a small leather valise handle close to her chest. Humble, resourceful human, no weapons or magic.
```

### seer.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for an original digital werewolf tabletop role card set aboard a nineteenth-century night steam train. Composition: single centered bust filling about 80 percent of square, complete head and shoulder silhouette with transparent margins, no scenery or frame. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink contours, dense engraved cross-hatching, angular handmade shapes, worn parchment skin and cloth, charcoal and desaturated bronze palette, muted accent colors, no glossy 3D or photorealism. Bold readable silhouette. Constraints: truly transparent alpha background, no readable writing, letters, digits, logos, watermark or recognizable commercial character design. Subject: an elderly human clairvoyant passenger with searching pale eyes, wiry silver hair, small round spectacles and a high-collared old travelling coat, holding a cloudy crystal orb at chest level. Subtle icy-blue glow illuminates angular wrinkled face. No symbols or stars on clothing.
```

### witch.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for an original digital werewolf tabletop role card set aboard a nineteenth-century night steam train. Composition: single centered bust filling about 80 percent of square, complete head and shoulder silhouette with transparent margins, no scenery or frame. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink contours, dense engraved cross-hatching, angular handmade shapes, worn parchment skin and cloth, charcoal and desaturated bronze palette, muted accent colors, no glossy 3D or photorealism. Bold readable silhouette. Constraints: truly transparent alpha background, no readable writing, letters, digits, logos, watermark or recognizable commercial character design. Subject: an enigmatic adult human herbalist witch passenger wearing a crooked broad-brim travelling hat and long worn shawl over an old-fashioned railway dress, tangled black hair, sharp thoughtful gaze. Holding two small stoppered glass potion bottles near chest, one muted mint-green and one deep plum-red. No labels or writing.
```

### hunter.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for an original digital werewolf tabletop role card set aboard a nineteenth-century night steam train. Composition: single centered bust filling about 80 percent of square, complete head and shoulder silhouette with transparent margins, no scenery or frame. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink contours, dense engraved cross-hatching, angular handmade shapes, worn parchment skin and cloth, charcoal and desaturated bronze palette, muted accent colors, no glossy 3D or photorealism. Bold readable silhouette. Constraints: truly transparent alpha background, no readable writing, letters, digits, logos, watermark or recognizable commercial character design. Subject: a weathered human wilderness hunter travelling on a night train, rugged bearded face, soft brim felt hat, patched brown wool coat and leather shoulder strap, holding an old wooden-stock hunting rifle angled upright safely beside shoulder, barrel visible but not aimed at viewer. Muted ochre accents. No blood or trophies.
```

### guard.webp

```text
Use case: stylized-concept. Asset type: square transparent chest-up character portrait for an original digital werewolf tabletop role card set aboard a nineteenth-century night steam train. Composition: single centered bust filling about 80 percent of square, complete head and shoulder silhouette with transparent margins, no scenery or frame. Style/medium: original dark whimsical storybook illustration, scratchy irregular black ink contours, dense engraved cross-hatching, angular handmade shapes, worn parchment skin and cloth, charcoal and desaturated bronze palette, muted accent colors, no glossy 3D or photorealism. Bold readable silhouette. Constraints: truly transparent alpha background, no readable writing, letters, digits, logos, watermark or recognizable commercial character design. Subject: a resolute adult human railway guard in a plain dark navy long coat, weathered conductor cap without badge text, sturdy leather gloves, holding a compact iron-banded shield across chest and a brass key ring in one hand. A muted silver-blue scarf, calm vigilant gaze. No insignia or writing.
```

### ticket.webp

```text
Use case: stylized-concept. Asset type: square transparent single prop illustration for an original tabletop game aboard a nineteenth-century night steam train. Composition: complete centered object fills about 75 percent of square with generous transparent margins, no scenery, frame, ground plane or broad shadow. Style/medium: original dark whimsical storybook illustration with scratchy irregular black ink outlines, dense engraved cross-hatching, angular handcrafted shapes, worn parchment and charcoal hues, desaturated brass, muted colors, no glossy 3D or photorealism. Constraints: truly transparent alpha background, no readable writing, letters, digits, logos, watermark or recognizable commercial prop. Subject: a single old ivory railway ticket with clipped corners, scalloped perforated edge and dark ornamental border, small engraved crescent moon motif only, wide completely blank interior for interface text overlay. Slight natural diagonal tilt and worn creases, muted burgundy corner accents. No text or numbers anywhere.
```

### lantern.webp

```text
Use case: stylized-concept. Asset type: square transparent single prop illustration for an original tabletop game aboard a nineteenth-century night steam train. Composition: complete centered object fills about 75 percent of square with generous transparent margins, no scenery, frame, ground plane or broad shadow. Style/medium: original dark whimsical storybook illustration with scratchy irregular black ink outlines, dense engraved cross-hatching, angular handcrafted shapes, worn parchment and charcoal hues, desaturated brass, muted colors, no glossy 3D or photorealism. Constraints: truly transparent alpha background, no readable writing, letters, digits, logos, watermark or recognizable commercial prop. Subject: an antique brass kerosene lantern with a tall glass chimney, small steady warm amber flame, tarnished metal body and dark arched carrying handle. Entire compact lantern visible, dim light hugging object silhouette, no background glow field.
```
