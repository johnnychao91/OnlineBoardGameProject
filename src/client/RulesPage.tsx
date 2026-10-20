import type { ReactNode } from 'react';
import { possibleRoleCounts, stationRolePool } from '../games/station/view-model';
import { Header, Icon } from './ui';
import './rules-page.css';

export type RulesGameID = 'space-station' | 'encrypted-call';
const games = {
  'space-station': { name: '太空維修站', detail: '4～8 人 · 隱藏陣營 · 討論與推理', intro: '維修員要讓太空站恢復運作，干擾者則潛伏在隊伍中。你知道自己持有哪些設備，卻不知道它們的位置。' },
  'encrypted-call': { name: '加密通話', detail: '2～4 人 · 全員合作 · 8 歲以上', intro: '諜報戰線上，所有人都是友方特務。保持沉默，憑默契把訊號由小到大傳送，避開敵方監聽。' },
};
const stationChapters = [['setup', '人數與配置'], ['goals', '陣營與勝負'], ['round', '每輪流程'], ['inspect', '如何檢修'], ['review', '換輪與結束']] as const;
const cipherChapters = [['setup', '人數與配牌'], ['silence', '通訊限制'], ['transmit', '同步與傳送'], ['mistakes', '順序錯誤'], ['pulse', '靜默脈衝'], ['levels', '進階與補給']] as const;

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="rules-chapter panel" id={id}><h2>{title}</h2>{children}</section>;
}

export function RulesPage({ gameID }: { gameID?: RulesGameID }) {
  const game = gameID ? games[gameID] : undefined;
  const chapters = gameID === 'space-station' ? stationChapters : gameID === 'encrypted-call' ? cipherChapters : [];
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
    {!game && <div className="rules-game-cards">{Object.entries(games).map(([id, entry]) => <a className="panel rules-game-card" data-art-game={id} href={`/rules/${id}`} key={id}>
      <Icon type={id === 'space-station' ? 'orbit' : 'signal'} size={30} /><h2>{entry.name}</h2><p className="rules-game-meta">{entry.detail}</p><p>{entry.intro}</p><span>閱讀詳細規則 →</span>
    </a>)}</div>}
    <div className={`rules-reading-layout${game ? '' : ' rules-overview'}`}>
      {game && <nav className="rules-toc" aria-label="本頁章節"><strong>快速前往</strong>
        {chapters.map(([id, title]) => <a href={`#${id}`} key={id}>{title}</a>)}<a href="#room">房間、觀戰與復盤</a>
      </nav>}
      <article className="rules-article">
        {gameID === 'space-station' && <StationRules />}
        {gameID === 'encrypted-call' && <CipherRules />}
        <PlatformRules />
      </article>
    </div>
    <p className="rules-return"><a href="/">回到捷寶桌遊室 →</a>{game && <span>從房間開啟規則時，關閉此分頁即可回到原本的牌桌。</span>}</p>
  </main></div>;
}

