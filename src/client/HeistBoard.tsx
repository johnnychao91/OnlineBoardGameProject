import { heistRoundIncome } from '../games/heist/scoring';
export { heistRoundIncome } from '../games/heist/scoring';
import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { heistObserverView, heistPlayerView, legalHeistActions, type HeistChoice, type HeistState } from '../games/heist/game';
import { HEIST_ARTIFACTS, HEIST_ARTIFACT_IDS, HEIST_HAZARDS, HEIST_HAZARD_IDS, type HeistArtifact, type HeistCard } from '../games/heist/content';
import { isPlayer, type RoomInfo } from './api';
import { BattleReport } from './BattleReport';
import { GameSoundControl } from './GameSoundControl';
import type { SnapshotProps } from './game-types';
import { RoomContext } from './room-context';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';
import { HeistRuleSummary } from './HeistRules';
import { heistHazardLimit } from '../games/heist/rules';
import { heistArt } from './heist-art';
import './heist.css';

type NameOf = (id: string) => string;
type BoardProps = { G: HeistState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => any> };
const nameReader = (info: RoomInfo): NameOf => id => {
  const player = info.players.find(entry => String(entry.id) === id);
  return `${player?.name || `劫案成員 ${Number(id) + 1}`}${player?.departed ? '（已離開）' : ''}`;
};
const choiceName = (choice: HeistChoice) => choice === 'explore' ? '深入' : '撤退';
const artifactValue = (artifacts: HeistArtifact[]) => artifacts.reduce((sum, id) => sum + HEIST_ARTIFACTS[id].value, 0);
export function useHeistPrivacy(): [boolean, (shown: boolean) => void] { return useState(true); }

export function HeistBoard({ G: state, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const G = heistPlayerView({ G: state, playerID: id }), nameOf = nameReader(info);
  const [visible, setVisible] = useHeistPrivacy(), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const sending = useRef(false), actions = legalHeistActions(G, id), own = G.players[id];
  const version = `${G.phaseEpoch}:${G.status}:${own?.submitted}:${own?.acknowledged}`;
  const canAct = isConnected !== false && !!own && !busy;
  useEffect(() => { sending.current = false; setBusy(false); setNotice(''); }, [version, isConnected]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => { sending.current = false; setBusy(false); setNotice('尚未收到操作確認，請檢查連線與目前劫案進度後再試。'); }, 8000);
    return () => window.clearTimeout(timer);
  }, [busy]);
  function send(move: string, ...args: unknown[]) {
    if (!canAct || sending.current || !actions.some(action => action.move === move)) return;
    sending.current = true; setBusy(true); setNotice(''); moves[move](...args, G.phaseEpoch);
  }
  const controls = <>
    {G.status === 'briefing' || G.status === 'review' ? <><h3>{G.status === 'briefing' ? '確認五幕行動' : G.round === 5 ? '最後一幕已落下' : '確認本幕結果'}</h3><p>{G.status === 'briefing' ? '每次都要在下一張牌揭開前決定是否撤退。全員準備好，第一幕才會開始。' : G.round === 5 ? '全員確認後公開金庫，結算五幕總分。' : '這幕的贓物與珍藏已結算。全員確認後洗牌並加入下一件珍藏。'}</p>
      <button type="button" className="button primary full" disabled={!canAct || !actions.some(action => action.move === 'acknowledge')} onClick={() => send('acknowledge')}>{own?.acknowledged ? '已確認，等待其他成員' : G.status === 'briefing' ? '準備好了，開始劫案' : G.round === 5 ? '確認結果，公開總分' : '確認結果，準備下一幕'}</button>
      <p className="small muted">{Object.values(G.players).filter(player => player.acknowledged).length} / {G.turnOrder.length} 位已確認</p></>
      : G.status === 'finished' ? <p>五幕完整結算已保留，可製作公開戰報或進入復盤。</p>
      : !visible && own?.exploring ? <p>私人金庫與決策已收起。展開私人區後再選擇行動。</p>
      : G.status === 'decision' && own?.exploring ? own.submitted ? <div className="heist-sealed" role="status"><Art asset="card-back" alt="密封決策" /><h3>決定已密封</h3><p>{G.private[id]?.choice ? `你的選擇：${choiceName(G.private[id].choice!)}` : '等待全員完成後一起公開。'}</p><small>本批不能改選；其他人只看見你已送出。</small></div>
        : <HeistDecision key={G.phaseEpoch} G={G} id={id} disabled={!canAct} onSubmit={choice => send('decide', choice)} />
      : <p>你已安全撤退，這一幕不再參與決策。可以觀看路線，等待幕末確認後再次入場。</p>}
    {busy && <p className="small muted" role="status">正在確認操作…</p>}{notice && <p className="error-message" role="status">{notice}</p>}
  </>;
  return <><div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status">{isConnected === false ? '連線中斷，重新連線後請確認最新劫案進度。' : '劇院暗線已接通 · 同時密封，沒有行動倒數'}</div>
    <HeistLayout G={G} info={info} ownID={id} nameOf={nameOf} visible={visible} onVisible={setVisible} controls={controls}
      sound={<GameSoundControl gameID="curtain-heist" G={G} matchID={info.matchID} playerID={id} connected={isConnected !== false} />} /></>;
}

