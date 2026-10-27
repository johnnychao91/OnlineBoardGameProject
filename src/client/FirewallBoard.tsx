import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { firewallObserverView, firewallPlayerView, legalFirewallActions } from '../games/firewall/game';
import { FIREWALL_ACTIONS, FIREWALL_PATHS, FIREWALL_ROLES, FIREWALL_TOOLS, type FirewallCard, type FirewallDirection, type FirewallPathDefinition, type FirewallRotation } from '../games/firewall/content';
import { firewallTileTopology } from '../games/firewall/topology';
import type { FirewallAction, FirewallActionTarget, FirewallEffect, FirewallPlacement, FirewallState, FirewallTile } from '../games/firewall/types';
import { isPlayer, type RoomInfo } from './api';
import { BattleReport } from './BattleReport';
import { GameSoundControl } from './GameSoundControl';
import type { SnapshotProps } from './game-types';
import { RoomContext } from './room-context';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';
import { FIREWALL_ACTION_HELP, firewallActionArt, firewallArt, firewallCardName, firewallPathName } from './firewall-art';
import './firewall.css';

type NameOf = (id: string) => string;
type BoardProps = { G: FirewallState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => any> };
const directionNames: Record<FirewallDirection, string> = { N: '北', E: '東', S: '南', W: '西' };
const edge: Record<FirewallDirection, [number, number]> = { N: [50, 0], E: [100, 75], S: [50, 150], W: [0, 75] };
const stop: Record<FirewallDirection, [number, number]> = { N: [50, 45], E: [73, 75], S: [50, 105], W: [27, 75] };
const nameReader = (info: RoomInfo): NameOf => id => { const p = info.players.find(entry => String(entry.id) === id); return `${p?.name || `節點 ${Number(id) + 1}`}${p?.departed ? '（已離開）' : ''}`; };
const effectName = (effect: FirewallEffect) => effect === 'trapped' ? '隔離監禁' : effect === 'theft' ? '竊取後門' : `${FIREWALL_TOOLS[effect].name}故障`;
export function firewallTopologyLabel(path: Pick<FirewallPathDefinition, 'components' | 'ladderComponent' | 'door' | 'crystals'>) {
  return path.components.map((component, i) => `連線${i + 1}：${component.map(side => directionNames[side]).join('、')}${component.length === 1 && path.ladderComponent !== i ? '（死路）' : ''}`).join('；') + (path.ladderComponent !== undefined ? '；連接共用跳板網路' : '') + (path.door ? `；${path.door.color === 'blue' ? '藍域' : '綠域'}閘門只作用於連線${path.door.component + 1}` : '') + (path.crystals ? '；資料晶簇一枚' : '');
}

