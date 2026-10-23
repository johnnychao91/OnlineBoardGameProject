import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { isTuringSharedTable, turingCards, turingCardNumber, type TuringState, type TuringEvent } from '../games/turing/game';
import { normalizeTuringAnswer, TURING_ANSWER_MAX, TURING_DECKS, type TuringQuestion } from '../games/turing/rules';
import { isPlayer, isRoomHost, roomHostPlayerID, type RoomInfo } from './api';
import { RoomContext, RoomManagementContent } from './room-context';
import { GameSoundControl } from './GameSoundControl';
import { BattleReport } from './BattleReport';
import { Icon } from './ui';
import { TuringSharedTable, type TuringTableActions } from './TuringSharedTable';
import { TuringQuestionFeedback } from './TuringQuestionFeedback';
import { TuringOrderControl, TuringRedrawControls, TuringNextControl, TuringFinishControl, turingApprovalText, turingReadiness, useTuringHostAction } from './TuringApprovalControls';
import { TuringPolicySettings, turingPolicyLabels, turingSeatedHost } from './TuringPolicySettings';
import './turing.css';

export type TuringNameOf = (id: string) => string;
type Props = { G: TuringState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => any> };
export function useTuringPrivacy(): [boolean, (value: boolean) => void] {
  return useState(true);
}
export const turingNameOf = (info: RoomInfo): TuringNameOf => id => {
  const player = info.players.find(p => String(p.id) === id);
  return `${player?.name || `成員 ${Number(id) + 1}`}${player?.departed ? '（已離開）' : ''}`;
};

