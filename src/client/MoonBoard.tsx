import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MoonState } from '../games/moon/game';
import { MOON_ROLES, moonNightSteps, moonRoleDeck, isMoonWolf } from '../games/moon/rules';
import { isPlayer } from './api';
import { RoomContext } from './room-context';
import { GameSoundControl } from './GameSoundControl';
import { BattleReport } from './BattleReport';
import { Icon } from './ui';
import { serverNow } from './server-clock';
import { moonKnownFactions, stampMoonTicket } from './moon-view';
import './moon.css';

export type MoonNameOf = (id: string) => string;
type BoardProps = { G: MoonState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => any> };
export const moonOutcomeLabel = (winner: string | null | undefined) => winner === 'draw' ? '平局 · 雙方全數離場' : `${moonFactionLabel(winner)}獲勝`;
export const moonFactionLabel = (faction: string | null | undefined) => faction === 'wolves' ? '狼人陣營' : faction === 'town' ? '好人陣營' : '尚未公開';
const nightRoleNames = ['守衛', '狼人', '預言家', '女巫'];
export const moonNightLabel = (step: number) => `${nightRoleNames[step] ?? '夜間'}時段`;
function moonNightProgress(G: MoonState): string {
  const steps = moonNightSteps(Object.keys(G.players).length, G.rulesVersion, G.configuration);
  return `${steps.indexOf(G.nightStep) + 1} / ${steps.length}`;
}

export function useMoonPrivacy() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => { const update = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  return visible;
}

