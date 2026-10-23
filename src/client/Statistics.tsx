import { useEffect, useState, type CSSProperties } from 'react';
import { api } from './api';
import { clientGames } from './game-registry';
import { ErrorMessage } from './ui';
import './statistics.css';

export interface GameStatistics {
  gameId: string;
  name: string;
  completed: number;
  /** Challenge runs count toward site participation, not the win-rate denominator. */
  rankedCompleted?: number;
  draws?: number;
  wins: Record<string, number>;
  byPlayerCount: { numPlayers: number; completed: number; draws?: number; wins: Record<string, number> }[];
  reasons: Record<string, number>;
  challenges?: { mode: string; numPlayers: number; startingLives: number; runs: number; bestCompletedRounds: number; averageCompletedRounds: number }[];
}
interface StatisticsData { completedGames: number; totalPlayerParticipations: number; byGame: GameStatistics[]; }

export function factionRecord(game: Pick<GameStatistics, 'completed' | 'rankedCompleted' | 'draws' | 'wins'>, faction: string) {
  const ranked = Math.max(0, Math.min(game.completed, game.rankedCompleted ?? game.completed));
  const draws = Math.max(0, Math.min(ranked, game.draws ?? 0));
  const decided = Math.max(0, ranked - draws);
  const wins = game.wins[faction] || 0;
  return { wins, losses: Math.max(0, decided - wins), draws, rate: decided ? Math.round(wins / decided * 100) : 0 };
}

export function ChallengeStandings({ challenges }: { challenges: NonNullable<GameStatistics['challenges']> }) {
  if (!challenges.length) return null;
  return <section className="challenge-statistics">
    <h4>無盡挑戰成績</h4><p className="small muted">只比較相同人數與起始生命；成績採完整通過的關數，不算入五關模式勝敗。</p>
    <div className="table-scroll"><table><caption className="visually-hidden">無盡挑戰各組成績</caption>
      <thead><tr><th>玩家</th><th>起始生命</th><th>挑戰局數</th><th>最高通關</th><th>平均通關</th></tr></thead>
      <tbody>{challenges.map(row => <tr key={`${row.mode}-${row.numPlayers}-${row.startingLives}`}>
        <td>{row.numPlayers} 人</td><td>{row.startingLives} 點</td><td>{row.runs}</td><td>{row.bestCompletedRounds} 關</td><td>{row.averageCompletedRounds} 關</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}

function FactionStandings({ game, factions }: { game: GameStatistics; factions: string[] }) {
  const definition = clientGames[game.gameId];
  const records = factions.map(faction => ({
    faction, label: definition?.factionLabels[faction] || faction, ...factionRecord(game, faction),
  }));
  if (!definition || definition.cooperative || records.length !== 2) {
    return <div className="faction-statistics">{records.map(record => <div key={record.faction}>
      <strong>{record.label}</strong>
      <span className="mint">{record.wins} 勝 <span className="muted">/ {record.losses} 敗</span></span>
      <div className="progress-track"><span style={{ width: `${record.rate}%` }} /></div>
      <small>{record.rate}% 勝率{record.draws > 0 && `（不含 ${record.draws} 局平局）`}</small>
    </div>)}</div>;
  }
  const [left, right] = records;
  const decided = left.wins + right.wins;
  // Use the actual ratio, not rounded percentage labels, for a continuous bar.
  const point = decided ? left.wins / decided * 100 : 50;
  const leftRateTenths = Math.round(point * 10);
  const rates = [leftRateTenths / 10, (1000 - leftRateTenths) / 10];
  return <div className="faction-duel" data-empty={decided === 0}
    data-contested={left.wins > 0 && right.wins > 0}
    style={{ '--clash-point': `${point}%` } as CSSProperties}>
    <div className="faction-duel-scoreboard">{records.map((record, index) => <div
      className={`faction-duel-side faction-duel-side--${index === 0 ? 'left' : 'right'}`} key={record.faction}>
      <strong className="faction-duel-name">{record.label}</strong>
      <div className="faction-duel-record"><span className="faction-duel-wins">{record.wins}<small>勝</small></span>
        <span className="faction-duel-losses">/ {record.losses} 敗</span></div>
      <small className="faction-duel-rate">{decided ? `${rates[index]}% 勝率` : '尚無勝敗資料'}</small>
    </div>)}</div>
    <div className="faction-clash" aria-hidden="true">
      <div className="faction-clash-track">
        <span className="faction-wave faction-wave--left" />
        <span className="faction-wave faction-wave--right" />
      </div>
      <span className="faction-clash-contact"><span className="faction-clash-core" />
        <i /><i /><i /><i /><i /><i />
      </span>
    </div>
    {left.draws > 0 && <p className="faction-duel-note">{left.draws} 局平局不計入勝率與交鋒比例。</p>}
  </div>;
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
  return <section className="statistics-section panel">
    <div className="section-heading"><div><div className="section-label">MISSION ARCHIVE</div><h2>這裡的每一場任務</h2></div><button className="text-button" onClick={() => setRevision(n => n + 1)}>更新統計</button></div>
    <p className="small muted">全站已完成的對局與勝敗；無盡挑戰另記通關成績，觀戰不計入參與人次。</p>
    <ErrorMessage>{error}</ErrorMessage>
    {!data && !error && <p className="small muted" role="status">正在讀取統計…</p>}
    {data && <>
      <div className="site-totals"><div><strong>{data.completedGames.toLocaleString()}</strong><span>完成對局</span></div><div><strong>{data.totalPlayerParticipations.toLocaleString()}</strong><span>玩家參與人次</span></div></div>
      {data.completedGames === 0 && <p className="small muted">第一場任務完成後，這裡就會開始累積戰績。</p>}
      {data.byGame.map(game => {
        const definition = clientGames[game.gameId];
        const factions = Object.keys(definition?.factionLabels || game.wins).filter(faction => faction !== 'draw');
        const hasChallenges = Boolean(game.challenges?.length);
        return <article className="game-statistics" key={game.gameId}>
          <div className="section-heading"><h3>{game.name}</h3><span>{game.completed} 局{(game.draws ?? 0) > 0 && ` · ${game.draws} 平局`}</span></div>
          {hasChallenges && <p className="small muted">五關模式：{game.rankedCompleted ?? game.completed} 局</p>}
          <FactionStandings game={game} factions={factions} />
          <ChallengeStandings challenges={game.challenges ?? []} />
          <details className="statistics-details"><summary>{hasChallenges ? '五關模式：依玩家人數與結束原因查看' : '依玩家人數與結束原因查看'}</summary>
            <div className="table-scroll"><table><caption className="visually-hidden">{game.name} 各人數陣營勝利次數</caption>
              <thead><tr><th>人數</th><th>完成局數</th><th>平局</th>{factions.map(faction => <th key={faction}>{definition?.factionLabels[faction] || faction}勝</th>)}</tr></thead>
              <tbody>{[...game.byPlayerCount].sort((a, b) => a.numPlayers - b.numPlayers).map(row => <tr key={row.numPlayers}><td>{row.numPlayers} 人</td><td>{row.completed}</td><td>{row.draws ?? 0}</td>{factions.map(faction => <td key={faction}>{row.wins[faction] || 0}</td>)}</tr>)}</tbody>
            </table></div>
            <ul className="reason-stats">{Object.entries(game.reasons).map(([reason, count]) => <li key={reason}><span>{definition?.reasonLabels[reason] || reason}</span><strong>{count} 局</strong></li>)}</ul>
          </details>
        </article>;
      })}
    </>}
  </section>;
}