export function TuringBoard({ G, playerID, moves, isConnected }: Props) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID ?? (isPlayer(seat) ? seat.playerID : '');
  const own = G.players[id], examiner = G.examinerID === id;
  const legacy = G.rulesVersion === 1;
  const sharedTable = isTuringSharedTable(G);
  const cards = turingCards(G);
  const ownCards = Object.entries(cards).filter(([, card]) => card.playerID === id);
  const spokenKey = ownCards.map(([cardID, card]) => `${cardID}:${card.spoken}`).join('|');
  const approvalKey = (G.orderApprovals ?? []).join('|');
  const redrawKey = (G.redrawApprovals ?? []).join('|');
  const [visible, setVisible] = useTuringPrivacy();
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [policyPending, setPolicyPending] = useState(false);
  const sending = useRef(false);
  const hostAction = useTuringHostAction(seat, info.matchID, G.epoch);
  const host = isRoomHost(seat, info);
  const seatedHost = host && turingSeatedHost(info) === id;
  const canAct = isConnected !== false && !!own && !pending && !hostAction.pending && !policyPending;
  const nameOf = turingNameOf(info);
  useEffect(() => { setAnswer(''); }, [G.round, id]);
  useEffect(() => { sending.current = false; setPending(false); setNotice(''); }, [G.epoch, own?.answered, own?.acknowledged, spokenKey, approvalKey, redrawKey, isConnected]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => { sending.current = false; setPending(false); setNotice('尚未收到確認，請確認連線與最新畫面後再試。'); }, 8000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  function send(move: string, ...args: (string | number)[]) {
    if (!canAct || sending.current) return;
    sending.current = true; setPending(true); setNotice('');
    moves[move](...args, G.epoch);
  }
  const review = G.status === 'briefing' || G.status === 'round-review';
  const redrawApprovals = G.redrawApprovals ?? [];
  const redrawPolicy = G.options.redrawApproval ?? 'all', orderPolicy = G.options.orderApproval ?? 'all', nextPolicy = G.options.nextApproval ?? 'all';
  const questionFeedback = G.question && <TuringQuestionFeedback question={G.question} round={G.round} />;
  const questionControls = <TuringRedrawControls G={G} id={id} nameOf={nameOf} canAct={canAct}
    onApprove={redrawPolicy === 'host' ? seatedHost ? () => void hostAction.send('redraw') : undefined : () => send('approveRedraw')}
    onWithdraw={() => send('withdrawRedraw')} />;
  const controls = <>
    {sharedTable && G.status === 'sorting' && <TuringOrderControl G={G} id={id} canAct={canAct && Object.keys(cards).length > 0}
      onApprove={orderPolicy === 'host' ? seatedHost ? () => void hostAction.send('order') : undefined : () => send('approveOrder')}
      onWithdraw={() => send('withdrawApproval')} />}
    {review && <TuringNextControl G={G} id={id} canAct={canAct} onApprove={G.status === 'round-review' && nextPolicy === 'host' ? seatedHost ? () => void hostAction.send('next') : undefined : () => send('acknowledge')} />}
    {legacy && G.status === 'answering' && !examiner && !own?.answered && visible && <form onSubmit={event => { event.preventDefault(); const normalized = normalizeTuringAnswer(answer.replace(/[\r\n\t]+/g, ' ')); if (normalized) send('submitAnswer', normalized); else setNotice('請輸入 1～160 字的回答，不可包含隱藏控制字元。'); }}>
      <label htmlFor="turing-answer">你的回答 <small>{answer.length} / {TURING_ANSWER_MAX}</small></label>
      <textarea id="turing-answer" maxLength={TURING_ANSWER_MAX} rows={4} value={answer} disabled={!canAct || !visible} onChange={event => setAnswer(event.target.value)} placeholder="用文字呈現你的秘密強度…" autoComplete="off" />
      <p className="small muted">送出後不能修改。不要直接說數字或使用約定暗號；全員送出後一起公開。</p>
      <button className="button primary full" disabled={!canAct || !visible || !answer.trim()} type="submit">送出回答</button>
    </form>}
    {!legacy && G.status === 'answering' && !examiner && visible && <div className="turing-spoken-controls"><p className="small">在語音通話中說出回答，再確認對應的卡牌。{ownCards.length > 1 && '先說明這是 A 卡或 B 卡，讓檢測員分得清楚。'}</p>{ownCards.map(([cardID, card]) => <button key={cardID} className="button primary full" type="button" disabled={!canAct || card.spoken} onClick={() => send('confirmSpoken', cardID)}>{ownCards.length > 1 && `${card.slot} 卡 · `}{card.spoken ? '已口頭回答' : '我已口頭回答'}<Icon type="check" size={16} /></button>)}</div>}
    {G.status === 'answering' && <p className="small muted">{legacy
      ? examiner ? '你是本輪檢測員，不需回答。請等待所有受測者提交。' : own?.answered ? '回答已封存，等待全員一起公開。' : !visible ? '先展開秘密資訊，再依強度作答。' : '可以虛構情境，不需分享真實私事。'
      : examiner ? '你是本關檢測員，不需回答。請聽每張卡的口頭回答，等所有卡確認後開始排序。' : own?.answered ? '你的卡牌已全部確認。等待其他受測者完成口頭回答。' : !visible ? '先展開秘密資訊，查看強度並口頭回答。' : '本站不會錄音或保存口頭回答。不要直接說出秘密數字。'}</p>}
    {G.status === 'sorting' && <p className="small muted">{sharedTable ? `每個人都能調整桌上的卡牌。共同討論，由低到高排好後，${turingApprovalText(orderPolicy)}才揭曉。可以重述原回答，請勿直接說數字或暗號。` : examiner ? '依剛才的回答，從中央選出你認為強度最低的一張，逐張揭曉。' : `由 ${nameOf(G.examinerID)} 排序。可以重述原回答，請勿用數字或暗號補充提示。`}</p>}
    {notice && <p className="error-message" role="status">{notice}</p>}
    {hostAction.error && <p className="error-message" role="status">{hostAction.error}</p>}
    {(pending || hostAction.pending) && <p className="small muted" role="status">正在確認操作…</p>}
  </>;
  return <>
    {host && G.status !== 'finished' && <RoomManagementContent>
      {G.rulesVersion >= 4 && <TuringPolicySettings seat={seat} info={info} policies={G.options} epoch={G.epoch} disabled={isConnected === false || pending || hostAction.pending} onBusy={setPolicyPending} compact />}
      <TuringFinishControl G={G} canAct={canAct} onFinish={() => void hostAction.send('finish')} />
    </RoomManagementContent>}
    <div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status"><Icon type="signal" size={15} />{isConnected === false ? '連線中斷，操作暫停；重連後同步最新進度。' : '人性檢測連線已建立'}</div>
    <TuringLayout G={G} info={info} nameOf={nameOf} ownID={id} visible={visible} onVisible={setVisible} controls={G.status === 'finished' ? undefined : controls}
      questionFeedback={questionFeedback} questionControls={questionControls}
      sound={<GameSoundControl gameID="turing-test" G={G} matchID={info.matchID} playerID={id} connected={isConnected !== false} />}
      tableActions={sharedTable && canAct ? { place: (cardID, index) => send('placeCard', cardID, index) } : undefined}
      onReveal={examiner && canAct && !redrawApprovals.length ? target => send('revealAnswer', target) : undefined} />
  </>;
}