export function MoonBoard({ G, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const own = G.players[id], secret = G.private?.[id];
  const [pending, setPending] = useState(false), [notice, setNotice] = useState(''), [covered, setCovered] = useState(false);
  const [privateExpanded, setPrivateExpanded] = useState(true);
  const [confirmation, setConfirmation] = useState<{ move: string; args: unknown[]; text: string } | null>(null);
  const sending = useRef(false), dialog = useRef<HTMLDialogElement>(null);
  const visible = useMoonPrivacy();
  const nameOf: MoonNameOf = target => info.players.find(player => String(player.id) === target)?.name || `乘客 ${Number(target) + 1}`;
  const version = `${G.epoch}:${own?.acknowledged}:${JSON.stringify(secret)}:${G.sheriffCandidates.join(',')}`;
  useEffect(() => { sending.current = false; setPending(false); setNotice(''); }, [version, isConnected]);
  useEffect(() => { setConfirmation(null); }, [G.epoch, isConnected]);
  useEffect(() => { if (confirmation && !dialog.current?.open) dialog.current?.showModal(); else if (!confirmation && dialog.current?.open) dialog.current.close(); }, [confirmation]);
  useEffect(() => { if (!visible) { setConfirmation(null); setCovered(true); } }, [visible]);
  useEffect(() => { if (!pending) return; const timer = window.setTimeout(() => { sending.current = false; setPending(false); setNotice('尚未收到確認，請查看目前時段與連線後再試。'); }, 8000); return () => window.clearTimeout(timer); }, [pending]);
  const canAct = isConnected !== false && !!own && !pending;
  const privateVisible = visible && !covered && privateExpanded;
  function setSecretsVisible(shown: boolean) { setCovered(!shown); setPrivateExpanded(shown); }
  function send(move: string, ...args: unknown[]) {
    if (!canAct || sending.current) return;
    sending.current = true; setPending(true); setNotice(''); moves[move](...args, G.epoch);
  }
  const review = ['briefing', 'dawn', 'vote-review'].includes(G.status);
  const mayReview = G.status === 'briefing' || own?.alive;
  return <>
    <div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status"><Icon type="signal" size={15} />{isConnected === false ? '連線中斷；倒數仍由伺服器進行，重連後請確認最新時段。' : G.options.mode === 'assisted' ? '現場輔助模式 · 每人操作自己的裝置' : '線上模式 · 列車通訊已建立'}</div>
    <main className={`game-layout moon-layout ${G.status === 'night' ? 'moon-night' : ''}`}>
      <section className="game-main moon-main">
        <MoonHeading G={G}><GameSoundControl gameID="silver-moon" G={G} matchID={info.matchID} playerID={id} connected={isConnected !== false} /></MoonHeading>
        <MoonStatus G={G} nameOf={nameOf} ownID={id} />
        <MoonParticipants G={G} nameOf={nameOf} ownID={id} concealed={!privateVisible} />
        <section className="panel moon-action-panel" aria-label="乘客操作">
          {G.status === 'night' ? <>
            <div className="moon-privacy-bar"><h3>夜間操作台</h3><button className="text-button" onClick={() => setSecretsVisible(!privateVisible)}>{privateVisible ? '遮住操作' : '顯示操作'}</button></div>
            {privateVisible ? <MoonNightAction key={`${G.epoch}:${id}`} G={G} id={id} nameOf={nameOf} disabled={!canAct} send={send} confirm={(move, args, text) => setConfirmation({ move, args, text })} /> : <div className="moon-privacy-cover"><Icon type="shield" size={28} /><p>秘密操作已遮住</p><button className="button secondary" onClick={() => setSecretsVisible(true)}>只有自己能看見時，顯示操作</button></div>}
          </> : <>
            <MoonPublicPhase G={G} nameOf={nameOf} />
            {review && mayReview && <button className="button primary full" disabled={!canAct || own?.acknowledged} onClick={() => send('acknowledge')}>{own?.acknowledged ? '已確認，等待其他乘客' : G.status === 'briefing' ? '已看過身分，準備出發' : '已看過結果，繼續'}</button>}
            {(G.status === 'speaking' || G.status === 'sheriff-speech') && G.speakerID === id && <button className="button primary full" disabled={!canAct} onClick={() => send('finishSpeech')}>我的發言結束 · 交給下一位</button>}
            {G.status === 'voting' && own?.alive && !own.voteDisabled && <><h3>{G.voteRound === 2 ? '同票重投' : '放逐投票'}</h3><p>{secret?.voteSubmitted ? `已提交：${secret.ownVote ? nameOf(secret.ownVote) : '棄票'}。等待統一揭曉。` : '選擇一位乘客或棄票。提交後不可修改，全員完成或倒數結束後一起公布。'}</p><MoonTargets ids={G.voteCandidates} nameOf={nameOf} selected={secret?.voteSubmitted ? secret.ownVote : undefined} disabled={!canAct || !!secret?.voteSubmitted} onSelect={target => setConfirmation({ move: 'exileVote', args: [target], text: `確定投票放逐 ${nameOf(target)}？` })} /><button className="button secondary" disabled={!canAct || !!secret?.voteSubmitted} onClick={() => setConfirmation({ move: 'exileVote', args: [null], text: '確定本次棄票？' })}>棄票</button></>}
            {G.status === 'voting' && own?.alive && own.voteDisabled && <p className="moon-secret-note">白癡已翻牌：你仍可發言，但本局不再參與投票。</p>}
            {privateVisible && <MoonExplosionAction G={G} id={id} nameOf={nameOf} disabled={!canAct} confirm={(move, args, text) => setConfirmation({ move, args, text })} />}
            {G.status.startsWith('sheriff-') && <MoonSheriffAction key={G.epoch} G={G} id={id} nameOf={nameOf} disabled={!canAct} send={send} confirm={(move, args, text) => setConfirmation({ move, args, text })} />}
            {G.status === 'hunter' && G.hunterID === id && <><h3>{moonShooterLabel(G)}的最後一槍</h3><MoonTargets ids={Object.keys(G.players).filter(target => G.players[target].alive)} nameOf={nameOf} disabled={!canAct} onSelect={target => setConfirmation({ move: 'hunterShoot', args: [target], text: `確定帶走 ${nameOf(target)}？此操作無法撤回。` })} />{moonForcedShot(G) ? <p className="small muted">本配置必須開槍；逾時由系統隨機選擇一位合法目標。</p> : <button className="button secondary" disabled={!canAct} onClick={() => setConfirmation({ move: 'hunterShoot', args: [null], text: '確定放棄最後一槍？' })}>放棄開槍</button>}</>}
            {!own?.alive && G.status !== 'hunter' && G.status !== 'sheriff-transfer' && G.status !== 'finished' && <p className="small muted">你已離場，無需投票或確認。請不要透露身分與夜間資訊，讓仍在列車上的乘客繼續推理。</p>}
            {G.status === 'finished' && <p className="small muted">終局畫面稍作停留後返回原等待室。可從房間歷史復盤與分享。</p>}
          </>}
          {pending && <p className="small muted" role="status">正在確認操作…</p>}{notice && <p className="error-message" role="status">{notice}</p>}
        </section>
      </section>
      <aside className="moon-personal-aside"><MoonPrivatePanel G={G} playerID={id} nameOf={nameOf} concealed={!visible || covered} expanded={privateExpanded} onExpandedChange={setSecretsVisible} /></aside>
      <aside className="game-aside moon-history-aside"><MoonLog G={G} nameOf={nameOf} /><details className="panel rules-details"><summary>乘車規則速查</summary><MoonRuleSummary G={G} /></details>{G.status === 'finished' && <BattleReport G={G} info={info} perspective="blind" label="製作列車戰報" />}</aside>
    </main>
    <dialog className="confirm-dialog" ref={dialog} onCancel={() => setConfirmation(null)} onClose={() => setConfirmation(null)}><div className="eyebrow">SILVER MOON EXPRESS</div><h2>{confirmation?.text}</h2><p>請確認目前的階段與目標。</p><div className="button-row"><button className="button secondary" onClick={() => setConfirmation(null)}>再想一下</button><button className="button primary" disabled={!canAct} onClick={() => { if (confirmation) send(confirmation.move, ...confirmation.args); setConfirmation(null); }}>確認</button></div></dialog>
  </>;
}

export function MoonHeading({ G, children, subtitle = 'SILVER MOON EXPRESS' }: { G: MoonState; children?: ReactNode; subtitle?: string }) {
  return <div className="game-title moon-heading"><div><div className="eyebrow">{subtitle}</div><h1>銀月列車</h1></div><div className="moon-heading-controls">{children}<span className="round-badge">第 <strong>{G.day || 1}</strong> 天</span></div></div>;
}

export function MoonCountdown({ deadline, replay = false }: { deadline: number | null; replay?: boolean }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => { if (!deadline || replay) return; setNow(serverNow()); const timer = window.setInterval(() => setNow(serverNow()), 250); return () => window.clearInterval(timer); }, [deadline, replay]);
  if (!deadline) return null;
  if (replay) return <span className="moon-replay-clock">歷史倒數階段</span>;
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <div className={`moon-countdown ${remaining <= 10 ? 'urgent' : ''}`} aria-label={`剩餘 ${remaining} 秒`}><strong>{remaining}</strong><span>秒</span>{remaining === 0 && <small>等待同步</small>}</div>;
}

