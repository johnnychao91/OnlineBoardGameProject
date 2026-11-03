import { useEffect, useState } from 'react';
import { version } from '../../package.json';
import { api } from './api';
import { roomContextPath } from './adsense';
import './site-footer.css';

interface PublicSiteInfo { contact: { label: string; href: string } | null; }

export function SiteFooter() {
  const [contact, setContact] = useState<PublicSiteInfo['contact']>(null);
  const [route, setRoute] = useState(() => typeof location === 'undefined' ? '' : location.pathname + location.search);
  useEffect(() => {
    const update = () => setRoute(location.pathname + location.search);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api<PublicSiteInfo>('/api/site-info', { signal: controller.signal })
      .then(info => { if (!controller.signal.aborted) setContact(info.contact); }).catch(() => {});
    return () => controller.abort();
  }, []);
  const room = /^\/room\/([A-Za-z0-9_-]{16})\/?$/.exec(route.split('?')[0])?.[1];
  const privacyPath = roomContextPath('/privacy', room);
  return <footer className="site-footer" aria-label="網站資訊">
    <div>Version {version} © {new Date().getFullYear()} JieBao | JohnnyChao</div>
    <div>Contact us：<a data-google-vignette="false" href={contact?.href ?? privacyPath + '#contact'} rel="noopener noreferrer">{contact?.label ?? '聯絡方式'}</a></div>
    <a data-google-vignette="false" className="site-footer-privacy" href={privacyPath}>Privacy Policy</a>
  </footer>;
}
