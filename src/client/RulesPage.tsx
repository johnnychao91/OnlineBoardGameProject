import { useEffect, type ReactNode } from 'react';
import { gameCatalog, ROOM_CAPACITY, type GameID } from '../games/catalog';
import { clientGames } from './game-registry';
import { Header, Icon } from './ui';
import './rules-page.css';

export type RulesGameID = GameID;
const games = gameCatalog;

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="rules-chapter panel" id={id}><h2>{title}</h2>{children}</section>;
}

export function RulesPage({ gameID }: { gameID?: RulesGameID }) {
  useEffect(() => {
    // A fresh page's fragment can be resolved before React mounts its chapters.
    function jumpToChapter() {
      let chapter: string;
      try { chapter = decodeURIComponent(location.hash.slice(1)); } catch { return; }
      if (chapter !== 'room' && !gameID) return;
      if (chapter !== 'room' && !clientGames[gameID!].chapters.some(([id]) => id === chapter)) return;
      document.getElementById(chapter)?.scrollIntoView({ block: 'start' });
    }
    jumpToChapter();
    window.addEventListener('hashchange', jumpToChapter);
    return () => window.removeEventListener('hashchange', jumpToChapter);
  }, [gameID]);
  const game = gameID ? games[gameID] : undefined;
  const chapters = gameID ? clientGames[gameID].chapters : [];
  const DetailedRules = gameID ? clientGames[gameID].DetailedRules : undefined;
  return <div className="rules-page" data-art-game={gameID}><Header /><main className="rules-main">
    <div className="rules-intro"><div className="eyebrow">HOW TO PLAY</div>
      <h1>{game ? `${game.name}・詳細規則` : '今晚怎麼玩？'}</h1>
      <p>{game?.intro ?? '先認識任務，再邀朋友同桌。這裡說明目前線上版本的完整流程與操作。'}</p>
      {game && <span className="rules-game-meta">{game.detail}</span>}
    </div>
    <nav className="rules-game-nav" aria-label="選擇遊戲規則">
      <a href="/rules" aria-current={!gameID ? 'page' : undefined}>規則總覽</a>
      {Object.entries(games).map(([id, entry]) => <a key={id} href={`/rules/${id}`} aria-current={gameID === id ? 'page' : undefined}>{entry.name}</a>)}
    </nav>
    {!game && <div className="rules-game-cards">{Object.entries(games).map(([id, entry]) => <article className="panel rules-game-card" data-art-game={id} key={id}>
      <Icon type={id === 'space-station' ? 'orbit' : 'signal'} size={30} /><h2><a href={`/rules/${id}`}>{entry.name}</a></h2><p className="rules-game-meta">{entry.detail}</p><p>{entry.intro}</p>
      <div className="rules-game-card-links"><a href={`/rules/${id}`}>閱讀詳細規則 →</a>{clientGames[id].roleGalleryChapter && <a href={`/rules/${id}#${encodeURIComponent(clientGames[id].roleGalleryChapter)}`}>角色圖鑑 →</a>}</div>
    </article>)}</div>}
    <div className={`rules-reading-layout${game ? '' : ' rules-overview'}`}>
      {game && <nav className="rules-toc" aria-label="本頁章節"><strong>快速前往</strong>
        {chapters.map(([id, title]) => <a href={`#${id}`} key={id}>{title}</a>)}<a href="#room">房間、觀戰與復盤</a>
      </nav>}
      <article className="rules-article">
        {DetailedRules && <DetailedRules />}
        <PlatformRules />
      </article>
    </div>
    <p className="rules-return"><a href="/">回到捷寶桌遊室 →</a>{game && <span>從房間開啟規則時，關閉此分頁即可回到原本的牌桌。</span>}</p>
  </main></div>;
}

function PlatformRules() {
  return <Chapter id="room" title="房間、觀戰與復盤">
    <ul><li><strong>先集合，再選遊戲：</strong>等待室最多 {ROOM_CAPACITY} 個參與席位，開局另依遊戲的人數限制。觀戰不占席。房主在等待室換遊戲時會清除全員準備，保留成員、邀請與各局歷史；超出所選遊戲人數時，請部分玩家自行改為觀戰。</li>
      <li><strong>身分與管理：</strong>開局前可在玩家、觀戰者之間切換；房主改成觀戰仍保留管理權。只有房主主動離開才交接。房主可在等待室單次移出玩家，有效邀請仍能讓對方重新加入。</li>
      <li><strong>遊戲進行中：</strong>不能換遊戲或變更參與身分。房主可提前結束並返回等待室，中止不計勝敗。所有玩家與觀戰者都離開或離線超過 60 秒，也會終止尚未完成的對局。</li>
      <li><strong>觀戰視角：</strong>盲視角只顯示公開資訊；上帝視角在遊戲中即可查看秘密資訊。觀戰不提供遊戲操作權限，請朋友自行保密。</li>
      <li><strong>回放與分享：</strong>完成局可逐步復盤、選擇盲視角或上帝視角，並製作當下戰報圖。回放連結有效 7 天，朋友可前後查看整局；分享上帝視角代表同意持有連結的人查看該局秘密。房主可撤銷既有回放分享，已下載的圖片不會因此消失。</li>
      <li><strong>邀請與重連：</strong>房間邀請有效 24 小時，可由房主更新。邀請不包含你的座位權限。重新整理可恢復此瀏覽器的身分；換裝置或清除網站資料後，可能需要重新加入。開房密碼只用於建立房間，受邀朋友不需輸入。</li></ul>
  </Chapter>;
}