export function MoonStatus({ G, nameOf, ownID, replay = false }: { G: MoonState; nameOf: MoonNameOf; ownID?: string; replay?: boolean }) {
  const speech = G.status === 'speaking' || G.status === 'sheriff-speech';
  const ownTurn = speech && G.speakerID === ownID;
  const title = G.status === 'lobby' ? '等待乘客登車' : G.status === 'briefing' ? '查看身分 · 準備出發' : G.status === 'night' ? `車廂熄燈 · ${moonNightLabel(G.nightStep)} ${moonNightProgress(G)}` : G.status === 'dawn' ? '晨光穿過車窗 · 昨夜結果' : speech ? `${G.status === 'sheriff-speech' ? '競選 · ' : ''}${ownTurn ? '輪到你發言' : `${G.speakerID ? nameOf(G.speakerID) : '乘客'}正在發言`}` : G.status === 'voting' ? `餐車表決 · ${G.voteRound === 2 ? '同票重投' : '秘密投票'}` : G.status === 'vote-review' ? '表決已揭曉' : G.status === 'hunter' ? `${moonShooterLabel(G)} ${G.hunterID ? nameOf(G.hunterID) : ''} 的最後選擇` : G.status === 'sheriff-signup' ? '警長競選 · 報名上警' : G.status === 'sheriff-voting' ? `警長競選 · ${G.sheriffRound === 2 ? '同票重投' : '警下投票'}` : G.status === 'sheriff-order' ? `警長 ${G.sheriffID ? nameOf(G.sheriffID) : ''} 決定發言順序` : G.status === 'sheriff-transfer' ? '警長離場 · 交接警徽' : moonOutcomeLabel(G.winner);
  const detail = G.status === 'night' ? '保持安靜，按照操作台行動。不公開哪些乘客持有技能或已完成；時段由系統統一切換。' : speech ? '依順序輪流發言。本人可提前結束，時間到會自動交棒。' : G.status === 'voting' ? '有投票權的存活乘客一票，警長票算 1.5 票。已翻牌白癡不能投票；逾時視為棄票。' : G.status === 'hunter' ? moonForcedShot(G) ? '此配置必須開槍，逾時由系統隨機選擇合法目標。' : '只有目前的射手可以指定目標；時間到視為放棄開槍。' : G.status === 'sheriff-signup' ? '存活乘客可報名；倒數結束後由候選人依序發言。' : G.status === 'sheriff-voting' ? '只有非候選的存活乘客能投票。候選人不參與這輪投票。' : G.status === 'sheriff-order' ? '警長指定第一位與發言方向。逾時使用預設座位順序。' : G.status === 'sheriff-transfer' ? '離場的警長可把警徽交給存活乘客，或銷毀警徽；逾時視為銷毀。' : G.status === 'finished' ? G.winner === 'draw' ? '所有連鎖技能已結算，雙方均無存活乘客。' : G.winReason === 'wolves-eliminated' ? '全部狼人已被找出，列車得以繼續前進。' : G.configuration?.victory === 'city' ? '所有好人已離場，列車落入狼群掌握。' : G.configuration?.victory === 'edge' ? '村民或神職已全數離場，列車落入狼群掌握。' : '存活狼人人數已達其餘乘客總和，列車落入狼群掌握。' : '看清目前結果，再確認繼續。';
  const resultTitle = G.status === 'vote-review' && !G.lastVote ? '自爆與技能結算完畢' : G.status === 'sheriff-transfer' && G.sheriffTransferID && G.players[G.sheriffTransferID]?.voteDisabled ? '警長失去票權 · 交接警徽' : title;
  return <section className={`moon-status ${ownTurn ? 'moon-your-turn' : ''} ${G.status === 'night' ? 'night' : ''}`} aria-label="目前階段"><span className="moon-status-emblem" aria-hidden="true">{G.status === 'night' ? '☾' : '◈'}</span><div><strong>{resultTitle}</strong><p>{detail}</p></div><MoonCountdown deadline={G.deadline} replay={replay} /></section>;
}

export function MoonParticipants({ G, nameOf, ownID, concealed = false, omniscient = false }: { G: MoonState; nameOf: MoonNameOf; ownID?: string; concealed?: boolean; omniscient?: boolean }) {
  const known = moonKnownFactions(G, ownID, concealed, omniscient);
  return <section className="panel moon-passengers-panel"><div className="section-heading"><h2>乘客名冊</h2><span className="small muted">存活 {Object.values(G.players).filter(player => player.alive).length} / {Object.keys(G.players).length}</span></div><div className="moon-passengers">{Object.entries(G.players).map(([id, player]) => <div key={id} className={`moon-passenger ${known[id] ? `known-${known[id]}` : ''} ${player.alive ? '' : 'departed'} ${G.speakerID === id && ['speaking', 'sheriff-speech'].includes(G.status) ? 'speaking' : ''}`}><div><span className="moon-seat">{Number(id) + 1}</span><strong>{nameOf(id)}</strong>{id === ownID && <small>你</small>}</div><span className="moon-passenger-state">{!player.alive ? '已離場' : ['speaking', 'sheriff-speech'].includes(G.status) && G.speakerID === id ? '正在發言' : '在車上'}{G.sheriffID === id && <b className="moon-sheriff-tag"> · 警長</b>}{player.voteDisabled && <b> · 已失去票權</b>}{player.revealedRole && <b> · {MOON_ROLES[player.revealedRole].name}</b>}</span>{known[id] && <span className="moon-known-faction">{moonFactionLabel(known[id])}</span>}</div>)}</div></section>;
}

