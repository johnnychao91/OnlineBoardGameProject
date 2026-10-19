import { useContext, useEffect, useRef, useState } from 'react';
import type { StationState } from '../games/station/game';
import { isPlayer } from './api';
import { RoomContext } from './room-context';
import { Icon, navigate } from './ui';
import { BattleReport } from './BattleReport';

type BoardProps = {
  G: StationState;
  playerID: string | null;
  isConnected?: boolean;
  moves: Record<string, (...args: any[]) => any>;
};
export const roleNames = { engineer: '維修員', saboteur: '干擾者' };
export const cardNames = { stable: '穩定設備', repair: '維修模組', hazard: '反應爐危機' };
export function initials(name: string) { return Array.from(name || '?').slice(0, 1).join(''); }

export function StationBoard({ G, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const [selection, setSelection] = useState<{ targetID: string; slot: number } | null>(null);
  const [privateVisible, setPrivateVisible] = useState(false);

  const modal = useRef<HTMLDialogElement>(null);
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const mine = G.private?.[id];
  const own = G.players[id];

  const nameOf = (target: string) => info.players.find(p => String(p.id) === target)?.name || `隊員 ${Number(target) + 1}`;

  const myTurn = G.status === 'playing' && G.activePlayer === id;
  const canAct = isConnected !== false;
  useEffect(() => { setSelection(null); }, [G.round, G.log.length, G.activePlayer]);
  useEffect(() => {
    if (selection && modal.current && !modal.current.open) modal.current.showModal();
    if (!selection && modal.current?.open) modal.current.close();
  }, [selection]);
  useEffect(() => {
    const hide = () => { if (document.hidden) setPrivateVisible(false); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  const roles = <div className="role-reveal-grid">{Object.keys(G.players).map(pid => <div key={pid}><span className={`avatar ${pid === id ? 'mine' : ''}`}>{initials(nameOf(pid))}</span><strong>{nameOf(pid)}{pid === id && '（你）'}</strong><span className={G.players[pid].revealedRole === 'saboteur' ? 'amber' : 'mint'}>{roleNames[G.players[pid].revealedRole || 'engineer']}</span></div>)}</div>;

  return <><div className={`connection-banner ${canAct ? '' : 'offline'}`} role="status"><Icon type="signal" size={15} />{canAct ? '即時連線中' : '連線中斷，正在自動重連。請保留這個頁面。'}</div>{G.status === 'finished' ? <main className="narrow results"><div className={`result-emblem ${G.winner === 'saboteur' ? 'sabotage' : ''}`}><Icon type="orbit" size={58} /></div><div className="eyebrow">MISSION COMPLETE</div><h1>{G.winner === 'engineer' ? '維修完成。平安返航。' : '任務中斷。暗流得逞。'}</h1><p className="result-winner">{G.winner ? roleNames[G.winner] : '任務'}陣營獲勝</p><p className="muted">{G.winReason === 'all-repairs' ? '所有維修模組都已找出，維修站恢復運作。' : G.winReason === 'hazard' ? '反應爐危機被揭開，太空維修站停止運作。' : '四輪結束，仍有維修模組沒有找到。'}</p><div className="result-stats"><div><strong>{G.repairsFound} / {G.repairsRequired}</strong><span>完成維修</span></div><div><strong>{G.round} / 4</strong><span>任務輪次</span></div></div><section className="panel"><div className="section-heading"><h2>揭曉真正的隊友</h2><Icon type="orbit" /></div>{roles}</section><button className="button primary full" onClick={() => navigate('/')}>回到大廳，開新的一桌<Icon type="arrow" /></button><p className="small muted">下一局使用全新房間與邀請，重新集合即可。</p><BattleReport G={G} info={info} perspective="blind" label="製作本局戰報圖" /><Log G={G} nameOf={nameOf} /></main> : <main className="game-layout"><section className="game-main"><div className="game-title"><div><div className="eyebrow">SPACE MAINTENANCE</div><h1>太空維修站</h1></div><span className="round-badge">第 <strong>{G.round}</strong> / 4 輪</span></div><section className="mission-progress"><div><span>已完成維修</span><strong>{G.repairsFound}<small> / {G.repairsRequired}</small></strong></div><div className="progress-track" role="progressbar" aria-label="完成維修" aria-valuenow={G.repairsFound} aria-valuemin={0} aria-valuemax={G.repairsRequired}><span style={{ width: `${Math.min(100, G.repairsFound / Math.max(1, G.repairsRequired) * 100)}%` }} /></div><p>本輪已揭開 {G.revealsThisRound} / {info.numPlayers} 張</p></section><section className={`turn-notice ${myTurn ? 'your-turn' : ''}`}><span className="status-dot" /><div><strong>{G.status === 'briefing' ? '先確認你的任務資訊' : myTurn ? '輪到你決定了' : `等待 ${nameOf(G.activePlayer || '')} 選擇`}</strong><p>{G.status === 'briefing' ? '每輪重新洗牌，所有人確認後繼續。' : myTurn ? '討論後，選擇其他隊員的一張暗牌。' : '可以繼續討論，你的推理很重要。'}</p></div></section><section className="panel private-panel"><button className="private-toggle" onClick={() => setPrivateVisible(!privateVisible)} aria-expanded={privateVisible}><span><Icon type="shield" /><strong>我的秘密資訊</strong><small>只有你看得到</small></span><span>{privateVisible ? '收起 −' : '查看 +'}</span></button>{privateVisible && mine && <div className="private-content"><div className={`role-card ${mine.role}`}><span>你的身份</span><strong>{roleNames[mine.role]}</strong><p>{mine.role === 'engineer' ? '找齊所有維修模組，讓維修站恢復運作。' : '讓反應爐危機被揭開，或讓維修模組留到四輪結束。'}</p></div><p className="small muted">目前剩餘設備組成</p><div className="composition"><div><strong>{mine.composition.stable}</strong><span>穩定設備</span></div><div className="mint"><strong>{mine.composition.repair}</strong><span>維修模組</span></div><div className="amber"><strong>{mine.composition.hazard}</strong><span>反應爐危機</span></div></div><p className="small muted">你知道數量，不知道暗牌的排列位置。</p></div>}{G.status === 'briefing' && <div className="briefing-action"><button className="button primary full" disabled={!canAct || own?.acknowledged} onClick={() => { moves.acknowledge(); setPrivateVisible(false); }}>{own?.acknowledged ? '已確認，等待其他隊員' : '我已看過資訊，準備繼續'}</button><p className="small muted center">{Object.values(G.players).filter(p => p.acknowledged).length} / {info.numPlayers} 位已確認</p></div>}</section><section className="table"><div className="section-heading"><h2>隊員的設備</h2><span className="small muted">不知牌面，也不知順序</span></div>{Object.entries(G.players).map(([pid, p]) => <article key={pid} className={`player-modules ${pid === id ? 'self' : ''} ${G.activePlayer === pid ? 'active-player' : ''}`}><div className="module-player"><span className={`avatar ${pid === id ? 'mine' : ''}`}>{initials(nameOf(pid))}</span><strong>{nameOf(pid)}{pid === id && <small className="you-label">你</small>}</strong>{G.activePlayer === pid && <span className="actor-tag">選擇中</span>}<span className="remaining">{p.cardCount} 張</span></div><div className="module-cards">{Array.from({ length: p.cardCount }, (_, slot) => <button key={slot} disabled={!canAct || !myTurn || pid === id} className="module-card" aria-label={`選擇${nameOf(pid)}的第 ${slot + 1} 張暗牌`} onClick={() => setSelection({ targetID: pid, slot })}><Icon type="orbit" size={22} /><span>{String(slot + 1).padStart(2, '0')}</span></button>)}{p.cardCount === 0 && <p className="small muted empty-cards">設備已全部揭開</p>}</div></article>)}</section></section><aside className="game-aside"><Log G={G} nameOf={nameOf} /><details className="panel rules-details"><summary>任務規則速查</summary><RuleSummary /></details></aside><dialog ref={modal} onCancel={() => setSelection(null)} onClose={() => setSelection(null)} className="confirm-dialog"><div className="eyebrow">CONFIRM YOUR CHOICE</div><h2>就檢查這個設備？</h2><p>揭開 <strong>{selection ? nameOf(selection.targetID) : ''}</strong> 的第 <strong>{(selection?.slot || 0) + 1}</strong> 張暗牌。</p><p className="muted small">確認後會公開結果，並由對方接手下一次選擇。</p><div className="button-row"><button className="button secondary" autoFocus onClick={() => setSelection(null)}>再想一下</button><button className="button primary" disabled={!canAct || !myTurn} onClick={() => { if (selection) moves.reveal(selection.targetID, selection.slot); setSelection(null); }}>確認檢查</button></div></dialog></main>}</>;
}

export function Log({ G, nameOf }: { G: StationState; nameOf: (id: string) => string }) {
  return <section className="panel event-log"><div className="section-heading"><h2>任務紀錄</h2><span className="small muted">公開資訊</span></div>{G.log.length ? <ol>{[...G.log].reverse().slice(0, 32).map((entry, index) => <li key={`${G.log.length - index}`}><span className={`log-dot ${entry.kind}`} /><div><p><strong>{nameOf(entry.actorID)}</strong> 檢查了 {nameOf(entry.targetID)} 的設備</p><span className={entry.kind === 'repair' ? 'mint' : entry.kind === 'hazard' ? 'amber' : 'muted'}>{cardNames[entry.kind]}</span><small>第 {entry.round} 輪</small></div></li>)}</ol> : <p className="muted small">第一次檢查後，結果會出現在這裡。</p>}</section>;
}

export function RuleSummary() {
  return <div className="rule-summary"><p>每位隊員有秘密陣營。維修員要找齊所有維修模組；干擾者要讓反應爐危機被揭開，或讓維修拖過第四輪。</p><p>每輪先查看自己的設備組成。暗牌會洗亂，連本人也不知道位置。大家可以自由討論，說實話、保留資訊或說謊。</p><p>持有選擇權的人揭開別人的一張牌，再由對方取得選擇權。每輪共揭開等同玩家人數的牌；剩餘牌重新混洗與分配，進入下一輪。</p><p>穩定設備沒有特殊效果；維修模組累計維修進度；反應爐危機一揭開，干擾者立刻獲勝。所有維修模組都找到，維修員立刻獲勝。</p></div>;
}
