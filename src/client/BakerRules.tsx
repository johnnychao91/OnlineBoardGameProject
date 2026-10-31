import { useMemo, useState, type ReactNode } from 'react';
import { BAKER_DECKS, BAKER_ERAS, BAKER_ROLE_CATALOG, BAKER_SCENES, sceneOptions, type BakerCard, type BakerEra, type BakerScene } from '../games/baker/content';
import { BakerArtwork, bakerImage, bakerPortrait } from './BakerArtwork';
import { RoleGallery, type RoleGalleryEntry } from './RoleGallery';
import './baker.css';

export const bakerChapters = [['setup', '案件與年代'], ['roles', '角色與標記圖鑑'], ['evidence', '手法與物證牌庫'], ['scenes', '推演圖板圖鑑'], ['investigation', '三輪調查'], ['accusation', '破案與目擊反轉'], ['privacy', '交流、觀戰與復盤']] as const;

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="rules-chapter" id={id}><h2>{title}</h2>{children}</section>;
}

export function BakerRuleSummary() {
  return <div className="small"><p>4～12 人。福爾摩斯公開身分並透過推演圖板提供線索；執行者從自己的牌中秘密選定一張作案手段與一張現場物證。</p>
    <p>共三輪調查，每位福爾摩斯以外的玩家有一次正式破案機會。指出同一位其他玩家面前的正確兩張牌即可破案；錯誤會交出警徽，但仍可參與討論。</p>
    <p>有華生時，執行者被識破後仍可指認華生，猜中便逆轉勝利。福爾摩斯只用圖板提示，不能以語音、文字或動作補充。</p>
    <a data-google-vignette="false" href="/rules/baker-street" target="_blank" rel="noopener noreferrer">閱讀完整規則與案件圖鑑 →</a></div>;
}

export function BakerCardFace({ card, selected = false, onSelect, onInspect, disabled = false, compact = false }: {
  card: BakerCard; selected?: boolean; onSelect?: () => void; onInspect?: () => void; disabled?: boolean; compact?: boolean;
}) {
  const content = <><BakerArtwork card={card} /><span className="baker-card-name">{card.name}</span></>;
  return <div className={`baker-card${selected ? ' selected' : ''}${compact ? ' compact' : ''}`} data-kind={card.kind} data-era={card.era}>
    {onSelect ? <button className="baker-card-select" type="button" aria-pressed={selected} disabled={disabled} onClick={onSelect}
      aria-label={`選擇${card.kind === 'means' ? '作案手段' : '現場物證'}：${card.name}`}>{content}</button> : <div className="baker-card-static">{content}</div>}
    {onInspect && <button type="button" className="baker-card-inspect" onClick={onInspect} aria-label={`放大查看${card.name}`}>放大</button>}
  </div>;
}

function EraSelect({ era, onChange }: { era: BakerEra; onChange: (era: BakerEra) => void }) {
  return <label>案件年代<select value={era} onChange={event => onChange(event.target.value as BakerEra)}>
    {(Object.keys(BAKER_ERAS) as BakerEra[]).map(id => <option key={id} value={id}>{BAKER_ERAS[id].name}</option>)}
  </select></label>;
}