export function MoonTargets({ ids, nameOf, onSelect, selected, disabled }: { ids: string[]; nameOf: MoonNameOf; onSelect: (id: string) => void; selected?: string | null; disabled: boolean }) {
  return <div className="moon-targets">{ids.map(id => <button key={id} className={`moon-target ${selected === id ? 'selected' : ''}`} disabled={disabled} onClick={() => onSelect(id)}><span className="moon-seat">{Number(id) + 1}</span><span>{nameOf(id)}</span></button>)}</div>;
}

export function MoonSheriffAction({ G, id, nameOf, disabled, send, confirm }: { G: MoonState; id: string; nameOf: MoonNameOf; disabled: boolean; send: (move: string, ...args: unknown[]) => void; confirm: (move: string, args: unknown[], text: string) => void }) {
  const living = Object.keys(G.players).filter(target => G.players[target].alive);
  const [first, setFirst] = useState(living[0] ?? ''), [direction, setDirection] = useState<'clockwise' | 'counterclockwise'>('clockwise');
  const candidate = G.sheriffCandidates.includes(id), own = G.private?.[id];
  if (G.players[id]?.voteDisabled && ['sheriff-signup', 'sheriff-speech', 'sheriff-voting'].includes(G.status)) return <p className="small muted">白癡已翻牌，不能參選或投票。</p>;
  if (G.status === 'sheriff-signup' && G.players[id]?.alive) return <button className={`button ${candidate ? 'secondary' : 'primary'} full`} disabled={disabled} onClick={() => send('standForSheriff', !candidate)}>{candidate ? '退出競選 · 退水' : '報名競選警長 · 上警'}</button>;
  if (G.status === 'sheriff-speech' && candidate) return <button className="button secondary" disabled={disabled} onClick={() => confirm('standForSheriff', [false], '確定退出這次警長競選？')}>退出競選 · 退水</button>;
  if (G.status === 'sheriff-voting' && G.players[id]?.alive && !candidate) return <><p>{own?.voteSubmitted ? `已投給：${own.ownVote ? nameOf(own.ownVote) : '棄票'}` : '選出你希望帶領餐車討論的警長。'}</p><MoonTargets ids={G.sheriffCandidates} nameOf={nameOf} selected={own?.voteSubmitted ? own.ownVote : undefined} disabled={disabled || !!own?.voteSubmitted} onSelect={target => confirm('sheriffVote', [target], `選 ${nameOf(target)} 擔任警長？`)} /><button className="button secondary" disabled={disabled || !!own?.voteSubmitted} onClick={() => confirm('sheriffVote', [null], '確定在警長選舉棄票？')}>棄票</button></>;
  if (G.status === 'sheriff-voting' && candidate) return <p className="small muted">你是本輪候選人，不能投票，請等待警下乘客的選擇。</p>;
  if (G.status === 'sheriff-order' && G.sheriffID === id) return <><div className="moon-order-controls"><label>第一位發言者<select value={first} disabled={disabled} onChange={event => setFirst(event.target.value)}>{living.map(target => <option key={target} value={target}>{nameOf(target)}</option>)}</select></label><label>發言方向<select value={direction} disabled={disabled} onChange={event => setDirection(event.target.value as typeof direction)}><option value="clockwise">座號遞增</option><option value="counterclockwise">座號遞減</option></select></label></div><button className="button primary full" disabled={disabled || !first} onClick={() => send('chooseOrder', first, direction)}>確認順序，開始發言</button></>;
  if (G.status === 'sheriff-transfer' && G.sheriffTransferID === id) return <><h3>交接警徽</h3><MoonTargets ids={living.filter(target => !G.players[target].voteDisabled)} nameOf={nameOf} disabled={disabled} onSelect={target => confirm('transferBadge', [target], `將警徽交給 ${nameOf(target)}？`)} /><button className="button secondary" disabled={disabled} onClick={() => confirm('transferBadge', [null], '確定銷毀警徽？本局不再重新選舉。')}>銷毀警徽</button></>;
  return null;
}

/** Local-only distraction: no request, acknowledgement, vote, or game-state mutation. */
export function MoonCoverTask({ count = 12 }: { count?: number }) {
  const [patrol, setPatrol] = useState({ taps: 0, active: 3 % count });
  const { taps, active } = patrol;
  return <div className="moon-cover-task"><h3>巡查車票</h3><p>點中亮起的票券才算巡查一次。可以繼續巡查至倒數結束；不影響技能、投票或勝負。</p><div className="moon-targets">{Array.from({ length: count }, (_, index) => <button key={index} className={`moon-target ${index === active ? 'selected' : ''}`} aria-label={`巡查票券 ${index + 1}`} onClick={() => { const roll = Math.random(); setPatrol(value => stampMoonTicket(value, index, count, roll)); }}><span className="moon-seat">{index + 1}</span><span>{index === active ? '蓋上查驗章' : '核對票券'}</span></button>)}</div><p className="small muted" aria-live="polite">已巡查 {taps} 次 · 這些點擊只留在此畫面</p></div>;
}

