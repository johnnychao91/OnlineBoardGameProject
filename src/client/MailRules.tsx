import { useState, type ReactNode } from 'react';
import { MAIL_CARDS, MAIL_CLASSIC_ROLES, MAIL_MODES, type MailMode, type MailRole } from '../games/post/rules';
import { mailPortrait } from './MailArtwork';
import { RoleGallery, type RoleGalleryEntry } from './RoleGallery';
import './mail.css';
export { MailRuleSummary } from './MailBoard';

export const mailChapters = [['setup', '人數與郵局故事'], ['flow', '密函投遞流程'], ['roles', '人物與封印圖鑑'], ['expanded', '全城夜遞規則'], ['director', '黑函局長規則'], ['privacy', '秘密、觀戰與復盤']] as const;
function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="rules-chapter panel" id={id}><h2>{title}</h2>{children}</section>;
}

export function MailRoleGallery() {
  const [mode, setMode] = useState<MailMode>('classic');
  const roles = (Object.keys(MAIL_CARDS) as MailRole[]).filter(role => mode === 'classic'
    ? MAIL_CLASSIC_ROLES.includes(role as typeof MAIL_CLASSIC_ROLES[number])
    : mode === 'premium' ? MAIL_CARDS[role].deck === 'letter' : MAIL_CARDS[role].deck !== 'letter' && !MAIL_CARDS[role].seal);
  const entries: RoleGalleryEntry[] = roles.map(role => {
    const card = MAIL_CARDS[role];
    return { id: role, name: card.name, image: mailPortrait(role),
      category: `${card.deck === 'letter' ? '投遞人物' : card.deck === 'courier' ? '午夜信使牌堆' : '黑函局長牌堆'} · ${card.value} · ${mode === 'classic' ? card.classicCount : card.count} 張`,
      description: card.description, tone: card.deck === 'director' ? 'hostile' : 'neutral' };
  });
  return <>
    <div className="mail-gallery-tabs" role="group" aria-label="選擇圖鑑玩法">{(Object.keys(MAIL_MODES) as MailMode[]).map(id => <button key={id}
      type="button" aria-pressed={id === mode} onClick={() => setMode(id)}>{MAIL_MODES[id].name}</button>)}</div>
    <RoleGallery entries={entries} idPrefix={`mail-${mode}`} />
    {mode === 'black-letter' && <div className="rules-role-gallery mail-seal-gallery">{(Object.entries(MAIL_CARDS) as [MailRole, typeof MAIL_CARDS[MailRole]][]).filter(([, card]) => card.seal).map(([role, card], index) => <article
      className="rules-role-card" key={role} data-tone="hostile"><div className="mail-seal-portrait" data-seal={index + 1} aria-hidden="true"><span>{['◉', '✦', '◇', '✹', '◈', '⌛'][index]}</span><b>{card.value}</b></div>
      <div className="rules-role-copy"><h3>{card.name}</h3><p className="rules-role-faction">局長封印 · {card.value} · 1 張</p><p>{card.description}</p></div>
    </article>)}</div>}
  </>;
}

