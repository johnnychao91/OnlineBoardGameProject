import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { echoCanAgree, type EchoState } from '../games/echo/game';
import { echoUsedWordKeys, echoWord, echoWordKey, ECHO_WORD_LIMIT } from '../games/echo/rules';
import type { RoomInfo } from './api';
import { GameSoundControl } from './GameSoundControl';
import type { SnapshotProps } from './game-types';
import { RoomContext } from './room-context';
import { serverNow } from './server-clock';
import openCup from './assets/echo/open-cup.webp';
import sealedCup from './assets/echo/sealed-cup.webp';
import type { SoundCueState } from './sound-cues';
import './echo.css';

type BoardProps = { G: EchoState; playerID: string | null; isConnected?: boolean; moves: Record<string, (...args: any[]) => unknown> };
const playerName = (info: RoomInfo, id: string) => info.players.find(player => String(player.id) === id)?.name || '酒肆客人';
const phaseLabel = (G: EchoState) => G.status === 'writing' ? '各自封詞' : G.status === 'review' ? '一起揭曉' : G.result === 'round-limit' ? '本桌已結束' : '相遇了';
const didMatch = (G: EchoState) => G.result === 'same-word' || G.result === 'same-meaning';

export function EchoBoard({ G, playerID, moves, isConnected = true }: BoardProps) {
  const { info } = useContext(RoomContext)!;
  const [highlight, setHighlight] = useState<{ phase: number; key: string }>();
  const repeatedKey = G.status === 'writing' && highlight?.phase === G.phaseEpoch ? highlight.key : undefined;
  return <EchoLayout G={G} info={info} live repeatedKey={repeatedKey}>
    <GameSoundControl gameID="cup-echo" G={G} matchID={info.matchID} playerID={playerID ?? undefined} connected={isConnected} />
    {playerID !== null && G.players[playerID] && <EchoControls key={G.phaseEpoch} G={G} id={playerID} connected={isConnected} moves={moves}
      onRepeat={key => setHighlight(key ? { phase: G.phaseEpoch, key } : undefined)} />}
  </EchoLayout>;
}

