const TITLE = '捷寶桌遊室';
const DESCRIPTION = '朋友邀請制的線上桌遊平台。開一桌、分享邀請，一起遊玩、觀戰與回放復盤。';
const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

/** Build crawler-readable HTML from the bundled page, without any room data. */
export function createPreviewPage(template: string, publicOrigin: string) {
  // Vite rewrites this local asset to its fingerprinted build path. Reuse it
  // rather than copying the logo or embedding a deployment address at build time.
  const icon = template.match(/<link\b[^>]*\brel="icon"[^>]*\bhref="([^"]+)"[^>]*>/i)?.[1];
  if (!icon || !icon.startsWith('/') || icon.startsWith('//') || !template.includes('</head>')) {
    throw new Error('The client page must contain a local favicon and a closing head tag');
  }
  const image = new URL(icon, publicOrigin).href;
  const meta = (key: string, value: string, attribute = 'property') =>
    `    <meta ${attribute}="${key}" content="${escapeAttribute(value)}" />`;
  const common = [
    meta('og:type', 'website'), meta('og:title', TITLE), meta('og:site_name', TITLE),
    meta('og:description', DESCRIPTION), meta('og:locale', 'zh_TW'),
    meta('og:image', image), meta('og:image:type', 'image/png'),
    meta('og:image:width', '1024'), meta('og:image:height', '1024'),
    meta('og:image:alt', '捷寶桌遊室 JB 圖示'),
    meta('twitter:card', 'summary', 'name'), meta('twitter:title', TITLE, 'name'),
    meta('twitter:description', DESCRIPTION, 'name'), meta('twitter:image', image, 'name'),
    meta('twitter:image:alt', '捷寶桌遊室 JB 圖示', 'name'),
  ];
  return (pathname: string) => {
    // Never derive public URLs from request Host / forwarded headers, or include
    // query strings, invite fragments, names, credentials, or live game state.
    const page = new URL(pathname === '/index.html' ? '/' : pathname, publicOrigin);
    page.search = ''; page.hash = '';
    return template.replace('</head>', `${[...common, meta('og:url', page.href)].join('\n')}\n  </head>`);
  };
}