export function BakerEvidenceGallery() {
  const [era, setEra] = useState<BakerEra>('victorian'), [kind, setKind] = useState<'clue' | 'means'>('clue');
  const [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const cards = useMemo(() => (kind === 'clue' ? BAKER_DECKS[era].clues : BAKER_DECKS[era].means)
    .filter(card => card.name.includes(query.trim()) || (card.description ?? '').includes(query.trim())), [era, kind, query]);
  const count = 24, pages = Math.max(1, Math.ceil(cards.length / count)), current = Math.min(page, pages - 1);
  return <div className="baker-evidence-gallery">
    <div className="baker-gallery-filters"><EraSelect era={era} onChange={value => { setEra(value); setPage(0); }} />
      <label>牌庫<select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setPage(0); }}><option value="clue">現場物證 · 400 張</option><option value="means">作案手段 · 180 張</option></select></label>
      <label>搜尋牌名<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="例如：懷錶、信件" /></label>
    </div>
    <p className="baker-gallery-count" role="status">{BAKER_ERAS[era].name} · {cards.length} 張{query && '符合搜尋'} · 第 {current + 1} / {pages} 頁</p>
    <div className="baker-library-cards">{cards.slice(current * count, (current + 1) * count).map(card => <BakerCardFace key={card.id} card={card} />)}</div>
    {!cards.length && <p>找不到符合的牌名，請換一個字詞。</p>}
    <div className="baker-gallery-pagination"><button type="button" className="button secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>上一頁</button>
      <span>{current + 1} / {pages}</span><button type="button" className="button secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一頁</button></div>
  </div>;
}

export function BakerSceneReference({ scene, era }: { scene: BakerScene; era: BakerEra }) {
  return <article className={`baker-scene-reference${scene.kind === 'special' ? ' special' : ''}`}>
    <span className="baker-scene-category">{({ cause: '固定 · 死因', location: '固定 · 案發地點', scene: '一般圖板', special: '特別圖板' })[scene.kind]}</span>
    <h3>{scene.name}</h3>{scene.kind === 'special' ? <p>{scene.description}</p> : <ol>{sceneOptions(scene, era).map((option, index) => <li key={index}>{option}</li>)}</ol>}
  </article>;
}

export function BakerSceneGallery() {
  const [era, setEra] = useState<BakerEra>('victorian'), [special, setSpecial] = useState(false), [page, setPage] = useState(0);
  const scenes = BAKER_SCENES.filter(scene => special ? scene.kind === 'special' : scene.kind !== 'special');
  const count = 12, pages = Math.max(1, Math.ceil(scenes.length / count)), current = Math.min(page, pages - 1);
  return <><div className="baker-gallery-filters"><EraSelect era={era} onChange={setEra} /><label>圖板類型<select value={special ? 'special' : 'normal'} onChange={event => { setSpecial(event.target.value === 'special'); setPage(0); }}>
    <option value="normal">死因、地點與一般圖板 · 52 塊</option><option value="special">特別圖板 · 12 塊</option></select></label></div>
    <div className="baker-scene-gallery">{scenes.slice(current * count, (current + 1) * count).map(scene => <BakerSceneReference scene={scene} era={era} key={scene.id} />)}</div>
    <div className="baker-gallery-pagination"><button type="button" className="button secondary" disabled={!current} onClick={() => setPage(current - 1)}>上一頁</button>
      <span>{current + 1} / {pages}</span><button type="button" className="button secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一頁</button></div></>;
}