/** Every separate component gets its own trace. Art never defines a connection. */
export function FirewallTopology({ path, rotation = 0, decorative = false }: { path: Pick<FirewallPathDefinition, 'components' | 'ladderComponent' | 'door' | 'crystals' | 'feature'>; rotation?: FirewallRotation; decorative?: boolean }) {
  const components = path.components;
  const stroke = (d: string, key: string) => <g key={key}><path d={d} fill="none" stroke="#13232d" strokeWidth={17} strokeLinecap="round" strokeLinejoin="round" /><path d={d} fill="none" stroke="#91e2ed" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" /></g>;
  function componentPath(component: readonly FirewallDirection[], index: number) {
    if (component.length === 1) { const a = edge[component[0]], b = path.ladderComponent === index ? [50, 75] : stop[component[0]]; return `M${a.join(',')} L${b.join(',')}`; }
    if (component.length === 2) {
      const [a, b] = component.map(side => edge[side]);
      if (a[0] === b[0] || a[1] === b[1]) return `M${a.join(',')} L${b.join(',')}`;
      const first = component[0] === 'N' ? [50, 45] : component[0] === 'S' ? [50, 105] : component[0] === 'E' ? [73, 75] : [27, 75];
      const last = component[1] === 'N' ? [50, 45] : component[1] === 'S' ? [50, 105] : component[1] === 'E' ? [73, 75] : [27, 75];
      return `M${a.join(',')} L${first.join(',')} Q50,75 ${last.join(',')} L${b.join(',')}`;
    }
    return component.map(side => `M${edge[side].join(',')} L50,75`).join(' ');
  }
  function markerPoint(index: number): [number, number] {
    const component = components[index];
    if (component?.length === 2) { const [a, b] = component.map(side => edge[side]); if (a[0] !== b[0] && a[1] !== b[1]) return [50 + (a[0] + b[0] - 100) / 10, 75 + (a[1] + b[1] - 150) / 10]; }
    return [50, 75];
  }
  const door = path.door ? markerPoint(path.door.component) : null, ladder = path.ladderComponent !== undefined ? markerPoint(path.ladderComponent) : null;
  return <svg className="firewall-topology" width={100} height={150} viewBox="0 0 100 150" aria-hidden={decorative || undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : firewallTopologyLabel(path)} data-components={components.map(component => component.join('')).join('|')}>
    <g transform={rotation === 180 ? 'rotate(180 50 75)' : undefined}>
      {components.map((component, index) => stroke(componentPath(component, index), `component-${index}`))}
      {path.feature === 'bridge' && <g data-bridge="separate-crossing"><path d="M50 55 V95" stroke="#13232d" strokeWidth={21} /><path d="M50 55 V95" stroke="#91e2ed" strokeWidth={8} /><path d="M39 59 V91 M61 59 V91" stroke="#efd59b" strokeWidth={2} /></g>}
      {components.map((component, index) => { if (component.length !== 1 || path.ladderComponent === index) return null; const [x, y] = stop[component[0]], vertical = component[0] === 'N' || component[0] === 'S'; return <path key={`cap-${index}`} data-dead-end={component[0]} d={vertical ? `M${x - 7} ${y} H${x + 7}` : `M${x} ${y - 7} V${y + 7}`} stroke="#e3a688" strokeWidth={4} strokeLinecap="round" />; })}
      {door && path.door && <g transform={`translate(${door[0]} ${door[1]})`} data-door={path.door.color}><rect x={-9} y={-12} width={18} height={24} rx={3} fill={path.door.color === 'blue' ? '#347cd0' : '#348868'} stroke="#f4f3d9" strokeWidth={2} /><path d="M-4 -6 H4 M-4 0 H4 M-4 6 H4" stroke="#fff5cf" strokeWidth={2} /></g>}
      {ladder && <g transform={`translate(${ladder[0]} ${ladder[1]})`} data-ladder="true"><rect x={-10} y={-13} width={20} height={26} rx={3} fill="#153e45" stroke="#fff0ac" strokeWidth={2} /><path d="M-5 -8 V8 M5 -8 V8 M-5 -5 H5 M-5 0 H5 M-5 5 H5" stroke="#fff0ac" strokeWidth={2} /></g>}
      {!!path.crystals && <g data-crystal="1"><path d="M77 14 L87 24 L83 40 H71 L67 24 Z" fill="#c3a3f0" stroke="#f2e4ff" strokeWidth={2} /><path d="M77 14 V40 M67 24 H87" stroke="#8060ae" strokeWidth={1.5} /></g>}
    </g>
  </svg>;
}