export function HeistDecision({ G, id, disabled, onSubmit }: { G: HeistState; id: string; disabled: boolean; onSubmit: (choice: HeistChoice) => void }) {
  const [choice, setChoice] = useState<HeistChoice | null>(null);
  return <><h3>這一步，你要留下嗎？</h3><p>先選擇，再密封。全員完成後一起公開；撤退會在下一張牌揭開前結算。</p>
    <div className="heist-decision-options" role="group" aria-label="秘密行動選擇">{(['explore', 'exit'] as const).map(value => <button type="button" className="heist-decision-option" key={value} aria-pressed={choice === value} disabled={disabled} onClick={() => setChoice(value)}><Art asset={`decision-${value}`} alt="" /><strong>{value === 'explore' ? '繼續深入' : '撤退入庫'}</strong><small>{value === 'explore' ? '帶著贓物，再揭一張' : '保住隨身，平分路上餘款'}</small></button>)}</div>
    <div className="heist-decision-stakes"><span>隨身贓物 <b>{G.players[id].carried}</b></span><span>路線餘款 <b>{G.leftovers}</b></span></div>
    {G.availableArtifacts.length > 0 && <p className="heist-decision-note">若這一批只有你撤退，還能帶走 {G.availableArtifacts.length} 件珍藏，共 {artifactValue(G.availableArtifacts)} 點。</p>}
    <button type="button" className="button primary full" disabled={disabled || choice === null} onClick={() => choice && onSubmit(choice)}>密封決定{choice ? ` · ${choiceName(choice)}` : ''}</button>
  </>;
}

export function HeistSnapshot({ G: state, info, perspective, replay = false }: SnapshotProps) {
  const G = heistObserverView(state as HeistState, perspective), nameOf = nameReader(info);
  const [id, setID] = useInspectedPlayer(G.turnOrder), [visible, setVisible] = useHeistPrivacy();
  return <HeistLayout G={G} info={info} ownID={id} nameOf={nameOf} visible={visible} onVisible={setVisible} readonly replay={replay} god={perspective === 'god'}
    inspector={perspective === 'god' ? <SnapshotPlayerSelect playerIDs={G.turnOrder} value={id} onChange={setID} nameOf={nameOf} label="檢視成員的私人金庫" /> : undefined} />;
}


/** Reconstruct public road change; withdrawals consume the earliest remaining coins first. */
export function heistPathRemainders(G: HeistState): number[] {
  const amounts = G.path.map(() => 0);
  let active = G.turnOrder.length;
  for (const entry of G.log.filter(entry => entry.round === G.round)) {
    if (entry.type === 'reveal' && entry.card?.kind === 'loot') amounts[entry.step - 1] = entry.card.value % active;
    if (entry.type === 'exit') {
      let taken = (entry.returns ?? []).reduce((sum, result) => sum + result.pathShare, 0);
      for (let index = 0; index < amounts.length && taken > 0; index++) {
        const used = Math.min(amounts[index], taken); amounts[index] -= used; taken -= used;
      }
      active -= entry.returns?.length ?? 0;
    }
    if (entry.type === 'round-end') amounts.fill(0);
  }
  return amounts;
}

