# 貝克街迷霧美術提示集

所有插畫使用內建圖片生成工具逐張生成，採原創人物與物件設計；未引用真人演員、影視劇照或原桌遊插畫。原始圖由本機工具保存，專案收錄轉換後的 WebP。圖片縮放與格式轉換使用 Pillow，未以程式繪圖替代插畫。

## 圖庫分工

- `roles/`：5 個可遊玩身分類型、6 位預製人物及幕後莫里亞蒂，共 12 款人物插畫。倫敦警察身分可共用同一張圖。
- `objects/`：各牌庫共用的原創物件圖庫。同一個物件可對應不同牌名與案件痕跡；跨年代外形不同的相機、槍械及車輛使用各自的圖。
- `scene-*.webp`：四個案件年代的倫敦場景。
- `card-back.webp`、`badge.webp`、`chess-marker.webp`：牌背、警徽及木製西洋棋標記。
- 牌框、類別色與年代細節由介面程式呈現，卡片文字保持可讀與可搜尋。

## 保存與顯示

物件圖最長邊 512 像素，人物及牌背最長邊 900 像素，場景最寬 1,600 像素。WebP 品質 86；透明標記保留 alpha。完整牌名與物件圖的對應以 `src/games/baker/card-lists.ts` 為準。

## 個別提示

### `badge.webp`

輸出尺寸：512 × 493。

One original tabletop police badge token, full silhouette centered on a genuinely transparent background. Ornate antique brass eight-point shield medallion, central relief of a Victorian London constable's domed custodian helmet, small laurel wreath, bottle-green enamel inlay. Refined physical metal craftsmanship, front-facing slight relief depth, crisp small-size readable shape, soft gentle edge highlights. No writing, no numbers, no crown insignia copied from real police, no letters, no logo, no watermark. Premium Sherlock mystery boardgame component.

### `card-back.webp`

輸出尺寸：640 × 896。

One original portrait playing-card BACK design for premium Sherlock mystery board game. Entire card centered straight on, symmetrical intricate brass filigree around bottle-green leather panel, central elegant magnifying glass crossing a small chess knight emblem, subtle London fog etching, refined ivory accents, no readable words, no lettering, no numbers, no faces, no weapon, no logo, no watermark. Crisp beveled physical edges, image fully fills portrait canvas, elegant dark green and antique gold, balanced detailed craftsmanship.

### `chess-marker.webp`

輸出尺寸：512 × 493。

One original tabletop clue marker for Sherlock detective boardgame: a polished honey-brown wooden chess knight, carved horse head with graceful recognisable silhouette and a round brass-rimmed base, one single piece fully visible and centered, three-quarter view, premium realistic painterly craftsmanship, soft studio lighting, genuinely transparent background with only subtle contact shadow. No writing, no labels, no numbers, no human, no logo, no watermark.

### `objects/access-card.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain plastic access card with a blank photo area. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/apron.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a folded plain work apron with long ties

### `objects/ash.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a small mound of pale ash with charred paper fragments. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/axe.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a small wood-handled axe resting flat. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/bandage.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a rolled clean white cloth bandage with a loose tail

### `objects/banknote.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: several folded paper banknotes with imaginary unreadable designs.

### `objects/basin.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a shallow plain enamel wash basin

### `objects/basket.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a woven wicker basket with handle.

### `objects/bathtub.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an empty freestanding bathtub in a dim uncluttered room

### `objects/battery.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: two plain cylindrical batteries with no branding

### `objects/bayonet.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a sheathed military bayonet resting flat

### `objects/belt.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a plain leather belt with metal buckle. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/binoculars.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a pair of black field binoculars with strap

### `objects/blanket.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a thick folded wool blanket

### `objects/bloodstain.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small dried dark red stain on a pale scrap of cloth, non-graphic forensic evidence

### `objects/bone.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small clean animal bone, archaeological still life

### `objects/book.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a worn leather-bound book with unmarked spine

### `objects/boot.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a muddy leather boot lying on its side.

### `objects/bottle.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain dark glass bottle with loose stopper.

### `objects/box.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small hinged wooden keepsake box half open.

### `objects/bread.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a torn piece of crusty bread with crumbs

### `objects/brick.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a chipped red clay building brick. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/brooch.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an ornate oval metal brooch with a dark green stone.

### `objects/bucket.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a dented plain metal bucket with handle

### `objects/button.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: several mismatched metal and bone clothing buttons.

### `objects/cable.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a loose coiled insulated electrical cable with cut end

### `objects/camera.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a simple black camera with round lens and no brand

