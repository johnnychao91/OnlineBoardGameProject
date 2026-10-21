import type { ReactNode } from 'react';
import siteIcon from './assets/site-icon.png';
import { VisualStyleSwitch } from './visual-style';
import './brand.css';
import { isGameID } from '../games/catalog';

export function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function Icon({ type, size = 20 }: { type: 'orbit' | 'link' | 'arrow' | 'shield' | 'check' | 'copy' | 'signal'; size?: number }) {
  const paths = {
    orbit: <><circle cx="12" cy="12" r="4" /><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-40 12 12)" /></>,
    link: <><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)" /></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V3H3v12h5" /></>,
    signal: <><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0" /><circle cx="12" cy="20" r=".6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}

export function Header({ room, rulesGame }: { room?: string; rulesGame?: string }) {
  const rulesPath = rulesGame && isGameID(rulesGame) ? `/rules/${rulesGame}` : '/rules';
  return <header className="site-header"><button className="brand" onClick={() => navigate('/')} aria-label="回捷寶桌遊室首頁"><span className="brand-symbol"><img src={siteIcon} alt="" /></span><span>捷寶桌遊室<small>BOARDGAME</small></span></button><div className="header-links"><VisualStyleSwitch /><a className="header-rules-link" href={rulesPath} target={room ? '_blank' : undefined} rel={room ? 'noopener noreferrer' : undefined}>詳細規則</a>{room ? <span className="room-tag">私人房間</span> : <span className="beta-tag">試玩版</span>}</div></header>;
}

export function ErrorMessage({ children }: { children: ReactNode }) { return children ? <p className="error-message" role="alert">{children}</p> : null; }
export function Note({ children }: { children: ReactNode }) { return <div className="note"><Icon type="shield" /><span>{children}</span></div>; }
export function Submit({ busy, disabled = false, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) { return <button className="button primary full" type="submit" disabled={busy || disabled}>{busy ? '正在連線…' : children}<Icon type="arrow" /></button>; }