export function MoonNightAction({ G, id, nameOf, disabled, send, confirm }: { G: MoonState; id: string; nameOf: MoonNameOf; disabled: boolean; send: (move: string, ...args: unknown[]) => void; confirm: (move: string, args: unknown[], text: string) => void }) {
  const own = G.private?.[id];
  const [showCover, setShowCover] = useState(!!own?.nightSubmitted);
  useEffect(() => { if (own?.nightSubmitted) setShowCover(true); }, [own?.nightSubmitted, own?.nightChoice, own?.witchChoice]);
  const alive = !!G.players[id]?.alive;
  const active = own && alive && ((G.nightStep === 0 && own.role === 'guard') || (G.nightStep === 1 && isMoonWolf(own.role)) || (G.nightStep === 2 && own.role === 'seer') || (G.nightStep === 3 && own.role === 'witch'));
  if (active && G.nightStep === 1 && G.day === 1 && G.configuration?.firstNightPeace) return <><p className="moon-secret-note">首夜無刀：可以查看狼群同伴，今晚不能襲擊。請等候完整時段。</p><MoonCoverTask count={Object.keys(G.players).length} /></>;
  if (!active) return <MoonCoverTask count={Object.keys(G.players).length} />;
  if (showCover) return <><div className="moon-privacy-bar"><p className="small moon-secret-note">行動已保存，可繼續巡查並等候下一時段。</p>{(own.role === 'guard' || isMoonWolf(own.role)) && <button className="text-button" disabled={disabled} onClick={() => setShowCover(false)}>修改選擇</button>}</div><MoonWolfChoices G={G} id={id} nameOf={nameOf} /><MoonCoverTask count={Object.keys(G.players).length} /></>;
  const aliveIDs = Object.keys(G.players).filter(target => G.players[target].alive);
  const completed = own.nightSubmitted && (own.role === 'seer' || own.role === 'witch');
  let candidates = aliveIDs;
  if (own.role === 'guard') candidates = candidates.filter(target => target !== own.previousGuard);
  if (isMoonWolf(own.role)) candidates = own.wolfTargets ?? candidates.filter(target => !own.knownWolves.includes(target) && target !== id);
  if (own.role === 'seer') candidates = candidates.filter(target => target !== id);
  const labels = { guard: '選擇今晚要守護的乘客', wolf: '與狼群選擇今晚的目標', seer: '查驗一位乘客的陣營', witch: '決定今晚是否使用藥劑' };
  const role = (isMoonWolf(own.role) ? 'wolf' : own.role) as keyof typeof labels;
  const selectMutable = (target: string | null) => {
    if (own.nightSubmitted && own.nightChoice === target) { setShowCover(true); return; }
    send(role === 'wolf' ? 'wolfVote' : 'guard', target);
  };
  return <><h3>{labels[role]}</h3><p className="small moon-secret-note">僅自己可見 · {own.nightSubmitted ? '已收到你的選擇' : '尚未選擇'}{own.nightChoice ? `：${nameOf(own.nightChoice)}` : ''}</p>
    <MoonWolfChoices G={G} id={id} nameOf={nameOf} />
    {role === 'guard' && <p className="small muted">可以守護自己，不能連續兩晚守護同一人。倒數結束前可修改選擇，送出後仍等待完整時段。</p>}
    {role === 'seer' && <p className="small muted">確認後不可修改。查驗結果只出現在你的秘密情報。</p>}
    {role !== 'witch' && !completed && <><MoonTargets ids={candidates} nameOf={nameOf} selected={own.nightChoice} disabled={disabled} onSelect={target => role === 'seer' ? confirm('inspect', [target], `查驗 ${nameOf(target)} 的陣營？`) : selectMutable(target)} /><button className="button secondary" disabled={disabled} onClick={() => role === 'seer' ? confirm('inspect', [null], '確定今晚不查驗？') : selectMutable(null)}>今晚不行動</button></>}
    {role === 'witch' && <><p className="small">解藥 {own.antidote ? '1' : '0'} 瓶 ／ 毒藥 {own.poison ? '1' : '0'} 瓶。每晚最多使用一瓶。</p>{own.antidote && <p>{own.attackedID ? `今晚被襲擊：${nameOf(own.attackedID)}` : '今晚沒有狼人襲擊目標。'}{own.attackedID === id && G.day > 1 ? '第一晚之後不能自救。' : ''}</p>}{!own.antidote && <p className="small muted">解藥已用完，不再獲知襲擊對象。</p>}{!completed && <><button className="button primary" disabled={disabled || !own.antidote || !own.attackedID || (own.attackedID === id && G.day > 1)} onClick={() => confirm('witch', ['save', own.attackedID], `使用唯一的解藥救 ${own.attackedID ? nameOf(own.attackedID) : ''}？`)}>使用解藥</button><h4>毒藥目標</h4><MoonTargets ids={aliveIDs.filter(target => target !== id)} nameOf={nameOf} disabled={disabled || !own.poison} onSelect={target => confirm('witch', ['poison', target], `使用唯一的毒藥帶走 ${nameOf(target)}？`)} /><button className="button secondary" disabled={disabled} onClick={() => confirm('witch', ['skip', null], '確定今晚不用藥？')}>保留藥劑</button></>}</>}
    {completed && <p className="small">你的行動已密封，不能修改。請等候下一時段。</p>}
    <details className="moon-extra-cover" open={completed || undefined}><summary>繼續巡查票券</summary><MoonCoverTask count={Object.keys(G.players).length} /></details>
  </>;
}

