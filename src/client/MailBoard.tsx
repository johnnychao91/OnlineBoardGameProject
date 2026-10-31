import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { legalMailActions, mailPlayableCards, type MailState, type MailCard } from '../games/post/game';
import { MAIL_CARDS, MAIL_MODES, mailWinningScore } from '../games/post/rules';
import { isPlayer, type RoomInfo } from './api';
import { BattleReport } from './BattleReport';
import { GameSoundControl } from './GameSoundControl';
import { MailArtwork } from './MailArtwork';
import { RoomContext } from './room-context';
import { Icon } from './ui';
import './mail.css';

export type MailNameOf = (id: string) => string;
type BoardProps = { G: MailState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => any> };
type Choice = { id: string; label: string; playerID?: string; cardID?: string };

/** The player's explicit choice persists while they switch windows. */
export function useMailPrivacy(): [boolean, (shown: boolean) => void] { return useState(true); }

export function MailBoard({ G, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const [visible, setVisible] = useMailPrivacy();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sending = useRef(false);
  const version = `${G.epoch}:${G.status}:${G.players[id]?.acknowledged}`;
  const canAct = isConnected !== false && !!G.players[id] && !busy;
  const nameOf: MailNameOf = target => {
    const player = info.players.find(entry => String(entry.id) === target);
    return `${player?.name || `信使 ${Number(target) + 1}`}${player?.departed ? '（已離開）' : ''}`;
  };
  useEffect(() => { sending.current = false; setBusy(false); setNotice(''); }, [version, isConnected]);
  useEffect(() => {
    if (!busy) return;
    const timeout = window.setTimeout(() => {
      sending.current = false; setBusy(false); setNotice('尚未收到操作確認，請檢查連線與最新牌面後再試。');
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [busy]);
  function send(move: string, ...args: unknown[]) {
    if (!canAct || sending.current) return;
    sending.current = true; setBusy(true); setNotice('');
    moves[move](...args, G.epoch);
  }
  const reviewing = G.status === 'briefing' || G.status === 'round-review';
  const acting = G.status === 'playing' && G.activePlayer === id && !G.pending;
  const pending = G.pending?.actorID === id ? G.pending : null;
  const playableIDs = mailPlayableCards(G, id).map(card => card.id);
  const canSeal = !G.pending && G.mode === 'black-letter' && legalMailActions(G, id).some(action => action.move === 'seal');
  const controls = <>
    {reviewing ? <>
      <h3>{G.status === 'briefing' ? '確認今晚的投遞任務' : '本輪投遞已結算'}</h3>
      <button className="button primary full" disabled={!canAct || G.players[id]?.acknowledged}
        onClick={() => send('acknowledge')}>
        {G.players[id]?.acknowledged ? '已確認，等待其他信使' : G.status === 'briefing' ? '我已準備好，開始投遞' : '已看過結果，開始下一輪'}<Icon type="check" size={16} />
      </button>
      <p className="small muted">{Object.values(G.players).filter(player => player.acknowledged).length} / {Object.keys(G.players).length} 位已確認</p>
    </> : G.status === 'finished' ? <p className="small muted">本局結果與復盤已保留，稍後返回原等待室。</p>
      : !visible && (acting || pending) ? <p>秘密資訊已收起。請先展開自己的信袋，再完成操作。</p>
      : pending ? <MailPending key={`${G.epoch}:${pending.kind}`} pending={pending} nameOf={nameOf} disabled={!canAct}
        onSubmit={choices => send('choose', choices)} />
      : acting ? <><h3>選一張牌打出</h3><p>點選自己信袋裡的一張牌。若有後續目標或效果，會再請你選擇。</p>
        {G.mode === 'black-letter' && G.directorID === id && <button className="button secondary full" disabled={!canAct || !canSeal}
          onClick={() => send('seal')}>宣告集齊六封印</button>}</>
      : <p>{G.players[id]?.eliminated ? '你已退出本輪。仍可觀看公開紀錄，輪末確認後重新加入下一輪。' : '等待其他信使投遞。請保管好自己的密函。'}</p>}
    {busy && <p className="small muted" role="status">正在確認操作…</p>}
    {notice && <p className="error-message" role="status">{notice}</p>}
  </>;
  return <>
    <div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status"><Icon type="signal" size={15} />{isConnected === false ? '連線中斷，投遞已暫停。重新連線後請確認最新牌面。' : '午夜郵路已接通'}</div>
    <MailLayout G={G} info={info} nameOf={nameOf} ownID={id} visible={visible} onVisible={setVisible} controls={controls}
      handDisabled={!canAct || !acting || !visible} playableIDs={playableIDs} onPlay={card => send('playCard', card.id)}
      sound={<GameSoundControl gameID="midnight-post" G={G} matchID={info.matchID} playerID={id} connected={isConnected !== false} />} />
  </>;
}

function MailPending({ pending, nameOf, disabled, onSubmit }: {
  pending: NonNullable<MailState['pending']>; nameOf: MailNameOf; disabled: boolean; onSubmit: (choices: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const minimum = pending.minimum ?? 1, maximum = pending.maximum ?? 1;
  const choices: Choice[] = pending.choices ?? [];
  function toggle(id: string) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id)
      : maximum === 1 ? [id] : current.length < maximum ? [...current, id] : current);
  }
  return <>
    <h3>{pending.title}</h3>
    <p className="mail-selection-help">{pending.ordered ? '按希望的順序點選；再點一次可取消，重新排定次序。' : minimum === maximum ? `請選擇 ${minimum} 項。` : `可選 ${minimum}～${maximum} 項。`}</p>
    <div className="mail-choice-list">{choices.map(choice => <button className="mail-choice" type="button" key={choice.id}
      aria-pressed={selected.includes(choice.id)} disabled={disabled} onClick={() => toggle(choice.id)}>
      {pending.ordered && <span className="mail-choice-index">{selected.includes(choice.id) ? selected.indexOf(choice.id) + 1 : '·'}</span>}
      <span>{choice.playerID ? nameOf(choice.playerID) : choice.label}{pending.requiredIDs?.includes(choice.id) && ' · 必選'}</span>
    </button>)}</div>
    <button className="button primary full" disabled={disabled || selected.length < minimum || selected.length > maximum || pending.requiredIDs?.some(id => !selected.includes(id))}
      onClick={() => onSubmit(selected)}>{minimum === 0 && !selected.length ? '略過這個效果' : pending.ordered ? '確認這個順序' : '確認選擇'}<Icon type="check" size={16} /></button>
  </>;
}

export function MailLayout({ G, info, nameOf, ownID, visible, onVisible, controls, handDisabled = true, playableIDs, onPlay, sound, inspector, readonly = false, replay = false }: {
  G: MailState; info: RoomInfo; nameOf: MailNameOf; ownID: string; visible: boolean; onVisible: (value: boolean) => void;
  controls?: ReactNode; handDisabled?: boolean; playableIDs?: string[]; onPlay?: (card: MailCard) => void; sound?: ReactNode; inspector?: ReactNode; readonly?: boolean; replay?: boolean;
}) {
  return <main className={`game-layout mail-layout${readonly ? ' mail-snapshot' : ''}`}>
    <section className="game-main mail-main">
      <MailHeading G={G} sound={sound} /><MailStatus G={G} ownID={readonly ? undefined : ownID} nameOf={nameOf} />
      <MailMetrics G={G} />
      <MailTable G={G} nameOf={nameOf} ownID={readonly ? undefined : ownID} />
      {(G.roundResult || G.status === 'finished') && <MailRoundResult G={G} nameOf={nameOf} />}
      {readonly && <p className="mail-readonly-note">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 不占參與人數'}。{G.private?.[ownID] ? '只查看目前視角獲准的信袋與情報。' : '隱藏的手牌及私人查驗不會顯示。'}</p>}
    </section>
    <aside className="mail-personal-aside">
      <MailPrivate G={G} id={ownID} nameOf={nameOf} visible={visible} onVisible={onVisible} readonly={readonly}
        disabled={handDisabled} playableIDs={playableIDs} onPlay={onPlay} inspector={inspector} />
      {controls && <section className="panel mail-controls" aria-label="目前操作">{controls}</section>}
    </aside>
    <aside className="game-aside mail-history-aside"><MailLog G={G} nameOf={nameOf} />
      <details className="panel rules-details"><summary>午夜郵局規則速查</summary><MailRuleSummary /></details>
      {G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective="blind" label="製作投遞戰報" />}
    </aside>
  </main>;
}

export function MailHeading({ G, sound }: { G: MailState; sound?: ReactNode }) {
  return <div className="game-title mail-heading"><div><div className="eyebrow">THE MIDNIGHT POST</div><h1>午夜郵局</h1></div>
    <div className="mail-heading-controls">{sound}<span className="round-badge">第 <strong>{G.round || '—'}</strong> 夜</span><span className="mail-mode-name">{MAIL_MODES[G.mode].name}</span></div>
  </div>;
}

export function MailStatus({ G, nameOf, ownID }: { G: MailState; nameOf: MailNameOf; ownID?: string }) {
  const actor = G.pending?.actorID ?? G.activePlayer;
  const ownTurn = G.status === 'playing' && actor === ownID;
  let title = '郵局正在準備營業', description = '等待房主安排今晚的投遞。';
  if (G.status === 'briefing') { title = '打開信袋，確認今晚的任務'; description = '每位參與者確認後開始。手牌與私人查驗請自行保密。'; }
  if (G.status === 'playing') {
    title = G.pending ? `${actor ? nameOf(actor) : '信使'} 正在處理卡牌效果` : ownTurn ? '輪到你投遞密函' : `${actor ? nameOf(actor) : '信使'} 正在投遞`;
    description = G.pending ? ownTurn ? '請在右側完成這張牌的選擇。' : '對方完成選擇後，郵路會繼續前進。'
      : ownTurn ? '從信袋挑選一張牌打出，保留另一封密函。' : '觀察公開棄牌，推理其他人留下的密函。';
  }
  if (G.status === 'round-review') { title = '本輪密函已送達'; description = '檢查公開牌面與信任郵戳，所有人確認後開始新一輪。'; }
  if (G.status === 'finished') {
    title = G.mode === 'black-letter' ? G.winner === 'director' ? '黑函封城 · 局長獲勝' : '晨光抵達 · 午夜信使獲勝'
      : `${G.winnerIDs.map(nameOf).join('、') || '信使'}贏得投遞競賽`;
    description = mailReason(G.winReason);
  }
  return <section className="mail-status" data-own-turn={ownTurn} role="status" aria-live="polite"><span className="mail-status-seal" aria-hidden="true">✉</span><div><strong>{title}</strong><p>{description}</p></div></section>;
}

export function mailReason(reason: string | null) {
  const labels: Record<string, string> = { 'delivery-champion': '信任郵戳已達獲勝門檻，今晚最受信任的信使已經誕生。',
    'director-defeated': '黑函局長的生命耗盡，信使守住了最後的郵路。', 'couriers-defeated': '午夜信使的共同生命耗盡，黑函封鎖全城。',
    'six-seals': '六枚封印聚齊，黑函局長完成封城。' };
  return reason ? labels[reason] ?? '今晚的投遞結果已記錄，可以在復盤中查看完整經過。' : '今晚的投遞結果已記錄。';
}

export function MailMetrics({ G }: { G: MailState }) {
  return <div className="mail-metrics" aria-label="郵路狀態">
    {G.mode === 'black-letter' ? <>
      <div className="mail-life mail-life-director"><span>黑函局長生命 <b>{G.directorLife} / {G.maxDirectorLife}</b></span><progress value={G.directorLife} max={G.maxDirectorLife || 1} aria-label="黑函局長剩餘生命" /></div>
      <div className="mail-life"><span>午夜信使共同生命 <b>{G.courierLife} / {G.maxCourierLife}</b></span><progress value={G.courierLife} max={G.maxCourierLife || 1} aria-label="午夜信使剩餘生命" /></div>
      <span>信使牌堆 <b>{G.deckCount}</b></span><span>局長牌堆 <b>{G.directorDeckCount}</b></span>
    </> : <><span>剩餘密函 <b>{G.deckCount}</b> 張</span><span>勝利門檻 <b>{mailWinningScore(Object.keys(G.players).length)}</b> 枚信任郵戳</span></>}
  </div>;
}

export function MailTable({ G, nameOf, ownID }: { G: MailState; nameOf: MailNameOf; ownID?: string }) {
  const reviewing = G.status === 'briefing' || G.status === 'round-review';
  return <section className="mail-desk" aria-label="公開投遞桌面"><div className="mail-desk-title"><h2>今夜的信使</h2><span>手牌保密 · 棄牌公開</span></div>
    <div className="mail-players">{Object.entries(G.players).map(([id, player]) => <article key={id}
      className={`mail-player${G.status === 'playing' && G.activePlayer === id ? ' active' : ''}${player.eliminated ? ' eliminated' : ''}`}>
      <div className="mail-player-heading"><strong>{nameOf(id)}</strong>{id === ownID && <span className="you-label">你</span>}</div>
      {G.mode === 'black-letter' ? <div className="mail-player-score"><b>{player.power}</b> 火漆力量</div> : <div className="mail-player-score"><b>{player.score}</b> 信任郵戳</div>}
      <div className="mail-public-hand" aria-label={`${nameOf(id)}的 ${player.cardCount} 張未公開手牌`}>{Array.from({ length: player.cardCount }, (_, index) => <span className="mail-mini-card" key={index} aria-hidden="true"><MailArtwork hidden /></span>)}{!player.cardCount && <span className="small muted">信袋已空</span>}</div>
      <div className="mail-player-status">{G.directorID === id && <span className="mail-director-label">黑函局長</span>}{player.protected && <span className="mail-protection">燈火護送中</span>}
        {player.eliminated && <span>本輪退出</span>}{G.status === 'playing' && G.activePlayer === id && <span>正在投遞</span>}{reviewing && <span>{player.acknowledged ? '已準備' : '尚未準備'}</span>}</div>
      <div className="mail-discard-list" aria-label={`${nameOf(id)}的公開棄牌`}>{player.discards.map(card => <span key={card.id}><b>{MAIL_CARDS[card.role].value}</b>{MAIL_CARDS[card.role].name}</span>)}</div>
    </article>)}</div>
  </section>;
}

export function MailPrivate({ G, id, nameOf, visible, onVisible, readonly = false, disabled = true, playableIDs, onPlay, inspector }: {
  G: MailState; id: string; nameOf: MailNameOf; visible: boolean; onVisible: (value: boolean) => void;
  readonly?: boolean; disabled?: boolean; playableIDs?: string[]; onPlay?: (card: MailCard) => void; inspector?: ReactNode;
}) {
  const secret = G.private?.[id];
  const cards = secret?.cards ?? [];
  return <section className="panel mail-private"><button className="mail-private-toggle" type="button" aria-expanded={visible} onClick={() => onVisible(!visible)}>
    <span><Icon type="shield" size={16} />{readonly ? '信使的信袋' : '我的秘密信袋'}</span><span>{visible ? '收起 −' : '展開 ＋'}</span>
  </button>{inspector}
    {visible ? <div className="mail-private-body"><p className="mail-private-name"><span>{nameOf(id)}</span>{G.directorID === id && <span>黑函局長</span>}</p>
      {cards.length ? <div className="mail-hand" data-count={cards.length}>{cards.map(card => <MailCardFace key={card.id} card={card}
        disabled={disabled || !onPlay || !playableIDs?.includes(card.id)} onPlay={onPlay ? () => onPlay(card) : undefined} />)}</div>
        : <div className="mail-concealed"><Icon type="shield" size={24} /><span>{secret ? '目前沒有手牌。' : '目前視角不可查看這個信袋。'}</span></div>}
      {!!secret?.intel.length && <div className="mail-intel"><h3>只有這個信袋知道的情報</h3><ul>{secret.intel.map((entry, index) => <li key={index}>{mailIntelText(entry, nameOf)}</li>)}</ul><p className="small muted">情報是查驗當時的結果；對方之後可能已換牌。</p></div>}
    </div> : <div className="mail-concealed"><Icon type="shield" size={24} /><span>信袋與私人情報已遮住</span></div>}
  </section>;
}

export function MailCardFace({ card, disabled = true, onPlay }: { card: MailCard; disabled?: boolean; onPlay?: () => void }) {
  const definition = MAIL_CARDS[card.role];
  const content = <><MailArtwork role={card.role} /><span className="mail-card-value">{definition.value}</span><span className="mail-card-copy"><strong>{definition.name}</strong><small>{definition.description}</small>{onPlay && <span>{disabled ? '等待投遞時機' : '點選打出'}</span>}</span></>;
  return onPlay ? <button type="button" className="mail-card" disabled={disabled} onClick={onPlay} aria-label={`打出 ${definition.value} ${definition.name}`}>{content}</button>
    : <div className="mail-card">{content}</div>;
}

function mailIntelText(entry: MailState['private'][string]['intel'][number], nameOf: MailNameOf): string {
  if (entry.card) return `${entry.label}：${entry.playerID ? `${nameOf(entry.playerID)}當時持有` : ''}${MAIL_CARDS[entry.card.role].name}（${MAIL_CARDS[entry.card.role].value}）。`;
  return `${entry.label}：${entry.text}`;
}

export function MailRoundResult({ G, nameOf }: { G: MailState; nameOf: MailNameOf }) {
  const winners = G.status === 'finished' ? G.winnerIDs : G.roundResult?.winnerIDs ?? [];
  return <section className="mail-result"><h2>{G.status === 'finished' ? '今夜的投遞結果' : '本輪結算'}</h2>
    <p>{G.mode === 'black-letter' ? G.status === 'finished' ? mailReason(G.winReason) : '郵路仍在繼續。'
      : winners.length ? `${winners.map(nameOf).join('、')}${G.status === 'finished' ? '贏得投遞競賽。' : '贏得本輪投遞。'}` : '本輪沒有信使送達。'}</p>
    {G.roundResult && <div className="mail-result-hands" aria-label="本輪公開留下的密函">{Object.entries(G.roundResult.hands).map(([id, cards]) => <div key={id}>
      <strong>{nameOf(id)}</strong><br />{cards.length ? cards.map(card => `${MAIL_CARDS[card.role].value} · ${MAIL_CARDS[card.role].name}`).join('、') : '本輪已退出'}
    </div>)}</div>}
  </section>;
}

export function mailEventText(event: MailState['log'][number], nameOf: MailNameOf): string {
  const actor = event.actorID ? `${nameOf(event.actorID)} · ` : '';
  const target = event.targetID ? ` ${nameOf(event.targetID)}` : '';
  const card = event.card ? ` ${MAIL_CARDS[event.card.role].name}（${MAIL_CARDS[event.card.role].value}）` : '';
  const winners = event.winnerIDs?.length ? ` ${event.winnerIDs.map(nameOf).join('、')}` : '';
  return `${actor}${event.message}${target}${card}${winners}`;
}
export function MailLog({ G, nameOf }: { G: MailState; nameOf: MailNameOf }) {
  return <section className="panel mail-log"><div className="section-heading"><h2>夜遞紀錄</h2><span>公開資訊</span></div>
    <ol>{G.log.slice().reverse().map((event, index) => <li key={G.log.length - index}><span>第 {event.round} 夜 · {G.log.length - index}</span><p>{mailEventText(event, nameOf)}</p></li>)}</ol>
    {!G.log.length && <p className="mail-empty">郵局開門後，公開投遞紀錄會留在這裡。</p>}
  </section>;
}

export function MailRuleSummary() {
  return <div className="small"><p>密函投遞（3～4 人）與全城夜遞（5～8 人）：輪流抽一張、打一張，保留密函並運用人物能力。只剩一人或牌堆用完時結算本輪，累積信任郵戳爭取勝利。</p>
    <p>黑函局長（2～6 人）：局長對抗其他信使。信使共享生命，依座位輪流投遞；雙人時信使每次連續行動兩回合。將對方生命降至零即可獲勝，局長也能蒐集六枚封印獲勝。</p>
    <p>手牌、查驗與對決情報只限獲准查看的人。黑函局長玩法只能討論公開資訊，不能暗示私下看過的牌，或指揮別人的選擇。</p><a data-google-vignette="false" href="/rules/midnight-post" target="_blank" rel="noopener noreferrer">閱讀完整規則與人物圖鑑 →</a></div>;
}
