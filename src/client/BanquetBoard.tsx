import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { banquetExchangeTargets, banquetObserverView, banquetPlayerView, legalBanquetActions, type BanquetState, type BanquetObservation, type BanquetPending as Pending } from '../games/banquet/game';
import { BANQUET_ROLES, type BanquetRole } from '../games/banquet/rules';
import { isPlayer, type RoomInfo } from './api';
import { BattleReport } from './BattleReport';
import { GameSoundControl } from './GameSoundControl';
import type { SnapshotProps } from './game-types';
import { RoomContext } from './room-context';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';
import { banquetArt, banquetPortrait } from './banquet-art';
import './banquet.css';

type NameOf = (id: string) => string;
type BoardProps = { G: BanquetState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => any> };
const names = (info: RoomInfo): NameOf => id => {
  const player = info.players.find(entry => String(entry.id) === id);
  return `${player?.name || `賓客 ${Number(id) + 1}`}${player?.departed ? '（已離開）' : ''}`;
};
export function useBanquetPrivacy(): [boolean, (value: boolean) => void] { return useState(true); }

export function BanquetBoard({ G: state, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const G = banquetPlayerView({ G: state, playerID: id });
  const [visible, setVisible] = useBanquetPrivacy();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const sending = useRef(false);
  const nameOf = names(info), actions = legalBanquetActions(G, id);
  const allowed = (move: string) => actions.some(action => action.move === move);
  const canAct = isConnected !== false && !!G.players[id] && !busy;
  useEffect(() => { sending.current = false; setBusy(false); setNotice(''); }, [G.epoch, G.status, isConnected]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => { sending.current = false; setBusy(false); setNotice('尚未收到操作確認，請確認連線與最新夜宴狀態後再試。'); }, 8000);
    return () => window.clearTimeout(timer);
  }, [busy]);
  function send(move: string, ...args: unknown[]) {
    if (!canAct || sending.current || !allowed(move)) return;
    sending.current = true; setBusy(true); setNotice('');
    moves[move](...args, G.epoch);
  }
  const pending = G.pending?.actorID === id ? G.pending : null;
  const controls = <>
    {G.status === 'briefing' ? <><h3>記住開場面具</h3><p>現在桌上的面具皆為公開資訊。全員確認後蓋住，接著進行四次盲換。</p>
      <button className="button primary full" disabled={!canAct || !allowed('acknowledge')} onClick={() => send('acknowledge')}>{G.players[id]?.acknowledged ? '已確認，等待其他賓客' : '記住了，準備入宴'}</button>
      <p className="small muted">{Object.values(G.players).filter(player => player.acknowledged).length} / {G.turnOrder.length} 位已確認</p></>
      : G.status === 'finished' ? <p>夜宴已結束，可查看公開紀錄與完整復盤。</p>
      : !visible && actions.length ? <p>私人記憶與操作已收起。請先展開，再完成這次選擇。</p>
      : pending ? <BanquetPending key={`${G.epoch}:${pending.kind}`} pending={pending} nameOf={nameOf} disabled={!canAct} onSubmit={selected => send('choose', selected)} />
      : allowed('respondClaim') && G.claim ? <><h3>你也認領這張面具嗎？</h3><div className="banquet-claim-role"><Mask role={G.claim.role} /><strong>{BANQUET_ROLES[G.claim.role].name}</strong></div>
        <p>{nameOf(G.claim.actorID)} 宣告自己是{BANQUET_ROLES[G.claim.role].name}。認領後若牌面不符，須繳 1 枚妖金。</p>
        <button className="button primary full" disabled={!canAct} onClick={() => send('respondClaim', true)}>我才是{BANQUET_ROLES[G.claim.role].name}</button>
        <button className="button secondary full" disabled={!canAct} onClick={() => send('respondClaim', false)}>不認領，讓夜宴繼續</button></>
      : allowed('exchange') ? <BanquetTurn key={`${G.turnNumber}:${G.epoch}`} G={G} id={id} nameOf={nameOf} disabled={!canAct} send={send} />
      : <p>等待其他賓客行動。可翻閱自己的歷史記憶與公開面具能力。</p>}
    {busy && <p className="small muted" role="status">正在確認操作…</p>}{notice && <p className="error-message" role="status">{notice}</p>}
  </>;
  return <><div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status">{isConnected === false ? '連線中斷，重新連線後請確認最新夜宴狀態。' : '夜宴已連線 · 沒有行動倒數'}</div>
    <BanquetLayout G={G} info={info} nameOf={nameOf} ownID={id} visible={visible} onVisible={setVisible} controls={controls}
      sound={<GameSoundControl gameID="hundred-ghosts" G={G} matchID={info.matchID} playerID={id} connected={isConnected !== false} />} /></>;
}

