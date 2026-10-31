import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fogAllowedQuestCards, type FogState } from '../games/fog/game';
import { FOG_FACTIONS, FOG_ROLES, fogFactionCounts, fogTeamSizes } from '../games/fog/rules';
import { isPlayer } from './api';
import { BattleReport } from './BattleReport';
import { RoomContext } from './room-context';
import { GameSoundControl } from './GameSoundControl';
import { Icon } from './ui';
import { fogRosterMarks } from './fog-roster';
import './fog.css';

export type FogNameOf = (id: string) => string;
type BoardProps = { G: FogState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => any> };
const reviewPhases = ['briefing', 'vote-review', 'quest-review'];

/** Switching away conceals secrets until the user explicitly opens them again. */
export function useFogPrivacy(): [boolean, (value: boolean) => void] {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => { const hide = () => { if (document.hidden) setVisible(false); };
    document.addEventListener('visibilitychange', hide); return () => document.removeEventListener('visibilitychange', hide); }, []);
  return [visible, setVisible];
}

export function FogBoard({ G, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const own = G.players[id];
  const secret = G.private?.[id];
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [secretsVisible, setSecretsVisible] = useFogPrivacy();
  const sending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameOf: FogNameOf = targetID => {
    const player = info.players.find(p => String(p.id) === targetID);
    return `${player?.name || `巡夜者 ${Number(targetID) + 1}`}${player?.departed ? '（已離開）' : ''}`;
  };
  const version = `${G.epoch}:${G.status}:${G.team.join(',')}:${own?.acknowledged}:${own?.voteSubmitted}:${own?.questSubmitted}`;
  useEffect(() => { sending.current = false; setPending(false); setNotice(''); }, [version, isConnected]);
  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => { sending.current = false; setPending(false); setNotice('尚未收到操作確認，請檢查連線與最新畫面後再試。'); }, 8000);
    return () => window.clearTimeout(timeout);
  }, [pending]);
  useEffect(() => { setTarget(null); }, [G.epoch, G.status, isConnected]);
  useEffect(() => { if (!secretsVisible) setTarget(null); }, [secretsVisible]);
  useEffect(() => {
    if (target && !dialog.current?.open) dialog.current?.showModal();
    else if (!target && dialog.current?.open) dialog.current.close();
  }, [target]);
  const canAct = isConnected !== false && !!own && !pending;
  function send(move: string, ...args: unknown[]) {
    if (!canAct || sending.current) return;
    sending.current = true; setPending(true); setNotice('');
    moves[move](...args, G.epoch);
  }
  const canNominate = canAct && G.status === 'nomination' && G.leaderID === id;
  const required = fogTeamSizes(Object.keys(G.players).length)[Math.max(0, G.quest - 1)] ?? 0;
  const forceFail = G.options.lancelotMode === 'forecast' && secret?.faction === 'apostles'
    && (secret.role === 'good-lancelot' || secret.role === 'evil-lancelot');
  const allowedCards = secret ? fogAllowedQuestCards(secret, G.options) : [];
  return <>
    <div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status"><Icon type="signal" size={15} />{isConnected === false ? '連線中斷，行動已暫停。重連後請確認最新局勢。' : '巡夜連線已建立'}</div>
    <main className="game-layout fog-layout">
      <section className={`game-main fog-main ${reviewPhases.includes(G.status) ? 'fog-reviewing' : ''}`}>
        <FogHeading G={G}><GameSoundControl gameID="black-fog" G={G} matchID={info.matchID} playerID={id} connected={isConnected !== false} /></FogHeading><FogStatus G={G} nameOf={nameOf} ownID={id} />
        <FogTrack G={G} />
        <FogParticipants G={G} nameOf={nameOf} ownID={id} secretsVisible={secretsVisible} selecting={canNominate} onSelect={targetID => {
          const selected = G.team.includes(targetID);
          if (!selected && G.team.length >= required) return;
          send('selectTeam', selected ? G.team.filter(member => member !== targetID) : [...G.team, targetID]);
        }} />
        <section className={`panel fog-action-panel ${reviewPhases.includes(G.status) ? 'fog-review-panel' : ''}`} aria-label="目前行動">
          <div className="fog-action-content">
          <FogPublicPhase G={G} nameOf={nameOf} showWaiting={false} />
          {G.status === 'nomination' && G.leaderID === id && <button className="button primary full" disabled={!canAct || G.team.length !== required} onClick={() => send('confirmTeam')}>確認這 {required} 位出征，開始全員表決</button>}
          {G.status === 'voting' && <div className="fog-vote-actions">
            <button className="button secondary" disabled={!canAct || own?.voteSubmitted} onClick={() => send('vote', false)}>反對此隊伍</button>
            <button className="button primary" disabled={!canAct || own?.voteSubmitted} onClick={() => send('vote', true)}>贊成此隊伍</button>
            <p className="small muted">{own?.voteSubmitted ? '已送出密票；全員完成後一起公開。' : '每人一票，提交後不能修改；同票視為否決。'}</p>
          </div>}
          {G.status === 'quest' && G.team.includes(id) && secretsVisible && <div className="fog-vote-actions">
            <button className="button primary" disabled={!canAct || own?.questSubmitted || !allowedCards.includes('success')} onClick={() => send('submitQuest', 'success')}>守護燈塔</button>
            <button className="button danger" disabled={!canAct || own?.questSubmitted || !allowedCards.includes('fail')} onClick={() => send('submitQuest', 'fail')}>侵蝕燈塔</button>
            <p className="small muted">{own?.questSubmitted ? '行動已密封送出，等待其餘隊員。' : forceFail ? '預示模式：目前效忠黑霧使徒的雙鐘騎士必須選「侵蝕燈塔」。' : secret?.faction === 'knights' ? '你目前效忠守夜騎士，只能守護燈塔。' : '你可以守護燈塔以隱藏身分，或選擇侵蝕。'}結果只公布合計，不公開每張牌的主人。</p>
          </div>}
          {G.status === 'assassination' && secretsVisible && secret?.role === 'assassin' && <div className="fog-assassination"><h3>選出你認為的逐星神諭者</h3><div className="fog-targets">{Object.keys(G.players).filter(targetID => targetID !== id).map(targetID => <button className="button secondary" key={targetID} disabled={!canAct} onClick={() => setTarget(targetID)}>{nameOf(targetID)}</button>)}</div><p className="small muted">點選後會再確認。只有一次機會，確認即結算勝負。</p></div>}
          {!secretsVisible && ((G.status === 'quest' && G.team.includes(id)) || G.status === 'assassination') && <p className="small muted">秘密行動已遮住；請先展開秘密情報，再查看自己的操作。</p>}
          {notice && <p className="error-message" role="status">{notice}</p>}
          {pending && <p className="small muted" role="status">正在確認行動…</p>}
          {G.status === 'finished' && <p className="small muted">本局已結束，稍後返回原等待室。結果與復盤會保留。</p>}
          </div>
          {reviewPhases.includes(G.status) && <FogReviewFooter G={G} nameOf={nameOf}>
            <button className="button primary" disabled={!canAct || own?.acknowledged} onClick={() => send('acknowledge')}>
              {own?.acknowledged ? '已確認，等待其他巡夜者' : G.status === 'briefing' ? '我已看過身分，準備巡夜' : '我已看過結果，繼續'}<Icon type="check" size={17} />
            </button>
          </FogReviewFooter>}
        </section>
      </section>
      <aside className="fog-personal-aside"><FogPrivatePanel G={G} playerID={id} nameOf={nameOf} expanded={secretsVisible} onExpandedChange={setSecretsVisible} /></aside>
      <aside className="game-aside fog-history-aside"><FogLog G={G} nameOf={nameOf} /><details className="panel rules-details"><summary>巡夜規則速查</summary><FogRuleSummary /></details>{G.status === 'finished' && <BattleReport G={G} info={info} perspective="blind" label="製作巡夜戰報" />}</aside>
    </main>
    <dialog ref={dialog} className="confirm-dialog" onCancel={() => setTarget(null)} onClose={() => setTarget(null)}>
      <div className="eyebrow">FINAL ACCUSATION</div><h2>確定指認 {target ? nameOf(target) : ''}？</h2><p>若他是逐星神諭者，黑霧使徒逆轉獲勝。確認後無法撤回。</p><div className="button-row"><button className="button secondary" onClick={() => setTarget(null)}>重新考慮</button><button className="button danger" disabled={!canAct} onClick={() => { if (target) send('assassinate', target); setTarget(null); }}>確認指認</button></div>
    </dialog>
  </>;
}

