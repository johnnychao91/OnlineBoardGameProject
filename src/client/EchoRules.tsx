import { ECHO_REVIEW_SECONDS, ECHO_WORD_LIMIT } from '../games/echo/rules';
import { RoleGallery } from './RoleGallery';
import cup from './assets/echo/sealed-cup.webp';
import bell from './assets/echo/bell.svg';
import seal from './assets/echo/seal.svg';

export const echoChapters = [['play', '如何封詞'], ['match', '如何達成共鳴'], ['gallery', '酒肆道具圖鑑'], ['records', '復盤與排行']] as const;

export function EchoRuleSummary() {
  return <p>第一輪各寫一個詞，之後沿著上一輪揭曉的詞聯想。全員寫出同一個詞，或一致確認用詞的意思相同，這一桌就達成共鳴。</p>;
}

export function EchoRules() {
  return <>
    <section className="rules-chapter panel" id="play"><h2>1. 杯蓋闔上前，各自想一個詞</h2>
      <p>2～4 人一起玩。第一輪自由聯想，從第二輪起，從桌上已揭曉的詞找共同方向。每個詞最多 {ECHO_WORD_LIMIT} 個字元。揭曉前請各自思考，輸入內容與封好的詞只能由本人查看。</p>
      <p>全員封詞後會一起揭曉。預設可在揭曉前改詞，房主也可設定提交後鎖定。封詞時間可選 15、30、60、120 秒或不限時，預設 60 秒。不限時會等全員送出後再揭曉。輪數上限可選 5、10、15、30 或 1,000 輪，達成共鳴就提前結束。</p>
      <p>房主可在開局前禁止重複詞語。若輸入先前輪次已揭曉的詞，逐輪詞鏈會標亮原詞，本輪須換詞。同一輪的玩家仍可提交相同的詞。</p>
      <p>倒數到期會揭曉伺服器最後收到的輸入內容。空白顯示「未作答」；若本輪未同詞，直接進入下一輪，最後一輪則直接結算。鎖定的詞維持原樣。房主可在對局的房間管理調整封詞時間和提交規則。</p>
    </section>
    <section className="rules-chapter panel" id="match"><h2>2. 讓全桌達成共鳴</h2>
      <p>全員的答案相同時，立即以同詞共鳴結算。比較時會整理空白、全半形與英文字母大小寫，桌上仍顯示玩家原本提交的詞。</p>
      <p>全員主動封詞但用詞不同時，揭曉後直接開始下一輪。你可以一邊想新詞，一邊在封詞區下方按「意思相同」，確認上一輪的詞。若在本輪揭曉前全員確認，就以上一輪的同義共鳴結算。最後一輪若符合確認條件，會留 {ECHO_REVIEW_SECONDS} 秒供大家確認，倒數結束自動結算。</p>
      <p>當輪至少有兩份提交，才會更新下一輪的線索。少於兩份時沿用原線索。第一輪若沒有足夠的詞，下一輪仍可自由聯想。</p>
    </section>
    <section className="rules-chapter panel" id="gallery"><h2>3. 酒肆道具圖鑑</h2>
      <RoleGallery idPrefix="echo" entries={[
        { id: 'cup', name: '封詞杯', image: cup, category: '秘密提交', description: '待封詞時杯蓋放在杯旁，送出後闔上。全桌揭曉時，杯蓋再次移開並顯示答案。', tone: 'friendly' },
        { id: 'bell', name: '回聲鐘', image: bell, category: '回合揭曉', description: '全員封詞或時間到時，回聲鐘讓已送出的詞同時公開。', tone: 'neutral' },
        { id: 'seal', name: '共鳴印記', image: seal, category: '合作結算', description: '全桌達成共鳴時，杯中的金色漣漪在桌心交會。', tone: 'friendly' },
      ]} />
    </section>
    <section className="rules-chapter panel" id="records"><h2>4. 記下這次共鳴</h2>
      <p>觀戰與復盤只能看到當下已公開的詞。完整對局可從房間歷史逐輪回看，並在「分享與戰報」製作整局詞鏈圖。詞鏈會標記達成共鳴的輪次，並顯示是同詞或同義共鳴。</p>
      <p>正式局達成共鳴時，同一匿名瀏覽器身分每局最多累計 1 次。排行榜按共鳴次數排序，同分並列，暱稱採最近一次達成共鳴的對局。換瀏覽器或清除網站資料後，新身分會重新累計。測試房、觀戰者及中止局不計入排行。</p>
    </section>
  </>;
}