function EchoControls({ G, id, connected, moves, onRepeat }: {
  G: EchoState; id: string; connected: boolean; moves: BoardProps['moves']; onRepeat: (key?: string) => void;
}) {
  const [draft, setDraft] = useState(G.private[id]?.draft ?? G.private[id]?.word ?? '');
  const [pending, setPending] = useState<string | boolean | null>(null);
  const [notice, setNotice] = useState('');
  const [composing, setComposing] = useState(false);
  const lastDraftSent = useRef(G.private[id]?.draft ?? '');
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const own = G.players[id];
  const offersMeaning = G.rulesVersion === 2 && echoCanAgree(G);
  const editable = G.status === 'writing' && (!own.sealed || G.options.allowChanges);
  const usedWords = useMemo(() => G.options.allowRepeats === false ? echoUsedWordKeys(G.history) : undefined, [G.history, G.options.allowRepeats]);
  const word = echoWord(draft);
  const wordKey = word ? echoWordKey(word) : '';
  const repeated = usedWords?.has(wordKey) === true;
  const confirmed = typeof pending === 'string' ? own.sealed && G.private[id]?.word === pending : own.reviewed;
  const busy = pending !== null && !confirmed;
  useEffect(() => { if (pending !== null && confirmed) setPending(null); }, [pending, confirmed]);
  useEffect(() => { if (!connected) lastDraftSent.current = G.private[id]?.draft ?? ''; }, [connected, G.private[id]?.draft]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      setPending(null);
      setNotice('尚未收到確認，請確認連線後重試。');
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [busy, pending]);
  useEffect(() => {
    if (!editable || !connected || composing || busy) return;
    // Sample regularly so continuous typing cannot postpone synchronization
    // until after a short round. Only send when the text has actually changed.
    const timer = window.setInterval(() => {
      const text = currentDraft.current;
      const value = text.trim() ? echoWord(text) : '';
      if (value === undefined || value === lastDraftSent.current) return;
      lastDraftSent.current = value;
      moves.saveDraft(value, G.phaseEpoch);
    }, 200);
    return () => window.clearInterval(timer);
  }, [editable, connected, composing, busy, moves, G.phaseEpoch]);
  if (G.status === 'finished' || G.status === 'lobby') return null;
  function send(move: string, value: string | boolean) {
    if (!connected || busy) return;
    if (typeof value === 'string') lastDraftSent.current = value;
    setPending(value);
    setNotice('');
    moves[move](value, G.phaseEpoch);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composing && editable && word && !repeated && word !== G.private[id]?.word) send('sealWord', word);
  }
  return <section className="echo-controls panel" aria-label="本輪操作">
    {!connected && <p className="small muted" role="status">連線中斷，重新連線後可接續本輪。</p>}
    {G.status === 'writing' ? !editable
      ? <p role="status">已封詞 <strong>{G.private[id]?.word}</strong>，等待一起揭曉。</p>
      : <form className="echo-input" onSubmit={submit}><label htmlFor="echo-word">你想到哪個詞？</label>
        <div><input id="echo-word" value={draft} maxLength={ECHO_WORD_LIMIT * 2} autoComplete="off" spellCheck={false}
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          aria-invalid={repeated} aria-describedby={repeated ? 'echo-repeated-word' : undefined}
          onChange={event => {
            const next = [...event.target.value].slice(0, ECHO_WORD_LIMIT).join('');
            const key = echoWordKey(next);
            setDraft(next);
            onRepeat(usedWords?.has(key) ? key : undefined);
          }} disabled={busy || !connected} />
          <button type="submit" className="button primary" disabled={busy || !connected || composing || !word || repeated || word === G.private[id]?.word}>{own.sealed ? '更新封詞' : '封詞'}</button></div>
        {repeated && <p id="echo-repeated-word" className="small amber" role="status">這個詞在前面的輪次出現過，請換一個詞。 <button type="button" className="text-button" onClick={() => {
          document.querySelector('.echo-history mark')?.scrollIntoView({ block: 'center' });
        }}>查看原詞</button></p>}
        <p className="small muted">最多 {ECHO_WORD_LIMIT} 個字元。{G.options.allowChanges ? '揭曉前可更改已封詞。' : '封詞後鎖定。'}倒數結束會採用伺服器最後收到的輸入內容。</p>
        {own.sealed && <p className="small muted" role="status">目前已封詞：{G.private[id]?.word}</p>}</form>
      : G.rulesVersion === 2 ? <p>最後一輪已揭曉，倒數結束後自動結算。</p>
      : own.reviewed ? <p role="status">已確認，等待其他客人。</p>
      : <><p>{echoCanAgree(G) ? '如果用詞不同但意思相同，全員選擇「意思相同」也算相遇。' : '有人沒有送出，這輪繼續往下聯想。'}</p>
        <div className="echo-actions">{echoCanAgree(G) && <button type="button" className="button primary" disabled={busy || !connected} onClick={() => send('reviewWords', true)}>意思相同</button>}
          <button type="button" className="button secondary" disabled={busy || !connected} onClick={() => send('reviewWords', false)}>
            {G.round >= G.options.roundLimit ? '查看結算' : '繼續聯想'}</button></div></>}
    {offersMeaning && <EchoMeaningVote G={G} reviewed={own.reviewed} connected={connected} vote={() => moves.reviewWords(true, G.phaseEpoch)} />}
    {busy && <p className="small muted" role="status">正在確認…</p>}
    {notice && !confirmed && <p className="small" role="status">{notice}</p>}
  </section>;
}

function EchoMeaningVote({ G, reviewed, connected, vote }: { G: EchoState; reviewed: boolean; connected: boolean; vote: () => void }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!pending || reviewed) return;
    const timer = window.setTimeout(() => setPending(false), 8000);
    return () => window.clearTimeout(timer);
  }, [pending, reviewed]);
  return <div className="echo-meaning">
    <p className="small muted">第 {G.history.at(-1)?.number} 輪的詞若意思相同，全員確認即相遇。</p>
    <button type="button" className="button secondary" disabled={!connected || pending || reviewed} onClick={() => { setPending(true); vote(); }}>
      {reviewed ? '已確認意思相同' : pending ? '正在確認…' : '意思相同'}
    </button>
  </div>;
}

function EchoTimer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(serverNow());
    const timer = window.setInterval(() => setNow(serverNow()), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return <span className="echo-time">剩餘 {Math.max(0, Math.ceil((deadline - now) / 1000))} 秒</span>;
}

