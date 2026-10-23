import { useEffect, useRef, useState } from 'react';
import { normalizeTuringOptions, validateTuringOptions, TURING_DECKS, TURING_CUSTOM_MAX, type TuringOptions as Options, type TuringCustomQuestion } from '../games/turing/rules';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { ErrorMessage } from './ui';
import './turing.css';

const blankQuestion = (): TuringCustomQuestion => ({ prompt: '', low: '', high: '' });
export function TuringOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const options = normalizeTuringOptions(info.gameOptions);
  const optionsKey = JSON.stringify(options);
  const [draft, setDraft] = useState(options), [question, setQuestion] = useState(blankQuestion);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sending = useRef(false), mounted = useRef(true), match = useRef(info.matchID);
  match.current = info.matchID;
  useEffect(() => { setDraft(normalizeTuringOptions(info.gameOptions)); setQuestion(blankQuestion()); setEditing(null); setError(''); }, [info.matchID, optionsKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const host = isRoomHost(seat, info), blocked = disabled || busy || !host || info.status !== 'lobby';
  const dirty = JSON.stringify(draft) !== optionsKey;
  function addQuestion() {
    try {
      const questions = [...draft.customQuestions];
      if (editing === null) questions.push(question); else questions[editing] = question;
      const next = normalizeTuringOptions({ ...draft, customQuestions: questions });
      setDraft(next); setQuestion(blankQuestion()); setEditing(null); setError('');
    } catch (cause) { setError((cause as Error).message); }
  }
  async function apply() {
    if (blocked || sending.current) return;
    const validation = validateTuringOptions(draft);
    if (validation) { setError(validation); return; }
    const submitted = info.matchID;
    sending.current = true; setBusy(true); setError(''); onBusy(true);
    try {
      const result = await api<RoomInfo>(`/api/rooms/${seat.roomId}/options`, { method: 'POST', body: JSON.stringify({ matchID: submitted, options: normalizeTuringOptions(draft) }) }, seat);
      if (mounted.current && match.current === submitted) onUpdate(result);
    } catch (cause) { if (mounted.current && match.current === submitted) setError((cause as Error).message); }
    finally { sending.current = false; if (mounted.current) { setBusy(false); onBusy(false); } }
  }
  async function importQuestions(file?: File) {
    if (!file || blocked) return;
    if (file.size > 100_000) { setError('題庫檔案最多 100 KB。'); return; }
    const submitted = info.matchID;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!mounted.current || match.current !== submitted) return;
      const next = normalizeTuringOptions({ ...draft, customQuestions: parsed });
      setDraft(next); setQuestion(blankQuestion()); setEditing(null); setError('');
    } catch (cause) { if (mounted.current && match.current === submitted) setError(`匯入失敗：${(cause as Error).message}`); }
  }
  function exportQuestions() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft.customQuestions, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'turing-custom-questions.json'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel turing-options" aria-label="圖靈測試房規"><h3>選擇本次測試題庫</h3>
    <label>題庫模式<select value={draft.deck} disabled={blocked} onChange={event => setDraft({ ...draft, deck: event.target.value as Options['deck'] })}>{Object.entries(TURING_DECKS).map(([id, name]) => <option key={id} value={id}>{name}{id === 'standard' ? ' · 1,000 題' : id === 'protocol' ? ' · 1,000 題 · 成人向' : id === 'mixed' ? ' · 2,000 題 · 含成人向' : ''}</option>)}</select></label>
    <p className="small muted">{draft.deck === 'protocol' || draft.deck === 'mixed' ? '失控協定含成人曖昧、社交尷尬與黑色幽默，請由成年且接受此風格的朋友一起玩。所有情境都可以虛構，無需分享私事。' : '人性校準涵蓋生活、想像與人類情緒；所有題目都能用文字作答，不需要開鏡頭或表演。'}</p>
    <p className="small">4～9 人全員合作，共五輪。檢測員輪流擔任；故事中的機器人不是玩家的秘密身分。</p>
    <details><summary>自訂題目 · {draft.customQuestions.length} / {TURING_CUSTOM_MAX} 題</summary>
      <p className="small muted">自訂題目會混入所選內建題庫；同題幹採自訂版本，不重複抽取。選「自訂題庫」可只玩自己的題目，至少需 5 題。內容會提供房間成員查看，請勿填入密碼或私人資料。</p>
      {host && <div className="turing-custom-editor"><h4>{editing === null ? '新增一道題目' : `編輯第 ${editing + 1} 題`}</h4>
        <label>題目（5～200 字）<textarea value={question.prompt} maxLength={200} disabled={blocked} onChange={event => setQuestion({ ...question, prompt: event.target.value })} placeholder="例如：替一台第一次放假的機器人寫下今天的行程。" /></label>
        <label>1 代表甚麼？<input value={question.low} maxLength={50} disabled={blocked} onChange={event => setQuestion({ ...question, low: event.target.value })} placeholder="最像還在上班" /></label>
        <label>10 代表甚麼？<input value={question.high} maxLength={50} disabled={blocked} onChange={event => setQuestion({ ...question, high: event.target.value })} placeholder="最懂得享受假期" /></label>
        <div className="button-row"><button className="button secondary" disabled={blocked || (editing === null && draft.customQuestions.length >= TURING_CUSTOM_MAX)} onClick={addQuestion}>{editing === null ? '加入題目清單' : '更新這道題目'}</button>{editing !== null && <button className="text-button" disabled={blocked} onClick={() => { setEditing(null); setQuestion(blankQuestion()); }}>取消編輯</button>}</div>
      </div>}
      <ol className="turing-custom-list">{draft.customQuestions.map((item, index) => <li key={index}><p><strong>{index + 1}. {item.prompt}</strong><br />1：{item.low} ／ 10：{item.high}</p>{host && <div className="button-row"><button className="button secondary" disabled={blocked} onClick={() => { setQuestion({ ...item }); setEditing(index); }}>編輯第 {index + 1} 題</button><button className="button secondary" disabled={blocked} onClick={() => { setDraft({ ...draft, customQuestions: draft.customQuestions.filter((_, i) => i !== index) }); setEditing(null); setQuestion(blankQuestion()); }}>移除第 {index + 1} 題</button></div>}</li>)}</ol>
      <div className="button-row"><button className="button secondary" disabled={!draft.customQuestions.length || busy} onClick={exportQuestions}>下載自訂題庫</button></div>
      {host && <label className="turing-import-label small">匯入 JSON 題庫（取代尚未套用的清單）<input type="file" accept=".json,application/json" disabled={blocked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importQuestions(file); }} /></label>}
      <p className="small muted">每題包含 prompt（題目）、low（1 的端點）、high（10 的端點）。可以先下載一份範例，再編輯及匯入；匯入後仍需套用設定。</p>
    </details>
    {host && <button className="button primary full" disabled={blocked || !dirty} onClick={() => void apply()}>{busy ? '儲存中…' : '套用題庫設定'}</button>}
    <p className="small muted">{host ? '變更後請按套用；會清除全員準備，開局後題庫固定。自訂題目儲存在此房間，下載檔案可留作下次使用。' : '由房主選擇題庫；設定更新後請重新準備。'}</p><ErrorMessage>{error}</ErrorMessage>
  </section>;
}
