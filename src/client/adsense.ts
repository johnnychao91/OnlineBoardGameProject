let loading: Promise<void> | undefined;
let publisher: string | undefined;
export function validAdUnit(client?: string, slot?: string): client is string {
  return !!client && /^ca-pub-\d{16}$/.test(client) && !!slot && /^\d{1,20}$/.test(slot);
}
/** Loading is opt-in, once per document, after an authenticated room response. */
export function loadAdSense(client: string): Promise<void> {
  if (!/^ca-pub-\d{16}$/.test(client)) return Promise.reject(new Error('Invalid ad publisher'));
  if (publisher && publisher !== client) return Promise.reject(new Error('Ad publisher changed'));
  if (loading) return loading;
  publisher = client;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true; script.crossOrigin = 'anonymous';
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
    const timer = window.setTimeout(() => { script.remove(); reject(new Error('Ad request timed out')); }, 10000);
    script.onload = () => { window.clearTimeout(timer); resolve(); };
    script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error('Ad request failed')); };
    // Removing a script does not undo its execution. Navigation starts a fresh
    // document so entering an ad-free room never keeps an earlier SDK alive.
    document.documentElement.dataset.adsLoaded = 'true';
    document.head.appendChild(script);
  });
  return loading;
}
export function requiresFreshDocument() {
  return typeof document !== 'undefined' && document.documentElement.dataset.adsLoaded === 'true';
}
/** Track the latest route, including routes entered before the SDK was loaded. */
export function createAdSafeNavigationHandler(update: () => void) {
  let pathname = location.pathname;
  return () => {
    if (requiresFreshDocument() && location.pathname !== pathname) { location.reload(); return; }
    pathname = location.pathname;
    update();
  };
}
export function roomContextPath(path: string, room?: string) {
  if (!room && typeof location !== 'undefined') room = new URLSearchParams(location.search).get('room') ?? undefined;
  return room && /^[A-Za-z0-9_-]{16}$/.test(room) ? path + '?room=' + encodeURIComponent(room) : path;
}