export function TuringLayout({ G, info, nameOf, ownID, visible, onVisible, controls, questionFeedback, questionControls, observerQuestionControls, sound, onReveal, tableActions, inspector, readonly = false, replay = false }: {
  G: TuringState; info: RoomInfo; nameOf: TuringNameOf; ownID: string; visible: boolean; onVisible: (value: boolean) => void;
  controls?: ReactNode; questionFeedback?: ReactNode; questionControls?: ReactNode; observerQuestionControls?: ReactNode; sound?: ReactNode; onReveal?: (id: string) => void; tableActions?: TuringTableActions; inspector?: ReactNode; readonly?: boolean; replay?: boolean;
}) {
  const legacy = G.rulesVersion === 1;
  const sharedTable = isTuringSharedTable(G);
  const cards = turingCards(G);
  const dualCards = G.rulesVersion === 2 && Object.keys(G.players).length <= 3;
  const cardName = (playerID: string, slot?: string) => `${nameOf(playerID)}${dualCards && slot ? ` · ${slot} 卡` : ''}`;
  const readiness = (id: string) => {
    const state = turingReadiness(G, id, roomHostPlayerID(info));
    return state && <span className={`turing-ready-badge ${state.ready ? 'is-ready' : 'is-waiting'}`}>{state.text}</span>;
  };
  return <div className={`game-layout turing-layout${readonly ? ' turing-snapshot' : ''}`}>
    <section className="game-main turing-main">
      <div className="game-title turing-heading"><div><div className="eyebrow">HUMANITY CALIBRATION</div><h1>圖靈測試</h1></div><div className="station-title-actions">{sound}<span className="round-badge">{G.targetRounds === null ? '無盡挑戰' : '測試'} <strong>{G.round || '—'}</strong>{G.targetRounds === null ? ' 關' : ` / ${G.targetRounds}`}</span>{G.targetRounds === null && <span className="turing-score-badge">已通過 {G.completedRounds ?? 0} 關</span>}</div></div>
      <TuringStatus G={G} nameOf={nameOf} />
      <section className="panel turing-question"><div className="section-heading"><span>{TURING_DECKS[G.options.deck]} · {G.question?.category ?? '等待開始'}</span><span>{legacy ? '容錯' : '生命'} <strong className={G.integrity <= 1 ? 'rules-danger' : 'mint'}>{G.integrity} / {G.maxIntegrity}</strong></span></div>
        <div className="turing-question-prompt"><h2>{G.question?.prompt ?? '準備好後，讓我們看看你有多了解人類。'}</h2>{!readonly && !replay && questionFeedback}</div>
        {!sharedTable && <TuringScale question={G.question} />}
        {!replay && (readonly ? observerQuestionControls : questionControls)}
      </section>
      {sharedTable ? <TuringSharedTable G={G} ownID={ownID} visible={visible} readonly={readonly} nameOf={nameOf} actions={tableActions} hostPlayerID={roomHostPlayerID(info)} scale={<TuringScale question={G.question} />} /> : <section className="panel turing-table"><div className="section-heading"><h2>{legacy ? '受測者回答' : '口頭回答卡'}</h2><span>檢測員：{nameOf(G.examinerID)} {readiness(G.examinerID)}</span></div>
        <div className="turing-answers">{Object.entries(cards).map(([cardID, card]) => {
          const id = card.playerID;
          const result = G.revealed.find(entry => legacy ? entry.playerID === id : entry.cardID === cardID);
          const finalNumber = G.status === 'finished' ? turingCardNumber(G, cardID) : undefined;
          const revealedIndex = G.revealed.findIndex(entry => legacy ? entry.playerID === id : entry.cardID === cardID);
          const answer = legacy ? G.answers[id] : undefined;
          return <article className={`turing-response ${result?.error ? 'turing-response-error' : ''}`} key={cardID} data-card-id={cardID}>
            <div className="turing-response-header"><strong>{cardName(id, card.slot)}{id === ownID && !readonly && <span className="you-label">你</span>}{readiness(id)}</strong>{(result || legacy) && <span>{result ? `第 ${revealedIndex + 1} 張` : card.spoken ? '已提交' : '待作答'}</span>}</div>
            <p>{legacy ? answer ?? (card.spoken ? '回答已封存，等待全員公開。' : '等待本輪回答…') : '請依語音中的回答判斷強度。'}</p>
            {result ? <div className="turing-result"><b>{result.number}</b><span>{result.error ? `順序下降 · ${legacy ? '容錯' : '生命'} −1` : revealedIndex === 0 ? '排序起點' : '順序上升'}</span></div>
              : finalNumber !== undefined ? <div className="turing-result"><b>{finalNumber}</b><span>終局公開 · 未參與排序</span></div>
              : <button className="button secondary" type="button" disabled={G.status !== 'sorting' || !onReveal} onClick={() => onReveal?.(cardID)}>{G.status === 'sorting' && onReveal ? '揭曉這張強度' : '強度未公開'}</button>}
          </article>;
        })}</div>
      </section>}
      {!sharedTable && <section className="turing-round-footer" aria-label="本輪排序與確認"><div className="turing-reveal-strip"><span>揭曉順序</span>{G.revealed.length ? G.revealed.map(entry => <span key={entry.cardID ?? entry.playerID} className={entry.error ? 'turing-drop' : ''} title={cardName(entry.playerID, entry.slot)}>{dualCards && <small>{cardName(entry.playerID, entry.slot)} · </small>}{entry.number}{entry.error && ' ↓'}</span>) : <span className="muted">尚未揭牌</span>}</div>
        {readonly && <p className="small muted">{replay ? '唯讀復盤' : '觀戰席，不占參與人數'} · {legacy ? '觀戰者不需作答或確認。' : replay ? '保留題目與揭牌順序，不含語音或逐字稿。' : '觀戰者不需作答或確認；語音需另外加入。'}</p>}
      </section>}
    </section>
    <aside className="turing-personal-aside"><TuringPrivate G={G} id={ownID} visible={visible} onVisible={onVisible} nameOf={nameOf} readonly={readonly}>{inspector}</TuringPrivate>
      {controls && <section className="panel turing-controls">{controls}</section>}
      {sharedTable && readonly && <p className="small muted turing-observer-note">{replay ? '唯讀復盤' : '觀戰席，不占參與人數'} · {replay ? '保留題目與揭牌順序，不含語音或逐字稿。' : '觀戰者不需作答或確認；語音需另外加入。'}</p>}
    </aside>
    <aside className="game-aside turing-history-aside"><TuringLog G={G} nameOf={nameOf} /><details className="panel rules-details"><summary>檢測守則</summary><TuringRuleSummary group={sharedTable} legacy={legacy} legacyDual={dualCards} direct={(G.rulesVersion ?? 1) >= 4} /></details>
      {G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective="blind" label="製作檢測戰報" />}
    </aside>
  </div>;
}