export function BanquetPending({ pending, nameOf, disabled, onSubmit }: { pending: Pending; nameOf: NameOf; disabled: boolean; onSubmit: (selected: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const minimum = pending.minimum ?? 1, maximum = pending.maximum ?? minimum;
  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : maximum === 1 ? [id] : current.length < maximum ? [...current, id] : current); }
  return <><h3>{pending.title}</h3><p className="small muted">{pending.kind === 'swap' ? '這個決定只有你知道。其他賓客看到的交換動作完全相同。' : pending.kind === 'guru-guess' ? '猜自己現在持有的面具；選擇後會公開驗證。' : `請選擇 ${minimum === maximum ? minimum : `${minimum}～${maximum}`} 項，再確認。`}</p>
    <div className="banquet-choice-list">{(pending.choices ?? []).map(choice => <button type="button" className="banquet-choice" aria-pressed={selected.includes(choice.id)} key={choice.id} disabled={disabled} onClick={() => toggle(choice.id)}>
      {choice.role && <Mask role={choice.role} small />}<span>{choice.playerID ? nameOf(choice.playerID) : choice.label}</span><span aria-hidden="true">{selected.includes(choice.id) ? '✓' : '○'}</span>
    </button>)}</div>
    <button className="button primary full" disabled={disabled || selected.length < minimum || selected.length > maximum} onClick={() => onSubmit(selected)}>確認選擇{maximum > 1 && `（${selected.length}/${maximum}）`}</button></>;
}

function BanquetTurn({ G, id, nameOf, disabled, send }: { G: BanquetState; id: string; nameOf: NameOf; disabled: boolean; send: (move: string, ...args: unknown[]) => void }) {
  const [tab, setTab] = useState<'exchange' | 'announce' | 'look'>('exchange');
  const [target, setTarget] = useState(''), [swap, setSwap] = useState<boolean | null>(null), [role, setRole] = useState<BanquetRole | ''>('');
  const actions = legalBanquetActions(G, id), has = (move: string) => actions.some(action => action.move === move);
  return <><h3>{G.initialTurnsRemaining ? '開場盲換' : '輪到你，選擇一個行動'}</h3>
    {G.initialTurnsRemaining > 0 && <p>還有 {G.initialTurnsRemaining} 次開場盲換。選一張他人或中央面具，私下決定交換或假換。</p>}
    {G.players[id].cannotAnnounce && <p className="banquet-warning">你的面具在上一回合被翻開，本回合只能查看或盲換。</p>}
    <div className="banquet-action-tabs" role="group" aria-label="本回合行動">{(['exchange', 'announce', 'look'] as const).map(action => <button type="button" key={action} disabled={disabled || !has(action)} aria-pressed={tab === action} onClick={() => setTab(action)}>{{ exchange: '盲換', announce: '宣告', look: '查看' }[action]}</button>)}</div>
    {tab === 'exchange' ? <><label className="banquet-field">選擇另一張面具<select value={target} disabled={disabled} onChange={event => setTarget(event.target.value)}><option value="">請選擇位置</option>{banquetExchangeTargets(G, id).map(key => <option key={key} value={key}>{locationName(key, G, nameOf)}</option>)}</select></label>
      <div className="banquet-action-tabs" role="group" aria-label="秘密交換決定"><button type="button" disabled={disabled} aria-pressed={swap === true} onClick={() => setSwap(true)}>真的交換</button><button type="button" disabled={disabled} aria-pressed={swap === false} onClick={() => setSwap(false)}>假裝交換</button></div>
      <p className="small muted">不會看見面具正面。無論真假，公開紀錄都只顯示一次盲換。</p><button className="button primary full" disabled={disabled || !target || swap === null} onClick={() => send('exchange', target, swap)}>完成秘密盲換</button></>
      : tab === 'look' ? <><p>花費整個回合，私下看自己的面具。結果會加入下方歷史記憶，之後仍可能被換走。</p><button className="button primary full" disabled={disabled || !has('look')} onClick={() => send('look')}>查看自己的面具，結束回合</button></>
      : <><p>可宣告本局任何一種面具。沒人認領就直接發動能力；有人認領時，所有認領者公開驗證。</p><label className="banquet-field">宣告面具<select value={role} disabled={disabled} onChange={event => setRole(event.target.value as BanquetRole)}><option value="">請選擇面具</option>{[...new Set(G.inPlayRoles)].map(value => <option key={value} value={value}>{BANQUET_ROLES[value].name}</option>)}</select></label>
        {role && <p className="banquet-ability">{BANQUET_ROLES[role].description}</p>}<button className="button primary full" disabled={disabled || !role || !has('announce')} onClick={() => send('announce', role)}>宣告{role ? `「我是${BANQUET_ROLES[role].name}」` : '面具'}</button></>}
  </>;
}