/** Only this authorized wolf record is inspected; never infer other roles. */
export function MoonWolfChoices({ G, id, nameOf, observer = false }: { G: MoonState; id: string; nameOf: MoonNameOf; observer?: boolean }) {
  const own = G.private?.[id];
  if (G.status !== 'night' || G.nightStep !== 1 || (!own || !isMoonWolf(own.role))) return null;
  const known = new Set([id, ...own.knownWolves]);
  const wolves = Object.keys(G.players).filter(wolf => G.players[wolf].alive && known.has(wolf));
  return <section className="moon-wolf-choices" aria-label="狼群目前選擇"><h4>狼群目前選擇</h4><ul aria-live="polite">{wolves.map(wolf => {
    const submitted = Object.hasOwn(own.wolfVotes, wolf), target = own.wolfVotes[wolf];
    return <li key={wolf}><span>{nameOf(wolf)}{wolf === id && <small>{observer ? '（目前查看）' : '（你）'}</small>}</span><b>{!submitted ? '尚未選擇' : target === null ? '放棄襲擊' : nameOf(target)}</b></li>;
  })}</ul><p className="small muted">全體存活狼人選擇一致後，最多再等 3 秒結算；更改而不再一致時，繼續等候原倒數。最高票相同時隨機選擇其中一個目標，全體放棄則不襲擊。</p></section>;
}

export function MoonPublicPhase({ G, nameOf }: { G: MoonState; nameOf: MoonNameOf }) {
  const review = ['briefing', 'dawn', 'vote-review'].includes(G.status);
  const latestVoteIndex = G.log.reduce((last, entry, index) => entry.type === 'vote' && entry.day === G.day ? index : last, -1);
  const flipped = latestVoteIndex >= 0 ? G.log.slice(latestVoteIndex + 1).find(entry => entry.type === 'idiot' && entry.day === G.day)?.actorID : undefined;
  const explosionIndex = G.log.reduce((last, entry, index) => entry.type === 'explosion' && entry.day === G.day ? index : last, -1);
  const explosion = explosionIndex >= 0 ? G.log[explosionIndex] : undefined;
  const waiting = review ? Object.entries(G.players).filter(([, player]) => (G.status === 'briefing' || player.alive) && !player.acknowledged).map(([id]) => nameOf(id)) : [];
  return <>
    {G.options.sheriff && <p className="small moon-sheriff-tag">警長：{G.sheriffID ? nameOf(G.sheriffID) : G.electionDone ? '目前無警徽持有人' : '尚未選出'}</p>}
    {['sheriff-signup', 'sheriff-speech', 'sheriff-voting'].includes(G.status) && <p>目前候選：{G.sheriffCandidates.map(nameOf).join('、') || '尚無人報名'}{G.sheriffRound === 2 ? '（同票重選）' : ''}</p>}
    {G.electionResult && G.status.startsWith('sheriff-') && <details className="moon-election-result"><summary>上一輪警長選舉結果</summary><div className="moon-ballots">{Object.entries(G.electionResult.votes).map(([id, target]) => <span key={id}>{nameOf(id)} → {target ? nameOf(target) : '棄票'}</span>)}</div></details>}
    {G.status === 'briefing' && <p>這班列車將穿越荒野。看完自己的身分後，請勿將秘密畫面展示給其他乘客。{G.options.mode === 'assisted' ? '現場夜間請安靜操作；每個人都有巡查任務，不需要抬頭找裁判。' : '請先確認外部通話已連上；夜間所有人保持安靜。'}</p>}
    {G.status === 'night' && <p>目前為{moonNightLabel(G.nightStep)}（{moonNightProgress(G)}）。不公開個別技能、目標或是否完成；請等候系統統一切換。</p>}
    {G.status === 'dawn' && <div className="moon-result"><h3>{G.dawnDeaths.length ? '這些乘客未能走出車廂' : '平安夜 · 所有人仍在車上'}</h3><p>{G.dawnDeaths.map(nameOf).join('、') || '列車繼續向前。'}</p><p className="small muted">{G.configuration?.revealOnDeath ? '本局出局後公開身分，死因仍不公開。' : '死因與一般離場者身分不公開。'}</p></div>}
    {(G.status === 'speaking' || G.status === 'sheriff-speech') && <p className="small">發言順序：{G.speakingOrder.filter(id => G.status !== 'sheriff-speech' || G.sheriffCandidates.includes(id)).map(id => <span className={id === G.speakerID ? 'moon-current-speaker' : ''} key={id}>{nameOf(id)}　</span>)}</p>}
    {G.status === 'vote-review' && G.lastVote && <div className="moon-result"><h3>{flipped ? `${nameOf(flipped)} 翻牌留場，失去投票權` : G.lastVote.exiledID ? G.players[G.lastVote.exiledID]?.voteDisabled && G.players[G.lastVote.exiledID]?.alive ? `${nameOf(G.lastVote.exiledID)} 翻牌留場，失去投票權` : `${nameOf(G.lastVote.exiledID)} 被放逐` : G.lastVote.tied.length > 1 && G.lastVote.round === 1 ? '最高票相同 · 將進行一次重投' : '本次無人被放逐'}</h3><div className="moon-ballots">{Object.entries(G.lastVote.votes).map(([id, target]) => <span key={id}>{nameOf(id)}{G.lastVote!.weights[id] === 3 ? '（1.5 票）' : ''} → <b>{target ? nameOf(target) : '棄票'}</b></span>)}</div></div>}
    {G.status === 'vote-review' && !G.lastVote && explosion && <div className="moon-result"><h3>{explosion.actorID ? nameOf(explosion.actorID) : '狼人'} 自爆離場</h3>{explosion.targetID && <p>同時帶走：{nameOf(explosion.targetID)}</p>}{G.log.slice(explosionIndex + 1).filter(entry => entry.type === 'hunter').map((entry, index) => <p key={index}>{moonEventText(entry, nameOf)}</p>)}<p className="small muted">連鎖技能已結算，全員確認後進入下一晚。</p></div>}
    {review && <p className="moon-waiting">{waiting.length ? `尚未確認：${waiting.join('、')}` : '全員已確認，正在繼續。'}</p>}
  </>;
}

