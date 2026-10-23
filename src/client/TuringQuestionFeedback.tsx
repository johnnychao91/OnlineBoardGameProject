import { useContext, useEffect, useRef, useState } from 'react';
import type { TuringQuestion } from '../games/turing/rules';
import { isPlayer, rateTuringQuestion, type TuringQuestionRating } from './api';
import { RoomContext } from './room-context';
import './turing-question-feedback.css';

export function TuringQuestionFeedback({ question, round }: { question: TuringQuestion; round: number }) {
  const context = useContext(RoomContext);
  const [rating, setRating] = useState<TuringQuestionRating | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const identity = JSON.stringify([context?.info.matchID, round, question]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const seat = context?.seat;
  const matchID = context?.info.matchID;
  useEffect(() => {
    let active = true;
    setRating(null); setError(''); setPending(false);
    if (seat && isPlayer(seat) && matchID) {
      setPending(true);
      rateTuringQuestion(seat, matchID, round, question)
        .then(value => { if (active && currentIdentity.current === identity) setRating(value); })
        .catch(() => { if (active && currentIdentity.current === identity) setError('暫時無法讀取評分，點選可重試。'); })
        .finally(() => { if (active && currentIdentity.current === identity) setPending(false); });
    }
    return () => { active = false; };
  }, [identity, seat?.credentials]);
  if (!context || !seat || !isPlayer(seat) || !matchID) return null;
  async function rate(vote: 'up' | 'down') {
    if (pending || !seat || !isPlayer(seat) || !matchID) return;
    setPending(true); setError('');
    try {
      const value = await rateTuringQuestion(seat, matchID, round, question, rating?.vote === vote ? null : vote);
      if (currentIdentity.current === identity) setRating(value);
    } catch (error) {
      if (currentIdentity.current === identity) setError(error instanceof Error ? error.message : '評分未儲存，請重試。');
    } finally { if (currentIdentity.current === identity) setPending(false); }
  }
  return <div className="turing-question-feedback" aria-label="題目評分">
    <span>這題如何？</span>
    <button type="button" className={rating?.vote === 'up' ? 'is-selected' : ''}
      aria-label="讚這題" aria-pressed={rating?.vote === 'up'} disabled={pending} onClick={() => void rate('up')}>
      <span aria-hidden="true">👍</span> 讚{rating ? ` ${rating.up}` : ''}
    </button>
    <button type="button" className={rating?.vote === 'down' ? 'is-selected' : ''}
      aria-label="倒讚這題" aria-pressed={rating?.vote === 'down'} disabled={pending} onClick={() => void rate('down')}>
      <span aria-hidden="true">👎</span> 倒讚{rating ? ` ${rating.down}` : ''}
    </button>
    {rating?.scope === 'test' && <small>測試評分</small>}
    {rating?.scope === 'match' && <small>本局自訂題評分</small>}
    {error && <small role="status">{error}</small>}
  </div>;
}