export function useFirewallPrivacy(): [boolean, (shown: boolean) => void] { return useState(true); }
export function FirewallBoard({ G: state, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID || (isPlayer(seat) ? seat.playerID : ''), G = firewallPlayerView({ G: state, playerID: id }), nameOf = nameReader(info);
  const [visible, setVisible] = useFirewallPrivacy(), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'play' | 'discard' | 'clear'>('play'), [selected, setSelected] = useState<string[]>([]), [rotation, setRotation] = useState<FirewallRotation>(0);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null), [target, setTarget] = useState<FirewallActionTarget | null>(null), [effect, setEffect] = useState<FirewallEffect | ''>(''), [victim, setVictim] = useState('');
  const sending = useRef(false), actions = legalFirewallActions(G, id), own = G.players[id], hand = G.private[id]?.hand ?? [];
  const version = G.status === 'briefing' || G.status === 'review' ? `${G.status}:${G.phaseEpoch}:${own?.acknowledged}` : `${G.status}:${G.epoch}`;
  useEffect(() => { sending.current = false; setBusy(false); setNotice(''); }, [version, isConnected]);
  useEffect(() => { setSelected([]); setPosition(null); setTarget(null); setRotation(0); setEffect(''); setVictim(''); }, [G.epoch, G.round]);
  useEffect(() => { if (!busy) return; const timer = window.setTimeout(() => { sending.current = false; setBusy(false); setNotice('尚未收到操作確認，請檢查連線與最新網格後再試。'); }, 8000); return () => window.clearTimeout(timer); }, [busy]);
  const canAct = isConnected !== false && !busy && !!own;
  function send(action?: FirewallAction) {
    if (!action || !canAct || sending.current || !actions.some(legal => legal.move === action.move && JSON.stringify(legal.args) === JSON.stringify(action.args))) return;
    sending.current = true; setBusy(true); setNotice(''); moves[action.move](...action.args);
  }
  function changeMode(next: typeof mode) { setMode(next); setSelected([]); setPosition(null); setTarget(null); setEffect(''); }
  function chooseCard(card: FirewallCard) {
    if (!visible || !canAct || G.status !== 'turn' || G.activePlayer !== id) return;
    setSelected(current => current.includes(card.id) ? current.filter(value => value !== card.id) : mode === 'play' ? [card.id] : current.length < (mode === 'clear' ? 2 : 3) ? [...current, card.id] : current);
    setPosition(null); setTarget(null);
  }
  const chosenCard = mode === 'play' ? hand.find(card => card.id === selected[0]) : undefined;
  const cardActions = chosenCard ? actions.filter(action => (action.move === 'placePath' || action.move === 'playAction') && action.args[0] === chosenCard.id) : [];
  const placements: FirewallPlacement[] = visible && canAct && chosenCard?.kind === 'path' ? cardActions.filter(action => action.move === 'placePath' && action.args[3] === rotation).map(action => ({ x: action.args[1] as number, y: action.args[2] as number, rotation })) : [];
  const actionTargets = chosenCard?.kind === 'action' ? cardActions.map(action => action.args[1] as FirewallActionTarget) : [];
  const targetMap: Record<string, FirewallActionTarget> = {};
  if (visible && canAct) for (const option of actionTargets) if (option.tileID || option.goalID) targetMap[(option.tileID ?? option.goalID)!] = option;
  const matchesCards = (action: FirewallAction) => Array.isArray(action.args[0]) && action.args[0].length === selected.length && action.args[0].every(value => selected.includes(value));
  const chosenAction = mode === 'discard' ? actions.find(action => action.move === 'discard' && matchesCards(action)) : mode === 'clear' ? actions.find(action => action.move === 'clearEffect' && matchesCards(action) && action.args[1] === effect)
    : chosenCard?.kind === 'path' && position ? cardActions.find(action => action.move === 'placePath' && action.args[1] === position.x && action.args[2] === position.y && action.args[3] === rotation)
      : chosenCard?.kind === 'action' ? cardActions.find(action => action.move === 'playAction' && JSON.stringify(action.args[1]) === JSON.stringify(target ?? (actionTargets.length === 1 && Object.keys(actionTargets[0]).length === 0 ? {} : null))) : undefined;
  const effects: FirewallEffect[] = own ? [...own.broken, ...(own.trapped ? ['trapped' as const] : []), ...(own.theftOrder !== null ? ['theft' as const] : [])] : [];
  const controls = <>
    {G.status === 'briefing' || G.status === 'review' ? <><h3>{G.status === 'briefing' ? '核對本輪身分與程式' : '本輪分紅與後門已結算'}</h3><p>{G.status === 'briefing' ? '每輪身分重新分配。確認後依席位輪流操作，手牌與資產請自行保密。' : G.round === 3 ? '全員確認後，公開三輪累積資產與最終勝者。' : '全員確認後開始下一輪，重新分配身分與六張手牌。'}</p><button type="button" className="button primary full" disabled={!canAct || !actions.some(action => action.move === 'acknowledge')} onClick={() => send(actions.find(action => action.move === 'acknowledge'))}>{own?.acknowledged ? '已確認，等待其他人' : G.status === 'briefing' ? '準備完成，開始滲透' : G.round === 3 ? '確認結算，公開總分' : '確認結算，準備下一輪'}</button><p className="small muted">{Object.values(G.players).filter(player => player.acknowledged).length} / {G.turnOrder.length} 位已確認</p></>
      : G.status === 'finished' ? <p>三輪滲透已結束，可查看公開分紅紀錄與完整復盤。</p>
      : !visible && G.activePlayer === id ? <p>私人身分、手牌與操作已收起。展開私人區後再完成回合。</p>
      : G.status === 'theft' && G.activePlayer === id ? <><h3>執行竊取後門</h3><p>選另一位玩家，從其累積資產取走 1 點；對方沒有資產時取得 0 點。</p><div className="firewall-choice-list">{actions.filter(action => action.move === 'steal').map(action => <button type="button" className="firewall-choice" key={String(action.args[0])} disabled={!canAct} aria-pressed={victim === action.args[0]} onClick={() => setVictim(String(action.args[0]))}>{nameOf(String(action.args[0]))}</button>)}</div><button type="button" className="button primary full" disabled={!canAct || !victim} onClick={() => send(actions.find(action => action.move === 'steal' && action.args[0] === victim))}>確認竊取目標</button></>
      : G.status === 'turn' && G.activePlayer === id ? <><h3>輪到你操作網路</h3>{(own.broken.length > 0 || own.trapped) && <p className="firewall-warning">目前不能放線路：{[...own.broken.map(tool => `${FIREWALL_TOOLS[tool].name}故障`), ...(own.trapped ? ['隔離監禁'] : [])].join('、')}。仍可使用行動牌、棄牌或解除效果。</p>}
        <div className="firewall-action-tabs" role="group" aria-label="選擇回合行動">{(['play', 'discard', 'clear'] as const).map(value => <button key={value} type="button" disabled={!canAct || value === 'clear' && !effects.length} aria-pressed={mode === value} onClick={() => changeMode(value)}>{{ play: '使用一張', discard: '棄牌換牌', clear: '解除效果' }[value]}</button>)}</div>
        {mode === 'play' ? !chosenCard ? <p>從下方手牌選一張。線路牌可旋轉後點選網格，行動牌依效果選擇目標。</p> : chosenCard.kind === 'path' ? <><p>{firewallPathName(FIREWALL_PATHS[chosenCard.pathID])} · {firewallTopologyLabel(FIREWALL_PATHS[chosenCard.pathID])}</p><div className="firewall-action-tabs" role="group" aria-label="線路旋轉">{([0, 180] as const).map(angle => <button type="button" key={angle} aria-pressed={rotation === angle} disabled={!canAct} onClick={() => { setRotation(angle); setPosition(null); }}>{angle}°</button>)}</div><p className="small">{placements.length ? `在網格點選 ${placements.length} 個合法位置之一。` : '這個方向目前沒有合法放置位置。可換方向、改用別張牌或棄牌。'}</p>{position && <p className="firewall-selected-target">已選位置（{position.x}, {position.y}）</p>}<button type="button" className="button primary full" disabled={!canAct || !chosenAction} onClick={() => send(chosenAction)}>確認放置線路</button></>
          : <><p>{FIREWALL_ACTION_HELP[chosenCard.action]}</p><div className="firewall-choice-list">{actionTargets.filter(option => Object.keys(option).length > 0).map(option => <button type="button" className="firewall-choice" key={JSON.stringify(option)} disabled={!canAct} aria-pressed={JSON.stringify(target) === JSON.stringify(option)} onClick={() => setTarget(option)}>{targetLabel(option, G, nameOf)}</button>)}</div>{!actionTargets.length && <p className="firewall-warning">目前沒有合法目標，可選另一張牌或棄牌。</p>}<button type="button" className="button primary full" disabled={!canAct || !chosenAction} onClick={() => send(chosenAction)}>執行{FIREWALL_ACTIONS[chosenCard.action].name}</button></>
          : mode === 'discard' ? <><p>選 1～3 張手牌棄掉，再抽相同張數；抽牌堆不足時只抽剩餘的牌。</p><button type="button" className="button primary full" disabled={!canAct || !chosenAction} onClick={() => send(chosenAction)}>棄掉 {selected.length} 張並補牌</button></>
            : <><p>選兩張手牌，解除自己面前一項效果，然後只抽 1 張。</p><label className="firewall-field">要解除的效果<select value={effect} disabled={!canAct} onChange={event => setEffect(event.target.value as FirewallEffect)}><option value="">請選擇效果</option>{effects.map(value => <option key={value} value={value}>{effectName(value)}</option>)}</select></label><button type="button" className="button primary full" disabled={!canAct || !chosenAction} onClick={() => send(chosenAction)}>棄兩張，解除效果（{selected.length}/2）</button></>}
      </> : <p>{own?.handCount === 0 && G.status === 'turn' ? '目前空手，暫時跳過你的回合。若交換後重新拿到手牌，就會恢復行動。' : '等待目前操作者完成選擇。可查看公開網格與自己的私人情報。'}</p>}
    {busy && <p className="small muted" role="status">正在確認操作…</p>}{notice && <p className="error-message" role="status">{notice}</p>}
  </>;
  return <><div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status">{isConnected === false ? '連線中斷，重新連線後請核對最新網格。' : '滲透通道已接通 · 回合選擇沒有倒數'}</div><FirewallLayout G={G} info={info} ownID={id} nameOf={nameOf} visible={visible} onVisible={setVisible} controls={controls} selectedIDs={selected} handDisabled={!visible || !canAct || G.status !== 'turn' || G.activePlayer !== id} onCard={chooseCard}
    network={<FirewallNetwork tiles={G.board} placements={placements} selected={visible && canAct ? position : null} preview={visible ? chosenCard : undefined} rotation={rotation} onPlace={(x, y) => setPosition({ x, y })} targets={targetMap} onTarget={setTarget} />}
    sound={<GameSoundControl gameID="firewall-breach" G={G} matchID={info.matchID} playerID={id} connected={isConnected !== false} />} /></>;
}