export function FogHeading({ G, subtitle = 'BLACK FOG', children }: { G: FogState; subtitle?: string; children?: ReactNode }) {
  return <div className="game-title fog-heading"><div><div className="eyebrow">{subtitle}</div><h1>黑霧襲城</h1></div><div className="fog-heading-controls">{children}<span className="round-badge">城郊燈塔 <strong>{G.quest || '—'}</strong> / 5</span></div></div>;
}

export function FogStatus({ G, nameOf, ownID }: { G: FogState; nameOf: FogNameOf; ownID?: string }) {
  const leader = G.leaderID ? nameOf(G.leaderID) : '巡夜隊長';
  const ownTurn = G.status === 'nomination' && G.leaderID === ownID;
  const labels: Record<FogState['status'], [string, string]> = {
    lobby: ['等待巡夜隊集結', '由房主開始本局。'],
    briefing: ['查看身分 · 全員準備', '先閱讀右側秘密情報。每位巡夜者確認後才會開始。'],
    nomination: [ownTurn ? '輪到你組織巡夜隊！' : `由 ${leader} 組織巡夜隊`, '隊長點選下方成員，所有人會即時看到目前人選；選好後再確認。'],
    voting: ['全員密票表決', '只有送出狀態可見；全員完成後，才一起公開贊成與反對。'],
    'vote-review': [G.lastVote?.approved ? '隊伍獲准出征' : '隊伍遭到否決', '表決結果暫時保留。所有巡夜者確認後繼續。'],
    quest: ['巡夜隊已抵達城郊燈塔', '入選成員秘密行動；其他人等待燈塔回報。'],
    'quest-review': ['燈塔結果已揭曉', '先看清這次任務與詛咒之鐘；全員確認後繼續。'],
    assassination: ['三座燈塔亮起 · 深海之刃最後指認', '守夜騎士尚未獲勝。深海之刃可與同伴討論，並指認一次逐星神諭者。'],
    finished: [G.winner ? `${FOG_FACTIONS[G.winner]}獲勝` : '本局已結束', fogReason(G.winReason)],
  };
  const [title, description] = labels[G.status];
  return <section className={`fog-status ${ownTurn ? 'fog-your-turn' : ''} ${G.winner === 'apostles' ? 'fog-danger' : ''}`} role="status" aria-live="polite"><span className="fog-status-emblem" aria-hidden="true">{ownTurn ? '✦' : '♜'}</span><div><strong>{title}</strong><p>{description}</p></div></section>;
}