export function MailRules() {
  return <div className="mail-rulebook">
    <Chapter id="setup" title="1. 午夜郵局：人數與故事">
      <p className="mail-rulebook-intro">城市入睡後，一間不存在於地圖上的郵局才開始營業。雨滴敲著黃銅信箱，信使把最後一封密函藏進墨綠郵袋。有人想讓它送達，有人想知道它寫了什麼，也有人準備調換整個信袋。</p>
      <div className="rules-table-wrap"><table><caption>三種投遞玩法</caption><thead><tr><th>玩法</th><th>人數</th><th>今晚的目標</th></tr></thead><tbody>
        <tr><th>密函投遞</th><td>3～4 人</td><td>16 張人物牌，個別競爭信任郵戳。</td></tr>
        <tr><th>全城夜遞</th><td>5～8 人</td><td>32 張人物牌，加入九種額外人物與特殊獎勵。</td></tr>
        <tr><th>黑函局長</th><td>2～6 人</td><td>一名局長對抗其他信使，以生命與六封印決勝。</td></tr>
      </tbody></table></div>
      <p>房主在等待室選擇玩法，也可選「依人數選擇」：兩人採黑函局長、三至四人採密函投遞、五至八人採全城夜遞。實際人數以開局時參與名單為準，觀戰者不占席。明確選定的玩法不會因人數不符而悄悄切換。</p>
      <p>黑函局長可以開局隨機分配，也可由房主指定一位參與玩家。三種玩法沿用相同郵局世界，牌堆與能力各自獨立，不能把不同玩法的人物能力混用。</p>
    </Chapter>
    <Chapter id="flow" title="2. 密函投遞：保留一封信，送出另一封">
      <h3>開門與配牌</h3>
      <p>每輪把 16 張人物牌重新洗勻，蓋放一張備用密函，然後每人取得一張秘密手牌。全員看過自己的信袋並確認後開始；輪到的人會自動抽一張，從兩張之中選一張打出，另一張留在信袋。</p>
      <ol><li><strong>打出人物：</strong>點選手牌後即公開這張牌，依人物能力繼續選擇目標、猜測數字或其他必要項目。需要多選或排序時，選好後再確認。</li>
        <li><strong>完成能力：</strong>伺服器處理查驗、比牌、保護、換牌或退出本輪；有些效果會交給被指定者做最後選擇。所有選擇完成才換下一位。</li>
        <li><strong>繼續投遞：</strong>依座位順序輪流，略過已退出本輪的人。退出者公開棄掉手牌，等下一輪重新加入。</li></ol>
      <p>守燈人的護送持續到自己下一回合開始，期間不能成為其他人的卡牌目標。若某張牌沒有合法目標，仍會公開打出，但能力落空；轉遞專員可以指定自己。當手持緘默夫人與轉遞專員或換袋總管時，必須打出緘默夫人，網站會禁用另一張牌。</p>
      <h3>本輪如何結束？</h3>
      <ul><li><strong>只剩一人：</strong>最後還在本輪的信使贏得本輪。</li><li><strong>牌堆用完：</strong>完成當前卡牌效果後，尚未退出者公開留下的密函，數字最高者贏得本輪。平手先比自己公開棄牌的數字總和，仍相同則並列獲勝。</li></ul>
      <p>本輪贏家各得一枚信任郵戳。三人局先達 5 枚、四人局先達 4 枚，且沒有同分最高者時，成為本局投遞冠軍。若達門檻時最高分並列，只有這些信使參加決勝投遞，直到分出冠軍。</p>
      <p>輪末結果會保留，所有參與玩家確認後才重新配牌。通常由上輪贏家先投遞；若上輪多人並列，網站以座位順序選出先手。</p>
    </Chapter>
    <Chapter id="roles" title="3. 人物與封印圖鑑">
      <p>圖鑑是公開的能力參考，不是本局手牌。切換玩法，可查看其牌堆、數字、張數與能力；只有畫面實際獲准顯示的牌面，才會在信袋中出現。</p>
      <MailRoleGallery />
    </Chapter>
    <Chapter id="expanded" title="4. 全城夜遞：全城信使的盤算">
      <p>適用 5～8 人，共 32 張人物牌。基本抽牌、打牌、保護、退出及輪末確認流程與密函投遞相同；巡街郵差增加為 8 張，並加入九種人物。每輪同樣先蓋放一張備用密函。</p>
      <ul><li><strong>反制與預測：</strong>斷郵客會反制巡街郵差的指認；夜鈴小丑可預測另一位信使，若預測對方贏得本輪，自己也得一枚郵戳。</li>
        <li><strong>更多情報與調包：</strong>雙窗窺信人可查看最多兩人的信袋；紅印主事讓兩人交換手牌，再由自己查看其中一張。引路掮客讓下一張需要選人的牌，必須把指定者列為目標之一；沒有合法選法時該效果落空。</li>
        <li><strong>改變比牌：</strong>霧巷遺孀讓數字較高者退出，與封緘審官的比較方向相反。集郵伯爵在自己的公開棄牌區時，每張讓輪末的手牌比較值加 1，其他時刻的比牌不加。</li>
        <li><strong>額外郵戳：</strong>已打出夜巡督察的人若之後退出本輪，得到一枚郵戳。終宵大主事猜中別人的數字也能得一枚郵戳，被猜中者可以選擇是否棄牌補牌。</li></ul>
      <p><strong>終宵大主事的輪末判定：</strong>這張牌印有 9。本站採固定判定：若輪末有人持有零號收件人，終宵大主事不列入本輪冠軍候選；其餘信使仍按手牌數字加集郵伯爵加成比較。沒有零號收件人時，大主事以 9 加伯爵加成參與比較。平手再比棄牌數字總和。</p>
      <p>所有人以 4 枚信任郵戳為獲勝門檻。額外郵戳會保留，即使當輪退出也不會扣掉；最高分達標但多人並列時，依前述方式進入決勝投遞。</p>
    </Chapter>
    <Chapter id="director" title="5. 黑函局長：阻止六封印封城">
      <p>午夜信使發現，局長正在把全城未寄出的信煉成六枚封印。這次不爭信任郵戳：一人扮演黑函局長，其餘玩家是共同作戰的午夜信使。局長與信使各用自己的牌堆。</p>
      <div className="rules-table-wrap"><table><caption>起始生命</caption><thead><tr><th>總人數</th><th>局長生命</th><th>信使共同生命</th></tr></thead><tbody>{[2, 3, 4, 5, 6].map(count => <tr key={count}><th>{count} 人</th><td>{count <= 3 ? 4 : count + 1}</td><td>6</td></tr>)}</tbody></table></div>
      <h3>兩個牌堆，兩種信袋</h3>
      <p>局長起手保留兩張牌，每回合抽一張再打出一張；午夜信使起手一張，每回合抽一張、打一張。局長本人這張 7 不能主動打出。所有人確認後，由局長先行，再依座位讓信使輪流行動，最後回到局長。</p>
      <p>局長處理完每次投遞後，需選擇「完成投遞，交給下一位信使」；若已集齊六封印，也可在這一步選擇宣告。</p>
      <p><strong>雙人特例：</strong>每次局長完成一回合後，信使連續進行兩個完整回合，每次仍各自抽牌與打牌；然後再輪到局長。</p>
      <h3>擊退、對決與火漆力量</h3>
      <p>猜中數字或其他能力可以擊退手牌。信使被擊退時，團隊失去 1 點共同生命，該信使棄牌後補回一張；局長被擊退一張手牌時失去 1 點生命，也會先補牌。這個玩法沒有人因一次擊退就離席。</p>
      <p>對決比較雙方指定的手牌數字。信使對上局長時，局長那張通常由系統隨機決定；局長主動對決則可選擇自己的哪張手牌出戰。數字較小者的牌被擊退，相同則雙方都不受傷。</p>
      <p>雙方有火漆力量時，每次對決各自必須消耗 1 枚，讓本次比較值加 2；每方最多用 1 枚。力量只影響對決，不會改變牌上數字，也不會讓對方的猜牌判定失準。</p>
      <h3>六封印與牌堆循環</h3>
      <p>局長的六種封印各一張，分別具有猜牌、擊退、連續對決、增加力量、調整手牌與複製棄牌能力。封印或局長本人被擊退時，先補回手牌，再把被擊退的該牌洗回局長牌堆；正常打出的封印留在公開棄牌區。</p>
      <p>信使牌堆用完時，將公開信使棄牌重新洗成牌堆。局長牌堆用完則不會把一般公開棄牌整疊洗回；補牌與部分能力可能因此無法抽足，依畫面的合法選項處理。</p>
      <p><strong>信使獲勝：</strong>局長生命降到 0。<strong>局長獲勝：</strong>信使共同生命降到 0，或局長在自己的回合、沒有尚待處理的效果時，宣告六種不同封印已同時存在於自己的手牌與公開棄牌區。調整手牌的效果要全部完成，才能確認是否集齊。</p>
      <p><strong>交流限制：</strong>只能討論公開資訊，例如棄牌、牌堆張數、力量與生命。不能透露或暗示任何私下看過的牌，包含自己的手牌與查驗別人的結果，也不能指揮其他人要打哪張牌或如何選擇。</p>
    </Chapter>
    <Chapter id="privacy" title="6. 信袋、觀戰與復盤">
      <p>自己的手牌、私下查驗與牌堆調整選擇只會提供給獲准的參與者。需要暫時遮住時，可以手動收起右側秘密信袋；收起時，私人選項也會遮住，切換視窗不會改變手動開合狀態。</p>
      <p>查驗紀錄描述的是當時的牌，對方之後可能換牌。公共桌面只顯示手牌張數、公開棄牌、護送、力量與郵戳，不會用圖片或提示音暗示未公開牌面。</p>
      <p>盲視角觀戰只看公開資料，上帝視角可切換查看各信使目前的信袋與私人查驗；兩種視角都不能操作，也看不到未來抽牌順序或正在整理的牌堆內容。回放會保留當時的規則與結果，PNG 戰報只包含公開資訊。</p>
    </Chapter>
  </div>;
}