### `objects/camera-victorian.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an 1890s compact folding plate camera with wooden body, brass lens and short leather bellows, no tripod

### `objects/camera-wartime.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a 1930s folding roll-film camera with dark leather-covered body, black bellows and small round lens

### `objects/candle.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: two wax candles with melted wax drips. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/candlestick.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a heavy brass candlestick with a short unlit candle. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/cane.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a dark wooden walking cane with curved handle. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/canteen.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain metal military water canteen in a cloth cover

### `objects/car.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an unbranded contemporary passenger car parked in shadow

### `objects/carriage.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a stationary enclosed horse-drawn carriage, no horse or driver

### `objects/cctv.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a compact wall-mounted security camera with no brand. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/chain.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a short heavy iron chain coiled on a table. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/chair.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a solid wooden dining chair with one loose rung

### `objects/chalk.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: several short chalk sticks with dust.

### `objects/chisel.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a steel woodworking chisel with wooden handle. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/cigar.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an unlit cigar beside a short cigar end.

### `objects/clock.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small wooden mantel clock with unlabeled dial.

### `objects/coal.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: several rough black lumps of coal. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/coat.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a dark wool coat draped over a simple wooden hanger.

### `objects/coin.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small pile of old metal coins with indistinct relief.

### `objects/comb.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a simple dark fine-toothed hair comb.

### `objects/compass.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an open brass pocket compass with directional needle.

### `objects/cork.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: several small natural cork stoppers

### `objects/crate.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small rough wooden shipping crate with a loose lid.

### `objects/cup.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain porcelain teacup on its saucer.

### `objects/dog-tag.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: two blank metal identity tags on a chain

### `objects/door.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a closed wooden door with a simple iron latch

### `objects/drone.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small consumer quadcopter drone at rest, no payload. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/envelope.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain paper envelope with a broken wax seal

### `objects/fabric.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: overlapping torn pieces of plain woven cloth.

### `objects/feather.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: two loose dark bird feathers

### `objects/film.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a short curled strip of photographic film

### `objects/fingerprint.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a visible dark fingerprint on a small shard of clear glass

### `objects/fire.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small contained hearth fire in a dark fireplace, no people or harm

### `objects/fire-extinguisher.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain red portable fire extinguisher with no writing

### `objects/fishhook.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a simple fishing hook attached to a short piece of line

### `objects/flintlock.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an old flintlock pistol with a single long barrel and wooden grip, museum still life, no action

### `objects/flower.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a single cut flower with a bent stem. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/footprint.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a single muddy shoe print on a pale floor

### `objects/fork.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain metal table fork.

### `objects/fruit.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a cut apple and its core

### `objects/funnel.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain metal funnel lying on its side

### `objects/gas-mask.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a period military gas mask resting flat with round eyepieces

### `objects/gear.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: two large worn iron machine gears

### `objects/glass.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a clear drinking glass with a small chip at the rim.

### `objects/glove.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a pair of plain leather gloves.

### `objects/goggles.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: clear protective work goggles with elastic strap

### `objects/grenade.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a single inert historical grenade as a museum object, no instructions or action

### `objects/hair.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a tied small lock of human hair, neutral evidence still life.

### `objects/hammer.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a wood-handled iron hammer. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/handkerchief.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a folded white handkerchief with stitched edges

### `objects/hat.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a dark felt brimmed hat seen at an angle.

### `objects/headphones.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: plain over-ear headphones with a loose cable. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/helmet.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain metal military helmet without markings

### `objects/inkwell.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a glass inkwell with dark ink and its loose stopper.

### `objects/key.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: three old metal door keys on a small iron ring.

### `objects/keyboard.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain computer keyboard seen from above, no legible legends. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/knife.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain kitchen knife resting flat, no blood.

### `objects/ladder.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a short wooden ladder leaning at a slight angle

### `objects/lantern.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: an enclosed oil lantern with brass frame and glass panels. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/laptop.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a slim open laptop with dark screen, no logo. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/leaf.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: several dry leaves with clearly visible veins. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/ledger.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a thick cloth-bound accounts ledger with ruled blank pages

### `objects/letter.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a folded handwritten letter with a small torn corner, no legible writing

### `objects/lighter.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a closed plain metal pocket lighter

### `objects/lockpick.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a museum collection of antique locksmith hand tools lying still on parchment. Historical inventory illustration only: small dark iron handles and simple rounded tool silhouettes, no lock, no person, no procedure, no diagrams, no internal mechanism and no instructional details.

### `objects/machinery.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a heavy industrial machine with exposed flywheel and drive belt, at rest

### `objects/map.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a folded hand-drawn street map with abstract unlabeled streets

