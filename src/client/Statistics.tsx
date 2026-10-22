import { useEffect, useState } from 'react';
import { api } from './api';
import { clientGames } from './game-registry';
import { ErrorMessage } from './ui';

export interface GameStatistics {
  gameId: string;
  name: string;
  completed: number;
  draws?: number;
  wins: Record<string, number>;
  byPlayerCount: { numPlayers: number; completed: number; draws?: number; wins: Record<string, number> }[];
  reasons: Record<string, number>;
}
interface StatisticsData { completedGames: number; totalPlayerParticipations: number; byGame: GameStatistics[]; }

export function factionRecord(game: Pick<GameStatistics, 'completed' | 'draws' | 'wins'>, faction: string) {
  const draws = Math.max(0, Math.min(game.completed, game.draws ?? 0));
  const decided = Math.max(0, game.completed - draws);
  const wins = game.wins[faction] || 0;
  return { wins, losses: Math.max(0, decided - wins), draws, rate: decided ? Math.round(wins / decided * 100) : 0 };
}

export function Statistics() {
  const [data, setData] = useState<StatisticsData | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<StatisticsData>('/api/stats', { signal: controller.signal }).then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [revision]);
  return <section className="statistics-section panel"><div className="section-heading"><div><div className="section-label">MISSION ARCHIVE</div><h2>這裡的每一場任務</h2></div><button className="text-button" onClick={() => setRevision(n => n + 1)}>更新統計</button></div><p className="small muted">全站已完成的對局與勝敗；合作遊戲記錄全隊成敗，觀戰不計入參與人次。</p><ErrorMessage>{error}</ErrorMessage>{!data && !error && <p className="small muted" role="status">正在讀取統計…</p>}{data && <><div className="site-totals"><div><strong>{data.completedGames.toLocaleString()}</strong><span>完成對局</span></div><div><strong>{data.totalPlayerParticipations.toLocaleString()}</strong><span>玩家參與人次</span></div></div>{data.completedGames === 0 && <p className="small muted">第一場任務完成後，這裡就會開始累積戰績。</p>}{data.byGame.map(game => { const definition = clientGames[game.gameId]; const factions = Object.keys(definition?.factionLabels || game.wins).filter(faction => faction !== 'draw'); return <article className="game-statistics" key={game.gameId}><div className="section-heading"><h3>{game.name}</h3><span>{game.completed} 局{(game.draws ?? 0) > 0 && ` · ${game.draws} 平局`}</span></div><div className="faction-statistics">{factions.map(faction => { const { wins, losses, draws, rate } = factionRecord(game, faction); return <div key={faction} className={game.gameId === 'space-station' && faction === 'saboteur' ? 'saboteur-statistics' : undefined}><strong>{definition?.factionLabels[faction] || faction}</strong><span className="mint">{wins} 勝 <span className="muted">/ {losses} 敗</span></span><div className="progress-track"><span style={{ width: `${rate}%` }} /></div><small>{rate}% 勝率{draws > 0 && `（不含 ${draws} 局平局）`}</small></div>; })}</div><details className="statistics-details"><summary>依玩家人數與結束原因查看</summary><div className="table-scroll"><table><caption className="visually-hidden">{game.name} 各人數陣營勝利次數</caption><thead><tr><th>人數</th><th>完成局數</th><th>平局</th>{factions.map(faction => <th key={faction}>{definition?.factionLabels[faction] || faction}勝</th>)}</tr></thead><tbody>{[...game.byPlayerCount].sort((a, b) => a.numPlayers - b.numPlayers).map(row => <tr key={row.numPlayers}><td>{row.numPlayers} 人</td><td>{row.completed}</td><td>{row.draws ?? 0}</td>{factions.map(faction => <td key={faction}>{row.wins[faction] || 0}</td>)}</tr>)}</tbody></table></div><ul className="reason-stats">{Object.entries(game.reasons).map(([reason, count]) => <li key={reason}><span>{definition?.reasonLabels[reason] || reason}</span><strong>{count} 局</strong></li>)}</ul></details></article>; })}</>}</section>;
}
