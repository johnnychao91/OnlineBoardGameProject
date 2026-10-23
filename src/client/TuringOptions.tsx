import { useEffect, useRef, useState } from 'react';
import { normalizeTuringOptions, validateTuringOptions, TURING_DECKS, TURING_CUSTOM_MAX, type TuringOptions as Options, type TuringCustomQuestion } from '../games/turing/rules';
import { api, isRoomHost, type RoomInfo } from './api';
import type { LobbyOptionsProps } from './game-types';
import { ErrorMessage } from './ui';
import './turing.css';
import { TuringPolicySettings } from './TuringPolicySettings';

const blankQuestion = (): TuringCustomQuestion => ({ prompt: '', low: '', high: '' });
export function TuringOptions({ seat, info, disabled, onBusy, onUpdate }: LobbyOptionsProps) {
  const options = normalizeTuringOptions(info.gameOptions);
  const optionsKey = JSON.stringify(options);
  const [customQuestions, setCustomQuestions] = useState(options.customQuestions), [question, setQuestion] = useState(blankQuestion);
  const [pendingOptions, setPendingOptions] = useState<Options | null>(null);
  const [livesText, setLivesText] = useState(String(options.lives ?? 5));
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [policyBusy, setPolicyBusy] = useState(false);
  const sending = useRef(false), mounted = useRef(true), match = useRef(info.matchID);
  const request = useRef<AbortController | null>(null);
  const locks = useRef({ edits: false, request: false, policy: false });
  const callbacks = useRef({ onBusy, onUpdate }); callbacks.current = { onBusy, onUpdate };
  const previous = useRef({ roomId: seat.roomId, options });
  match.current = info.matchID;
  function lock(kind: keyof typeof locks.current, value: boolean) {
    locks.current[kind] = value;
    callbacks.current.onBusy(Object.values(locks.current).some(Boolean));
  }
  useEffect(() => {
    const next = normalizeTuringOptions(info.gameOptions), before = previous.current;
    // Saving public selectors creates a new lobby match. Keep the independent
    // custom editor unless the server actually changes the saved question list.
    if (before.roomId !== seat.roomId || JSON.stringify(before.options.customQuestions) !== JSON.stringify(next.customQuestions)) {
      setCustomQuestions(next.customQuestions); setQuestion(blankQuestion()); setEditing(null);
    }
    if (before.roomId !== seat.roomId || before.options.lives !== next.lives) setLivesText(String(next.lives ?? 5));
    previous.current = { roomId: seat.roomId, options: next };
  }, [seat.roomId, optionsKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); callbacks.current.onBusy(false); }; }, []);
  const host = isRoomHost(seat, info), blocked = disabled || busy || policyBusy || !host || info.status !== 'lobby';
  const draftLives = livesText.trim() && Number.isFinite(Number(livesText)) ? Math.max(1, Math.min(20, Math.trunc(Number(livesText)))) : 5;
  const livesDirty = livesText !== String(options.lives ?? 5);
  const customDirty = JSON.stringify(customQuestions) !== JSON.stringify(options.customQuestions);
  const editorDirty = editing !== null || Object.values(question).some(value => value !== '');
  const displayed = pendingOptions ?? options;
  useEffect(() => { lock('edits', host && (livesDirty || customDirty || editorDirty)); }, [host, livesDirty, customDirty, editorDirty]);
  function addQuestion() {
    try {
      const questions = [...customQuestions];
      if (editing === null) questions.push(question); else questions[editing] = question;
      const next = normalizeTuringOptions({ ...options, customQuestions: questions });
      setCustomQuestions(next.customQuestions); setQuestion(blankQuestion()); setEditing(null); setError('');
    } catch (cause) { setError((cause as Error).message); }
  }
  async function save(nextOptions: Options) {
    if (blocked || sending.current) return;
    const validation = validateTuringOptions(nextOptions);
    if (validation) { setError(validation); return; }
    if (JSON.stringify(nextOptions) === optionsKey) return;
    const submitted = info.matchID;
    sending.current = true; setPendingOptions(nextOptions); setBusy(true); setError(''); lock('request', true);
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const result = await api<RoomInfo>(`/api/rooms/${seat.roomId}/options`, { method: 'POST', body: JSON.stringify({ matchID: submitted, options: normalizeTuringOptions(nextOptions) }), signal: controller.signal }, seat);
      if (mounted.current && match.current === submitted) callbacks.current.onUpdate(result);
    } catch (cause) { if (mounted.current && match.current === submitted) setError(controller.signal.aborted ? '尚未確認設定已儲存，請確認連線後重試。' : (cause as Error).message); }
    finally { window.clearTimeout(timeout); request.current = null; sending.current = false; if (mounted.current) { setPendingOptions(null); setBusy(false); lock('request', false); } }
  }
  function saveLives() {
    if (blocked) return;
    setLivesText(String(draftLives));
    void save({ ...options, lives: draftLives });
  }
  function discardEdits() {
    setCustomQuestions(options.customQuestions); setQuestion(blankQuestion()); setEditing(null);
    setLivesText(String(options.lives ?? 5)); setError('');
  }
  async function importQuestions(file?: File) {
    if (!file || blocked || sending.current) return;
    if (file.size > 100_000) { setError('題庫檔案最多 100 KB。'); return; }
    const submitted = info.matchID;
    sending.current = true; setBusy(true); lock('request', true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!mounted.current || match.current !== submitted) return;
      const next = normalizeTuringOptions({ ...options, customQuestions: parsed });
      lock('edits', livesDirty || JSON.stringify(next.customQuestions) !== JSON.stringify(options.customQuestions));
      setCustomQuestions(next.customQuestions); setQuestion(blankQuestion()); setEditing(null); setError('');
    } catch (cause) { if (mounted.current && match.current === submitted) setError(`匯入失敗：${(cause as Error).message}`); }
    finally { sending.current = false; if (mounted.current) { setBusy(false); lock('request', false); } }
  }
  function exportQuestions() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(customQuestions, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'turing-custom-questions.json'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel turing-options" aria-label="圖靈測試房規"><h3>本次人性測試設定</h3>
    <div className="turing-voice-note"><strong>先連上語音，再開始遊戲</strong><p>使用語音軟體交流。本站提供題目、秘密強度與揭牌操作，不需在局內打字，也不會錄音或轉錄語音。</p></div>
    <div className="turing-mode-settings"><label>挑戰模式<select value={displayed.mode ?? 'standard'} disabled={blocked} onChange={event => void save({ ...options, mode: event.target.value as Options['mode'] })}><option value="standard">標準模式 · 五關合作</option><option value="endless">無盡模式 · 有限生命闖關</option></select></label>{displayed.mode === 'endless' && <label>起始生命<input type="number" inputMode="numeric" min={1} max={20} step={1} value={livesText} disabled={blocked} onChange={event => { lock('edits', true); setLivesText(event.target.value); }} onBlur={event => { if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.turingDiscard === 'true')) saveLives(); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveLives(); } }} /><small>1～20 點，預設 5 點；離開欄位或按 Enter 後儲存，超出範圍自動調整。</small></label>}</div>
    <p className="small">{displayed.mode === 'endless' ? `以 ${draftLives} 點生命不斷挑戰，生命不會回復；歸零時記錄已通過幾關。題庫用完會重新抽取，避免連續同題。` : '標準模式共五關。2～3 人起始 3 點生命，4～8 人等於參與人數，9～10 人起始 8 點；生命不會回復。'}</p>
    <label>排序玩法<select value={displayed.sortingMode ?? 'examiner'} disabled={blocked} onChange={event => void save({ ...options, sortingMode: event.target.value as Options['sortingMode'] })}><option value="group">群體校準 · 全員共同排序</option><option value="examiner">檢測員模式 · 輪流判讀</option></select></label>
    <p className="small muted">群體校準適用 2～10 人，每人一張牌，任何人都能移動所有卡牌；檢測員模式適用 4～10 人，由一位不抽牌的檢測員排序。2～3 人固定使用群體校準。</p>
    <TuringPolicySettings seat={seat} info={info} policies={options} disabled={disabled || busy || info.status !== 'lobby'} onUpdate={onUpdate} onBusy={value => { setPolicyBusy(value); lock('policy', value); }} />
    <label>題庫模式<select value={displayed.deck} disabled={blocked} onChange={event => void save({ ...options, deck: event.target.value as Options['deck'] })}>{Object.entries(TURING_DECKS).map(([id, name]) => <option key={id} value={id}>{name}{id === 'standard' ? ' · 1,000 題' : id === 'protocol' ? ' · 1,000 題 · 無審查' : id === 'mixed' ? ' · 2,000 題 · 含無審查' : ''}</option>)}</select></label>
    <p className="small muted">{displayed.deck === 'protocol' || displayed.deck === 'mixed' ? '失控協定含成人曖昧、社交尷尬與黑色幽默，請由成年且接受此風格的朋友一起玩。所有情境都可以虛構，無需分享私事。' : '人性校準涵蓋生活、想像與人類情緒；題目可以直接口頭作答，不需要開鏡頭或表演。'}題目若提到「寫下」，也直接說出內容即可。</p>
    <p className="small">群體校準依同意方式確認後揭牌；任何位置調整都會取消先前的排序同意。輪末依「檢查完畢下一題」的同意方式換關。所有玩家同隊，機器人只是故事背景。</p>
    <details><summary>自訂題目 · {customQuestions.length} / {TURING_CUSTOM_MAX} 題{(customDirty || editorDirty) && ' · 尚未套用'}</summary>
      <p className="small muted">自訂題目會混入所選內建題庫；同題幹採自訂版本，不重複抽取。選「自訂題庫」可只玩自己的題目，至少需 5 題。內容會提供房間成員查看，請勿填入密碼或私人資料。</p>
      {host && <div className="turing-custom-editor"><h4>{editing === null ? '新增一道題目' : `編輯第 ${editing + 1} 題`}</h4>
        <label>題目（5～200 字）<textarea value={question.prompt} maxLength={200} disabled={blocked} onChange={event => { lock('edits', true); setQuestion({ ...question, prompt: event.target.value }); }} placeholder="例如：替一台第一次放假的機器人寫下今天的行程。" /></label>
        <label>1 代表甚麼？<input value={question.low} maxLength={50} disabled={blocked} onChange={event => { lock('edits', true); setQuestion({ ...question, low: event.target.value }); }} placeholder="忙到比上班還想逃" /></label>
        <label>10 代表甚麼？<input value={question.high} maxLength={50} disabled={blocked} onChange={event => { lock('edits', true); setQuestion({ ...question, high: event.target.value }); }} placeholder="快樂到想永遠放假" /></label>
        <p className="small muted">兩端請寫同一個面向的相反極端，讓 1 也有鮮明情境；避免只寫「普通」或「稍微」。</p>
        <div className="button-row"><button className="button secondary" disabled={blocked || (editing === null && customQuestions.length >= TURING_CUSTOM_MAX)} onClick={addQuestion}>{editing === null ? '加入題目清單' : '更新這道題目'}</button>{editorDirty && <button className="text-button" disabled={blocked} onClick={() => { setEditing(null); setQuestion(blankQuestion()); }}>取消編輯</button>}</div>
      </div>}
      <ol className="turing-custom-list">{customQuestions.map((item, index) => <li key={index}><p><strong>{index + 1}. {item.prompt}</strong><br />1：{item.low} ／ 10：{item.high}</p>{host && <div className="button-row"><button className="button secondary" disabled={blocked} onClick={() => { lock('edits', true); setQuestion({ ...item }); setEditing(index); }}>編輯第 {index + 1} 題</button><button className="button secondary" disabled={blocked} onClick={() => { lock('edits', true); setCustomQuestions(customQuestions.filter((_, i) => i !== index)); setEditing(null); setQuestion(blankQuestion()); }}>移除第 {index + 1} 題</button></div>}</li>)}</ol>
      <div className="button-row"><button className="button secondary" disabled={!customQuestions.length || busy} onClick={exportQuestions}>下載自訂題庫</button></div>
      {host && <label className="turing-import-label small">匯入 JSON 題庫（取代尚未套用的清單）<input type="file" accept=".json,application/json" disabled={blocked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importQuestions(file); }} /></label>}
      <p className="small muted">每題包含 prompt（題目）、low（1 的端點）、high（10 的端點）。可以先下載一份範例，再編輯及匯入；匯入後仍需套用自訂題目。</p>
      {host && <button className="button primary full" disabled={blocked || !customDirty || editorDirty} onClick={() => void save({ ...options, customQuestions })}>套用自訂題目</button>}
    </details>
    {host && (livesDirty || customDirty || editorDirty) && <div role="status"><p className="small amber">{livesDirty ? '起始生命尚未儲存，請離開欄位或按 Enter。' : ''}{(customDirty || editorDirty) && '自訂題目尚未套用；請完成編輯並套用，或放棄修改，才能準備及開局。'}</p><button className="button secondary" data-turing-discard="true" disabled={blocked} onPointerDown={event => event.preventDefault()} onClick={discardEdits}>放棄尚未儲存的修改</button></div>}
    <p className="small muted" role="status">{busy ? '儲存並同步中…' : host ? '挑戰模式、排序玩法、題庫與同意方式切換即儲存；起始生命離開欄位後儲存。等待室更新會清除全員準備。設定會保留在房間，這台瀏覽器下次開房也會沿用。' : '由房主選擇模式與題庫；設定更新後請重新準備。'}</p><ErrorMessage>{error}</ErrorMessage>
  </section>;
}
