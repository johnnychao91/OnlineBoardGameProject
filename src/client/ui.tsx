import { useContext, type ReactNode } from 'react';
import { requiresFreshDocument, roomContextPath } from './adsense';
import { GameHeaderContext } from './game-header-context';
import './game-header.css';
import siteIcon from './assets/endlessbar-logo-transparent.png';
import './brand.css';
import { gameCatalog, isGameID, type GameID } from '../games/catalog';
import { BackgroundPicker, type BackgroundSelection } from './BackgroundPicker';

export function navigate(path: string) {
  if (requiresFreshDocument()) { window.location.assign(path); return; }
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export type IconType = 'orbit' | 'link' | 'arrow' | 'shield' | 'check' | 'copy' | 'signal' | 'lighthouse' | 'train' | 'robot' | 'mail' | 'search' | 'mask' | 'curtain' | 'network' | 'anvil';
export function Icon({ type, size = 20 }: { type: IconType; size?: number }) {
  const paths = {
    orbit: <><circle cx="12" cy="12" r="4" /><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-40 12 12)" /></>,
    link: <><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)" /></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V3H3v12h5" /></>,
    signal: <><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0" /><circle cx="12" cy="20" r=".6" /></>,
    lighthouse: <><path d="M7 21h10l-2-12H9zM8 9h8V5H8zM7 5l5-3 5 3M10 13h4M11 17h2M5 6 2 4m3 4-3 2m17-4 3-2m-3 4 3 2" /></>,
    train: <><rect x="5" y="3" width="14" height="15" rx="4" /><path d="M5 10h14M12 3v7M8 18l-3 4m11-4 3 4M7 21h10" /><circle cx="9" cy="14" r="1" /><circle cx="15" cy="14" r="1" /></>,
    robot: <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M9 16h6M2 11v5m20-5v5" /><circle cx="8" cy="12" r="1" /><circle cx="16" cy="12" r="1" /><circle cx="12" cy="2" r="1" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7m-18 12 6-5m12 5-6-5" /></>,
    search: <><circle cx="10" cy="10" r="7" /><path d="m15 15 7 7M7 9a3 3 0 0 1 3-3" /></>,
    mask: <><path d="m4 3 4 4h8l4-4v10c0 6-8 9-8 9S4 19 4 13zM7 11l3 2m7-2-3 2m-4 4h4M12 13v2" /></>,
    curtain: <><path d="M2 4h20M3 4v17h6l-3-8c4-2 5-5 5-9m10 0v17h-6l3-8c-4-2-5-5-5-9M3 13h3m12 0h3M9 21h6" /></>,
    network: <><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M12 3v6m0 6v6M3 12h6m6 0h6M5 5l4 4m6 6 4 4m0-14-4 4m-6 6-4 4" /><circle cx="12" cy="2" r="1" /><circle cx="2" cy="12" r="1" /><circle cx="22" cy="12" r="1" /><circle cx="12" cy="22" r="1" /></>,
    anvil: <><path d="M3 10h18l-4 5h-3v3h4v3H6v-3h4v-3H7zM4 10V7h7v3m6-8 1 3 3 1-3 1-1 3-1-3-3-1 3-1z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}

const gameIcons = {
  'space-station': 'orbit', 'encrypted-call': 'signal', 'black-fog': 'lighthouse', 'silver-moon': 'train',
  'turing-test': 'robot', 'midnight-post': 'mail', 'baker-street': 'search', 'hundred-ghosts': 'mask',
  'curtain-heist': 'curtain', 'firewall-breach': 'network', 'star-workshop': 'anvil',
} satisfies Record<GameID, IconType>;

export function GameIcon({ gameID, size = 30 }: { gameID: GameID; size?: number }) {
  return <Icon type={gameIcons[gameID]} size={size} />;
}

export function Header({ room, rulesGame, gameID, background }: { room?: string; rulesGame?: string; gameID?: string; background?: BackgroundSelection }) {
  const chrome = useContext(GameHeaderContext);
  const activeGame = chrome?.replayGameID ?? gameID;
  const gameName = activeGame && isGameID(activeGame) ? gameCatalog[activeGame].name : undefined;
  const rulesTarget = activeGame ?? rulesGame;
  const rulesPath = rulesTarget && isGameID(rulesTarget) ? `/rules/${rulesTarget}` : '/rules';
  return <header className={`site-header${gameName ? ' has-game-title' : ''}`}><div className="header-brand-group"><button className="brand" onClick={() => navigate('/')} aria-label="回未央酒肆首頁"><span className="brand-symbol"><img src={siteIcon} alt="" /></span><span>未央酒肆<small>ENDLESS BAR</small></span></button>{gameName && <h1 className="header-game-name">{gameName}</h1>}</div><div className="header-links"><div className="header-sound-slot" ref={chrome?.setSoundTarget} />{background && <BackgroundPicker {...background} />}<a data-google-vignette="false" className="header-rules-link" href={roomContextPath(rulesPath, room)} target={room ? '_blank' : undefined} rel={room ? 'noopener noreferrer' : undefined}>詳細規則</a><a data-google-vignette="false" className="header-rules-link" href={roomContextPath('/privacy', room)} target={room ? '_blank' : undefined} rel={room ? 'noopener noreferrer' : undefined}>隱私權</a>{room && <span className="room-tag">私人房間</span>}</div></header>;
}

export function ErrorMessage({ children }: { children: ReactNode }) { return children ? <p className="error-message" role="alert">{children}</p> : null; }
export function Note({ children }: { children: ReactNode }) { return <div className="note"><Icon type="shield" /><span>{children}</span></div>; }
export function Submit({ busy, disabled = false, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) { return <button className="button primary full" type="submit" disabled={busy || disabled}>{busy ? '正在連線…' : children}<Icon type="arrow" /></button>; }