export function fogReason(reason: FogState['winReason']) {
  return reason ? ({ 'three-fails': '三座城郊燈塔失守，黑霧湧入城中。', 'five-rejections': '同一座燈塔連續五次組隊遭否決，黑霧使徒獲勝。', 'merlin-found': '深海之刃成功找出逐星神諭者，黑霧使徒逆轉戰局。', 'merlin-safe': '三座燈塔點亮，而且逐星神諭者躲過指認。' } as const)[reason] : '巡夜結果已記錄。';
}

export function FogTrack({ G }: { G: FogState }) {
  const sizes = fogTeamSizes(Object.keys(G.players).length);
  return <section className="panel fog-track-panel" aria-label="城郊燈塔進度"><div className="fog-track">{sizes.map((size, index) => {
    const quest = index + 1;
    const result = G.questResults.find(result => result.quest === quest);
    return <div key={quest} className={`fog-lighthouse ${result ? result.succeeded ? 'lit' : 'lost' : ''} ${G.quest === quest ? 'current' : ''}`} aria-label={`第 ${quest} 座燈塔・${result ? result.succeeded ? '已點亮' : '被侵蝕' : '未點亮'}`} aria-current={G.quest === quest ? 'step' : undefined}><span className="fog-lighthouse-art" data-lighthouse-state={result ? result.succeeded ? 'lit' : 'corrupted' : 'unlit'} aria-hidden="true" /><span>第 {quest} 座</span><strong>{result ? result.succeeded ? '點亮' : '失守' : `${size} 人`}</strong><small>{quest === 4 && Object.keys(G.players).length >= 7 ? '需 2 次侵蝕才失守' : result ? `${result.fails} 次侵蝕` : '1 次侵蝕即失守'}</small></div>;
  })}</div><div className="fog-rejections"><span>連續否決</span><strong>{G.rejections} / 5</strong><span className="small muted">第 5 次立即由黑霧使徒獲勝</span></div><FogBells G={G} /></section>;
}