function targetLabel(target: FirewallActionTarget, G: FirewallState, nameOf: NameOf) {
  if (target.playerID) return `${nameOf(target.playerID)}${target.tool ? ` · ${FIREWALL_TOOLS[target.tool].name}` : ''}`;
  const tile = G.board.find(entry => entry.id === (target.goalID ?? target.tileID));
  return tile ? `${target.goalID ? '未知目標' : '線路'}（${tile.x}, ${tile.y}）` : '部署在自己面前';
}
export function FirewallSnapshot({ G: state, info, perspective, replay = false }: SnapshotProps) {
  const G = firewallObserverView(state as FirewallState, perspective), nameOf = nameReader(info), [id, setID] = useInspectedPlayer(G.turnOrder), [visible, setVisible] = useFirewallPrivacy();
  return <FirewallLayout G={G} info={info} ownID={id} nameOf={nameOf} visible={visible} onVisible={setVisible} readonly replay={replay}
    inspector={perspective === 'god' ? <SnapshotPlayerSelect playerIDs={G.turnOrder} value={id} onChange={setID} nameOf={nameOf} label="查看節點的私人情報" /> : undefined} />;
}

export function FirewallLayout({ G, info, ownID, nameOf, visible, onVisible, controls, network, inspector, sound, selectedIDs = [], handDisabled = true, onCard, readonly = false, replay = false }: {
  G: FirewallState; info: RoomInfo; ownID: string; nameOf: NameOf; visible: boolean; onVisible: (shown: boolean) => void; controls?: ReactNode; network?: ReactNode; inspector?: ReactNode; sound?: ReactNode;
  selectedIDs?: string[]; handDisabled?: boolean; onCard?: (card: FirewallCard) => void; readonly?: boolean; replay?: boolean;
}) {
  const privateInfo = G.private[ownID], background = firewallArt('background');
  let title = '本輪正在建立滲透通道', description = '核對私人身分與六張手牌，全員確認後開始。';
  if (G.status === 'turn') { title = G.activePlayer ? `${nameOf(G.activePlayer)}正在操作` : '網路等待下一個行動'; description = '放線路、使用行動牌、棄牌換牌，或用兩張牌解除一項效果。'; }
  if (G.status === 'theft') { title = `${G.activePlayer ? nameOf(G.activePlayer) : '節點'}正在執行後門`; description = '本輪身分與分紅已公開；後門依序完成後才進入確認。'; }
  if (G.status === 'review') { title = '本輪資產已結算'; description = '檢查分紅與後門結果，全員確認後繼續。'; }
  if (G.status === 'finished') { title = `${G.winnerIDs.map(nameOf).join('、')}贏得三輪滲透`; description = '累積資產最高者勝；同分共享勝利。'; }
  return <main className={`game-layout firewall-layout${readonly ? ' firewall-snapshot' : ''}`} data-dense={G.turnOrder.length > 8}>
    <section className="game-main firewall-main" style={background ? { '--firewall-scene': `url("${background}")` } as CSSProperties : undefined}>
      <div className="game-title firewall-heading"><div><div className="eyebrow">FIREWALL BREACH</div><h1>潛入防火牆</h1></div><div className="firewall-heading-controls">{sound}<span className="round-badge">第 <strong>{G.round}</strong> / 3 輪</span></div></div>
      <section className="firewall-status" data-own-turn={!readonly && G.activePlayer === ownID} role="status" aria-live="polite"><strong>{title}</strong><p>{description}</p></section>
      <div className="firewall-metrics"><span>抽牌堆 <b>{G.deckCount}</b></span><span>棄牌 <b>{G.discardCount}</b></span><span>第 <b>{G.turnNumber || '—'}</b> 回合</span><span>{G.turnOrder.length} 個節點</span></div>
      {network ?? <FirewallNetwork tiles={G.board} />}
      <div className="firewall-players" aria-label="公開節點狀態">{G.turnOrder.map(id => { const player = G.players[id]; return <article key={id} data-active={G.activePlayer === id} data-own={!readonly && ownID === id} data-winner={G.winnerIDs.includes(id)}><strong title={nameOf(id)}>{nameOf(id)}{!readonly && ownID === id ? ' · 你' : ''}</strong><div><span>手牌 {player.handCount}</span>{G.status === 'briefing' || G.status === 'review' ? <span>{player.acknowledged ? '✓ 已確認' : '待確認'}</span> : G.status === 'finished' ? <span>總分 <b>{G.finalScores[id] ?? 0}</b></span> : <span>{G.activePlayer === id ? '操作中' : ''}</span>}</div><div className="firewall-player-effects">{player.broken.map(tool => <span key={tool} title={`${FIREWALL_TOOLS[tool].name}故障`}><Art asset={`tools/${tool}`} /><small>{FIREWALL_TOOLS[tool].name} ×</small></span>)}{player.trapped && <span className="firewall-bad-effect">隔離監禁</span>}{player.theftOrder !== null && <span>竊取後門</span>}</div>{player.publicRole && <p>{FIREWALL_ROLES[player.publicRole].name}</p>}</article>; })}</div>
      {G.roundResult && <details className="firewall-round-result" open={G.status === 'finished'}><summary>本輪結算 · {G.roundResult.reason === 'connected' ? '核心已連通' : '全部手牌耗盡'} · {G.roundResult.crystals} 枚晶簇</summary><div>{G.turnOrder.map(id => <p key={id}><b>{nameOf(id)}</b> · {FIREWALL_ROLES[G.roundResult!.roles[id]].name} · 分紅 {G.roundResult!.awards[id] ?? 0}{G.players[id].trapped ? '（監禁中）' : ''}</p>)}{G.roundResult.thefts.map((item, index) => <p key={`theft-${index}`}>{nameOf(item.playerID)}從{nameOf(item.targetID)}取得 {item.amount} 點資產。</p>)}</div></details>}
      {readonly && <p className="firewall-readonly-note">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 唯讀'}。私人情報依當前授權顯示，未知目標與未來牌堆保持隱藏。</p>}
    </section>
    <aside className="firewall-personal-aside"><section className="panel firewall-private"><div className="firewall-private-heading"><h2>私人節點</h2><button type="button" className="button secondary" aria-pressed={visible} onClick={() => onVisible(!visible)}>{visible ? '收起秘密' : '展開私人區'}</button></div>{inspector}
      {!visible ? <div className="firewall-concealed"><Art asset="card-back" alt="已遮住的私人節點" /><p>身分、手牌與私人情報已遮住</p></div> : !privateInfo ? <p className="firewall-private-note">目前視角不可查看身分、手牌、資產或私人查驗。</p> : <><div className="firewall-role"><Art asset={`roles/${privateInfo.role}`} alt={FIREWALL_ROLES[privateInfo.role].name} /><div><span>本輪身分</span><h3>{FIREWALL_ROLES[privateInfo.role].name}</h3><p>{FIREWALL_ROLES[privateInfo.role].description}</p></div></div><div className="firewall-private-gold"><Art asset="credit" /><span>私人累積資產</span><strong data-private-gold="true">{G.status === 'finished' ? G.finalScores[ownID] ?? privateInfo.gold : privateInfo.gold}</strong></div></>}
      {controls && <div className="firewall-controls" aria-label="目前操作">{controls}</div>}
      {visible && privateInfo && <><div className="firewall-hand-heading"><h3>程式手牌</h3><small>{privateInfo.hand.length} 張{selectedIDs.length ? ` · 已選 ${selectedIDs.length}` : ''}</small></div><div className="firewall-hand">{privateInfo.hand.map(card => readonly ? <div key={card.id} className="firewall-hand-card"><FirewallCardFace card={card} /></div> : <button type="button" key={card.id} className="firewall-hand-card" disabled={handDisabled} aria-label={`選擇${firewallCardName(card)}`} aria-pressed={selectedIDs.includes(card.id)} onClick={() => onCard?.(card)}><FirewallCardFace card={card} /></button>)}</div>{!privateInfo.hand.length && <p className="small muted">目前沒有手牌。</p>}
        {(privateInfo.goalMemory.length > 0 || privateInfo.roleMemory.length > 0) && <details className="firewall-private-memory" open><summary>私人查驗紀錄</summary>{[...privateInfo.goalMemory].reverse().map((entry, index) => <article key={`goal-${index}`}><strong>第 {entry.round} 輪 · {G.board.find(tile => tile.id === entry.goalID)?.y === -2 ? '上方' : G.board.find(tile => tile.id === entry.goalID)?.y === 2 ? '下方' : '中間'}目標</strong><div className="firewall-memory-path"><FirewallTopology path={FIREWALL_PATHS[entry.pathID]} /></div><p>{entry.pathID === 'goal_gold' ? '核心資料' : '空核心'} · 這是當時私下看到的內容。</p></article>)}{[...privateInfo.roleMemory].reverse().map((entry, index) => <article key={`role-${index}`}><strong>{nameOf(entry.playerID)}</strong><p>第 {entry.round} 輪：{FIREWALL_ROLES[entry.role].name}</p><small>查驗後可能被重配身分，並非持續追蹤。</small></article>)}</details>}</>}
    </section></aside>
    <aside className="game-aside firewall-history-aside"><section className="panel firewall-history"><h2>入侵紀錄 <small>{G.log.length}</small></h2><ol>{[...G.log].reverse().map((entry, index) => <li key={G.log.length - index}><span>第 {entry.round} 輪</span><p>{entry.actor && <b>{nameOf(entry.actor)} · </b>}{entry.message}</p>{entry.target && <small>{nameOf(entry.target)}</small>}{entry.card && <strong>{firewallCardName(entry.card)}</strong>}{entry.tile && <small>網格（{entry.tile.x}, {entry.tile.y}）{entry.tile.revealed && entry.tile.pathID ? ` · ${firewallPathName(FIREWALL_PATHS[entry.tile.pathID])}` : ''}</small>}{entry.effect && <small>{effectName(entry.effect)}</small>}</li>)}</ol></section><details className="panel rules-details"><summary>防火牆規則速查</summary><FirewallRuleSummary /></details>{G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective="blind" label="製作滲透戰報" />}</aside>
  </main>;
}

export function FirewallRuleSummary() { return <div className="firewall-rule-summary"><p>2～12 人，三輪競逐資產。每輪將 118 張牌洗勻、暗移 10 張，每人 6 張與一個秘密身分。</p><p>每回合四選一：放一張線路、打一張行動牌、棄 1～3 張補同數、棄兩張解除自己一項效果後抽 1 張。</p><p>線路只能旋轉 0° 或 180°，配邊一致且至少一個通道接通起點。橋與雙彎的兩路不互通；跳板連接起點與其他跳板。</p><p>器材故障或被隔離時不能放線路。目標由可達路線接觸才揭開；未翻目標不能拿來穿越。</p><p>核心連通或全員空手即結算。依身分、門與隔離決定分紅，之後執行後門。三輪資產最高者勝，同分共享。</p></div>; }

function Art({ asset, alt = '', className = '' }: { asset: string; alt?: string; className?: string }) { const src = firewallArt(asset); return src ? <img className={className} src={src} alt={alt} loading="lazy" decoding="async" /> : null; }
export function FirewallCardFace({ card, rotation = 0 }: { card: FirewallCard; rotation?: FirewallRotation }) {
  return <div className="firewall-card" data-kind={card.kind}><div className="firewall-card-visual">{card.kind === 'path' ? <><Art asset="route-base" /><FirewallTopology path={FIREWALL_PATHS[card.pathID]} rotation={rotation} /></> : <div className="firewall-action-art">{firewallActionArt(card.action).map(asset => <Art key={asset} asset={asset} />)}</div>}</div><b>{firewallCardName(card)}</b></div>;
}

export function FirewallNetwork({ tiles, placements = [], selected, preview, rotation = 0, onPlace, targets = {}, onTarget }: {
  tiles: FirewallTile[]; placements?: FirewallPlacement[]; selected?: { x: number; y: number } | null; preview?: FirewallCard;
  rotation?: FirewallRotation; onPlace?: (x: number, y: number) => void; targets?: Record<string, FirewallActionTarget>; onTarget?: (target: FirewallActionTarget) => void;
}) {
  const xs = tiles.map(tile => tile.x), ys = tiles.map(tile => tile.y);
  const minX = Math.min(-1, ...xs) - 1, maxX = Math.max(8, ...xs) + 1, minY = Math.min(-2, ...ys) - 1, maxY = Math.max(2, ...ys) + 1;
  const fitW = (maxX - minX + 1) * 100, fitH = (maxY - minY + 1) * 150;
  const [view, setView] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const current = view ?? { x: (minX + maxX + 1) * 50, y: (minY + maxY + 1) * 75, zoom: 1 };
  const w = fitW / current.zoom, h = fitH / current.zoom;
  const drag = useRef<{ clientX: number; clientY: number; x: number; y: number; zoom: number; ratio: number; key: string | null; moved: boolean } | null>(null);
  const selectCell = (key: string) => { if (key.startsWith('place:')) { const [, x, y] = key.split(':'); onPlace?.(Number(x), Number(y)); } else if (targets[key]) onTarget?.(targets[key]); };
  const zoom = (factor: number) => setView({ ...current, zoom: Math.max(.5, Math.min(6, current.zoom * factor)) });
  const pan = (x: number, y: number) => setView({ ...current, x: current.x + x * w * .2, y: current.y + y * h * .2 });
  return <div className="firewall-network"><div className="firewall-network-toolbar" aria-label="網格視野控制"><div><button type="button" onClick={() => zoom(1.3)} aria-label="放大網格">＋</button><button type="button" onClick={() => zoom(1 / 1.3)} aria-label="縮小網格">−</button><button type="button" onClick={() => setView(null)}>適配全圖</button><button type="button" onClick={() => setView({ ...current, x: 50, y: 75 })}>回起點</button></div><div aria-label="平移網格"><button type="button" aria-label="向左平移" onClick={() => pan(-1, 0)}>←</button><button type="button" aria-label="向上平移" onClick={() => pan(0, -1)}>↑</button><button type="button" aria-label="向下平移" onClick={() => pan(0, 1)}>↓</button><button type="button" aria-label="向右平移" onClick={() => pan(1, 0)}>→</button></div></div>
    <svg className="firewall-grid" viewBox={`${current.x - w / 2} ${current.y - h / 2} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="可拖曳的無邊界網格，使用按鈕縮放及平移"
      onPointerDown={event => { if (event.button !== 0) return; const rect = event.currentTarget.getBoundingClientRect(); drag.current = { clientX: event.clientX, clientY: event.clientY, x: current.x, y: current.y, zoom: current.zoom, ratio: Math.max(w / rect.width, h / rect.height), key: (event.target as Element).closest('[data-firewall-cell]')?.getAttribute('data-firewall-cell') ?? null, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (!drag.current) return; const d = drag.current, dx = event.clientX - d.clientX, dy = event.clientY - d.clientY; if (Math.abs(dx) + Math.abs(dy) < 4 && !d.moved) return; d.moved = true; setView({ x: d.x - dx * d.ratio, y: d.y - dy * d.ratio, zoom: d.zoom }); }}
      onPointerUp={event => { const d = drag.current; drag.current = null; if (d && !d.moved && d.key) selectCell(d.key); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}>
      {Array.from({ length: maxX - minX + 2 }, (_, i) => <path key={`v${i}`} d={`M${(minX + i) * 100} ${minY * 150} V${(maxY + 1) * 150}`} className="firewall-grid-line" />)}
      {Array.from({ length: maxY - minY + 2 }, (_, i) => <path key={`h${i}`} d={`M${minX * 100} ${(minY + i) * 150} H${(maxX + 1) * 100}`} className="firewall-grid-line" />)}
      {placements.map(position => <g key={`${position.x}:${position.y}`} transform={`translate(${position.x * 100} ${position.y * 150})`} className="firewall-grid-candidate" data-selected={selected?.x === position.x && selected?.y === position.y} data-firewall-cell={`place:${position.x}:${position.y}`} role="button" tabIndex={0} aria-label={`合法位置 ${position.x}, ${position.y}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPlace?.(position.x, position.y); } }}><rect x={4} y={4} width={92} height={142} rx={8} /><text x={50} y={71} textAnchor="middle">＋</text><text x={50} y={95} textAnchor="middle" fontSize={13}>{position.x}, {position.y}</text></g>)}
      {tiles.map(tile => { const topology = firewallTileTopology(tile), hidden = tile.kind === 'goal' && !tile.revealed; const art = hidden ? 'card-back' : tile.kind === 'start' ? 'nodes/start' : tile.kind === 'goal' ? tile.pathID === 'goal_gold' ? 'nodes/core' : 'nodes/decoy' : 'route-base'; const src = firewallArt(art); return <g key={tile.id} transform={`translate(${tile.x * 100} ${tile.y * 150})`} className="firewall-grid-tile" data-kind={tile.kind} data-targetable={!!targets[tile.id]} data-firewall-cell={targets[tile.id] ? tile.id : undefined} role={targets[tile.id] ? 'button' : 'img'} tabIndex={targets[tile.id] ? 0 : undefined} aria-label={`${hidden ? '未知目標' : tile.pathID ? firewallPathName(FIREWALL_PATHS[tile.pathID]) : '線路'} ${tile.x}, ${tile.y}`} onKeyDown={event => { if (targets[tile.id] && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onTarget?.(targets[tile.id]); } }}><rect x={1} y={1} width={98} height={148} rx={7} />{src && <image href={src} width={100} height={150} preserveAspectRatio="xMidYMid meet" className={hidden ? 'firewall-node-back' : 'firewall-tile-art'} />}{topology && !hidden && <FirewallTopology path={topology} decorative />}<text x={hidden ? 50 : 5} y={141} textAnchor={hidden ? "middle" : "start"} className="firewall-tile-label">{hidden ? '未知目標' : tile.kind === 'start' ? '起點' : tile.kind === 'goal' ? tile.pathID === 'goal_gold' ? '核心' : '空' : `${tile.x},${tile.y}`}</text></g>; })}
      {selected && preview?.kind === 'path' && <g transform={`translate(${selected.x * 100} ${selected.y * 150})`} className="firewall-grid-preview" pointerEvents="none"><rect x={2} y={2} width={96} height={146} rx={8} /><FirewallTopology path={FIREWALL_PATHS[preview.pathID]} rotation={rotation} decorative /></g>}
    </svg><p className="firewall-network-note">拖曳空間可平移；閃框是可操作位置。線路可向四方延伸，未知目標不提供隱藏連線提示。</p>
  </div>;
}
