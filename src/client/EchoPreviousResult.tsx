import { useEffect, useState } from 'react';
import type { EchoState } from '../games/echo/game';
import { api, type AuthSession, type RoomInfo } from './api';
import { BattleReport } from './BattleReport';
import { ErrorMessage } from './ui';
import './echo.css';

interface FinalEchoReplay { G: EchoState; room: RoomInfo }

export function EchoPreviousResult({ seat, matchID }: { seat: AuthSession; matchID: string }) {
  const [result, setResult] = useState<FinalEchoReplay>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<FinalEchoReplay>(`/api/rooms/${seat.roomId}/replay?matchID=${encodeURIComponent(matchID)}&final=1`, { signal: controller.signal }, seat)
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch(() => { if (!controller.signal.aborted) setError('暫時無法讀取上一局的逐輪詞鏈。'); });
    return () => controller.abort();
  }, [seat.roomId, seat.credentials, matchID, attempt]);

  if (error) return <><ErrorMessage>{error}</ErrorMessage><button className="text-button" onClick={() => {
    setError('');
    setAttempt(value => value + 1);
  }}>重新讀取詞鏈</button></>;
  if (!result) return <p className="small muted" role="status">正在讀取上一局的詞鏈…</p>;

  const { G, room } = result;
  const finalRound = G.history.at(-1);
  const revealedWords = Object.values(finalRound?.words ?? {});
  const matchedWords = G.result === 'same-word' ? revealedWords.slice(0, 1)
    : G.result === 'same-meaning' ? [...new Set(revealedWords)] : [];

  return <div className="echo-previous-result">
    {matchedWords.length > 0 && <div className="echo-previous-match">
      <span className="small muted">第 {finalRound?.number} 輪達成共鳴的詞</span>
      <ul>{matchedWords.map(word => <li key={word}>{word}</li>)}</ul>
    </div>}
    <BattleReport G={G} info={room} perspective="blind" />
  </div>;
}