export function BanquetSnapshot({ G: state, info, perspective, replay = false }: SnapshotProps) {
  const G = banquetObserverView(state as BanquetState, perspective);
  const [id, setID] = useInspectedPlayer(G.turnOrder), [visible, setVisible] = useBanquetPrivacy();
  const nameOf = names(info);
  return <BanquetLayout G={G} info={info} nameOf={nameOf} ownID={id} visible={visible} onVisible={setVisible} readonly replay={replay} god={perspective === 'god'}
    inspector={perspective === 'god' ? <SnapshotPlayerSelect playerIDs={G.turnOrder} value={id} onChange={setID} nameOf={nameOf} label="查看賓客的歷史記憶" /> : undefined} />;
}

function Mask({ role, small = false }: { role?: BanquetRole; small?: boolean }) {
  const src = role ? banquetPortrait(role) : banquetArt('card-back');
  return <div className={`banquet-mask${small ? ' banquet-mask-small' : ''}`} data-face={role ? 'shown' : 'hidden'}>{src && <img src={src} alt={role ? `${BANQUET_ROLES[role].name}面具` : '蓋住的面具'} loading="lazy" decoding="async" />}<span className="banquet-mask-symbol" aria-hidden="true">{role ? BANQUET_ROLES[role].name.slice(0, 1) : '幽'}</span></div>;
}
function locationName(location: string, G: BanquetState, nameOf: NameOf) {
  const [type, index] = location.split(':'), number = Number(index);
  return type === 'center' ? `中央面具 ${number + 1}` : `第 ${number + 1} 席 · ${nameOf(G.turnOrder[number])}`;
}
function historicalLocation(location: string) {
  const [type, index] = location.split(':');
  return type === 'center' ? `中央面具 ${Number(index) + 1}` : `當時第 ${Number(index) + 1} 席`;
}
const sourceNames: Record<BanquetObservation['source'], string> = { initial: '開場公開', look: '自己查看', claim: '認領驗證', guru: '白澤驗證', spy: '百目鬼私看', princess: '青行燈亮牌' };