function TuringScale({ question }: { question: TuringQuestion | null }) {
  if (!question) return null;
  return <div className="turing-scale"><div><b>1</b><span>{question.low}</span></div><span className="turing-scale-line" aria-hidden="true" /><div><b>10</b><span>{question.high}</span></div></div>;
}

function TuringPrivate({ G, id, visible, onVisible, nameOf, readonly, children }: { G: TuringState; id: string; visible: boolean; onVisible: (value: boolean) => void; nameOf: TuringNameOf; readonly: boolean; children?: ReactNode }) {
  const secret = G.private?.[id];
  const legacy = G.rulesVersion === 1;
  const cards = Object.entries(turingCards(G)).filter(([, card]) => card.playerID === id);
  return <section className="panel turing-private"><button className="turing-toggle" type="button" aria-expanded={visible} onClick={() => onVisible(!visible)}><Icon type="shield" size={17} /><strong>{readonly ? '受測者情報' : '我的秘密資訊'}</strong><span>{visible ? '收起 −' : '展開 +'}</span></button>
    {children}
    {visible && <div className="turing-private-content"><p className="small muted">{nameOf(id)}</p>{id === G.examinerID ? <><span className="turing-terminal-art" aria-hidden="true" /><h2>本輪檢測員</h2><p>你不抽取強度，也不作答。觀察全部回答，再由低到高逐張揭曉。</p></>
      : <><div className={`turing-private-cards${cards.length > 1 ? ' turing-double-cards' : ''}`}>{cards.map(([cardID, card]) => <div className="turing-chip" key={cardID}>{cards.length > 1 && <span>{card.slot} 卡</span>}<strong>{turingCardNumber(G, cardID) ?? '?'}</strong>{turingCardNumber(G, cardID) === undefined && <small>目前視角不可查看</small>}</div>)}</div>
        {secret && <p>{!legacy && cards.length > 1 ? 'A、B 是兩份獨立回答，請分別對應各自強度。先說卡牌代號，再說答案；不要透露數字。' : '讓你的回答落在量表的這個位置。全隊合作，不要直接透露數字。'}</p>}
        {legacy && secret?.answer && !G.answers[id] && <div className="turing-sealed"><strong>已封存的回答</strong><p>{secret.answer}</p></div>}</>}
      <p className="small muted">機器人是故事背景；玩家都是同隊。需要遮住數字時，可手動收起秘密資訊。</p>
    </div>}
  </section>;
}