function FogBells({ G }: { G: FogState }) {
  if (G.options.lancelotMode === 'off') return <p className="small muted fog-bell-line">本局未加入雙鐘騎士與詛咒之鐘。</p>;
  const forecast = G.options.lancelotMode === 'forecast';
  const cards = forecast ? G.bellForecast.map((card, index) => ({ quest: index + 1, card })) : G.bellHistory;
  return <div className="fog-bells"><span className="fog-bell-art" aria-hidden="true" /><div><strong>詛咒之鐘 · {forecast ? '預示模式' : '隨機模式'}</strong><div className="fog-bell-cards">{cards.length ? cards.map(({ quest, card }) => <span key={quest} className={card === 'switch' ? 'switch' : ''}>第 {quest} 座：{card === 'switch' ? '效忠轉換' : '保持效忠'}{forecast && quest > G.quest ? '（預示）' : ''}</span>) : <span>首座燈塔尚未揭鐘</span>}</div></div></div>;
}

export function FogParticipants({ G, nameOf, ownID, secretsVisible = true, godView = false, selecting = false, onSelect }: { G: FogState; nameOf: FogNameOf; ownID?: string; secretsVisible?: boolean; godView?: boolean; selecting?: boolean; onSelect?: (id: string) => void }) {
  const required = fogTeamSizes(Object.keys(G.players).length)[Math.max(0, G.quest - 1)] ?? 0;
  const marks = fogRosterMarks(G, ownID, secretsVisible, godView);
  return <section className="panel fog-players-panel"><div className="section-heading"><h2>巡夜隊伍</h2><span className="small muted">{G.team.length} / {required} 位入選</span></div><div className="fog-players">{Object.entries(G.players).map(([id, player]) => {
    const selected = G.team.includes(id);
    const mark = marks[id];
    const content = <><span className="fog-player-top"><span className="fog-seat">{Number(id) + 1}</span><span className="fog-player-name">{nameOf(id)}{id === ownID ? '（你）' : ''}</span></span><span className="fog-player-tags">{G.leaderID === id && <b>隊長</b>}{selected && <b className="fog-selected-label">出征</b>}{G.status === 'voting' && <span>{player.voteSubmitted ? '已密投' : '待投票'}</span>}{G.status === 'quest' && selected && <span>{player.questSubmitted ? '已行動' : '待行動'}</span>}{reviewPhases.includes(G.status) && <span>{player.acknowledged ? '已確認' : '待確認'}</span>}</span>{mark && <span className="fog-known-faction">{mark.label}</span>}{secretsVisible && G.status === 'finished' && player.revealedRole && <span className="fog-public-role">{FOG_ROLES[player.revealedRole].name}</span>}</>;
    const classes = `fog-player ${selected ? 'selected' : ''}${mark ? ` fog-known-${mark.kind}` : ''}`;
    return selecting && onSelect ? <button key={id} className={`${classes} selectable`} aria-pressed={selected} disabled={!selected && G.team.length >= required} onClick={() => onSelect(id)}>{content}</button> : <div key={id} className={classes}>{content}</div>;
  })}</div></section>;
}

export function FogReviewFooter({ G, nameOf, children }: { G: FogState; nameOf: FogNameOf; children?: ReactNode }) {
  const unready = Object.keys(G.players).filter(id => !G.players[id].acknowledged);
  return <div className="fog-review-footer"><p className="fog-unready" role="status"><strong>尚未確認：</strong>{unready.length ? unready.map(nameOf).join('、') : '全員已確認'}</p>{children}</div>;
}

