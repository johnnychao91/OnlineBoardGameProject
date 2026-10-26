import { useContext, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { bakerCanAccuse, legalBakerActions, type BakerAction, type BakerState, type BakerSceneSlot } from '../games/baker/game';
import { BAKER_ERAS, BAKER_ROLES } from '../games/baker/rules';
import { BAKER_SCENES, sceneOptions, type BakerCard } from '../games/baker/content';
import { isPlayer, type RoomInfo } from './api';
import { BattleReport } from './BattleReport';
import { GameSoundControl } from './GameSoundControl';
import { BakerArtwork } from './BakerArtwork';
import { BakerCardFace, BakerRuleSummary } from './BakerRules';
import { RoomContext } from './room-context';
import { Icon } from './ui';
import './baker.css';

type BoardProps = { G: BakerState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => any> };
export type BakerNameOf = (id: string) => string;
type Accusation = { targetID: string; meansID: string; clueID: string };

export function useBakerPrivacy(): [boolean, (shown: boolean) => void] { return useState(true); }
export function bakerCardByID(G: BakerState, id?: string) {
  if (!id) return undefined;
  return Object.values(G.players).flatMap(player => [...player.means, ...player.clues]).find(card => card.id === id);
}
const canAccuse = bakerCanAccuse;

export function BakerBoard({ G, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const [visible, setVisible] = useBakerPrivacy();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [accusation, setAccusation] = useState<Accusation>({ targetID: '', meansID: '', clueID: '' });
  const sending = useRef(false);
  const version = `${G.epoch}:${G.status}:${G.players[id]?.acknowledged}`;
  const canAct = isConnected !== false && !!G.players[id] && !busy;
  const nameOf: BakerNameOf = target => {
    const player = info.players.find(entry => String(entry.id) === target);
    return `${player?.name || `警員 ${Number(target) + 1}`}${player?.departed ? '（已離開）' : ''}`;
  };
  useEffect(() => { sending.current = false; setBusy(false); setNotice(''); }, [version, isConnected]);
  useEffect(() => {
    if (!busy) return;
    const timeout = window.setTimeout(() => { sending.current = false; setBusy(false); setNotice('尚未收到確認，請確認連線與最新案件狀態後重試。'); }, 8000);
    return () => window.clearTimeout(timeout);
  }, [busy]);
  function send(move: string, ...args: unknown[]) {
    if (!canAct || sending.current) return;
    sending.current = true; setBusy(true); setNotice(''); moves[move](...args, G.epoch);
  }
  function selectEvidence(targetID: string, card: BakerCard) {
    if (!canAct || !canAccuse(G, id) || targetID === id || G.excludedCards.includes(card.id)) return;
    setAccusation(previous => ({ ...(previous.targetID === targetID ? previous : { targetID, meansID: '', clueID: '' }),
      [card.kind === 'means' ? 'meansID' : 'clueID']: card.id }));
  }
  const ownRole = G.private[id]?.role;
  const controls = <>
    {G.status === 'briefing' ? <><h3>查看秘密卷宗</h3><p>確認自己的身分後準備開始。請保密你知道的資訊。</p>
      <button type="button" className="button primary full" disabled={!canAct || G.players[id]?.acknowledged} onClick={() => send('acknowledge')}>
        {G.players[id]?.acknowledged ? '已準備，等待其他人' : '已看過身分，開始調查'}<Icon type="check" size={16} /></button>
      <p className="small muted">{Object.values(G.players).filter(player => player.acknowledged).length} / {Object.keys(G.players).length} 位已準備</p></>
      : G.status === 'finished' ? <p>本局卷宗已結案，稍後回到原等待室；可從房間歷史查看復盤。</p>
      : G.status === 'crime' ? ownRole === 'murderer' && visible
        ? <BakerCrimeChoice key={`crime:${id}`} G={G} id={id} disabled={!canAct} onSubmit={(means, clue) => send('chooseCrime', means, clue)} />
        : <p>案件正在建立。請查看公開證物，等待第一份鑑證提示。</p>
      : G.status === 'witness-hunt' ? ownRole === 'murderer' ? visible
        ? <BakerWitnessChoice G={G} id={id} nameOf={nameOf} disabled={!canAct} onSubmit={target => send('identifyWitness', target)} />
        : <p>展開秘密卷宗後，完成最後指認。</p>
        : <p>破案推論已成立，等待最後的目擊者指認。</p>
      : id === G.holmesID ? G.status === 'special' && !visible
        ? <p>展開秘密卷宗後，處理目前的鑑證事件。</p>
        : <BakerHolmesControls G={G} id={id} nameOf={nameOf} disabled={!canAct} onSend={send} />
      : G.status === 'presentation' && G.speakerID === id ? <><h3>輪到你說明案情</h3><p>整理目前的推理。說完後交給下一位警員。</p>
        <button type="button" className="button primary full" disabled={!canAct} onClick={() => send('finishSpeech')}>我已完成發言<Icon type="check" size={16} /></button></>
      : <p>{G.status === 'presentation' ? `請聽 ${G.speakerID ? nameOf(G.speakerID) : '目前發言者'} 說明案情。` : '結合福爾摩斯的提示，討論公開桌面上的證物。'}</p>}
    {canAccuse(G, id) && <BakerAccusationForm G={G} id={id} nameOf={nameOf} value={accusation} onChange={setAccusation} disabled={!canAct}
      onSubmit={() => {
        const means = bakerCardByID(G, accusation.meansID), clue = bakerCardByID(G, accusation.clueID);
        if (means && clue && window.confirm(`提交一次正式破案推論？\n\n${nameOf(accusation.targetID)}\n作案手段：${means.name}\n現場物證：${clue.name}\n\n若推論不成立，將交出你的警徽。`)) send('accuse', accusation.targetID, accusation.meansID, accusation.clueID);
      }} />}
    {!G.players[id]?.badge && id !== G.holmesID && !['lobby', 'briefing', 'crime', 'finished', 'witness-hunt'].includes(G.status) && <p className="baker-badge-spent">你已交出警徽，仍可討論與發言。</p>}
    {busy && <p role="status">正在確認操作…</p>}{notice && <p className="error-message" role="status">{notice}</p>}
  </>;
  return <><div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status"><Icon type="signal" size={15} />
    {isConnected === false ? '連線中斷，請重新連線後確認最新案件狀態。' : '貝克街案件卷宗已同步'}</div>
    <BakerLayout G={G} info={info} nameOf={nameOf} ownID={id} visible={visible} onVisible={setVisible} controls={controls}
      canSelectEvidence={canAct && !!canAccuse(G, id)} selection={accusation} onSelectEvidence={selectEvidence}
      onMark={id === G.holmesID && G.status === 'evidence' && canAct ? (tile, option) => send('markScene', tile, option) : undefined}
      sound={<GameSoundControl gameID="baker-street" G={G} matchID={info.matchID} playerID={id} connected={isConnected !== false} />} />
  </>;
}

function BakerCrimeChoice({ G, id, disabled, onSubmit }: { G: BakerState; id: string; disabled: boolean; onSubmit: (means: string, clue: string) => void }) {
  const [means, setMeans] = useState(''), [clue, setClue] = useState('');
  return <div className="baker-secret-choice"><h3>秘密建立案件</h3><p>從自己面前各選一張。確認後，本局答案就固定。</p>
    <label>作案手段<select value={means} disabled={disabled} onChange={event => setMeans(event.target.value)}><option value="">選擇一張作案手段</option>{G.players[id].means.map(card => <option value={card.id} key={card.id}>{card.name}</option>)}</select></label>
    <label>現場物證<select value={clue} disabled={disabled} onChange={event => setClue(event.target.value)}><option value="">選擇一張現場物證</option>{G.players[id].clues.map(card => <option value={card.id} key={card.id}>{card.name}</option>)}</select></label>
    <button type="button" className="button primary full" disabled={disabled || !means || !clue} onClick={() => onSubmit(means, clue)}>確認秘密案情</button></div>;
}

function BakerWitnessChoice({ G, id, nameOf, disabled, onSubmit }: { G: BakerState; id: string; nameOf: BakerNameOf; disabled: boolean; onSubmit: (id: string) => void }) {
  const [target, setTarget] = useState('');
  const legalTargets = legalBakerActions(G, id).filter(action => action.move === 'identifyWitness').map(action => String(action.args[0]));
  return <><h3>最後指認：誰是華生？</h3><p>與內應商量後，指出你認為的目擊者。這次選擇決定最後勝負。</p>
    <label>指認對象<select value={target} disabled={disabled} onChange={event => setTarget(event.target.value)}><option value="">選擇一名玩家</option>
      {legalTargets.map(targetID => <option key={targetID} value={targetID}>{nameOf(targetID)}</option>)}</select></label>
    <button type="button" className="button primary full" disabled={disabled || !legalTargets.includes(target)} onClick={() => {
      if (window.confirm(`確定指認 ${nameOf(target)} 是華生醫生？`)) onSubmit(target);
    }}>確認指認</button></>;
}

function BakerHolmesControls({ G, id, nameOf, disabled, onSend }: { G: BakerState; id: string; nameOf: BakerNameOf; disabled: boolean; onSend: (move: string, ...args: unknown[]) => void }) {
  const [selection, setSelection] = useState('');
  const actions = legalBakerActions(G, id).filter(action => action.move === 'chooseLocation' || action.move === 'replaceScene' || action.move === 'resolveSpecial');
  const actionKey = (action: BakerAction) => JSON.stringify([action.move, ...action.args.slice(0, -1)]);
  const selected = actions.find(action => actionKey(action) === selection);
  if (G.status === 'scene-setup' || G.status === 'replacement' || G.status === 'special') return <>
    <h3>{G.status === 'scene-setup' ? '選擇案發地點圖板' : G.status === 'replacement' ? '追加一份鑑證線索' : G.special?.tile.name ?? '案件事件'}</h3>
    {G.special?.tile.description && <p>{G.special.tile.description}</p>}
    {G.nextScene && <p>新圖板：<strong>{G.nextScene.name}</strong></p>}
    <label>{G.status === 'scene-setup' ? '案發地點' : '選擇處理方式'}<select key={`${G.status}:${G.round}`} value={selected ? selection : ''} disabled={disabled} onChange={event => setSelection(event.target.value)}>
      <option value="">請選擇</option>{actions.map(action => <option key={actionKey(action)} value={actionKey(action)}>{bakerActionLabel(action, G, nameOf)}</option>)}
    </select></label>
    <button type="button" className="button primary full" disabled={disabled || !selected} onClick={() => selected && onSend(selected.move, ...selected.args.slice(0, -1))}>
      {G.status === 'scene-setup' ? '確認案發地點圖板' : '確認鑑證選擇'}</button>
  </>;
  if (G.status === 'evidence') return <><h3>放置推理棋子</h3><p>在中央圖板點選一個詞。可自行決定先後順序，每塊圖板放一枚；放下後就不能更改。</p>
    <p className="baker-mark-progress">已完成 <strong>{G.scenes.filter(slot => slot.marks.length).length}</strong> / 6 塊圖板</p></>;
  if (G.status === 'discussion') return <><h3>鑑證提示已備齊</h3><p>讓調查隊討論線索，再開始本輪依序發言。</p><button type="button" className="button primary full" disabled={disabled} onClick={() => onSend('startPresentations')}>開始本輪發言</button></>;
  if (G.status === 'presentation') return <><h3>案情研討中</h3><p>目前由 {G.speakerID ? nameOf(G.speakerID) : '調查員'} 發言。請讓對方自行按下完成；需要協助時也可由你推進。</p>
    <button type="button" className="button secondary full" disabled={disabled} onClick={() => {
      if (window.confirm(`確認 ${G.speakerID ? nameOf(G.speakerID) : '目前玩家'} 已完成發言，交給下一位？`)) onSend('finishSpeech');
    }}>協助結束目前發言</button></>;
  return <p>等待調查隊完成目前階段。</p>;
}

function bakerActionLabel(action: BakerAction, G: BakerState, nameOf: BakerNameOf): string {
  const target = String(action.args[0]), option = typeof action.args[1] === 'number' ? action.args[1] : null;
  const tile = BAKER_SCENES.find(scene => scene.id === target) ?? G.scenes.find(slot => slot.tile.id === target)?.tile;
  if (action.move === 'chooseLocation') return tile ? `${tile.name}：${sceneOptions(tile, G.options.era).join('、')}` : target;
  if (action.move === 'replaceScene') return `替換「${tile?.name ?? target}」→ ${G.nextScene && option !== null ? sceneOptions(G.nextScene, G.options.era)[option] : '新線索'}`;
  const effect = G.special?.tile.effect;
  if (effect === 'restore-badge') return `歸還 ${nameOf(target)} 的警徽`;
  const card = bakerCardByID(G, target);
  if (card) return `排除 ${card.name}`;
  const optionTile = effect === 'replace-scene' ? G.special?.replacement : tile;
  if (optionTile && option !== null) return `${tile?.name ?? optionTile.name} → ${sceneOptions(optionTile, G.options.era)[option]}`;
  return target ? `確認 ${tile?.name ?? target}` : '無可處理的目標，繼續調查';
}

function BakerAccusationForm({ G, id, nameOf, value, onChange, disabled, onSubmit }: {
  G: BakerState; id: string; nameOf: BakerNameOf; value: Accusation; onChange: (value: Accusation) => void; disabled: boolean; onSubmit: () => void;
}) {
  const targets = Object.keys(G.players).filter(target => target !== id && target !== G.holmesID);
  const target = targets.includes(value.targetID) ? G.players[value.targetID] : undefined;
  const valid = target?.means.some(card => card.id === value.meansID && !G.excludedCards.includes(card.id)) && target.clues.some(card => card.id === value.clueID && !G.excludedCards.includes(card.id));
  return <div className="baker-accusation"><h3><BakerArtwork token="badge" />提交破案推論</h3><p>選擇同一人的兩張牌。你只有一次正式破案機會。</p>
    <label>嫌疑人<select value={target ? value.targetID : ''} disabled={disabled} onChange={event => onChange({ targetID: event.target.value, meansID: '', clueID: '' })}>
      <option value="">選擇一位其他玩家</option>{targets.map(targetID => <option key={targetID} value={targetID}>{nameOf(targetID)}</option>)}</select></label>
    <label>作案手段<select value={value.meansID} disabled={disabled || !target} onChange={event => onChange({ ...value, meansID: event.target.value })}>
      <option value="">選擇作案手段</option>{target?.means.map(card => <option value={card.id} disabled={G.excludedCards.includes(card.id)} key={card.id}>{card.name}{G.excludedCards.includes(card.id) && '（已排除）'}</option>)}</select></label>
    <label>現場物證<select value={value.clueID} disabled={disabled || !target} onChange={event => onChange({ ...value, clueID: event.target.value })}>
      <option value="">選擇現場物證</option>{target?.clues.map(card => <option value={card.id} disabled={G.excludedCards.includes(card.id)} key={card.id}>{card.name}{G.excludedCards.includes(card.id) && '（已排除）'}</option>)}</select></label>
    <button type="button" className="button primary full" disabled={disabled || !valid} onClick={onSubmit}>確認並提交破案</button></div>;
}

export function BakerLayout({ G, info, ownID, nameOf, visible, onVisible, controls, sound, inspector, readonly = false, replay = false,
  canSelectEvidence = false, selection, onSelectEvidence, onMark }: {
  G: BakerState; info: RoomInfo; ownID: string; nameOf: BakerNameOf; visible: boolean; onVisible: (value: boolean) => void;
  controls?: ReactNode; sound?: ReactNode; inspector?: ReactNode; readonly?: boolean; replay?: boolean; canSelectEvidence?: boolean;
  selection?: Accusation; onSelectEvidence?: (targetID: string, card: BakerCard) => void; onMark?: (tile: string, option: number) => void;
}) {
  const [inspect, setInspect] = useState<BakerCard | null>(null);
  return <main className={`game-layout baker-layout${readonly ? ' baker-snapshot' : ''}`} data-baker-era={G.options.era}>
    <section className="game-main baker-main"><div className="game-title baker-heading"><div><div className="eyebrow">THE BAKER STREET FILES</div><h1>貝克街迷霧</h1></div>
      <div className="baker-heading-controls">{sound}<span className="baker-year">{G.options.year}<small>{BAKER_ERAS[G.options.era].name}</small></span><span className="round-badge">第 <strong>{G.round || '—'}</strong> / 3 輪</span></div></div>
      <BakerStatus G={G} nameOf={nameOf} />
      <div className="baker-case-scroll">
        <BakerSceneTable G={G} onMark={onMark} />
        <BakerEvidenceTable G={G} ownID={readonly ? undefined : ownID} nameOf={nameOf} selection={selection}
          canSelect={canSelectEvidence} onSelect={onSelectEvidence} onInspect={setInspect} />
        {G.status === 'finished' && <BakerResult G={G} nameOf={nameOf} />}
        {readonly && <p className="baker-readonly-note">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 不占參與人數'}。只顯示目前視角獲准的資料。</p>}
      </div>
    </section>
    <aside className="baker-personal-aside"><BakerPrivate G={G} id={ownID} nameOf={nameOf} visible={visible} onVisible={onVisible} inspector={inspector} readonly={readonly} />
      {controls && <section className="panel baker-controls" aria-label="目前操作">{controls}</section>}</aside>
    <aside className="game-aside baker-history-aside"><BakerLog G={G} nameOf={nameOf} />
      <details className="panel rules-details"><summary>貝克街迷霧規則速查</summary><BakerRuleSummary /></details>
      {G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective="blind" label="製作案件戰報" />}
    </aside>
    {inspect && <BakerCardInspection card={inspect} onClose={() => setInspect(null)} />}
  </main>;
}

export function BakerStatus({ G, nameOf }: { G: BakerState; nameOf: BakerNameOf }) {
  const copy: Record<BakerState['status'], [string, string]> = {
    lobby: ['案件尚未開卷', '等待房主安排本次調查。'], briefing: ['查看身分，準備調查', `${G.holmesID ? `本案由 ${nameOf(G.holmesID)} 擔任福爾摩斯。` : ''}秘密卷宗只提供給各位本人。`], crime: ['案情建立中', '觀察公開證物，等待第一份鑑證。'],
    'scene-setup': ['福爾摩斯正在還原現場', '等待案發地點與推演圖板。'], evidence: ['鑑證線索逐一公開', '觀察棋子標出的詞，結合作案手段與現場物證。'],
    discussion: ['案情研討', '六塊圖板已備齊，可以討論或提交破案推論。'], presentation: [`${G.speakerID ? nameOf(G.speakerID) : '調查員'} 正在發言`, '依座位輪流說明推理；有警徽時仍可插入正式破案。'],
    replacement: ['追加鑑證', '福爾摩斯將替換一塊一般圖板。'], special: [G.special?.tile.name ?? '案件事件', G.special?.tile.description ?? '等待特別圖板處理完畢。'],
    'witness-hunt': ['破案推論成立 · 最後指認', '等待執行者指認目擊者。'], finished: [G.winner === 'police' ? '真相大白 · 調查陣營獲勝' : '迷霧未散 · 莫里亞蒂陣營獲勝', bakerReason(G.winReason)],
  };
  const [title, detail] = copy[G.status];
  return <section className="baker-status" role="status" aria-live="polite"><span className="baker-status-glyph" aria-hidden="true">⌕</span><div><strong>{title}</strong><p>{detail}</p></div></section>;
}

export function BakerSceneTable({ G, onMark }: { G: BakerState; onMark?: (tile: string, option: number) => void }) {
  if (!G.scenes.length) return <section className="baker-empty-scene"><BakerArtwork token="chess-marker" /><p>鑑證開始後，福爾摩斯會在這裡留下六份提示。</p></section>;
  return <section className="baker-scenes-section" aria-label="福爾摩斯推演圖板"><div className="baker-section-title"><h2>福爾摩斯推演板</h2><span>{G.scenes.filter(slot => slot.marks.length).length} / 6 份提示</span></div>
    <div className="baker-scene-table">{G.scenes.map(slot => <BakerSceneTile key={slot.tile.id} slot={slot} era={G.options.era} onMark={onMark} />)}</div></section>;
}

function BakerSceneTile({ slot, era, onMark }: { slot: BakerSceneSlot; era: BakerState['options']['era']; onMark?: (tile: string, option: number) => void }) {
  return <article className="baker-scene-tile" data-kind={slot.tile.kind}><h3>{slot.tile.name}{slot.tile.kind !== 'scene' && <small>固定</small>}</h3>
    <ol>{sceneOptions(slot.tile, era).map((option, index) => <li key={index} className={slot.marks.includes(index) ? 'marked' : ''}>
      {onMark && !slot.marks.length ? <button type="button" onClick={() => onMark(slot.tile.id, index)} aria-label={`在${slot.tile.name}標記${option}`}><span>{option}</span><span className="baker-marker-position" aria-hidden="true">＋</span></button>
        : <span><span>{option}</span><span className="baker-marker-position" aria-hidden="true">{slot.marks.includes(index) && <BakerArtwork token="chess-marker" />}</span></span>}
    </li>)}</ol></article>;
}

export function BakerEvidenceTable({ G, ownID, nameOf, selection, canSelect = false, onSelect, onInspect }: {
  G: BakerState; ownID?: string; nameOf: BakerNameOf; selection?: Accusation; canSelect?: boolean; onSelect?: (id: string, card: BakerCard) => void; onInspect?: (card: BakerCard) => void;
}) {
  const [focused, setFocused] = useState('all');
  const ids = G.turnOrder.filter(id => id !== G.holmesID && G.players[id]);
  const shown = focused === 'all' || !ids.includes(focused) ? ids : [focused];
  return <section className="baker-evidence-section" aria-label="公開證物桌"><div className="baker-section-title"><h2>公開證物桌</h2><span>每人各 {G.options.cardsPerType} 張 · 牌面公開</span></div>
    <div className="baker-roster-tabs" role="group" aria-label="篩選證物桌"><button type="button" aria-pressed={focused === 'all'} onClick={() => setFocused('all')}>全部</button>
      {ids.map(id => <button key={id} type="button" aria-pressed={focused === id} onClick={() => setFocused(id)}>{nameOf(id)}{G.speakerID === id && ' · 發言'}</button>)}</div>
    <div className="baker-suspects" data-focused={shown.length === 1}>{shown.map(id => {
      const player = G.players[id];
      return <article className={`baker-suspect${G.speakerID === id ? ' speaking' : ''}`} key={id}>
        <header><div><h3>{nameOf(id)}</h3>{id === ownID && <span className="you-label">你</span>}{player.revealedRole && <span className="baker-public-role">{BAKER_ROLES[player.revealedRole].name}</span>}</div>
          <span className={`baker-badge-status${player.badge ? '' : ' spent'}`} title={player.badge ? '尚有一次正式破案機會' : '已交出警徽'}><BakerArtwork token="badge" /><span>{player.badge ? '警徽' : '已用'}</span></span></header>
        {(['means', 'clues'] as const).map(kind => <div className="baker-evidence-row" key={kind}><h4>{kind === 'means' ? '作案手段' : '現場物證'}</h4>
          <div className="baker-evidence-cards" style={{ '--baker-card-count': player[kind].length } as CSSProperties}>{player[kind].map(card => <div key={card.id} className={G.excludedCards.includes(card.id) ? 'baker-excluded-card' : ''}>
            <BakerCardFace card={card} compact selected={selection?.targetID === id && (selection.meansID === card.id || selection.clueID === card.id)}
              onSelect={onSelect && canSelect && id !== ownID ? () => onSelect(id, card) : undefined} disabled={G.excludedCards.includes(card.id)} onInspect={onInspect ? () => onInspect(card) : undefined} />
            {G.excludedCards.includes(card.id) && <span className="baker-excluded-label">已排除</span>}
          </div>)}</div></div>)}
      </article>;
    })}</div>
    {!ids.length && <p>公開證物尚未配發。</p>}
  </section>;
}

export function BakerPrivate({ G, id, nameOf, visible, onVisible, inspector, readonly = false }: {
  G: BakerState; id: string; nameOf: BakerNameOf; visible: boolean; onVisible: (visible: boolean) => void; inspector?: ReactNode; readonly?: boolean;
}) {
  const own = G.private?.[id], role = own?.role;
  const means = bakerCardByID(G, own?.solution?.meansID), clue = bakerCardByID(G, own?.solution?.clueID);
  return <section className="panel baker-private"><button className="baker-private-toggle" type="button" aria-expanded={visible} onClick={() => onVisible(!visible)}>
    <span><Icon type="shield" size={16} />{readonly ? '人物秘密卷宗' : '我的秘密卷宗'}</span><span>{visible ? '收起 −' : '展開 ＋'}</span></button>{inspector}
    {visible ? <div className="baker-private-body"><p className="baker-private-name">{nameOf(id)}</p>
      {role ? <><div className="baker-identity-card" data-faction={BAKER_ROLES[role].faction}><BakerArtwork role={role} /><h2>{BAKER_ROLES[role].name}</h2></div><p>{BAKER_ROLES[role].description}</p>
        {!!own.knownCriminals.length && <div className="baker-private-intel"><h3>{role === 'watson' ? '你目擊的兩位涉案者' : '你知道的涉案者'}</h3><p>{own.knownCriminals.map(nameOf).join('、')}</p>{role === 'watson' && <small>無法區分誰是執行者、誰是內應。</small>}</div>}
        {own.knownWitnessID && <div className="baker-private-intel"><h3>華生醫生</h3><p>{nameOf(own.knownWitnessID)}</p></div>}
        {own.solution && <div className="baker-private-intel"><h3>完整案情</h3><p>執行者：{nameOf(own.solution.murdererID)}</p><dl><dt>作案手段</dt><dd>{means?.name ?? '—'}</dd><dt>現場物證</dt><dd>{clue?.name ?? '—'}</dd></dl></div>}
      </> : <div className="baker-concealed"><Icon type="shield" size={26} /><p>目前視角不可查看這份秘密卷宗。</p></div>}
    </div> : <div className="baker-concealed"><Icon type="shield" size={26} /><p>身分、案情與私人情報已遮住</p></div>}
  </section>;
}

function BakerCardInspection({ card, onClose }: { card: BakerCard; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog className="baker-card-dialog" ref={dialog} aria-label={`查看${card.name}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div><button type="button" className="baker-dialog-close button secondary" onClick={onClose}>關閉 ×</button><BakerCardFace card={card} />
      <p>{BAKER_ERAS[card.era].name} · {card.kind === 'means' ? '作案手段' : '現場物證'}</p>{card.description && <p>{card.description}</p>}</div>
  </dialog>;
}

export function bakerReason(reason: string | null) {
  const labels: Record<string, string> = { solved: '正確指出作案手段與關鍵物證，案件真相成立。', 'crime-solved': '正確指出作案手段與關鍵物證，案件真相成立。',
    'witness-found': '華生遭到指認，莫里亞蒂的犯罪網逃過追查。', 'witness-protected': '華生成功保密，警方完成破案。',
    'badges-exhausted': '正式破案機會已用完，真相仍未成立。', 'investigation-expired': '三輪調查結束，真相仍未成立。' };
  return reason ? labels[reason] ?? '案件結果已記錄，可在復盤中查看完整經過。' : '案件結果已記錄。';
}

export function BakerResult({ G, nameOf }: { G: BakerState; nameOf: BakerNameOf }) {
  return <section className="baker-result"><h2>結案卷宗</h2><p>{bakerReason(G.winReason)}</p>
    {G.solution && <dl><dt>執行者</dt><dd>{nameOf(G.solution.murdererID)}</dd><dt>作案手段</dt><dd>{bakerCardByID(G, G.solution.meansID)?.name}</dd><dt>關鍵物證</dt><dd>{bakerCardByID(G, G.solution.clueID)?.name}</dd></dl>}
    <div className="baker-revealed-roles">{Object.entries(G.players).map(([id, player]) => player.revealedRole && <span key={id}><b>{nameOf(id)}</b> · {BAKER_ROLES[player.revealedRole].name}</span>)}</div>
  </section>;
}

export function bakerEventText(event: BakerState['log'][number], G: BakerState, nameOf: BakerNameOf) {
  const actor = event.actorID ? `${nameOf(event.actorID)} · ` : '';
  const target = event.targetID ? nameOf(event.targetID) : '';
  const cards = [bakerCardByID(G, event.meansID)?.name, bakerCardByID(G, event.clueID)?.name].filter(Boolean).join('／');
  if (event.type === 'accusation') return `${actor}對 ${target} 提交「${cards}」。${event.message}`;
  if (event.type === 'identify') return `${actor}指認 ${target}。${event.message}`;
  if (event.type === 'badge') return `${target} 重新取得一次正式破案機會。`;
  return `${actor}${event.message}`;
}
export function BakerLog({ G, nameOf }: { G: BakerState; nameOf: BakerNameOf }) {
  return <section className="panel baker-log"><div className="section-heading"><h2>案件紀錄</h2><span>公開資訊</span></div>
    <ol>{G.log.slice().reverse().map((event, index) => <li key={G.log.length - index}><span>第 {event.round} 輪 · {G.log.length - index}</span><p>{bakerEventText(event, G, nameOf)}</p></li>)}</ol>
    {!G.log.length && <p>調查開始後，公開的鑑證與推論會記錄在這裡。</p>}</section>;
}
