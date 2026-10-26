import type { ReactNode } from 'react';
import { HEIST_ARTIFACTS, HEIST_ARTIFACT_IDS, HEIST_HAZARDS, HEIST_HAZARD_IDS, HEIST_LOOT_VALUES, HEIST_RULE_SOURCES } from '../games/heist/content';
import { RoleGallery, type RoleGalleryEntry } from './RoleGallery';
import { heistArt } from './heist-art';
import './heist.css';

export const heistChapters = [['setup', '五幕劫案'], ['flow', '深入或撤退'], ['gallery', '贓物、警戒與珍藏圖鑑'], ['danger', '警戒與撤離'], ['artifacts', '獨自帶走珍藏'], ['victory', '結算與秘密']] as const;
function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) { return <section className="rules-chapter panel" id={id}><h2>{title}</h2>{children}</section>; }

export function HeistRuleSummary() { return <div className="heist-rule-summary"><p>3～8 人，連續五幕。每幕先揭一張牌，仍在現場的人再同時密選深入或撤退，全部密封後一起公開。</p><p>贓物由在場者平均分配，餘數留在路上。撤退者先平分整條路線的餘款，再把隨身贓物一起存入自己的金庫。</p><p>只有同一批恰好一人撤退，才能帶走路上全部珍藏。多人同行撤退時，珍藏繼續留在現場。</p><p>同種警戒第二次出現，這幕立即失敗，仍在現場的人失去全部隨身贓物。移除第二張同種警戒，已入庫財富安全。</p><p>五幕後比金庫加珍藏總值；平手比珍藏件數，仍同分共享勝利。未結算的決策與他人的金庫始終保密。</p></div>; }

export function HeistRoleGallery() {
  const entries: RoleGalleryEntry[] = [
    { id: 'loot-a', name: '散落贓物', image: heistArt('loot-a'), category: '贓物牌 · 共 15 張', description: '揭牌時由所有仍在現場的人平均分配，無法整除的部分留在路線上。圖上的財物是插畫，實際價值以牌面數字為準。', tone: 'friendly' },
    { id: 'loot-b', name: '滿載贓物', image: heistArt('loot-b'), category: '贓物牌 · 另一幅公開插畫', description: `完整牌值為 ${HEIST_LOOT_VALUES.join('、')}。兩種贓物插畫共用同一套分配規則，不增加牌或改變數值。`, tone: 'friendly' },
    ...HEIST_HAZARD_IDS.map(id => ({ id, name: HEIST_HAZARDS[id].name, image: heistArt(`hazards/${id}`), category: '警戒牌 · 起始各 3 張', description: '第一次出現只留下警訊；同一幕第二次出現時立即觸發封鎖，仍在現場的人失去隨身贓物。只有第二張同種警戒永久移出牌堆。', tone: 'hostile' as const })),
    ...HEIST_ARTIFACT_IDS.map((id, index) => ({ id, name: HEIST_ARTIFACTS[id].name, image: heistArt(`artifacts/${id}`), category: `珍藏 · ${HEIST_ARTIFACTS[id].value} 點 · 第 ${index + 1} 幕加入`, description: '揭開後先留在路上。某批只有一人撤退時，由他帶走現場全部珍藏；這幕結束仍未取走的珍藏永久移除。尚未揭開的珍藏留在牌堆。', tone: 'neutral' as const })),
    { id: 'bank', name: '幕後金庫', image: heistArt('bank'), category: '私人財富 · 安全保存', description: '撤退時把自己的隨身贓物和分得的路線餘款存入。之後任何警戒都不會扣除金庫；遊戲中只有本人能查看，終局才一起公開。', tone: 'friendly' },
    { id: 'decision-explore', name: '繼續深入', image: heistArt('decision-explore'), category: '同時密封決策', description: '留在現場，等所有撤退者完成結算後才揭下一張牌。你保留隨身贓物，也繼續承受第二張同種警戒的風險。', tone: 'neutral' },
    { id: 'decision-exit', name: '撤退入庫', image: heistArt('decision-exit'), category: '同時密封決策', description: '與這一批撤退者平分路線餘款，存好隨身贓物。本幕不再參與後續決策，下一幕重新入場。', tone: 'friendly' },
  ];
  return <RoleGallery entries={entries} idPrefix="heist" />;
}