### `objects/mask.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain disposable medical face mask with ear loops

### `objects/matches.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: an open plain matchbox with a few wooden safety matches. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/meat.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a wrapped piece of cooked meat on plain paper, no gore

### `objects/medal.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain military medal hanging from a striped ribbon, no national symbols

### `objects/medicine-bottle.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small amber apothecary bottle with blank paper label and stopper.

### `objects/mirror.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small handheld mirror with metal handle.

### `objects/necklace.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a fine chain necklace with an oval pendant.

### `objects/needle.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a few sewing needles resting across a plain pin cushion.

### `objects/net.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small folded coarse fishing net

### `objects/newspaper.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a folded newspaper with abstract print blocks, no legible text

### `objects/notebook.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small worn pocket notebook open to unlettered pages

### `objects/oilcan.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a small metal oil can with long narrow spout. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/padlock.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a heavy iron padlock with its shackle open.

### `objects/parachute.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a folded parachute pack with a few visible straps

### `objects/pencil.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: two sharpened wooden pencils and a few shavings.

### `objects/phone.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a contemporary smartphone with dark inactive screen and no brand. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/photo.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small monochrome photograph with an indistinct street scene

### `objects/pickaxe.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a mining pickaxe resting diagonally. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/pillow.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain linen pillow with a slightly torn seam

### `objects/pipe.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a curved wooden smoking pipe.

### `objects/pistol.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: an antique six-shot revolver lying flat, unloaded, no action. One square canvas. Center the complete object silhouette with generous margins. Etched painterly realism, clearly readable material details, warm muted ivory parchment backdrop with a subtle charcoal vignette. Restrained bottle-green and brass accents where natural to the object. Soft directional light and a grounded soft shadow. No unrelated props, people, hands, card border, legible text, letters, numbers, logo, or watermark.

### `objects/plasticbag.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a crumpled translucent plastic shopping bag

### `objects/plate.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain ceramic dinner plate with a visible crack.

### `objects/playing-card.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: three worn playing cards laid askew.

### `objects/plug.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain three-prong electrical plug with short cable. It has three rectangular British-style plug prongs.

### `objects/pocket-watch.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an open silver pocket watch with chain, no readable numerals.

### `objects/poker.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a long iron fireplace poker with hooked tip. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/poster.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a weathered paper notice with abstract print blocks, no legible text

### `objects/powder.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a small folded paper packet spilling pale powder, no substance label. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/purse.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an open leather drawstring coin purse.

### `objects/quill.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a long feather writing quill with a darkened tip.

### `objects/radio.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small rectangular analogue radio with knobs and speaker grille

### `objects/razor.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: an open traditional folding straight razor, no blood. One square canvas. Center the complete object silhouette with generous margins. Etched painterly realism, clearly readable material details, warm muted ivory parchment backdrop with a subtle charcoal vignette. Restrained bottle-green and brass accents where natural to the object. Soft directional light and a grounded soft shadow. No unrelated props, people, hands, card border, legible text, letters, numbers, logo, or watermark.

### `objects/remote.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain small remote control with indistinct buttons

### `objects/ribbon.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a curled length of silk ribbon.

### `objects/rifle.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a simple wooden-stock rifle lying flat, no action. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/ring.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a gold signet ring lying on its side.

### `objects/rope.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a loose coil of coarse rope. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/sand.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a small spill of coarse sand and grit. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/satchel.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a worn brown leather shoulder satchel.

### `objects/saw.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a traditional hand saw with wooden grip. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/scarf.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a loosely folded wool scarf with fringed ends.

### `objects/scissors.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a pair of large metal tailor scissors. One square canvas. Center the complete object silhouette with generous margins. Etched painterly realism, clearly readable material details, warm muted ivory parchment backdrop with a subtle charcoal vignette. Restrained bottle-green and brass accents where natural to the object. Soft directional light and a grounded soft shadow. No unrelated props, people, hands, card border, legible text, letters, numbers, logo, or watermark.

### `objects/scooter.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a folded contemporary electric kick scooter with no brand. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/seal.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a brass desk sealing stamp beside an impression in red wax.

### `objects/seed.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a small pile of mixed plain plant seeds. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/shell.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small seashell with a chipped edge

### `objects/shirt.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a folded plain linen shirt with collar.

### `objects/shoe.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a pair of worn leather lace-up shoes.

### `objects/shovel.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a short wood-handled iron shovel. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/sickle.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a curved agricultural sickle with wooden handle. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/sim-card.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small SIM card with gold contacts beside its carrier. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/snuffbox.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: an open small engraved metal snuffbox.