export function MoonPrivatePanel({ G, playerID, nameOf, observer = false, concealed = false, expanded: controlledExpanded, onExpandedChange, children }: { G: MoonState; playerID: string; nameOf: MoonNameOf; observer?: boolean; concealed?: boolean; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void; children?: ReactNode }) {
  const [localExpanded, setLocalExpanded] = useState(true);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = onExpandedChange ?? setLocalExpanded;
  const visible = useMoonPrivacy();
  const secret = G.private?.[playerID], player = G.players[playerID];
  const role = secret?.role ?? player?.revealedRole, faction = secret?.faction ?? player?.revealedFaction;
  const shown = expanded && visible && !concealed;
  const deck = G.configuration?.roles ?? moonRoleDeck(Math.max(6, Math.min(12, Object.keys(G.players).length)));
  return <section className="panel moon-private-panel"><button className="moon-private-toggle" aria-expanded={shown} onClick={() => setExpanded(!shown)}><span><Icon type="shield" size={16} />{observer ? '乘客情報' : '我的秘密情報'}</span><span>{shown ? '收起 −' : '展開 ＋'}</span></button>{children}{shown ? <div className="moon-private-content"><div className={`moon-role-card ${faction ?? ''}`}>{role && <span className="moon-role-art" data-moon-role={role} aria-hidden="true" />}<span className="small muted">{observer ? `${nameOf(playerID)}的身分` : '你的身分'}</span><h2>{role ? MOON_ROLES[role].name : '尚未公開'}</h2><strong>{role ? moonFactionLabel(faction) : '盲視角不顯示秘密身分'}</strong>{role && <p>{MOON_ROLES[role].description}</p>}</div><p className="small moon-composition"><span>起始配置：</span><span>狼人 {deck.filter(isMoonWolf).length} 位</span><span>好人 {deck.filter(role => !isMoonWolf(role)).length} 位</span></p>{secret && <div className="moon-intelligence"><h3>私人情報</h3>{secret.knownWolves.length > 0 && <p>狼群同伴：{secret.knownWolves.map(nameOf).join('、')}</p>}{observer && <MoonWolfChoices G={G} id={playerID} nameOf={nameOf} observer />}{role === 'ghost-rider' && <p>反傷：{secret.reflectionUsed ? '已使用' : '尚可發動一次'}。夜間免傷持續有效。</p>}{secret.checks.map(check => <p key={`${check.day}:${check.targetID}`}>第 {check.day} 夜查驗 {nameOf(check.targetID)}：<b className={check.isWolf ? 'moon-wolf-text' : 'mint'}>{check.isWolf ? '狼人' : '不是狼人'}</b></p>)}{role === 'witch' && <p>解藥：{secret.antidote ? '尚有 1 瓶' : '已用完'}<br />毒藥：{secret.poison ? '尚有 1 瓶' : '已用完'}</p>}{secret.voteSubmitted && <p>{observer ? '此乘客' : '你'}的密票：{secret.ownVote ? nameOf(secret.ownVote) : '棄票'}</p>}{G.status === 'night' && secret.nightSubmitted && <p>今夜已選擇：{secret.witchChoice === 'save' ? '使用解藥' : secret.witchChoice === 'poison' ? '使用毒藥' : secret.nightChoice ? nameOf(secret.nightChoice) : '不行動'}</p>}{!secret.knownWolves.length && !secret.checks.length && role !== 'witch' && <p>目前沒有其他身分情報，請從公開發言與投票推理。</p>}</div>}<p className="small muted">夜間不要展示畫面。離場後仍請保守秘密，等到遊戲結束再一起復盤。</p></div> : <div className="moon-privacy-cover"><Icon type="shield" size={25} /><p>秘密情報已遮住</p></div>}</section>;
}