function TuringStatus({ G, nameOf }: { G: TuringState; nameOf: TuringNameOf }) {
  const legacy = G.rulesVersion === 1;
  const sharedTable = isTuringSharedTable(G);
  const endless = G.targetRounds === null;
  const labels = {
    lobby: ['檢測室準備中', '等待房主開始。'],
    briefing: ['校準開始 · 全員確認', sharedTable ? '先加入語音通話，每人查看自己的一張秘密強度牌。這一關由全員共同排序。' : legacy ? `本輪檢測員是 ${nameOf(G.examinerID)}，其餘玩家查看自己的秘密強度。` : `先加入語音通話。${nameOf(G.examinerID)} 擔任檢測員，其餘玩家查看秘密強度。`],
    answering: legacy ? ['回答封存中', '各自用文字作答。送出後不可修改，全員完成才一起公開。'] : ['語音回答中', '在外部語音中作答，再按「我已口頭回答」。題目若提到寫下，也直接說出內容；本站不錄音、不轉成文字。'],
    sorting: sharedTable ? [`群體校準 · 等待${turingApprovalText(G.options.orderApproval)}`, `把所有卡牌由左到右排好。每個人都能拖曳調整；${turingApprovalText(G.options.orderApproval)}後一次揭曉，下降會失去生命。`] : [`${nameOf(G.examinerID)} 正在排序`, `從你認為最低的強度開始。每張只和前一張比較，下降會失去一點${legacy ? '容錯' : '生命'}。`],
    'round-review': [legacy ? '本輪檢測完成' : '本關檢測完成', `先看看最後結果；${turingApprovalText(G.options.nextApproval)}後換題，生命不會回復。`],
    finished: endless ? [`無盡挑戰結束 · 已通過 ${G.completedRounds ?? 0} 關`, G.winReason === 'endless-stopped' ? '房主已結算目前成績，保留已通過關數。稍後返回原房間。' : `在第 ${G.round} 關耗盡生命，本關不算通過。稍後返回原房間。`] : G.winner === 'humans' ? ['人性校準完成 · 全隊成功', '你們用不同的答案，找到了彼此的默契。稍後返回原房間。'] : ['系統誤判 · 本次檢測失敗', `${legacy ? '容錯' : '生命'}已耗盡，保留這份紀錄，下次重新校準。稍後返回原房間。`],
  };
  const [title, description] = labels[G.status];
  return <section className="turing-status" role="status" aria-live="polite"><strong>{legacy && <span className="turing-legacy-label">舊版文字局</span>}{title}</strong><p>{description}</p></section>;
}
export function turingEventText(event: TuringEvent, nameOf: TuringNameOf, { legacy = false, dualCards = true }: { legacy?: boolean; dualCards?: boolean } = {}): string {
  const unit = legacy ? '輪' : '關', life = legacy ? '容錯' : '生命';
  if (event.type === 'round-start') return event.examinerID === '' ? `第 ${event.round} ${unit} · 群體校準 · 全員共同排序` : `第 ${event.round} ${unit} · ${event.examinerID ? nameOf(event.examinerID) : '檢測員'} 接手檢測`;
  if (event.type === 'answers') return '所有回答已公開，開始排序';
  if (event.type === 'spoken') return '全員已確認口頭回答，開始排序';
  if (event.type === 'question-redraw') return '已重抽題目，保留強度牌並重新排序';
  if (event.type === 'approval-change') return `同意方式更新：${Object.entries(event.policies ?? {}).map(([key, policy]) => `${turingPolicyLabels[key as keyof typeof turingPolicyLabels]}改為${turingApprovalText(policy)}`).join('、')}`;
  if (event.type === 'reveal') return `${nameOf(event.targetID ?? event.actorID ?? '')}${dualCards && event.slot ? ` · ${event.slot} 卡` : ''}：${event.number}${event.error ? ` · 順序下降，${life} −1` : ' · 揭曉強度'}`;
  if (event.type === 'round-complete') return `本${unit}排序完成，剩餘${life} ${event.integrity}`;
  if (event.reason === 'endless-exhausted') return `無盡挑戰結束，已通過 ${Math.max(0, event.round - 1)} 關`;
  if (event.reason === 'endless-stopped') return `房主已結算無盡挑戰，已通過 ${event.completedRounds ?? 0} 關`;
  return event.winner === 'humans' ? `五${unit}校準完成，全隊成功` : `${life}耗盡，本次檢測失敗`;
}
function TuringLog({ G, nameOf }: { G: TuringState; nameOf: TuringNameOf }) {
  const legacy = G.rulesVersion === 1, dualCards = G.rulesVersion === 2 && Object.keys(G.players).length <= 3;
  return <section className="panel event-log turing-log"><div className="section-heading"><h2>檢測紀錄</h2><span>公開資訊</span></div><ol>{G.log.slice(-40).reverse().map((event, i) => <li key={G.log.length - i}><span className={`log-dot ${event.error ? 'hazard' : 'repair'}`} /><div><p>{turingEventText(event, nameOf, { legacy, dualCards })}</p>{event.question && <p>{event.question.prompt}</p>}<small>第 {event.round} {legacy ? '輪' : '關'}</small></div></li>)}</ol></section>;
}
export function TuringRuleSummary({ legacy = false, legacyDual = false, direct = true, group = false }: { legacy?: boolean; legacyDual?: boolean; direct?: boolean; group?: boolean }) {
  return <div className="rule-summary">{legacy ? <><p>這是仍依舊規則進行的文字局：4～9 人合作五輪，受測者各有一張強度牌，回答封存至全員送出才公開。</p><p>檢測員逐張揭牌；比前一張小扣一點容錯。歸零失敗，完成五輪仍有容錯則成功。</p></> : <><p>2～10 人全員合作。請先透過語音軟體建立通話，以口頭回答傳達秘密強度。{direct ? '抽題後直接開始排牌，不需逐人確認已回答。' : '這是舊版進行局，仍需完成原有的開場與口頭回答確認。'}</p>{legacyDual ? <p>這是舊版雙卡局：檢測員不抽牌，其餘玩家各有 A、B 兩張牌；依每張卡的回答由低到高逐張揭曉。</p> : group ? <p>本局採「群體校準」：每人一張牌，任何人都能調整任何人的牌，依房規由房主、全員或任一玩家確認後一次揭曉。調整位置會取消先前的排序同意。牌面依桌面空間等比例縮放，窄螢幕會換行接續排列。</p> : <p>本局採「檢測員玩法」：輪流擔任檢測員，其餘每人一張牌，由檢測員逐張揭牌。</p>}{direct && <p>尚未揭牌時，依房規由房主、全員或任一玩家同意重抽；換題會保留強度牌、關數與生命，並重新排牌。房主模式需由入座房主確認。輪末依「檢查完畢下一題」的同意方式換關；房主可在遊戲中即時切換三項設定。</p>}<p>比前一張小扣一點生命，生命不會回復。標準模式挑戰五關；無盡模式持續到生命歸零，或由房主選擇以目前成績結束，紀錄成功通過幾關。</p><p>題目提到「寫下」也直接口頭回答。網站不錄音或轉錄語音。</p></>}<p>可以虛構，不必透露真實經歷。不得直接說出秘密數字或用約定暗號；本遊戲沒有敵對玩家。</p><a href="/rules/turing-test" target="_blank" rel="noopener noreferrer">完整規則與圖鑑 →</a></div>;
}
