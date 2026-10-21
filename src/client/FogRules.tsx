import type { ReactNode } from 'react';
import { FOG_ROLES, FOG_FACTIONS, fogFactionCounts, fogTeamSizes } from '../games/fog/rules';

export const fogChapters = [['setup', '人數與配置'], ['roles', '角色與情報'], ['flow', '組隊與燈塔'], ['bell', '詛咒之鐘'], ['end', '勝負與操作']] as const;
function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) { return <section id={id} className="rules-chapter panel"><h2>{title}</h2>{children}</section>; }

export function FogRules() {
  return <>
    <Chapter id="setup" title="1. 巡夜隊集結：人數與配置"><p>黑霧包圍城市。守夜騎士必須點亮三座城郊燈塔，並保護梅林不被識破；混入隊伍的黑霧使徒，則要讓燈塔失守或揭穿梅林。需 5～10 位參與玩家，觀戰者不計入席位。</p>
      <div className="rules-table-wrap"><table><caption>陣營人數與五座燈塔的出征人數</caption><thead><tr><th>玩家</th><th>守夜騎士／黑霧使徒</th><th>第 1～5 座</th></tr></thead><tbody>{[5, 6, 7, 8, 9, 10].map(n => { const counts = fogFactionCounts(n); return <tr key={n}><th>{n} 人</th><td>{counts.knights} ／ {counts.apostles}</td><td>{fogTeamSizes(n).join('、')}</td></tr>; })}</tbody></table></div>
      <p>開局會洗勻身分，並隨機指定首任隊長。梅林與刺客固定登場；房主可加入派西維爾、莫甘娜、莫德雷德、奧伯倫，以及成對的正、邪蘭斯洛特。特殊角色取代同陣營的一般角色，不增加總人數。莫甘娜需搭配派西維爾；超過陣營名額的設定無法開局。</p>
      <p>角色配置在等待室公開，但誰拿到哪個身分是秘密。所有人看完自己的身分與情報後，按準備才開始。</p>
    </Chapter>
    <Chapter id="roles" title="2. 身分、效忠與開局情報"><div className="rules-table-wrap"><table><thead><tr><th>角色</th><th>初始陣營</th><th>能力</th></tr></thead><tbody>{Object.entries(FOG_ROLES).map(([id, role]) => <tr key={id}><th>{role.name}</th><td>{FOG_FACTIONS[role.faction]}</td><td>{role.description}</td></tr>)}</tbody></table></div>
      <ul><li><strong>梅林：</strong>看見開局的黑霧使徒，包含奧伯倫與邪蘭斯洛特，但看不見莫德雷德。請用討論引導隊伍，同時藏好自己的線索。</li><li><strong>派西維爾：</strong>看見梅林與莫甘娜這兩位候選，但不知道誰是誰。未加入莫甘娜時，只看見梅林。</li><li><strong>黑霧使徒的互認：</strong>除奧伯倫與邪蘭斯洛特之外，黑霧使徒知道其他可互認的同伴，也能看見邪蘭斯洛特；奧伯倫不看見同伴，同伴也不看見他。</li><li><strong>正、邪蘭斯洛特：</strong>彼此不互認；邪蘭斯洛特也不知道其他黑霧使徒是誰。鐘聲只改變效忠，不改角色名稱，且不更新任何人的開局情報。</li></ul>
      <p>可以討論、質疑或謊報身分，但請勿展示秘密畫面來證明。觀戰者請自行保密；上帝視角得到的資訊不能轉告玩家。</p>
    </Chapter>
    <Chapter id="flow" title="3. 每座城郊燈塔的流程"><ol><li><strong>隊長提名：</strong>隊長可選自己，也可選其他人，必須湊足該座燈塔需要的人數。點選會即時公開目前隊伍，確認後才進入投票。</li><li><strong>全員密票：</strong>所有玩家各選贊成或反對，不限入選者。送出後不可修改；所有人完成前，只顯示誰已投票。</li><li><strong>公開表決：</strong>嚴格過半贊成才通過；同票視為否決。結果公開每人的選擇，等所有人確認。</li><li><strong>遭到否決：</strong>隊長依座位順序交給下一位，重新組同一座燈塔的隊伍。連續第 5 次遭否決，黑霧使徒立即獲勝。否決不重抽鐘牌。</li><li><strong>隊伍出征：</strong>入選者秘密提交「守護燈塔」或「侵蝕燈塔」。目前效忠守夜騎士的人只能守護；黑霧使徒通常可擇一。預示模式的黑霧蘭斯洛特必須侵蝕。</li><li><strong>揭曉結果：</strong>只公開守護與侵蝕的合計，不公開每張行動牌的主人。出征成功或失敗後，連續否決歸零，下一位接任隊長。</li></ol>
      <p><strong>一般任務只要 1 次侵蝕就失守。</strong>唯獨 7～10 人局的第 4 座燈塔，需要至少 2 次侵蝕才失守；只有 1 次仍能點亮。</p><p>燈塔結果會停留，並列出還沒確認的玩家。全體確認後，才進入下一座燈塔或最後指認；觀戰者無需確認。第五次否決與第三座失守也會先保留結果，確認後結算勝負，不再進入下一次組隊。</p>
    </Chapter>
    <Chapter id="bell" title="4. 詛咒之鐘：兩種蘭斯洛特玩法"><p>房主可以不使用蘭斯洛特，或在以下兩種模式擇一。啟用後，正蘭斯洛特初始效忠守夜騎士、邪蘭斯洛特初始效忠黑霧使徒；每次「效忠轉換」都讓兩人互換目前陣營，因此人數比例始終不變。</p>
      <h3>隨機模式</h3><p>使用 4 張「保持效忠」與 2 張「效忠轉換」，洗勻後，在<strong>第一座起、每座新燈塔開始前</strong>揭一張。未來牌序不公開，已揭鐘牌保留在紀錄。當前效忠黑霧使徒的蘭斯洛特可選守護或侵蝕；當前效忠守夜騎士則只能守護。</p>
      <h3>預示模式</h3><p>使用 5 張「保持效忠」與 2 張「效忠轉換」，洗勻抽出 5 張，開局依序公開，分別對應五座燈塔。每座開始時套用對應鐘牌。<strong>此模式中，當前效忠黑霧使徒的蘭斯洛特出征時，必須選侵蝕燈塔。</strong>當前效忠守夜騎士仍只能守護。</p>
      <p>同一座燈塔的組隊遭否決時，不再次敲鐘。轉換後請查看右側的「目前效忠」；角色名稱及開局互認情報不會跟著重寫。終局以當前效忠判定蘭斯洛特屬於哪一方。</p>
    </Chapter>
    <Chapter id="end" title="5. 最後指認與勝負"><ul><li><strong>三座燈塔失守：</strong>黑霧使徒立即獲勝。</li><li><strong>同一座燈塔連續五次組隊遭否決：</strong>黑霧使徒立即獲勝。</li><li><strong>三座燈塔成功點亮：</strong>進入刺客最後指認。所有人可以討論，只有刺客能指定一位其他玩家，並再次確認。</li><li><strong>指認到梅林：</strong>黑霧使徒逆轉獲勝；否則守夜騎士獲勝。</li></ul><p>終局公開所有角色與當前效忠。回到原等待室後，可以查看本局復盤、分享回放或製作只含公開事件的戰報圖。</p><p>進行中不能撤回已提交的投票、行動或刺客指認。重新連線會同步最新局勢；如果玩家離開造成無法繼續，可由房主提前終止本局，終止不計勝敗。</p></Chapter>
  </>;
}
