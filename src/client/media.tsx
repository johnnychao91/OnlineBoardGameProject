import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mediaPageID, type MediaID } from '../games/media-route';
import { mediaFor, mediaGames, mediaSections } from './media-art';
import { SiteFooter } from './SiteFooter';
import './media.css';

function MediaPage({ game }: { game: MediaID }) {
  const [search, setSearch] = useState('');
  const [groups] = useState(() => mediaFor(game));
  const gameName = mediaGames.find(entry => entry.id === game)!.name;
  const query = search.trim().toLowerCase();
  const sections = mediaSections.map(section => ({
    ...section,
    assets: groups[section.id].filter(asset => asset.name.toLowerCase().includes(query) || asset.filename.toLowerCase().includes(query)),
  }));
  const total = sections.reduce((count, section) => count + section.assets.length, 0);
  return <>
    <main className="media-page">
      <header className="media-heading">
        <img src="/endless-bar-icon.svg" width="64" height="64" alt="" />
        <div><p>未央酒肆 · ENDLESS BAR</p><h1>美術素材檢查</h1></div>
      </header>
      <nav className="media-game-nav" aria-label="依遊戲瀏覽">
        {mediaGames.map(entry => <a key={entry.id} href={entry.id === 'endless-bar' ? '/media/' : `/media/${entry.id}`}
          aria-current={entry.id === game ? 'page' : undefined}>{entry.name}</a>)}
      </nav>
      <div className="media-toolbar">
        <div><h2>{gameName}</h2><p>{total} 張素材 · 點圖可另開原尺寸</p></div>
        <label>搜尋檔名<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="例：boot、roles、scene" /></label>
      </div>
      <nav className="media-section-nav" aria-label="素材分類">
        {sections.filter(section => section.assets.length).map(section =>
          <a key={section.id} href={`#${section.id}`}>{section.name}<span>{section.assets.length}</span></a>)}
      </nav>
      {sections.filter(section => section.assets.length).map(section =>
        <section className="media-section" key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`}>
          <h3 id={`${section.id}-heading`}>{section.name} <span>{section.assets.length} 張</span></h3>
          <ul className="media-grid">
            {section.assets.map(asset => <li key={asset.filename}>
              <a className="media-tile" href={asset.url} target="_blank" rel="noopener noreferrer">
                <div className="media-preview"><img src={asset.url} alt="" loading="lazy" decoding="async" /></div>
                <span>{asset.name}</span>
              </a>
            </li>)}
          </ul>
        </section>)}
      {!total && <p className="media-empty" role="status">沒有符合的美術素材。</p>}
    </main>
    <SiteFooter />
  </>;
}

const game = mediaPageID(location.pathname);
if (game) {
  createRoot(document.getElementById('root')!).render(<StrictMode><MediaPage game={game} /></StrictMode>);
}