### `objects/soil.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a clod of damp dark earth with crumbling edges. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/spectacles.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: round wire-rimmed spectacles with one folded arm.

### `objects/spoon.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a simple silver table spoon.

### `objects/spray-can.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain unbranded aerosol spray can with cap beside it

### `objects/spring.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a loose heavy coiled metal spring

### `objects/stairs.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a steep old staircase descending into shadow, no people

### `objects/statue.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a small heavy classical marble bust on a square base. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/stethoscope.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain black medical stethoscope coiled on a table

### `objects/stone.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a rough palm-sized stone. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/suitcase.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a closed leather travelling suitcase with brass buckles.

### `objects/sword.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a sheathed straight sword with part of the blade visible. One square canvas. Center the complete object silhouette with generous margins. Etched painterly realism, clearly readable material details, warm muted ivory parchment backdrop with a subtle charcoal vignette. Restrained bottle-green and brass accents where natural to the object. Soft directional light and a grounded soft shadow. No unrelated props, people, hands, card border, legible text, letters, numbers, logo, or watermark.

### `objects/syringe.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a plain modern disposable medical syringe without packaging, no body or procedure

### `objects/telephone.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a black rotary desk telephone

### `objects/thermometer.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a narrow glass thermometer with no readable scale

### `objects/thread.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: two spools of sewing thread with a loose strand.

### `objects/ticket.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small rectangular paper admission ticket with a perforated edge, no writing.

### `objects/tinderbox.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: an open old metal tinderbox with flint and steel. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/tobacco.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a paper pouch spilling dry tobacco leaves.

### `objects/tongs.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a pair of long iron hearth tongs. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/torch.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a simple handheld electric flashlight

### `objects/train.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a dark steam railway locomotive at rest, no people

### `objects/umbrella.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a tightly furled plain black umbrella. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/usb.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small plain USB flash drive with cap removed. The technology and physical shape must remain contemporary and credible for 2026, not a fictional steampunk machine.

### `objects/vase.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a tall plain ceramic flower vase. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/wartime-truck.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a 1930s military transport truck with canvas-covered cargo bed, parked, no markings or people

### `objects/water.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: dark rippling water beside a stone river edge, no people

### `objects/waterpipe.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a short metal plumbing pipe with elbow joint

### `objects/weight.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a solid iron balance weight with carrying loop. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/wheel.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a detached wooden spoked wagon wheel

### `objects/whistle.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a small metal whistle on a short cord

### `objects/window.webp`

輸出尺寸：512 × 512。

One original hand-painted evidence illustration for a premium Sherlock Holmes mystery boardgame. Square canvas. Depict only this specific subject clearly centered, full silhouette fully visible with generous margins, three-quarter museum still-life view, fine etched painterly realism, crisp readable shape and rich material detail. Muted warm ivory parchment backdrop with subtle charcoal vignette, restrained bottle-green and antique brass accents where appropriate. Soft directional light. No extra unrelated objects, no humans, no hands, no card borders, no lettering, no labels, no numbers, no logos, no watermark. Subject: a narrow window with one cracked pane, no person

### `objects/wire.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a loose coil of bare thin metal wire. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `objects/wrench.webp`

輸出尺寸：512 × 512。

Use case: stylized-concept. Asset type: original object illustration for a premium Sherlock Holmes mystery board game. Subject: a heavy metal adjustable wrench. Square canvas, complete object centered with generous margins. Etched painterly realism with clearly readable material details. Warm muted ivory parchment backdrop, subtle charcoal vignette, restrained bottle-green and brass accents only where natural. Soft directional light with a grounded shadow. No unrelated props, humans, hands, card border, legible text, letters, numbers, logo or watermark.

### `roles/accomplice.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. An original adult female covert associate of Moriarty, poised Victorian woman in a charcoal travelling coat, pinned dark hair, cool observant gaze, one hand resting on a leather document folder, subtle burgundy scarf accent, intelligent secretive atmosphere, no weapons or violence.

### `roles/gregson.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Inspector Tobias Gregson, original literary interpretation not resembling any actor: tall broad-shouldered middle-aged detective with fair hair and prominent fair moustache, confident measured expression, dark blue coat and grey waistcoat, holding plain case papers, softly blurred office.

### `roles/holmes.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Sherlock Holmes, original literary interpretation not resembling any actor: slender sharp-featured clean-shaven British consulting detective in his early forties, dark wavy hair, intense grey eyes, dark tweed coat with subtle checked scarf, holding a small magnifying glass near his chest, composed analytical posture, soft blurred study shelves behind.

