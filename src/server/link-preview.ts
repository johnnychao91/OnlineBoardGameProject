const SITE_NAME = '未央酒肆 Endless Bar';
const TITLE = '未央酒肆 Endless Bar';
const DESCRIPTION = '免下載、免註冊的多人線上桌遊。開房分享連結，就能和朋友一起推理、合作、冒險，還能即時觀戰與賽後復盤。';
const IMAGE_ALT = '雲海酒館夜景上的金色標題「未央酒肆 Endless Bar」，前景有牌、骰子與酒杯';
const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

/** Build crawler-readable HTML from the bundled page, without any room data. */
export function createPreviewPage(template: string, publicOrigin: string) {
  // The favicon remains independent from the wide, public sharing artwork.
  const icon = template.match(/<link\b[^>]*\brel="icon"[^>]*\bhref="([^"]+)"[^>]*>/i)?.[1];
  if (!icon || !icon.startsWith('/') || icon.startsWith('//') || !template.includes('</head>')) {
    throw new Error('The client page must contain a local favicon and a closing head tag');
  }
  const cover = template.match(/<link\b[^>]*\brel="image_src"[^>]*\bhref="([^"]+)"[^>]*>/i)?.[1];
  if (!cover || !/^\/social\/[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/.test(cover)) {
    throw new Error('The client page must contain a local sharing cover under /social/.');
  }
  const image = new URL(cover, publicOrigin).href;
  const meta = (key: string, value: string, attribute = 'property') =>
    `    <meta ${attribute}="${key}" content="${escapeAttribute(value)}" />`;
  const common = [
    meta('og:type', 'website'), meta('og:title', TITLE), meta('og:site_name', SITE_NAME),
    meta('og:description', DESCRIPTION), meta('og:locale', 'zh_TW'),
    meta('og:image', image), ...(image.startsWith('https:') ? [meta('og:image:secure_url', image)] : []), meta('og:image:type', 'image/jpeg'),
    meta('og:image:width', '1200'), meta('og:image:height', '630'),
    meta('og:image:alt', IMAGE_ALT),
    meta('twitter:card', 'summary_large_image', 'name'), meta('twitter:title', TITLE, 'name'),
    meta('twitter:description', DESCRIPTION, 'name'), meta('twitter:image', image, 'name'),
    meta('twitter:image:alt', IMAGE_ALT, 'name'),
  ];
  return (pathname: string) => {
    // Never derive public URLs from request Host / forwarded headers, or include
    // query strings, invite fragments, names, credentials, or live game state.
    const page = new URL(pathname === '/index.html' ? '/' : pathname, publicOrigin);
    page.search = ''; page.hash = '';
    return template.replace('</head>', `${[...common, meta('og:url', page.href)].join('\n')}\n  </head>`);
  };
}