export function FogPublicPhase({ G, nameOf, showWaiting = true }: { G: FogState; nameOf: FogNameOf; showWaiting?: boolean }) {
  const result = G.questResults.at(-1);
  return <>
    {G.status === 'briefing' && <p>查看秘密身分與已知情報；之後可以自由討論，請勿展示秘密畫面。</p>}
    {G.status === 'nomination' && <p><strong>{G.leaderID ? nameOf(G.leaderID) : '隊長'}</strong>正在組隊。目前人選：{G.team.length ? G.team.map(nameOf).join('、') : '尚未選擇'}。</p>}
    {G.status === 'voting' && <p className="fog-submission-count">已密投 <strong>{Object.values(G.players).filter(player => player.voteSubmitted).length} / {Object.keys(G.players).length}</strong> 位</p>}
    {G.status === 'vote-review' && G.lastVote && <div className="fog-vote-result"><h3>{G.lastVote.approved ? '表決通過' : '表決未通過'}</h3><div>{Object.entries(G.lastVote.votes).map(([id, approve]) => <span className={approve ? 'approved' : 'rejected'} key={id}>{nameOf(id)}：{approve ? '贊成' : '反對'}</span>)}</div></div>}
    {G.status === 'quest' && <p className="fog-submission-count">已密封行動 <strong>{G.team.filter(id => G.players[id]?.questSubmitted).length} / {G.team.length}</strong> 位。只揭曉匿名合計。</p>}
    {G.status === 'quest-review' && result && <div className={`fog-quest-result ${result.succeeded ? 'lit' : 'lost'}`}><h3>第 {result.quest} 座燈塔{result.succeeded ? '成功點亮' : '失守'}</h3><div><span>守護 <strong>{result.successes}</strong></span><span>侵蝕 <strong>{result.fails}</strong></span></div><p className="small muted">出征：{result.team.map(nameOf).join('、')}。行動牌的主人不會公開。</p></div>}
    {showWaiting && reviewPhases.includes(G.status) && <FogReviewFooter G={G} nameOf={nameOf} />}
    {G.status === 'assassination' && <p>所有人可討論；只有深海之刃能提交最後指認。其他玩家請等待。</p>}
    {G.status === 'finished' && <p>{G.assassinationTarget ? `最後指認：${nameOf(G.assassinationTarget)}。` : ''}{fogReason(G.winReason)}</p>}
  </>;
}

export function FogPrivatePanel({ G, playerID, nameOf, children, observer = false, expanded, onExpandedChange }: { G: FogState; playerID: string; nameOf: FogNameOf; children?: ReactNode; observer?: boolean; expanded?: boolean; onExpandedChange?: (value: boolean) => void }) {
  const [localExpanded, setLocalExpanded] = useFogPrivacy();
  const secret = G.private?.[playerID];
  const publicPlayer = G.players[playerID];
  const role = G.status === 'finished' ? publicPlayer?.revealedRole ?? secret?.role : secret?.role;
  const faction = G.status === 'finished' ? publicPlayer?.revealedFaction ?? secret?.faction : secret?.faction;
  const counts = fogFactionCounts(Object.keys(G.players).length);
  const shown = expanded ?? localExpanded;
  const subject = observer ? '此巡夜者' : '你';
  return <section className="panel fog-private-panel"><button className="fog-private-toggle" aria-expanded={shown} onClick={() => (onExpandedChange ?? setLocalExpanded)(!shown)}><span><Icon type="shield" size={16} />{observer ? '巡夜者情報' : '我的秘密情報'}</span><span>{shown ? '收起 −' : '展開 ＋'}</span></button>{children}{shown ? <div className="fog-private-content"><div className={`fog-role-card ${faction ?? 'unrevealed'}`}>
    {role && <span className="fog-role-art" data-fog-role={role} aria-hidden="true" />}
    <span className="small muted">{observer ? `${nameOf(playerID)}的身分` : '你的身分'}</span><h2>{role ? FOG_ROLES[role].name : '尚未公開'}</h2><strong>{faction ? `目前效忠：${FOG_FACTIONS[faction]}` : '盲視角不顯示秘密身分'}</strong>{role && <p>{FOG_ROLES[role].description}</p>}
  </div><div className="small fog-composition"><p>全場配置（含自己）</p><div><b className="mint">守夜騎士 {counts.knights} 位</b><b className="fog-apostles-text">黑霧使徒 {counts.apostles} 位</b></div></div>
    {secret && <div className="fog-intelligence"><h3>{subject}在開局獲得的情報</h3><p>{secret.knownEvil.length ? `${subject}看見的黑霧使徒：${secret.knownEvil.map(nameOf).join('、')}。` : '沒有其他黑霧使徒的身分情報。'}</p>{secret.merlinCandidates.length > 0 && <p>逐星神諭者候選：<strong>{secret.merlinCandidates.map(nameOf).join('、')}</strong>。{secret.merlinCandidates.length > 1 ? `${subject}無法分辨其中誰是逐星神諭者、誰是幻淵祭司。` : '本局未加入幻淵祭司，這位巡夜者就是逐星神諭者。'}</p>}<p className="small muted">詛咒之鐘改變效忠後，開局情報不會更新。</p>{typeof secret.ownVote === 'boolean' && <p>{subject}的密票：{secret.ownVote ? '贊成' : '反對'}</p>}{(secret.ownQuestCard === 'success' || secret.ownQuestCard === 'fail') && <p>{subject}已密封的行動：{secret.ownQuestCard === 'success' ? '守護燈塔' : '侵蝕燈塔'}</p>}</div>}
    {!secret && <p className="small muted">只能查看公開的隊伍、表決結果與燈塔紀錄。</p>}
  </div> : <p className="small muted fog-concealed"><Icon type="shield" size={22} />秘密情報已遮住</p>}</section>;
}