function StationRules() {
  return <>
    <Chapter id="setup" title="1. 人數與配置">
      <p>參與玩家需 4～8 位，觀戰者不計入人數。以實際參與人數 N 計算，設備共有 5N 張：<strong>N 張維修模組、1 張反應爐危機、4N−1 張穩定設備</strong>。第一輪每人分到 5 張，最多進行 4 輪。</p>
      <div className="rules-table-wrap"><table><caption>身分牌池與可能的全場陣營人數</caption><thead><tr><th>玩家</th><th>身分牌池</th><th>本局可能人數</th></tr></thead><tbody>
        {[4, 5, 6, 7, 8].map(count => { const pool = stationRolePool(count); return <tr key={count}><th>{count} 人</th><td>維修員 {pool.filter(role => role === 'engineer').length}／干擾者 {pool.filter(role => role === 'saboteur').length}</td><td>{possibleRoleCounts(count).map(pair => `維修員 ${pair.engineer}／干擾者 ${pair.saboteur}`).join(' 或 ')}</td></tr>; })}
      </tbody></table></div>
      <p>身分牌洗勻後每人取一張；多出的一張不發出，也不公開。因此 4 人、7 人局的實際陣營比例不一定相同。身分整局固定，畫面列出的可能人數包含你自己。</p>
    </Chapter>
    <Chapter id="goals" title="2. 陣營與勝負">
      <ul><li><strong className="mint">維修員：</strong>在期限內找齊全部 N 張維修模組，立即獲勝。</li>
        <li><strong className="rules-danger">干擾者：</strong>反應爐危機被揭開，或第四輪的檢修額度用盡仍未找齊全部維修模組，即獲勝。</li>
        <li><strong>穩定設備：</strong>不增加維修進度，但仍消耗一次檢修額度。</li></ul>
      <p>勝敗屬於整個陣營。若第四輪最後一次檢修找到最後一張維修模組，維修員仍然獲勝；牌面結果先於輪數限制判定。</p>
    </Chapter>
    <Chapter id="round" title="3. 每輪先確認，再宣稱">
      <ol><li><strong>查看秘密資訊：</strong>你會看見自己的身分，以及目前剩餘暗牌中各種設備的數量。你不知道任何一張暗牌的實際位置，包括自己的牌。</li>
        <li><strong>全員確認：</strong>每位玩家按「我已看過資訊，準備繼續」。全部確認後才進入宣稱。</li>
        <li><strong>宣稱維修模組數量：</strong>點選數字就會提交，本輪不能修改。可以誠實，也可以說謊；可選上限為「你的暗牌張數」與「全場尚未找到的維修模組數量」兩者的較小值。</li>
        <li><strong>完成宣稱：</strong>尚未宣稱時，看不到別人的宣稱數字，只會知道誰已提交。自己提交後可查看已提交的數字；全員提交後才開始檢修。</li></ol>
      <p>宣稱只是玩家的說法，不代表實際設備。可以討論、質疑或說服朋友，但不要展示自己的秘密資訊畫面。</p>
    </Chapter>
    <Chapter id="inspect" title="4. 如何選擇與檢修設備">
      <p>第一輪的檢修工具隨機交給一位參與玩家；畫面會標示目前行動者。只有該玩家能檢修，而且必須選擇<strong>其他玩家尚未翻開的設備</strong>。</p>
      <ol><li>第一次點牌：預選位置，全員都能看到哪張牌即將被檢修，此時還沒翻開。</li>
        <li>可以改選另一張牌或取消預選。</li>
        <li>再次點同一張牌：開啟確認視窗；按「確認檢修」才真正翻牌。</li>
        <li>翻開的牌留在原位置，公開顯示種類。該玩家的暗牌數量與秘密資訊中的剩餘設備數量會扣除這張牌。</li>
        <li>若任務未結束，工具交給<strong>剛剛被檢修設備的玩家</strong>，由他選下一張。</li></ol>
      <p>本輪檢修順序與全部任務紀錄都會保留。提示音可開關，音量可調整為 0～100%；預設 50%，0% 為靜音。</p>
    </Chapter>
    <Chapter id="review" title="5. 換輪與任務結束">
      <p>每輪全場合計可檢修 N 張牌，並非每人各檢修一次。若尚未分出勝負，第一至第三輪的額度用完時會保留最後牌桌，等待<strong>所有參與玩家確認</strong>；畫面會列出還沒確認的人，觀戰者不需確認。</p>
      <p>全員確認後，把全部未翻開的牌重新洗勻、平均分配。第二、三、四輪每人分別收到 4、3、2 張牌，再經過查看資訊與宣稱階段。工具保留給上一輪最後被檢修的玩家。</p>
      <p>分出勝負時公開身分，保留終局牌桌至少 8 秒後返回原等待室。房間、邀請與歷史仍在，大家重新準備便能再玩；也可以先換一款遊戲。</p>
    </Chapter>
  </>;
}