function Art({ asset, alt, className = '' }: { asset: string; alt: string; className?: string }) {
  const src = heistArt(asset);
  return src ? <img className={className} src={src} alt={alt} loading="lazy" decoding="async" /> : null;
}
export function heistCardName(card: HeistCard) { return card.kind === 'loot' ? `${card.value} 點贓物` : card.kind === 'hazard' ? HEIST_HAZARDS[card.hazard].name : HEIST_ARTIFACTS[card.artifact].name; }
function cardAsset(card: HeistCard) { return card.kind === 'loot' ? `loot-${card.value >= 9 ? 'b' : 'a'}` : card.kind === 'hazard' ? `hazards/${card.hazard}` : `artifacts/${card.artifact}`; }
export function HeistCardFace({ card, large = false, caption }: { card: HeistCard; large?: boolean; caption?: string }) {
  return <div className={`heist-card${large ? ' heist-card-large' : ''}`} data-kind={card.kind} aria-label={heistCardName(card)}><Art asset={cardAsset(card)} alt={heistCardName(card)} /><div className="heist-card-copy"><span>{card.kind === 'loot' ? 'LOOT / 贓物' : card.kind === 'hazard' ? 'DANGER / 警戒' : 'COLLECTION / 珍藏'}</span><strong>{card.kind === 'loot' ? card.value : card.kind === 'artifact' ? HEIST_ARTIFACTS[card.artifact].value : '!'}</strong><b>{card.kind === 'loot' ? '平均分配' : heistCardName(card)}</b>{caption && <small className="heist-card-caption">{caption}</small>}</div></div>;
}