export function HeistRules() { return <div className="heist-rulebook">
  <Chapter id="setup" title="1. 掌聲落下，劫案開場"><p className="heist-rulebook-intro">最後一束追光熄滅，觀眾離開了劇院。舞台下的暗門卻剛剛開啟。你們穿過後台與收藏室，把散落的財物收入行囊；越接近深處，珍藏越耀眼，警戒也越密。何時退出這場演出，只有自己知道。</p><p>3～8 位玩家各自競爭財富，進行五幕劫案。每幕所有人一起入場，隨身贓物從 0 開始，先前存入金庫的財富與取得的珍藏則保留。每人確認準備後揭開本幕第一張牌，接著開始同時決策。</p><p>基本牌堆包含 15 張贓物牌、五種警戒各 3 張，以及依幕次逐一加入的五件珍藏。沒有額外事件或其他擴充。畫面沒有行動倒數，所有仍在現場的人密封完成才會繼續。</p><p>每幕開始前，將該幕的新珍藏加入仍可使用的牌堆，再重新洗牌。第一幕只有藍寶石之眼；後四幕依序加入月相懷錶、緋紅假面、水晶王冠、稜鏡之心。前幕已永久移除的牌不會恢復。</p></Chapter>
  <Chapter id="flow" title="2. 多走一步，還是現在謝幕？"><ol><li><strong>揭開下一段路線：</strong>贓物立即平均分給仍在現場的人；珍藏放在路上；警戒則檢查是否已出現相同種類。</li><li><strong>秘密選擇：</strong>若尚未封鎖，每位仍在現場的人選擇「深入」或「撤退」，再按「密封決定」。送出後本批不可改選，別人只知道你已送出。</li><li><strong>同時公開：</strong>等全員完成，所有決定一起揭曉。先結算這一批撤退者的分贓與入庫，再讓留下來的人揭下一張牌。</li></ol><p>選擇撤退時，下一張牌還沒有揭開。即使接下來立刻封鎖，已撤退的人也安全。剩最後一人時仍可自由選擇深入或撤退，不會被強制送回金庫。</p><h3>贓物與餘款</h3><p>每張贓物牌按當下人數平均分配，只拿整數，餘數留在路線。例：11 點贓物由 4 人平分，每人隨身增加 2 點，剩下 3 點留在路上。隨身贓物公開，尚未安全入庫。</p><p>每批撤退者平分整條路線累積的餘款，無法整除的餘數繼續留著。例：路上共 7 點、2 人一起撤退，各多拿 3 點，留下 1 點。每人把自己全部隨身贓物加上這份餘款存入金庫。</p></Chapter>
  <Chapter id="gallery" title="3. 後台藏品與警戒圖鑑"><p>這份圖鑑是公開規則參考，包含贓物插畫、五種警戒、五件珍藏與決策道具。它不會顯示未揭牌堆或任何人尚未公開的選擇。</p><HeistRoleGallery /></Chapter>
  <Chapter id="danger" title="4. 第二道警訊，封鎖全場"><p>五種警戒起始各有 3 張。第一次出現某種警戒時沒有人失去贓物，牌留在路上提醒風險。當同一幕再次揭出相同種類，立刻封鎖：仍在現場的人失去本幕全部隨身贓物，不能再選擇撤退。</p><p>不同種類的警戒不會互相配對。你可以同時面對五種各一張的警訊，直到其中一種第二次出現才失敗。</p><p>把造成封鎖的第二張同種警戒永久移出遊戲；第一張仍保留。其他已揭開的贓物與警戒，會和未揭的牌在下一幕重新洗勻。因此某種警戒可能逐幕由 3 張減成 2 張、再減成 1 張。</p><p>當所有人自行撤退，這一幕也會結束。無論安全撤離或遭遇封鎖，路上的剩餘零錢都歸回供應，尚未取走且已經揭開的珍藏永久移除。所有人確認本幕結果後，才開始下一幕。</p></Chapter>
  <Chapter id="artifacts" title="5. 珍藏只跟獨行者離場"><p>五件珍藏的固定價值依序為 5、7、8、10、12 點。這些數值不受取得先後順序影響，也不會在持有人之間改變。</p><p>珍藏揭出時不平均分配，先留在路線上。如果某一批只有一人選擇撤退，他就能帶走路上全部尚未取走的珍藏。如果兩人或更多人一起撤退，誰都拿不到珍藏，它們仍留在原處。</p><p>珍藏不會因為場上只剩一人就自動歸他；那位玩家仍要安全選擇撤退。已拿到的珍藏公開展示，價值與件數都安全保留到終局。</p><p>已揭開但在幕末沒人帶走的珍藏永久移除；整幕都沒被翻到的珍藏則繼續留在牌堆。因此某一幕可能遇到先前尚未出現的珍藏，以及這一幕新加入的那件。</p></Chapter>
  <Chapter id="victory" title="6. 幕後清點，誰笑到最後？"><p>第五幕結束並確認結果後，所有人的金庫公開。總分等於金庫中存好的普通贓物，加上持有珍藏的固定價值。總分最高者獲勝；若同分，比較珍藏件數，多者勝。件數也相同則共享勝利。</p><p>金庫在遊戲中是私人資訊，別人的精確入庫總額不會直接顯示。隨身贓物、路線餘款、已揭牌、在場或撤退狀態與取得的珍藏則公開。先前公開的入庫事件仍可從歷史推理，規則不要求遺忘曾經看見的資訊。</p><p>私人區可以手動收起或展開，切換視窗不會改變你的選擇。收起後，金庫與尚未公開的決策也會遮住。觀戰與回放只能閱讀：盲視角不顯示金庫，上帝視角可檢視當時的金庫，但所有視角都看不到未揭牌堆，也不會提前看見這一批尚未公開的決策。</p><p>PNG 戰報只包含已公開的路線、珍藏、事件與終局分數。提示音只根據公開進度與你是否需要操作，不傳達別人的秘密選擇。</p><p>本作保留 2018 年後《Incan Gold》基本規則，使用原創劇院劫案人物、敘述與插畫。規則依據：<a href={HEIST_RULE_SOURCES.publisher} target="_blank" rel="noreferrer">出版社遊戲頁</a>與<a href={HEIST_RULE_SOURCES.rules} target="_blank" rel="noreferrer">2024 年官方基本規則</a>。</p></Chapter>
</div>; }