function EchoLayout({ G, info, live, repeatedKey, children }: { G: EchoState; info: RoomInfo; live: boolean; repeatedKey?: string; children?: ReactNode }) {
  const ids = Object.keys(G.players);
  const revealed = G.status === 'review' || G.status === 'finished' ? G.history.at(-1) : undefined;
  const matched = didMatch(G);
  const confirmed = G.status === 'writing' ? ids.filter(id => G.players[id].sealed).length : ids.filter(id => G.players[id].reviewed).length;
  return <main className="game-layout echo-layout" data-player={!!children} style={{ '--echo-player-count': Math.max(1, ids.length) } as CSSProperties}>
    <section className="game-main echo-main">
      <div className="echo-desk" data-matched={matched}>
        <div className="echo-desk-head"><span>第 {G.round}／{G.options.roundLimit} 輪</span><strong role="status">{phaseLabel(G)}</strong>
          {live && G.deadline !== null && <EchoTimer deadline={G.deadline} />}
          {live && G.status === 'writing' && G.deadline === null && <span>不限時</span>}</div>
        <div className="echo-clues"><h2>{matched ? (G.result === 'same-word' ? '全員同詞' : '全員確認同義') : G.status === 'finished' ? '本桌尚未相遇' : G.status === 'review' ? '杯中的詞' : G.clues.length ? '沿著這些詞繼續想' : '先各想一個詞'}</h2>
          {G.status === 'writing' && !!G.clues.length && <ul>{G.clues.map(word => <li key={word}>{word}</li>)}</ul>}
          {matched && <span className="echo-ripples" aria-hidden="true"><i /><i /><i /></span>}</div>
        <ul className="echo-cups">{ids.map(id => {
          const sealed = G.status === 'writing' && G.players[id].sealed;
          const word = revealed?.words[id];
          return <li key={id} data-sealed={sealed || !!word}>
            <span className="echo-cup-art">
              <img src={sealed ? sealedCup : openCup} alt="" width={704} height={704} />
            </span>
            <span>{playerName(info, id)}</span>
            <strong>{revealed ? word ?? '未作答' : sealed ? '已封詞' : '待封詞'}</strong>
          </li>;
        })}</ul>
        {(G.status === 'writing' || G.status === 'review') && <p className="small muted echo-progress">{confirmed}／{ids.length} 位{G.status === 'writing' ? '已封詞' : '已確認'}</p>}
        {G.status === 'finished' && <p className="small muted echo-progress">詞鏈已保留，可從房間的歷史對局進入復盤。</p>}
      </div>
    </section>
    {children && <aside className="echo-side">{children}</aside>}
    <section className="panel echo-history" aria-label="逐輪詞鏈">
        <h2>逐輪詞鏈</h2>
        {G.history.length ? <ol>{G.history.map(round => <li key={round.number} data-matched={matched && G.round === round.number}>
          <h3>第 {round.number} 輪 {matched && G.round === round.number && <small>{G.result === 'same-word' ? '同詞相遇' : '同義相遇'}</small>}</h3>
          {round.timedOut && <p className="small muted">倒數結束，採用最後同步的輸入。</p>}
          <dl>{ids.map(id => {
            const word = round.words[id];
            return <div key={id}><dt>{playerName(info, id)}</dt><dd>
              {word && repeatedKey && echoWordKey(word) === repeatedKey ? <mark>{word}</mark> : word ?? '未作答'}
            </dd></div>;
          })}</dl>
        </li>)}</ol> : <p className="small muted">第一輪揭曉後，詞鏈會出現在這裡。</p>}
    </section>
  </main>;
}

export function EchoSnapshot({ G, info, replay }: SnapshotProps) {
  return <EchoLayout G={G as EchoState} info={info} live={!replay} />;
}

export function echoSoundAdapter(G: EchoState, playerID?: string): SoundCueState | undefined {
  if (!G || !Array.isArray(G.history)) return undefined;
  const own = playerID ? G.players[playerID] : undefined;
  const needsAction = own && (G.status === 'writing' && !own.sealed || G.status === 'review' && !own.reviewed);
  return { revision: G.epoch, events: [...G.history.map(round => 'echo-reveal:' + round.number), ...(G.result ? ['echo-result:' + G.result] : [])],
    attention: needsAction ? 'echo-turn:' + G.phaseEpoch : undefined };
}
