import { gameCatalog, isGameID } from '../games/catalog';

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;
let started: Promise<void> | undefined;

/** Only public page categories enter Analytics, never room IDs or URL tokens. */
export function analyticsPage(pathname: string) {
  const path = pathname.replace(/\/$/, '') || '/';
  if (path === '/' || path === '/index.html') return { path: '/', title: '未央酒肆 Endless Bar' };
  if (['/privacy', '/privacy.html'].includes(path)) return { path: '/privacy', title: '隱私權政策｜未央酒肆 Endless Bar' };
  if (path === '/rules') return { path, title: '遊戲規則｜未央酒肆 Endless Bar' };
  const rules = /^\/rules\/([a-z0-9-]+)$/.exec(path);
  if (rules && isGameID(rules[1])) return { path, title: `${gameCatalog[rules[1]].name}規則｜未央酒肆 Endless Bar` };
  const room = /^\/(room|join|replay)\/[A-Za-z0-9_-]+$/.exec(path);
  if (room) return { path: '/' + room[1], title: `${{ room: '遊戲房間', join: '加入房間', replay: '公開復盤' }[room[1]]}｜未央酒肆 Endless Bar` };
  return { path: '/other', title: '其他頁面｜未央酒肆 Endless Bar' };
}

/** Runtime settings are optional. Failed configuration / blocked tags never block play. */
export function startAnalytics(): Promise<void> {
  return started ??= initialize().catch(() => {});
}

async function initialize() {
  const response = await fetch('/api/analytics', { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) return;
  const { measurementId } = await response.json();
  if (typeof measurementId !== 'string' || !MEASUREMENT_ID.test(measurementId)) return;

  const target = window as Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  target.dataLayer ??= [];
  function gtag(..._args: unknown[]) { target.dataLayer!.push(arguments); }
  // Do not reuse an advertising tag's configuration or send game events.
  target.gtag ??= gtag;
  gtag('js', new Date());
  gtag('config', measurementId, {
    send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    page_location: location.origin + analyticsPage(location.pathname).path,
    page_referrer: '',
  });
  let previousPath: string | undefined;
  let previousLocation = '';
  try {
    const referrer = new URL(document.referrer);
    if (['http:', 'https:'].includes(referrer.protocol)) previousLocation = referrer.origin + '/';
  } catch { /* Direct visit. */ }
  const track = () => {
    if (previousPath === location.pathname) return;
    const page = analyticsPage(location.pathname);
    const pageLocation = location.origin + page.path;
    const values = { page_location: pageLocation, page_referrer: previousLocation, page_title: page.title };
    gtag('set', values);
    gtag('event', 'page_view', { ...values, send_to: measurementId });
    previousPath = location.pathname;
    previousLocation = pageLocation;
  };
  track();
  window.addEventListener('popstate', track);
  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
  document.head.appendChild(script);
}