### `roles/hopkins.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Inspector Stanley Hopkins, original literary interpretation not resembling any actor: young adult London detective with clean-shaven face, keen determined expression, dark hair neatly parted, brown tweed suit and dark tie, holding a closed case notebook, softly lit police office.

### `roles/investigator.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. An original Victorian London police constable, anonymous generic investigator role: earnest adult man in navy blue tunic and traditional domed custodian helmet, polished plain brass details, small notebook in hand, neutral foggy street background, no real badge design or insignia.

### `roles/irene.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Irene Adler, original literary interpretation not resembling any actor: confident adult opera singer and perceptive woman with auburn hair, elegant deep burgundy Victorian evening dress with refined high neckline, small theatre mask held at waist, self-possessed gaze, velvet curtain softly blurred behind.

### `roles/lestrade.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Inspector Lestrade, original literary interpretation not resembling any actor: compact wiry middle-aged London detective, sharp attentive eyes and small neat moustache, dark formal coat and bowler hat held in hand, notebook and brass cuff accents, foggy police station interior.

### `roles/mary.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Mary Morstan, original literary interpretation not resembling any actor: thoughtful adult Victorian woman, chestnut hair neatly pinned, modest sage green high-neck dress, holding a small folded letter, calm confident gaze, gentle warm study light.

### `roles/moriarty.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Professor Moriarty, original literary interpretation not resembling any actor: gaunt older intellectual gentleman with high forehead, sparse grey hair and piercing calculating eyes, immaculate charcoal Victorian suit, slender fingers holding a black chess king, dark study background, restrained menace with no violence.

### `roles/murderer.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. An original mysterious adult agent of Moriarty, refined masculine Victorian face partly shadowed by a dark brimmed hat, bottle-green coat and black gloves, subtly hiding a sealed envelope at chest height, composed evasive expression, not monstrous, no wounds or violence.

### `roles/mycroft.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Mycroft Holmes, original literary interpretation not resembling any actor: broad-built middle-aged British gentleman with receding dark hair, reserved intelligent expression, dark formal waistcoat and suit, holding a neatly folded government dossier with no writing, club interior softly blurred.

### `roles/watson.webp`

輸出尺寸：600 × 900。

Original premium boardgame character card illustration, portrait composition from waist to head, one person fully within frame, Victorian oil painting with finely etched textures, moody deep bottle-green and antique brass palette, subtle luminous rim light, detailed expressive face, rich fabric texture, uncluttered background, no words, no letters, no card frame, no logo, no watermark. Dr John Watson, original literary interpretation not resembling any actor: trustworthy British physician in his early forties, warm eyes, neat chestnut moustache, brown wool suit and waistcoat, holding a closed leather doctor's bag, strong grounded posture, dim medical study behind.

### `scene-industrial.webp`

輸出尺寸：1599 × 900。

Original premium mystery boardgame wide background, London around 1800 during early industrialization, damp cobblestone canal street, brick textile mill with waterwheel and steam drifting far away, candlelit detective study at left edge, horse cart silhouettes only in distance. Historically old hand tools and oil lamps, no electricity, no automobiles, no modern skyscrapers. Dark bottle green, soot charcoal, warm brass, painterly engraved realism, empty quiet center and lower center suitable for readable game UI. No people foreground, no writing, no numbers, no logos, no border.

### `scene-modern.webp`

輸出尺寸：1599 × 900。

Original premium mystery boardgame wide background, Baker Street London in realistic 2026, traditional Georgian brick buildings mixed with subtle modern CCTV and an unbranded electric black taxi far away, rain-wet pavement and LED streetlights, elegant contemporary detective office at left window, moody deep bottle-green and restrained amber, painterly etched realism same visual family as Victorian Sherlock boardgame. No futuristic flying technology or holograms. Empty dark quiet center and lower area for readable UI. No readable text, no brands, no people foreground, no logos.

### `scene-victorian.webp`

輸出尺寸：1599 × 900。

Original Victorian London 1890 rain-wet Baker Street gas lamps, detective study edge, bottle-green and amber painterly etched realism, quiet dark central game UI area; no text or people.

### `scene-wartime.webp`

輸出尺寸：1599 × 900。

Original premium mystery boardgame wide background, London 1939 during wartime blackout, rainy brick street, curtained windows, a period detective office at left, sandbags and old telephone box in distance, muted shielded street lamp, subtle searchlight through fog. Dark slate green, charcoal and dim amber, painterly etched realism, mystery without battle, no corpses, no explosions, no flags or insignias. Broad center and lower area dark and quiet for game UI. No text, no lettering, no logos.
