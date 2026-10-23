import type { ReactNode } from 'react';
import { RoleGallery } from './RoleGallery';
import terminal from './assets/art/turing/terminal.png';
import chip from './assets/art/turing/chip.png';
import core from './assets/art/turing/core.png';
function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) { return <section className="rules-chapter panel" id={id}><h2>{title}</h2>{children}</section>; }

export function TuringRules() {
  return <>
    <Chapter id="setup" title="1. 歡迎來到人性檢測室"><p>城市傳出機器混入人群的消息，你們受邀協助校準一套辨識人性的系統。它會讀取回答，卻不懂幽默、分寸與情緒；只有你們能讓它學會這些差異。</p>
      <p><strong>4～9 位玩家全員合作，沒有隱藏機器人玩家，也沒有敵對陣營。</strong>一局共五輪，容錯起始值等於玩家人數，九人局則使用八點。觀戰者不占參與人數。</p>
      <p>第一輪檢測員由系統隨機選出，之後依座位順序輪換。檢測員負責解讀與排序，不抽取強度，也不回答該輪題目。其他玩家各收到一個不重複的 1～10，代表自己的回答應落在量表上的位置。沒有發出的數字不公開。</p>
    </Chapter>
    <Chapter id="gallery" title="2. 檢測設備圖鑑"><p>這些是所有玩家共用的測試設備，不是秘密角色；每輪的檢測員只是輪值職務。</p>
      <RoleGallery idPrefix="turing-guide" entries={[
        { id: 'terminal', name: '檢測終端', image: terminal, category: '設備 · 輪值檢測員', tone: 'friendly', description: '由本輪檢測員操作。等全部回答公開後，從他認為強度最低的回答開始，逐張揭曉數字。檢測員沒有自己的秘密強度。' },
        { id: 'chip', name: '強度晶片', image: chip, category: '牌面 · 秘密量表', tone: 'neutral', sampleNumber: 7, description: '每位受測者取得一個不重複的 1～10，依題目兩端的描述決定回答程度。這裡的 7 是教學範例，不代表任何對局中的數字。' },
        { id: 'core', name: '人性容錯核心', image: core, category: '設備 · 全隊共同資源', tone: 'friendly', description: '揭出的數字比緊接著的前一張更小時，核心失去一點容錯。五輪之間不重設，也不回血；耗盡立即失敗，撐過五輪則全隊成功。' },
      ]} />
    </Chapter>
    <Chapter id="answer" title="3. 用回答呈現強度"><ol>
      <li><strong>閱讀題目：</strong>每輪公布同一道題目與量表兩端。1 接近左端，10 接近右端；中間的數字由你自行拿捏。</li>
      <li><strong>確認就緒：</strong>受測者查看秘密強度，檢測員確認自己的職務；全部玩家按確認後開放輸入。</li>
      <li><strong>封存回答：</strong>受測者輸入最多 160 字的文字。送出前可修改，送出後就鎖定。檢測員不需作答。</li>
      <li><strong>一起公開：</strong>全員提交後才顯示全部回答。等待期間只知道誰已完成，不能看別人的內容；自己的已提交回答可在秘密資訊查看。</li>
      </ol><p>用句子、名稱或短描述作答，依題目指定的形式即可。可以虛構情境，不必透露真實私事。不要直接寫出自己的強度、用字數編碼或約定暗號；語意判讀由朋友遵守，系統不會替你評定答案好不好。</p>
      <div className="rules-example"><strong>原創示例</strong><p>「替一台第一次放假的機器人寫下今天的行程。」量表從「最像還在上班」到「最懂得享受假期」。你可以寫「整理完家裡，再把街坊的備份硬碟逐一檢查」，也可以寫「把鬧鐘寄放倉庫，帶著躺椅去追夕陽」。回答沒有唯一標準，重點是讓別人感受程度。</p></div>
    </Chapter>
    <Chapter id="sort" title="4. 逐張排序與誤差"><p>檢測員根據公開回答，從認為強度最低的那位開始，按「揭曉這張強度」。點擊就會揭牌，不能撤回。接著從尚未揭曉的回答挑選下一張，直到本輪結束或容錯耗盡。</p>
      <p>第一張只是排序起點。後續每張<strong>只和緊接著的前一張比較</strong>：上升不扣分；下降扣一點容錯。新揭出的數字會成為下一次比較基準，並非永遠和目前最大值比較。</p>
      <div className="rules-example"><strong>判定示例</strong><p>揭曉順序是 9 → 2 → 3：2 比 9 小，扣一點；3 比 2 大，不再扣。每次下降各扣一點，不會按照漏過幾個數字倍增。</p></div>
      <p>回答卡留在原位置，顯示數字及揭曉次序；底部還有本輪順序列，左側紀錄保存公開結果。排序時可以重新閱讀已公開內容，但不要以數字、表情暗號或補充答案指揮檢測員。</p>
    </Chapter>
    <Chapter id="round" title="5. 輪換與共同勝負"><p>本輪所有強度揭曉後，畫面停在最後結果，列出尚未確認的玩家。全員確認才換下一位檢測員、下一道題目，並重新洗出強度。每局抽取五道不同題目，容錯持續累計。</p>
      <p><strong>完成第五輪且至少剩一點容錯，全隊成功；容錯降到零，立即失敗。</strong>結束時公開本輪情報，終局桌面保留至少八秒後回到同一等待室；邀請、成員與歷史保留，可以重新準備或換別款遊戲。</p>
    </Chapter>
    <Chapter id="questions" title="6. 題庫與自訂題目"><ul><li><strong>人性校準：</strong>1,000 道原創正常題，涵蓋生活、想像、情緒與荒謬情境。</li><li><strong>失控協定：</strong>1,000 道成人向原創題，包含曖昧、尷尬與黑色幽默，適合接受這種風格的成年朋友；不要求露骨描述或真實自白。</li><li><strong>混合測試：</strong>從以上兩套合計 2,000 題抽選，包含成人向內容。</li><li><strong>自訂題庫：</strong>只使用房主提供的題目，至少五題；也能把自訂題目混入任一內建題庫。</li></ul>
      <p>房主可在等待室新增、編輯、移除最多 50 題。每題包含 5～200 字題幹，以及各 1～50 字的低、高端點，兩端不能相同，題幹不能重複。寫成能用文字完成的任務，例如寫一句回覆或取一個名稱，讓強度容易從低到高發揮。</p>
      <p>加入清單後要按「套用題庫設定」才生效；更新會清除全員準備，進行中不能換題庫。可下載 JSON 留存，或匯入同格式的題目清單。與內建題幹相同時採自訂版本，不重複抽取。自訂內容供此房間使用，不會自動加入全站內建題庫。</p>
    </Chapter>
    <Chapter id="privacy" title="7. 觀戰、回放與測試房"><p>盲視角只看已公開的回答與數字；上帝視角可查看當下受測者的秘密強度與已封存回答。未來題目的抽選順序不會提供給任何視角。觀戰者不參與作答、排序或確認，請勿把秘密情報轉告玩家。</p>
      <p>復盤保存當時的題目、回答與判定，之後修改自訂題庫也不會改寫舊局。分享復盤沿用框架的視角權限；PNG 檢測戰報只使用公開題目、回答和已揭曉結果。</p>
      <p>測試房可加入虛擬玩家，模擬作答、確認與排序；虛擬玩家用於測試介面，不代表真正理解題意，排序也可能失誤。測試房不計入統計。</p>
    </Chapter>
  </>;
}
