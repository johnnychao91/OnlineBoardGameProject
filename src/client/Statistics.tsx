import { useEffect, useState, type CSSProperties } from 'react';
import { api } from './api';
import { clientGames } from './game-registry';
import { ErrorMessage } from './ui';
import { challengeModeLabel } from './challenge-labels';
import './statistics.css';

export interface GameStatistics {
  gameId: string;
  name: string;
  completed: number;
  /** Challenges and individual competitions count toward participation, not faction win rates. */
  rankedCompleted?: number;
  draws?: number;
  wins: Record<string, number>;
  byPlayerCount: { numPlayers: number; completed: number; draws?: number; wins: Record<string, number> }[];
  reasons: Record<string, number>;
  challenges?: { mode: string; numPlayers: number; startingLives: number; runs: number; bestCompletedRounds: number; averageCompletedRounds: number }[];
  competitions?: { mode: string; numPlayers: number; runs: number; totalRounds: number; averageRounds: number; highScores?: { name: string; total: number }[]; roundHighScores?: { name: string; total: number; round: number }[] }[];
}
export interface StatisticsData { completedGames: number; totalPlayerParticipations: number; byGame: GameStatistics[]; }

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
    <h4>無盡挑戰成績</h4><p className="small muted">只比較相同玩法、人數與起始生命；成績採完整通過的關數，不算入五關模式勝敗。</p>
    <div className="table-scroll"><table><caption className="visually-hidden">無盡挑戰各組成績</caption>
      <thead><tr><th>玩法</th><th>玩家</th><th>起始生命</th><th>挑戰局數</th><th>最高通關</th><th>平均通關</th></tr></thead>
      <tbody>{challenges.map(row => <tr key={`${row.mode}-${row.numPlayers}-${row.startingLives}`}>
        <td>{challengeModeLabel(row.mode)}</td><td>{row.numPlayers} 人</td><td>{row.startingLives} 點</td><td>{row.runs}</td><td>{row.bestCompletedRounds} 關</td><td>{row.averageCompletedRounds} 關</td>
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

export function CompetitionStandings({ competitions, gameID }: { competitions: NonNullable<GameStatistics['competitions']>; gameID: string }) {
  if (!competitions.length) return null;
  const labels = clientGames[gameID]?.competitionLabels ?? { title: '個人競賽紀錄', description: '依玩法與人數記錄已完成的競賽。', roundsLabel: '平均輪數', roundUnit: '輪', modes: {} as Record<string, string> };
  return <section className="challenge-statistics">
    <h4>{labels.title}</h4><p className="small muted">{labels.description}</p>
    <div className="table-scroll"><table><caption className="visually-hidden">{labels.title}</caption>
      <thead><tr><th>玩法</th><th>玩家</th><th>完成局數</th><th>{labels.roundsLabel}</th></tr></thead>
      <tbody>{competitions.map(row => <tr key={`${row.mode}-${row.numPlayers}`}>
        <td>{labels.modes[row.mode] ?? row.mode}</td>
        <td>{row.numPlayers} 人</td><td>{row.runs} 局</td><td>{row.averageRounds} {labels.roundUnit}</td>
      </tr>)}</tbody>
    </table></div>
    {competitions.map(row => <div key={row.mode + '-' + row.numPlayers}>
      {!!row.highScores?.length && <CompetitionScoreTable title={`單局最高收益排行 · ${labels.modes[row.mode] ?? row.mode} · ${row.numPlayers} 人`} scores={row.highScores} />}
      {!!row.roundHighScores?.length && <CompetitionScoreTable title={`單幕最高收益排行 · ${labels.modes[row.mode] ?? row.mode} · ${row.numPlayers} 人`} scores={row.roundHighScores} byRound />}
    </div>)}
  </section>;
}

function CompetitionScoreTable({ title, scores, byRound = false }: { title: string; scores: { name: string; total: number; round?: number }[]; byRound?: boolean }) {
  return <section className="competition-high-scores"><h4>{title}</h4>
    <p className="small muted">{byRound ? '單幕' : '五幕合計'}收益前 10 筆，包含安全入庫贓物與珍藏價值；暱稱採該局紀錄，同名不合併。</p>
    <div className="table-scroll"><table><caption className="visually-hidden">{byRound ? '單幕' : '單局'}最高收益排行</caption>
      <thead><tr><th>名次</th><th>玩家</th>{byRound && <th>幕次</th>}<th>收益</th></tr></thead>
      <tbody>{scores.map((score, index) => <tr key={index}>
        <td>{scores.findIndex(entry => entry.total === score.total) + 1}</td><td>{score.name}</td>{byRound && <td>第 {score.round} 幕</td>}<td><strong>{score.total} 點</strong></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}

export function GameStatisticsCard({ game }: { game: GameStatistics }) {
  const definition = clientGames[game.gameId];
  const factions = Object.keys(definition?.factionLabels || game.wins).filter(faction => faction !== 'draw');
  const hasChallenges = Boolean(game.challenges?.length);
  const hasCompetitions = Boolean(game.competitions?.length);
  const hasRanked = !definition?.individualCompetition && ((game.rankedCompleted ?? game.completed) > 0 || !hasCompetitions);
  return <article className="game-statistics" key={game.gameId}>
    <div className="section-heading"><h3>{game.name}</h3><span>{game.completed} 局{(game.draws ?? 0) > 0 && ` · ${game.draws} 平局`}</span></div>
    {hasChallenges && <p className="small muted">五關模式：{game.rankedCompleted ?? game.completed} 局</p>}
    {hasCompetitions && hasRanked && <p className="small muted">{game.gameId === 'midnight-post' ? '黑函局長陣營對抗' : '陣營對抗'}：{game.rankedCompleted ?? 0} 局</p>}
    {hasRanked && <FactionStandings game={game} factions={factions} />}
    <CompetitionStandings competitions={game.competitions ?? []} gameID={game.gameId} />
    <ChallengeStandings challenges={game.challenges ?? []} />
    {hasRanked && <details className="statistics-details"><summary>{hasChallenges ? '五關模式：依玩家人數與結束原因查看' : hasCompetitions && game.gameId === 'midnight-post' ? '黑函局長：依玩家人數與結束原因查看' : '依玩家人數與結束原因查看'}</summary>
      <div className="table-scroll"><table><caption className="visually-hidden">{game.name} 各人數陣營勝利次數</caption>
        <thead><tr><th>人數</th><th>完成局數</th><th>平局</th>{factions.map(faction => <th key={faction}>{definition?.factionLabels[faction] || faction}勝</th>)}</tr></thead>
        <tbody>{[...game.byPlayerCount].sort((a, b) => a.numPlayers - b.numPlayers).map(row => <tr key={row.numPlayers}><td>{row.numPlayers} 人</td><td>{row.completed}</td><td>{row.draws ?? 0}</td>{factions.map(faction => <td key={faction}>{row.wins[faction] || 0}</td>)}</tr>)}</tbody>
      </table></div>
      <ul className="reason-stats">{Object.entries(game.reasons).map(([reason, count]) => <li key={reason}><span>{definition?.reasonLabels[reason] || reason}</span><strong>{count} 局</strong></li>)}</ul>
    </details>}
  </article>;
}

export function Statistics({ gameID }: { gameID?: string } = {}) {
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
    <div className="section-heading"><div><div className="section-label">MISSION ARCHIVE</div><h2>{gameID ? '遊戲統計' : '這裡的每一場任務'}</h2></div><button className="text-button" onClick={() => setRevision(n => n + 1)}>更新統計</button></div>
    <p className="small muted">{gameID ? '此遊戲' : '全站'}已完成的對局與勝敗；無盡挑戰及個人競賽另列紀錄，觀戰不計入參與人次。</p>
    <ErrorMessage>{error}</ErrorMessage>
    {!data && !error && <p className="small muted" role="status">正在讀取統計…</p>}
    {data && <StatisticsBody data={data} gameID={gameID} />}
  </section>;
}

/** Lobby and home render the same records; the lobby selects just one game. */
export function StatisticsBody({ data, gameID }: { data: StatisticsData; gameID?: string }) {
  if (gameID) {
    const game = data.byGame.find(game => game.gameId === gameID);
    return game ? <GameStatisticsCard game={game} /> : <p className="small muted">此遊戲尚無統計資料。</p>;
  }
  return <>
      <div className="site-totals"><div><strong>{data.completedGames.toLocaleString()}</strong><span>完成對局</span></div><div><strong>{data.totalPlayerParticipations.toLocaleString()}</strong><span>玩家參與人次</span></div></div>
      {data.completedGames === 0 && <p className="small muted">第一場任務完成後，這裡就會開始累積戰績。</p>}
      {data.byGame.map(game => <GameStatisticsCard key={game.gameId} game={game} />)}
  </>;
}
