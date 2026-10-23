import { useContext, useEffect, useRef, useState } from 'react';
import type { TuringQuestion } from '../games/turing/rules';
import { QUESTION_ASPECTS, type QuestionAspect } from '../games/turing/feedback';
import { isPlayer, rateTuringQuestion, type TuringQuestionRating } from './api';
import { RoomContext } from './room-context';
import './turing-question-feedback.css';

const aspectLabels = { topic: '題目主題', low: '1 的敘述', high: '10 的敘述' };

export function TuringQuestionFeedback({ question, round }: { question: TuringQuestion; round: number }) {
  const context = useContext(RoomContext);
  const [rating, setRating] = useState<TuringQuestionRating | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [aspect, setAspect] = useState<QuestionAspect>('topic');
  const sending = useRef(false);
  const identity = JSON.stringify([context?.info.matchID, context?.seat.credentials, round, question]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const seat = context?.seat;
  const matchID = context?.info.matchID;
  useEffect(() => {
    let active = true;
    setRating(null); setError(''); setPending(false); sending.current = false;
    if (seat && isPlayer(seat) && matchID) {
      setPending(true);
      rateTuringQuestion(seat, matchID, round, question)
        .then(value => { if (active && currentIdentity.current === identity) setRating(value); })
        .catch(() => { if (active && currentIdentity.current === identity) setError('暫時無法讀取評分，點選可重試。'); })
        .finally(() => { if (active && currentIdentity.current === identity) setPending(false); });
    }
    return () => { active = false; };
  }, [identity, seat?.credentials]);
  const selected = rating?.ratings[aspect];
  if (!context || !seat || !isPlayer(seat) || !matchID) return null;
  async function rate(vote: 'up' | 'down') {
    if (pending || sending.current || !seat || !isPlayer(seat) || !matchID) return;
    sending.current = true; setPending(true); setError('');
    try {
      const value = await rateTuringQuestion(seat, matchID, round, question, aspect, selected?.vote === vote ? null : vote);
      if (currentIdentity.current === identity) setRating(value);
    } catch (error) {
      if (currentIdentity.current === identity) setError(error instanceof Error ? error.message : '評分未儲存，請重試。');
    } finally { if (currentIdentity.current === identity) { sending.current = false; setPending(false); } }
  }
  return <div className="turing-question-feedback" aria-label="題目評分">
    <label className="turing-feedback-target">評分
      <select aria-label="評分項目" value={aspect} onChange={event => { setAspect(event.target.value as QuestionAspect); setError(''); }}>
        {QUESTION_ASPECTS.map(key => <option key={key} value={key}>{aspectLabels[key]}</option>)}
      </select>
    </label>
    <button type="button" className={selected?.vote === 'up' ? 'is-selected' : ''}
      aria-label={`讚${aspectLabels[aspect]}`} aria-pressed={selected?.vote === 'up'} disabled={pending} onClick={() => void rate('up')}>
      <span aria-hidden="true">👍</span> 讚{selected ? ` ${selected.up}` : ''}
    </button>
    <button type="button" className={selected?.vote === 'down' ? 'is-selected' : ''}
      aria-label={`倒讚${aspectLabels[aspect]}`} aria-pressed={selected?.vote === 'down'} disabled={pending} onClick={() => void rate('down')}>
      <span aria-hidden="true">👎</span> 倒讚{selected ? ` ${selected.down}` : ''}
    </button>
    {rating?.scope === 'test' && <small>測試評分</small>}
    {rating?.scope === 'match' && <small>本局自訂題評分</small>}
    {error && <small role="status">{error}</small>}
  </div>;
}