export function MoonLog({ G, nameOf }: { G: MoonState; nameOf: MoonNameOf }) {
  return <section className="panel moon-log"><h2>列車紀錄</h2><ol>{G.log.map((entry, index) => <li key={index}><span>第 {entry.day} 天 · {index + 1}</span><p>{moonEventText(entry, nameOf)}</p>{(entry.type === 'vote' || entry.type === 'sheriff-election') && entry.votes && <details><summary>查看公開票型</summary>{Object.entries(entry.votes).map(([id, target]) => <p key={id}>{nameOf(id)}{entry.weights?.[id] === 3 ? '（1.5 票）' : ''} → {target ? nameOf(target) : '棄票'}</p>)}</details>}</li>)}</ol>{!G.log.length && <p className="small muted">尚未出發。</p>}</section>;
}

export function moonEventText(entry: MoonState['log'][number], nameOf: MoonNameOf) {
  switch (entry.type) {
    case 'start': return '乘客登上銀月列車，秘密身分已分配。';
    case 'night': return '車廂熄燈，所有乘客進入夜間時段。';
    case 'dawn': return entry.deaths?.length ? `天亮後，${entry.deaths.map(nameOf).join('、')} 離場。` : '平安夜，所有乘客仍在車上。';
    case 'speech': return `${entry.actorID ? nameOf(entry.actorID) : '乘客'} 開始發言。`;
    case 'vote': return entry.targetID ? `${nameOf(entry.targetID)} 在公開表決中獲得最高票。` : '表決完成，暫無人被放逐。';
    case 'hunter': return entry.targetID ? `${entry.role ? MOON_ROLES[entry.role].name : '獵人'}帶走 ${nameOf(entry.targetID)}。` : `${entry.role ? MOON_ROLES[entry.role].name : '獵人'}放棄開槍。`;
    case 'explosion': return `${entry.actorID ? nameOf(entry.actorID) : '狼人'} 自爆離場${entry.targetID ? `，帶走 ${nameOf(entry.targetID)}` : ''}。`;
    case 'idiot': return `${entry.actorID ? nameOf(entry.actorID) : '白癡'} 翻牌留場，永久失去投票權。`;
    case 'sheriff-election': return entry.targetID ? `${nameOf(entry.targetID)} 當選警長。` : entry.tied?.length ? '警長選舉同票，進入重選或結束選舉。' : '警長選舉結束，無人當選。';
    case 'sheriff-transfer': return entry.targetID ? `警徽交給 ${nameOf(entry.targetID)}。` : '警徽已銷毀。';
    case 'finish': return `${moonOutcomeLabel(entry.winner)}。`;
    default: return '列車進入下一個公開階段。';
  }
}

export function moonShooterLabel(G: MoonState) {
  const role = G.hunterID ? G.players[G.hunterID]?.revealedRole : undefined;
  return role ? MOON_ROLES[role].name : '獵人';
}
export function moonForcedShot(G: MoonState) {
  return !!G.configuration?.forcedHunter && !!G.hunterID && G.players[G.hunterID]?.revealedRole === 'hunter' && Object.values(G.players).some(player => player.alive);
}

export function MoonExplosionAction({ G, id, nameOf, disabled, confirm }: { G: MoonState; id: string; nameOf: MoonNameOf; disabled: boolean; confirm: (move: string, args: unknown[], text: string) => void }) {
  const role = G.private?.[id]?.role;
  if (G.status !== 'speaking' || !G.players[id]?.alive || !G.configuration?.allowWolfExplosion || !role || !isMoonWolf(role) || role === 'ghost-rider') return null;
  return <details className="moon-explosion"><summary>我的角色技能 · 自爆</summary><p className="small muted">公開身分並離場。所有連鎖技能結算後結束白天，無法撤回。</p>{role === 'white-wolf-king' ? <><h3>白狼王 · 自爆帶走一人</h3><MoonTargets ids={Object.keys(G.players).filter(target => G.players[target].alive && target !== id)} nameOf={nameOf} disabled={disabled} onSelect={target => confirm('wolfExplode', [target], '確定自爆並帶走 ' + nameOf(target) + '？')} /></> : <button className="button secondary" disabled={disabled} onClick={() => confirm('wolfExplode', [null], '確定自爆離場？自爆不能開槍。')}>自爆離場</button>}</details>;
}

export function MoonRuleSummary({ G }: { G?: MoonState }) {
  const config = G?.configuration;
  return <div className="small"><p>{config?.name ?? '經典配置'}。好人找出全部狼人；{config?.victory === 'city' ? '屠城：狼人必須消滅全部好人。' : config?.victory === 'edge' ? '屠邊：狼人消滅全部村民或全部神職即可獲勝。' : '存活狼人人數達其餘乘客總和時，狼人獲勝。'}所有連鎖技能結算後才判定勝負。</p>{config && <p>{config.revealOnDeath ? '出局公開身分' : '一般出局不公開身分'}；{config.firstNightPeace ? '首夜不能襲擊' : '首夜正常襲擊'}；同守同救{config.doubleProtectionKills ? '死亡' : '存活'}。</p>}<p>夜間只安排開局配置的主動職業；已登場但後來離場仍保留完整時段。只有狼人一致選中同一襲擊目標並維持 3 秒，才提前切換。巡查票券不影響結果。</p><p>白天依序發言，本人可提前結束。秘密投票統一揭曉；同票重投一次，再同票無人放逐。翻牌白癡保留發言，失去票權。</p><a data-google-vignette="false" href="/rules/silver-moon" target="_blank" rel="noopener noreferrer">閱讀完整規則 →</a></div>;
}