export function HeistLayout({ G, info, ownID, nameOf, visible, onVisible, controls, inspector, sound, readonly = false, replay = false, god = false }: {
  G: HeistState; info: RoomInfo; ownID: string; nameOf: NameOf; visible: boolean; onVisible: (shown: boolean) => void;
  controls?: ReactNode; inspector?: ReactNode; sound?: ReactNode; readonly?: boolean; replay?: boolean; god?: boolean;
}) {
  const routeScroll = useRef<HTMLDivElement>(null);
  const previousRow = useRef<{ round: number; top: number } | null>(null);
  useEffect(() => {
    const area = routeScroll.current;
    if (!area || replay) return;
    const last = area.querySelector<HTMLElement>('.heist-path li:last-child');
    const previous = previousRow.current;
    if (!last || previous?.round !== G.round) {
      area.scrollTop = 0;
      previousRow.current = last ? { round: G.round, top: last.offsetTop } : null;
      return;
    }
    if (last.offsetTop > previous.top) area.scrollTo({ top: area.scrollTop + last.getBoundingClientRect().bottom - area.getBoundingClientRect().bottom + 8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    previousRow.current = { round: G.round, top: last.offsetTop };
  }, [G.round, G.path.length, replay]);
  const remaining = heistPathRemainders(G), background = heistArt('background'), hazardLimit = heistHazardLimit(G.options);
  const privateInfo = G.private[ownID], final = G.status === 'finished' ? G.finalScores[ownID] : undefined;
  const banked = final?.banked ?? privateInfo?.banked, ownedArtifacts = G.players[ownID]?.artifacts ?? [];
  return <main className={`game-layout heist-layout${readonly ? ' heist-snapshot' : ''}`}>
    <section className="game-main heist-main" style={background ? { '--heist-scene': `url("${background}")` } as CSSProperties : undefined}>
      <div className="game-title heist-heading"><div><div className="eyebrow">THE CURTAIN HEIST</div><h1>謝幕劫案</h1></div><div className="heist-heading-controls">{sound}<span className="round-badge">第 <strong>{G.round || '—'}</strong> / 5 幕</span></div></div>
      <div className="heist-acts" aria-label="五幕珍藏進度">{HEIST_ARTIFACT_IDS.map((artifact, index) => <div key={artifact} data-current={G.round === index + 1} data-open={G.round >= index + 1}><Art asset={`artifacts/${artifact}`} alt="" /><span>第 {index + 1} 幕</span><strong>{HEIST_ARTIFACTS[artifact].value}</strong></div>)}</div>
      <div className="heist-stage-scroll" ref={routeScroll}>
        {G.status === 'briefing' ? <div className="heist-prologue"><Art asset="card-back" alt="尚未揭開的劫案牌" /><div><span className="eyebrow">AFTER THE LAST APPLAUSE</span><h2>觀眾離席，行動開始。</h2><p>你們將在五幕之間決定何時深入、何時撤退。帶回金庫的贓物才安全；珍藏，只留給獨自離場的人。</p><p>首幕加入：<b>藍寶石之眼 · 5 點</b></p></div></div>
          : <><div className="heist-stage-heading"><div><span className="eyebrow">THE ROUTE / 已揭路線</span><h2>第 {G.step} 段通道</h2></div><div className="heist-route-metrics"><span>路線餘款 <b>{G.leftovers}</b></span><span>未揭牌 <b>{G.deckCount}</b></span></div></div>
            {G.roundResult && <HeistRoundSummary G={G} nameOf={nameOf} />}
            {G.status === 'finished' && <div className="heist-final"><h2>五幕財富總帳</h2><div className="rules-table-wrap"><table><thead><tr><th>成員</th>{[1, 2, 3, 4, 5].map(round => <th key={round}>第 {round} 幕收益</th>)}<th>金庫</th><th>珍藏價值</th><th>件數</th><th>總分</th></tr></thead><tbody>{G.turnOrder.map(id => <tr key={id} data-winner={G.winnerIDs.includes(id)}><th>{nameOf(id)}{G.winnerIDs.includes(id) ? ' · 勝者' : ''}</th>{[1, 2, 3, 4, 5].map(round => <td key={round}>{heistRoundIncome(G, id, round)}</td>)}<td>{G.finalScores[id]?.banked ?? 0}</td><td>{G.finalScores[id]?.artifactValue ?? 0}</td><td>{G.finalScores[id]?.artifactCount ?? 0}</td><td><strong>{G.finalScores[id]?.total ?? 0}</strong></td></tr>)}</tbody></table></div></div>}
            <details className="heist-path" open><summary>完整本幕路線 · {G.path.length} 張</summary><ol>{G.path.map((card, index) => { const owner = card.kind === 'artifact' ? G.turnOrder.find(id => G.players[id].artifacts.includes(card.artifact)) : undefined; return <li key={index}><span className="heist-path-index">{String(index + 1).padStart(2, '0')}</span><HeistCardFace card={card} caption={card.kind === 'artifact' ? owner ? `${nameOf(owner)}已帶走` : G.discardedArtifacts.includes(card.artifact) ? '幕末已失落' : '等待獨行者' : card.kind === 'loot' ? `剩餘 ${remaining[index]} 點贓物` : '無贓物'} /></li>; })}</ol></details>
            {G.remainingDeck && <details className="heist-deck-summary"><summary>剩餘牌庫 · {G.deckCount} 張</summary><p>只顯示牌數，不顯示抽牌順序。</p><ul><li>贓物牌 <b>{G.remainingDeck.loot}</b> 張</li><li>珍藏牌 <b>{G.remainingDeck.artifacts}</b> 張</li>{HEIST_HAZARD_IDS.map(hazard => <li key={hazard}>{HEIST_HAZARDS[hazard].name} <b>{G.remainingDeck!.hazards[hazard]}</b> 張</li>)}</ul></details>}
          </>}
      </div>
      {G.status !== 'briefing' && <div className="heist-hazards" aria-label={`本幕已出現的警戒 · 同類第 ${hazardLimit} 張危機卡結束本幕`}>{HEIST_HAZARD_IDS.map(hazard => { const seen = G.path.filter(card => card.kind === 'hazard' && card.hazard === hazard).length; return <div key={hazard} data-seen={seen > 0} data-risk={seen >= hazardLimit ? 'critical' : seen === hazardLimit - 1 ? 'high' : seen > 0 ? 'low' : 'clear'} data-triggered={seen >= hazardLimit}><Art asset={`hazards/${hazard}`} alt="" /><strong>{HEIST_HAZARDS[hazard].name}</strong><span>{seen} / {hazardLimit}</span><small>已移除 {G.removedHazards[hazard]} 張</small></div>; })}</div>}
      {readonly && <p className="heist-readonly-note">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 唯讀'}。{god ? '可看所選成員當時的金庫；未公開的決策仍密封。' : '只顯示公開路線與成員狀態，私人金庫與密封選擇不會顯示。'}</p>}
    </section>
    <aside className="heist-personal-aside"><section className="panel heist-private"><div className="heist-private-heading"><h2>{readonly ? god ? '金庫檢視' : '觀戰筆記' : '你的幕後金庫'}</h2><button type="button" className="button secondary" aria-pressed={visible} onClick={() => onVisible(!visible)}>{visible ? '收起秘密' : '展開私人區'}</button></div>{inspector}
      {!visible ? <div className="heist-concealed"><Art asset="card-back" alt="已遮住的私人資料" /><p>金庫與密封選擇已遮住</p></div> : banked === undefined ? <p className="heist-private-note">目前視角不可查看私人金庫。舞台上的隨身贓物與珍藏是公開資訊。</p> : <><div className="heist-vault"><Art asset="bank" alt="私人金庫" /><div><span>安全入庫</span><strong data-private-bank="true">{banked}</strong><small>不會因本幕封鎖而失去</small></div></div><div className="heist-vault-total"><span>公開珍藏 <b>{artifactValue(ownedArtifacts)}</b> 點</span><span>目前合計 <b>{banked + artifactValue(ownedArtifacts)}</b> 點</span></div>{readonly && <p className="heist-private-note">金庫是當時已保存的財富，尚未公開的決策在此視角仍然隱藏。</p>}</>}
      {controls && <div className="heist-controls" aria-label="目前操作">{controls}</div>}
    </section>
      <section className="panel heist-crew-panel"><h2>玩家狀態</h2><div className="heist-crew" aria-label="公開成員狀態">{G.turnOrder.map(id => <article key={id} data-own={!readonly && ownID === id} data-exploring={G.players[id].exploring} data-winner={G.winnerIDs.includes(id)}><div><strong title={nameOf(id)}>{nameOf(id)}{!readonly && id === ownID ? ' · 你' : ''}</strong><small className="heist-crew-status" data-presence={G.status === 'decision' ? G.players[id].exploring ? 'inside' : 'exited' : undefined}>{G.status === 'decision' && <span aria-hidden="true">{G.players[id].exploring ? '◆ ' : '✓ '}</span>}{G.status === 'briefing' || G.status === 'review' ? G.players[id].acknowledged ? '✓ 已確認' : '待確認' : G.status === 'finished' ? G.winnerIDs.includes(id) ? '勝者' : '已謝幕' : G.players[id].exploring ? G.players[id].submitted ? '仍在現場 · 已密封' : '仍在現場' : '已安全撤退'}</small></div><p>{G.status === 'finished' ? <>總分 <b>{G.finalScores[id]?.total ?? 0}</b></> : <>隨身 <b>{G.players[id].carried}</b></>}<span>珍藏 {G.players[id].artifacts.length} 件</span></p>{G.players[id].artifacts.length > 0 && <div className="heist-owned-artifacts">{G.players[id].artifacts.map(artifact => <span key={artifact} title={`${HEIST_ARTIFACTS[artifact].name} · ${HEIST_ARTIFACTS[artifact].value} 點`}><Art asset={`artifacts/${artifact}`} alt={HEIST_ARTIFACTS[artifact].name} /><small>{HEIST_ARTIFACTS[artifact].value}</small></span>)}</div>}</article>)}</div></section>
    </aside>
    <aside className="game-aside heist-history-aside"><section className="panel heist-history"><h2>劫案紀錄 <small>{G.log.length}</small></h2><ol>{[...G.log].reverse().map((entry, index) => <li key={G.log.length - index}><span>第 {entry.round} 幕{entry.step ? ` · ${entry.step}` : ''}</span><p>{entry.message}</p>{entry.card && <strong>{heistCardName(entry.card)}</strong>}{entry.artifact && <strong>{HEIST_ARTIFACTS[entry.artifact].name} · {HEIST_ARTIFACTS[entry.artifact].value} 點</strong>}{entry.choices && <div className="heist-log-choices">{Object.entries(entry.choices).map(([id, choice]) => <small key={id}>{nameOf(id)} · {choiceName(choice)}</small>)}</div>}{entry.returns?.map(result => <small key={result.playerID}>{nameOf(result.playerID)}存入 {result.bankedDelta} 點{result.artifacts.length ? `，帶走 ${result.artifacts.map(id => HEIST_ARTIFACTS[id].name).join('、')}` : ''}</small>)}{entry.lost && Object.entries(entry.lost).map(([id, amount]) => <small key={id}>{nameOf(id)}失去隨身 {amount} 點</small>)}</li>)}</ol></section>
      <details className="panel rules-details"><summary>謝幕劫案規則速查</summary><HeistRuleSummary options={G.options} /></details>{G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective="blind" label="製作劫案戰報" />}
    </aside>
  </main>;
}

function HeistRoundSummary({ G, nameOf }: { G: HeistState; nameOf: NameOf }) {
  const result = G.roundResult!;
  return <section className="heist-round-result" data-disaster={result.reason === 'hazard'}><h3>{result.reason === 'hazard' ? `${result.hazard ? HEIST_HAZARDS[result.hazard].name : '警戒'}觸發封鎖` : '本幕全部安全撤離'}</h3>
    {result.escaped.length > 0 && <p>安全離場：{result.escaped.map(nameOf).join('、')}</p>}{Object.entries(result.lost).map(([id, amount]) => <p key={id}>{nameOf(id)}失去本幕隨身的 <strong>{amount}</strong> 點贓物。</p>)}
    {result.discardedArtifacts.length > 0 && <p>未帶走的珍藏已永久移除：{result.discardedArtifacts.map(id => HEIST_ARTIFACTS[id].name).join('、')}。</p>}{result.discardedLeftovers > 0 && <p>路上剩餘 {result.discardedLeftovers} 點歸回供應。</p>}
    <small>已經存入的財富與取得的珍藏都安全保留。</small></section>;
}