export function fogEventText(event: FogState['log'][number], nameOf: FogNameOf) {
  const actor = event.actorID ? nameOf(event.actorID) : '巡夜隊';
  switch (event.type) {
    case 'start': return '巡夜隊集結，各自取得秘密身分。';
    case 'bell': return `詛咒之鐘：${event.card === 'switch' ? '雙鐘騎士轉換效忠' : '效忠保持不變'}。`;
    case 'team': return `${actor}提名：${(event.team ?? []).map(nameOf).join('、')}。`;
    case 'vote': return `隊伍${event.approved ? '通過' : '遭否決'}（贊成 ${Object.values(event.votes ?? {}).filter(Boolean).length}／反對 ${Object.values(event.votes ?? {}).filter(v => !v).length}）。`;
    case 'quest': return `燈塔${event.succeeded ? '點亮' : '失守'}：守護 ${event.successes ?? 0}、侵蝕 ${event.fails ?? 0}。`;
    case 'assassination': return `${actor}最後指認${event.targetID ? nameOf(event.targetID) : '一位巡夜者'}。`;
    case 'finish': return event.winner ? `${FOG_FACTIONS[event.winner]}獲勝。` : '本局結束。';
  }
}

export function FogLog({ G, nameOf }: { G: FogState; nameOf: FogNameOf }) {
  return <section className="panel fog-log"><h2>巡夜紀錄</h2><ol>{G.log.map((event, index) => <li key={index}><span>燈塔 {event.quest || '—'} · {index + 1}</span><p>{fogEventText(event, nameOf)}</p>{event.type === 'vote' && event.votes && <details className="fog-vote-log"><summary>查看表決明細</summary>{Object.entries(event.votes).map(([id, approved]) => <div key={id}>{nameOf(id)}：<span className={approved ? 'mint' : 'fog-apostles-text'}>{approved ? '贊成' : '反對'}</span></div>)}</details>}</li>)}</ol>{!G.log.length && <p className="small muted">尚未開始巡夜。</p>}</section>;
}

export function FogRuleSummary() {
  return <div className="small"><p>5～10 位巡夜者，隊長輪流組隊。全員密投表決，過半贊成才出征；同票否決，同一燈塔連續五次否決由黑霧使徒獲勝。</p><p>出征者秘密選擇守護或侵蝕。守夜騎士只能守護；黑霧使徒可擇一，預示模式中效忠黑霧的雙鐘騎士必須侵蝕。</p><p>一般 1 次侵蝕就失守；7～10 人的第 4 座需 2 次。三座失守由黑霧使徒獲勝；三座點亮後，還需躲過深海之刃對逐星神諭者的最後指認。</p><p>每次表決、任務結果皆保留到全員確認。雙鐘騎士模式與角色配置由房主開局前設定。</p><a data-google-vignette="false" href="/rules/black-fog" target="_blank" rel="noopener noreferrer">閱讀完整規則 →</a></div>;
}