export function BakerRules() {
  const roles: RoleGalleryEntry[] = BAKER_ROLE_CATALOG.map(role => ({ id: role.id, name: role.name, image: bakerPortrait(role.id), description: role.description,
    category: role.playable ? `${role.faction === 'criminal' ? '莫里亞蒂陣營' : '調查陣營'} · 身分牌 ${role.count} 張`
      : role.faction === 'reserve' ? '預製人物 · 未加入角色配置' : '故事人物 · 幕後主使', tone: role.faction === 'criminal' ? 'hostile' : role.faction === 'police' ? 'friendly' : 'neutral' }));
  return <div className="baker-rulebook">
    <Chapter id="setup" title="1. 貝克街迷霧：選一個年代，打開一宗案件">
      <p className="baker-rulebook-intro">煤氣燈下的足跡、戰時封緘的文件，或現代倫敦的一段數位紀錄，都可能通往同一個名字：莫里亞蒂。執行者與內應混進調查隊伍；福爾摩斯掌握真相，必須以鑑證線索讓警方看穿迷霧。</p>
      <p>4～12 位玩家透過語音交流，網站負責身分、公開證物、推演圖板與破案裁定。年代是平行案件背景：福爾摩斯與熟悉的人物會出現在選定年代的故事中。</p>
      <div className="rules-table-wrap"><table><caption>四套年代牌庫</caption><thead><tr><th>年代</th><th>案發年份</th><th>本年代內容</th></tr></thead><tbody>
        {(Object.keys(BAKER_ERAS) as BakerEra[]).map(era => <tr key={era}><th>{BAKER_ERAS[era].name}</th><td>{BAKER_ERAS[era].minYear === BAKER_ERAS[era].maxYear ? BAKER_ERAS[era].minYear : `${BAKER_ERAS[era].minYear}～${BAKER_ERAS[era].maxYear}`}</td><td>400 張現場物證、180 張作案手段</td></tr>)}
      </tbody></table></div>
      <p>房主設定案件年代與公開年份。配牌只使用該年代的牌庫，同一年代中不同年份沿用同一套牌；年份不增加額外勝負條件。跨年代相同物件可以共用原創插畫，牌名與年代標示以本局資料為準。</p>
      <p>標準配牌為每人各 4 張作案手段與現場物證，全部放在公開桌面。較容易的案件可改成各 3 張，較困難的案件可改成各 5 張。福爾摩斯公開身分，使用推演圖板而不保留這些牌。</p>
      <p>4～5 人使用福爾摩斯、執行者與倫敦警察。6 人起可加入內應，或同時加入內應與華生。選擇「依人數配置」時，6～12 人會啟用內應與華生；房主也能選擇基本配置。</p>
    </Chapter>
    <Chapter id="roles" title="2. 角色與標記圖鑑">
      <p>基礎身分牌共 12 張：福爾摩斯、華生、執行者、內應各 1 張，以及 8 張倫敦警察；每局依人數及設定取用。數位基本配置可按人數重複使用倫敦警察身分。福爾摩斯可以隨機分配，也可指定一位已入座玩家。其餘身分保密。</p>
      <RoleGallery entries={roles} idPrefix="baker-role" />
      <p>瑪麗、艾琳、邁克羅夫特、雷斯垂德探長、葛萊森探長與霍普金斯是預製人物圖卡，目前沒有額外技能，也不會被抽成新角色。莫里亞蒂是幕後主使，不占玩家名額。</p>
      <RoleGallery idPrefix="baker-token" entries={[
        { id: 'badge', name: '倫敦警徽', image: bakerImage('badge'), category: '破案機會 · 最多 11 枚', description: '福爾摩斯以外，每人持有一枚。一次錯誤的正式破案會交出警徽；失去警徽仍可討論與發言。', tone: 'neutral' },
        { id: 'chess-marker', name: '推理棋子', image: bakerImage('chess-marker'), category: '鑑證標記 · 6 枚', description: '福爾摩斯在六塊推演圖板各選一個詞，用棋子標出線索。一般情況下，已放置的棋子不能改動。', tone: 'neutral' },
      ]} />
    </Chapter>
    <Chapter id="evidence" title="3. 作案手段與現場物證牌庫">
      <p>執行者從自己面前的作案手段與現場物證中各選一張，組成本局唯一答案。福爾摩斯與內應會知道答案；倫敦警察不會知道，華生也不知道作案方式。</p>
      <p>所有牌面都公開。插畫用於辨認物件，推理以牌名為準，可以合理想像物件與案件的關係；圖鑑不讀取房間資料，也不標示本局答案。</p>
      <BakerEvidenceGallery />
    </Chapter>
    <Chapter id="scenes" title="4. 福爾摩斯推演圖板">
      <p>共有 64 塊圖板，包含 12 塊特別圖板。第一輪使用死因圖板、福爾摩斯選擇的一塊案發地點圖板，以及隨機抽出的四塊一般圖板。一般圖板各有六個詞，福爾摩斯每塊選一個。</p>
      <p>死因與案發地點在整局固定；第二、三輪各抽一塊新的一般圖板，替換原本四塊一般圖板之一，再放上新的棋子。舊的公開提示仍可在案件紀錄中回顧。</p>
      <p>房主可開啟特別圖板，讓第二、三輪有機會出現案件事件。這 12 塊是《貝克街迷霧》的原創擴充，效果列在圖鑑與抽到時的畫面中；依提示完成後繼續調查。</p>
      <BakerSceneGallery />
    </Chapter>
    <Chapter id="investigation" title="5. 三輪調查：鑑證與案情研討">
      <ol><li><strong>確認身分：</strong>每人查看自己的秘密身分。執行者秘密選定自己的兩張答案牌，其他人等待案件建立。</li>
        <li><strong>福爾摩斯鑑證：</strong>先選案發地點圖板，再以自己決定的順序，在六塊圖板各放一枚推理棋子。第一枚棋子放下後，調查隊便可討論與正式破案。</li>
        <li><strong>案情研討：</strong>六枚棋子放妥後，從福爾摩斯之後的第一位玩家開始，依座位輪流發言。發言者按下完成才換下一位；可先約定每人約半分鐘。</li>
        <li><strong>追加鑑證：</strong>所有人發言完畢，進入下一輪，抽出新圖板並替換一塊一般圖板，再次依序發言。</li></ol>
      <p>第三輪最後一人完成發言時，仍未破案便由莫里亞蒂陣營獲勝。沒有警徽的玩家照常參與發言。發言期間，其他人應讓發言者說完，正式破案可以插入。</p>
      <p>所有一般線索與發言次序都由畫面提示。福爾摩斯不能利用額外文字、說話、手勢或目光告訴大家答案；他的正式資訊管道是圖板與破案結果。</p>
    </Chapter>
    <Chapter id="accusation" title="6. 提交破案推論與華生的目擊反轉">
      <p>福爾摩斯以外的每一位玩家，包括執行者及內應，都有一次正式破案機會。在公開證物桌選擇另一位玩家，指出他面前的一張作案手段與一張現場物證，再確認提交。</p>
      <ul><li><strong>兩張都正確：</strong>執行者遭到識破。未啟用華生時，調查陣營立即獲勝。</li>
        <li><strong>任何一張不正確：</strong>只會得到「推論不成立」。不指出錯的是手法、物證還是嫌疑人；提交者交出警徽，繼續參與討論。</li>
        <li><strong>機會耗盡：</strong>所有人的警徽都用完，或第三輪發言結束仍未破案，莫里亞蒂陣營獲勝。</li></ul>
      <p>華生看見執行者與內應兩人離開現場，知道這兩人的身分值得懷疑，卻分不清誰是執行者、誰是內應。他沒有完整答案，也不知道作案手段與關鍵物證。</p>
      <p>有華生時，正確破案會進入最後指認。執行者可與內應商量並選擇一名玩家：若找到華生，莫里亞蒂陣營逆轉獲勝；若指錯，調查陣營獲勝。正式結案才公開全部身分與答案。</p>
    </Chapter>
    <Chapter id="privacy" title="7. 交流、秘密資訊、觀戰與復盤">
      <p>遊戲透過外部語音進行，網站不存取麥克風、不錄音。請遵守福爾摩斯的提示限制與輪流發言；其餘玩家可以討論、推理或隱瞞自己知道的事。</p>
      <p>右側秘密卷宗只提供本人獲准的身分與情報。收起時會一起遮住角色插畫、私人答案與秘密選擇；切換分頁或視窗不會改變手動開合狀態。公開的福爾摩斯身分不受影響。</p>
      <p>盲視角觀戰與復盤只顯示當時的公開桌面；上帝視角可查看各玩家當時的私人資訊。兩者均不能操作，也看不到尚未抽出的牌序。公開 PNG 戰報只收錄公開的鑑證與破案紀錄。</p>
    </Chapter>
  </div>;
}