function CipherRules() {
  return <>
    <Chapter id="setup" title="1. 人數、訊號與任務目標">
      <p>所有玩家都是友方特務，共同使用掩護與靜默脈衝。每個頻段從 1～100 的不重複訊號中重新洗牌發放；第 L 頻段每人收到 L 張，畫面會由小到大排列自己的牌。</p>
      <div className="rules-table-wrap"><table><caption>開局設定</caption><thead><tr><th>玩家</th><th>目標頻段</th><th>起始掩護</th><th>起始脈衝</th></tr></thead><tbody>
        <tr><th>2 人</th><td>12</td><td>2</td><td>1</td></tr><tr><th>3 人</th><td>10</td><td>3</td><td>1</td></tr><tr><th>4 人</th><td>8</td><td>4</td><td>1</td></tr>
      </tbody></table></div>
      <p>通過所有目標頻段，全隊獲勝；掩護降到 0，立即全隊失敗。掩護與脈衝跨頻段保留，不會每輪重設。</p>
    </Chapter>
    <Chapter id="silence" title="2. 保持沉默的通訊限制">
      <p>你們要在不透露手牌資訊的前提下，讓所有訊號依照數字由小到大傳送。沒有輪流順序，也沒有要求等待幾秒的固定時刻。</p>
      <ul><li>不能說出數字、大小範圍或剩餘牌的特徵，也不能展示牌面。</li><li>不能用手勢、倒數、約定節拍、聊天訊息或外部通話暗示出牌時機。</li><li>可以使用畫面的準備、暫停與脈衝決議功能；這些操作不能用來編碼暗號。</li><li>公開的傳送、剩餘張數與棄牌可以查看。觀戰者不要把上帝視角看到的資訊告訴玩家。</li></ul>
    </Chapter>
    <Chapter id="transmit" title="3. 同步、傳送與暫停">
      <ol><li>每個新頻段先發牌，所有特務按「我已就緒，確認同步」。全員確認後解除封鎖。</li><li>任何玩家都可以在自己認為合適的時機傳送，但只能傳送<strong>自己手中最小的一張</strong>。</li><li>點牌一次就立即送出，沒有確認視窗，也不能撤回。伺服器依實際收到並處理的先後決定順序。</li><li>手牌送完的人仍留在任務中，參與後續同步、下一頻段確認與脈衝決議。</li></ol>
      <p>任何玩家都能按「暫停，重新同步」。暫停不扣掩護或脈衝，也不重新發牌；全員再次確認後繼續。可用「遮住牌面」暫時隱藏自己的數字，重新顯示後才能傳送。</p>
    </Chapter>
    <Chapter id="mistakes" title="4. 順序錯誤如何處理">
      <p>如果你傳送一張訊號時，其他人手上還有更小的牌，便發生通訊破綻：<strong>全隊扣 1 點掩護</strong>，並公開棄掉所有比這次訊號更小、尚未傳送的牌。無論同一次漏掉幾張，都只扣 1 點。</p>
      <div className="rules-example"><strong>例子</strong><p>你傳送 20，隊友還握著 8 和 12。20 留在公開傳送紀錄，8、12 被棄掉，全隊只失去 1 點掩護。</p></div>
      <p>仍有掩護且還有牌時，全員重新同步後繼續。若已無手牌，就結算這個頻段；但掩護為 0 時直接失敗，不能靠本頻段的補給救回。</p>
    </Chapter>
    <Chapter id="pulse" title="5. 靜默脈衝：共同捨棄最小訊號">
      <ol><li>傳送階段至少還有 1 次脈衝時，任何特務可提出提議，傳送暫停。提議者視為已同意。</li><li>其餘所有特務都需選擇同意或拒絕，手牌為空的人也需表決。討論只限同意與否，不要透露牌面。</li><li><strong>任一人拒絕：</strong>取消，不消耗脈衝；回到重新同步。</li><li><strong>全員同意：</strong>消耗 1 次脈衝，每人有牌就公開棄掉自己最小的一張。這些牌不是傳送，不要求彼此的大小順序，也不扣掩護。</li></ol>
      <p>脈衝棄掉的數字不會成為新的傳送門檻，之後仍依剩餘手牌由小到大傳送。若還有手牌，全員重新同步後繼續；若全部手牌已清空，直接完成本頻段。</p>
    </Chapter>
    <Chapter id="levels" title="6. 完成頻段、補給與勝負">
      <p>全員手牌清空且掩護仍大於 0，便完成本頻段。以下補給在完成指定頻段後發放：</p>
      <ul><li>完成第 <strong>2、5、8</strong> 頻段：脈衝 +1，最多持有 3 次。</li><li>完成第 <strong>3、6、9</strong> 頻段：掩護 +1，最多持有 6 點。</li></ul>
      <p>尚未達到目標時，全員按「繼續下一頻段」，再重新洗牌，每人多發一張；新的頻段仍需全員確認同步。過關補給只在真的完成該頻段時取得。</p>
      <p>完成目標頻段立即全隊獲勝；掩護歸零立即全隊失敗。結果保存後返回同一等待室，可查看復盤與製作戰報，再重新準備下一局。</p>
    </Chapter>
  </>;
}

function PlatformRules() {
  return <Chapter id="room" title="房間、觀戰與復盤">
    <ul><li><strong>先集合，再選遊戲：</strong>等待室最多 8 個參與席位，開局另依遊戲的人數限制。觀戰不占席。房主在等待室換遊戲時會清除全員準備，保留成員、邀請與各局歷史；超出所選遊戲人數時，請部分玩家自行改為觀戰。</li>
      <li><strong>身分與管理：</strong>開局前可在玩家、觀戰者之間切換；房主改成觀戰仍保留管理權。只有房主主動離開才交接。房主可在等待室單次移出玩家，有效邀請仍能讓對方重新加入。</li>
      <li><strong>遊戲進行中：</strong>不能換遊戲或變更參與身分。房主可提前結束並返回等待室，中止不計勝敗。所有玩家與觀戰者都離開或離線超過 60 秒，也會終止尚未完成的對局。</li>
      <li><strong>觀戰視角：</strong>盲視角只顯示公開資訊；上帝視角在遊戲中即可查看秘密資訊。觀戰不提供遊戲操作權限，請朋友自行保密。</li>
      <li><strong>回放與分享：</strong>完成局可逐步復盤、選擇盲視角或上帝視角，並製作當下戰報圖。回放連結有效 7 天，朋友可前後查看整局；分享上帝視角代表同意持有連結的人查看該局秘密。房主可撤銷既有回放分享，已下載的圖片不會因此消失。</li>
      <li><strong>邀請與重連：</strong>房間邀請有效 24 小時，可由房主更新。邀請不包含你的座位權限。重新整理可恢復此瀏覽器的身分；換裝置或清除網站資料後，可能需要重新加入。開房密碼只用於建立房間，受邀朋友不需輸入。</li></ul>
  </Chapter>;
}