export function BanquetLayout({ G, info, nameOf, ownID, visible, onVisible, controls, sound, inspector, readonly = false, replay = false, god = false }: {
  G: BanquetState; info: RoomInfo; nameOf: NameOf; ownID: string; visible: boolean; onVisible: (value: boolean) => void;
  controls?: ReactNode; sound?: ReactNode; inspector?: ReactNode; readonly?: boolean; replay?: boolean; god?: boolean;
}) {
  const actor = G.pending?.actorID ?? (G.claim ? G.claim.responderIDs[G.claim.responseIndex] : G.activePlayer);
  const memory = readonly && !god ? G.observerMemory ?? [] : G.private[ownID]?.memory ?? [];
  const initial = (key: string) => G.initialLayout.find(entry => entry.location === key)?.role;
  const face = (id: string, index: number) => G.status === 'briefing' ? initial(`seat:${index}`) : readonly && god && visible ? G.currentMasks?.players[id] : undefined;
  let title = '面具已入席，夜宴將啟', subtitle = '記住每張公開面具的位置，所有人確認後開始。';
  if (G.status === 'playing') {
    title = actor ? `${nameOf(actor)}${G.pending ? '正在施展能力' : G.claim ? '正在回應認領' : '的回合'}` : '夜宴繼續';
    subtitle = G.pending ? '等待能力所需的選擇完成。' : G.claim ? `${nameOf(G.claim.actorID)}宣告「我是${BANQUET_ROLES[G.claim.role].name}」。依座次決定是否一同認領。` : G.initialTurnsRemaining ? `開場還有 ${G.initialTurnsRemaining} 次盲換。` : '查看、盲換，或宣告一個足以改變夜宴的名字。';
  }
  if (G.status === 'finished') { title = `${G.winnerIDs.map(nameOf).join('、')}贏得夜宴`; subtitle = G.winReason === 'cheater' ? '天邪鬼能力生效，持有至少 10 枚妖金。' : G.winReason === 'bankruptcy' ? '有賓客破產，以此刻最多妖金決定勝者。' : '妖金達到 13 枚，勝者已定。'; }
  const background = banquetArt('background');
  return <main className={`game-layout banquet-layout${readonly ? ' banquet-snapshot' : ''}`} data-density={G.turnOrder.length >= 9 ? 'crowded' : 'standard'}>
    <section className="game-main banquet-main" style={background ? { '--banquet-background': `url("${background}")` } as React.CSSProperties : undefined}>
      <div className="game-title banquet-heading"><div><div className="eyebrow">THE HUNDRED GHOSTS' BANQUET</div><h1>百鬼夜宴</h1></div><div className="banquet-heading-controls">{sound}<span className="round-badge">第 <strong>{G.turnNumber || '—'}</strong> 回合</span></div></div>
      <section className="banquet-status" data-own-turn={!readonly && actor === ownID} role="status" aria-live="polite"><span aria-hidden="true">◈</span><div><strong>{title}</strong><p>{subtitle}</p></div></section>
      <div className="banquet-metrics"><span>{G.turnOrder.length} 位賓客</span><span>{banquetArt('court') && <img src={banquetArt('court')} alt="" />}裁決堂 <b>{G.court}</b> 妖金</span><span>勝利門檻 <b>13</b></span></div>
      <div className="banquet-table-scroll"><div className="banquet-table" aria-label="夜宴座次，依序順時針">
        {G.turnOrder.map((id, index) => <article key={id} className="banquet-guest" data-active={actor === id} data-own={!readonly && id === ownID} data-winner={G.winnerIDs.includes(id)}>
          <div className="banquet-seat">第 {index + 1} 席{!readonly && id === ownID ? ' · 你' : ''}<span>{G.status === 'briefing' ? G.players[id].acknowledged ? '✓ 已確認' : '記憶中' : actor === id ? '行動中' : '↻'}</span></div>
          <Mask role={face(id, index)} /><h3 title={nameOf(id)}>{nameOf(id)}</h3><div className="banquet-coins">{banquetArt('coin') ? <img src={banquetArt('coin')} alt="" /> : <span aria-hidden="true">◉</span>}<strong>{G.players[id].coins}</strong><span>妖金</span></div>
          <progress value={G.players[id].coins} max={13} aria-label={`${nameOf(id)}：${G.players[id].coins} 枚妖金，目標 13 枚`} />
          {G.players[id].cannotAnnounce && <small>本回合不能宣告</small>}{G.claim?.claimantIDs.includes(id) && <small className="banquet-claim-tag">認領{BANQUET_ROLES[G.claim.role].name}</small>}
        </article>)}
      </div>{G.centerCount > 0 && <div className="banquet-center-masks"><span>中央面具</span>{Array.from({ length: G.centerCount }, (_, index) => <div key={index}><Mask small role={G.status === 'briefing' ? initial(`center:${index}`) : readonly && god && visible ? G.currentMasks?.center[index] : undefined} /><small>中央 {index + 1}</small></div>)}</div>}
        <details className="banquet-inplay"><summary>本局面具與能力 · {G.inPlayRoles.length} 張</summary><div>{[...new Set(G.inPlayRoles)].map(role => <p key={role}><b>{BANQUET_ROLES[role].name}{G.inPlayRoles.filter(value => value === role).length > 1 ? ' × 2' : ''}</b> {BANQUET_ROLES[role].description}</p>)}</div></details>
      </div>
      {readonly && <p className="banquet-readonly-note">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 唯讀'} · {god ? '上帝視角可看此刻面具，右側保留所選賓客當時的記憶。' : '盲視角只提供觀眾當時看見的公開記憶，不顯示即時面具。'}</p>}
    </section>
    <aside className="banquet-personal-aside">
      {controls && <section className="panel banquet-controls" aria-label="目前操作">{controls}</section>}
      <section className="panel banquet-memory"><div className="banquet-private-heading"><h2>{readonly && !god ? '觀眾見聞' : '面具記憶'}</h2><button type="button" className="button secondary" aria-pressed={visible} onClick={() => onVisible(!visible)}>{visible ? '收起秘密' : '展開記憶'}</button></div>{inspector}
        {!visible ? <div className="banquet-concealed"><Mask /><p>面具記憶與私人操作已遮住</p></div> : <><p className="banquet-memory-note">這是當時看見的面具，不是免費查看現在的牌。盲換或假換都可能讓記憶失準。</p>
          <div className="banquet-memory-list">{[...memory].reverse().map((entry, index) => <article className="banquet-memory-entry" key={`${entry.epoch}:${entry.location}:${index}`} data-uncertain={entry.uncertain}><Mask role={entry.role} small /><div><strong>{BANQUET_ROLES[entry.role].name}</strong><p>{entry.playerID ? `${nameOf(entry.playerID)} · 當時第 ${Number(entry.location.split(':')[1]) + 1} 席` : `中央 ${Number(entry.location.split(':')[1]) + 1}`}</p><small>{entry.turn ? `第 ${entry.turn} 回合` : '開場'} · {sourceNames[entry.source]}{entry.uncertain ? ' · 可能已改變' : ' · 當時所見'}</small></div></article>)}</div>
          {!memory.length && <p className="muted">目前視角沒有可查看的面具記憶。</p>}</>}
      </section>
    </aside>
    <aside className="game-aside banquet-history-aside"><section className="panel banquet-history"><h2>夜宴紀事 <small>{G.log.length}</small></h2><ol className="banquet-log">{[...G.log].reverse().map((entry, index) => <li key={G.log.length - index}><span className="banquet-log-turn">{entry.turn ? `第 ${entry.turn} 回合` : '開場'}</span><p>{entry.actorID && <strong>{nameOf(entry.actorID)} · </strong>}{entry.message}</p>{entry.targetIDs?.length ? <small>{entry.targetIDs.map(id => id.includes(':') ? historicalLocation(id) : nameOf(id)).join('、')}</small> : null}{entry.revealed && <div className="banquet-public-reveal">{Object.entries(entry.revealed).map(([id, role]) => <span key={id}>{nameOf(id)}：{BANQUET_ROLES[role].name}</span>)}</div>}</li>)}</ol></section>
      <details className="panel rules-details"><summary>夜宴規則速查</summary><BanquetRuleSummary /></details>
      {G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective="blind" label="製作夜宴戰報" />}
    </aside>
  </main>;
}

export function BanquetRuleSummary() { return <div className="banquet-rule-summary"><p>4～12 人，每人 6 枚妖金。記住開場面具，全員確認後前四回合只能盲換或假換。</p><p>之後每回合三選一：私看自己的面具、與另一張盲換或假換、宣告本局某種面具並發動能力。查看也會花掉一個回合。</p><p>宣告後其他人依序決定是否認領。無人認領就不驗牌直接發動；有認領則全部亮牌，正確者使用能力，錯誤者在能力之後各繳 1 妖金到裁決堂。</p><p>達 13 妖金立即獲勝；有人降至 0，最富者勝。天邪鬼必須成功發動能力，且當時至少有 10 妖金才勝。</p><p>剛在上一回合亮過面具且接著輪到你時，不能宣告。記憶只反映當時所見；面具可能已被盲換。</p></div>; }
