import { useContext, useEffect, useRef, useState } from 'react';
import type { CipherEvent, CipherState } from '../games/cipher/game';
import { isPlayer } from './api';
import { BattleReport } from './BattleReport';
import { RoomContext } from './room-context';
import { Icon } from './ui';
import './cipher.css';

type NameOf = (id: string) => string;
type BoardProps = {
  G: CipherState;
  playerID: string | null;
  isConnected?: boolean;
  moves: Record<string, (...args: any[]) => any>;
};

export function CipherBoard({ G, playerID, moves, isConnected }: BoardProps) {
  const { seat, info } = useContext(RoomContext)!;
  const id = playerID || (isPlayer(seat) ? seat.playerID : '');
  const own = G.players[id];
  const cards = G.private?.[id]?.cards ?? [];
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const pendingRef = useRef(false);
  const canAct = isConnected !== false && !!own && !pending;
  const nameOf: NameOf = target => {
    const player = info.players.find(p => String(p.id) === target);
    return `${player?.name || `特務 ${Number(target) + 1}`}${player?.departed ? '（已離開）' : ''}`;
  };
  const actionVersion = `${G.level}:${G.epoch}:${own?.acknowledged}:${cards[0]}:${G.pulse?.votes[id]}`;

  useEffect(() => {
    pendingRef.current = false;
    setPending(false);
    setNotice('');
  }, [actionVersion, isConnected]);
  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => {
      pendingRef.current = false;
      setPending(false);
      setNotice('尚未收到操作確認，請檢查連線與最新牌面後再試。');
    }, 8000);
    return () => window.clearTimeout(timeout);
  }, [pending]);
  useEffect(() => {
    const conceal = () => { if (document.hidden) setHidden(true); };
    document.addEventListener('visibilitychange', conceal);
    return () => document.removeEventListener('visibilitychange', conceal);
  }, []);

  function send(move: string, ...args: (number | boolean)[]) {
    if (!canAct || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setNotice('');
    moves[move](...args, G.level, G.epoch);
  }

  return <>
    <div className={`connection-banner ${isConnected === false ? 'offline' : ''}`} role="status">
      <Icon type="signal" size={15} />
      {isConnected === false ? '連線中斷，傳送已暫停。重新連線後請確認最新牌面。' : '通話連線已建立'}
    </div>
    <main className="game-layout cipher-layout">
      <section className="game-main">
        <CipherHeading G={G} />
        <CipherMetrics G={G} />
        <CipherStatus G={G} />

        {G.status !== 'finished' && <section className="panel cipher-hand">
          <div className="section-heading">
            <div><div className="eyebrow">FOR YOUR EYES ONLY</div><h2>我的訊號牌</h2></div>
            <button className="text-button" aria-expanded={!hidden} onClick={() => setHidden(!hidden)}>
              <Icon type="shield" size={15} />{hidden ? '顯示牌面' : '遮住牌面'}
            </button>
          </div>
          {hidden ? <div className="cipher-concealed"><Icon type="shield" size={26} /><p>你的 {cards.length} 張訊號牌已遮住</p><span>顯示牌面後才能傳送。</span></div>
            : cards.length ? <>
              <div className="cipher-hand-cards" aria-label="你的訊號牌，由小到大">
                {cards.map((card, index) => index === 0
                  ? <button key={card} className="cipher-card cipher-card-send" type="button"
                    aria-label={`傳送訊號 ${card}`} disabled={!canAct || G.status !== 'playing'}
                    onClick={() => send('playCard', card)}>
                    <span className="cipher-card-mark">SIGNAL</span><CipherCardNumber value={card} />
                    <span className="cipher-card-caption">{G.status === 'playing' ? pending ? '傳送中' : '點擊傳送' : '最小訊號'}</span>
                  </button>
                  : <div key={card} className="cipher-card"><span className="cipher-card-mark">SIGNAL</span><CipherCardNumber value={card} /><span className="cipher-card-caption">稍後傳送</span></div>)}
              </div>
              <p className="small muted cipher-hand-note">只有最小的一張能傳送。點一下就立即送出，沒有確認視窗；請保持安靜，等待你認為合適的時機。</p>
            </> : <div className="cipher-concealed"><Icon type="check" size={26} /><p>你的訊號已全部送出</p><span>保持靜默，等待同伴完成傳送。</span></div>}
          {(G.status === 'syncing' || G.status === 'intermission') && <div className="cipher-sync-action">
            <button className="button primary full" disabled={!canAct || own?.acknowledged}
              onClick={() => send(G.status === 'syncing' ? 'readySync' : 'acknowledgeLevel')}>
              {own?.acknowledged ? '已確認，等待其他特務' : G.status === 'syncing' ? '我已就緒，確認同步' : '繼續下一頻段'}
              <Icon type="check" size={17} />
            </button>
            <p className="small muted center">{Object.values(G.players).filter(p => p.acknowledged).length} / {Object.keys(G.players).length} 位已確認</p>
          </div>}
        </section>}

        {G.status === 'pulse' && G.pulse && <section className="panel cipher-pulse">
          <CipherResourceArtwork resource="pulse" />
          <div className="eyebrow">SILENT PULSE REQUEST</div><h2>是否發動靜默脈衝？</h2>
          <p><strong>{nameOf(G.pulse.proposerID)}</strong> 提議消耗 1 次脈衝，公開棄掉每位特務最小的一張牌。</p>
          <p className="small muted">全員同意才會發動；任一人拒絕就取消。討論只限同意與否，請勿暗示手牌大小。</p>
          <div className="button-row">
            <button className="button secondary" disabled={!canAct || G.pulse.votes[id] !== null} onClick={() => send('votePulse', false)}>拒絕發動</button>
            <button className="button primary" disabled={!canAct || G.pulse.votes[id] !== null} onClick={() => send('votePulse', true)}>
              {G.pulse.votes[id] === true ? '已同意' : '同意發動'}
            </button>
          </div>
        </section>}

        {G.status === 'playing' && <div className="cipher-tools">
          <button className="button secondary" disabled={!canAct} onClick={() => send('requestSync')}>暫停，重新同步</button>
          <button className="button secondary" disabled={!canAct || G.pulses < 1} onClick={() => send('proposePulse')}><CipherResourceArtwork resource="pulse" />提議靜默脈衝 <span>×{G.pulses}</span></button>
        </div>}
        {notice && <p className="error-message" role="status">{notice}</p>}
        {pending && <p className="small muted" role="status">正在確認操作…</p>}
        <CipherTransmission G={G} />
        <CipherAgents G={G} nameOf={nameOf} ownID={id} />
        {G.status === 'finished' && <>
          <p className="small muted">本局已結束，正在返回原房間。結果與復盤會保留。</p>
          <BattleReport G={G} info={info} perspective="blind" label="製作本局任務戰報" />
        </>}
      </section>
      <aside className="game-aside">
        <CipherLog G={G} nameOf={nameOf} />
        <details className="panel rules-details cipher-rules"><summary>通話守則與補給速查</summary><CipherRuleSummary /></details>
      </aside>
    </main>
  </>;
}

export function CipherCardNumber({ value }: { value: number | null }) {
  return <strong className={value === 100 ? 'cipher-number-three-digits' : undefined}>{value ?? '?'}</strong>;
}

export function CipherHeading({ G }: { G: CipherState }) {
  return <div className="game-title cipher-heading">
    <div><div className="eyebrow"><span className="cipher-seal" aria-hidden="true">⌁</span> ENCRYPTED CALL</div><h1>加密通話</h1></div>
    <span className="round-badge">頻段 <strong>{G.level || '—'}</strong> / {G.targetLevel}</span>
  </div>;
}

function CipherResourceArtwork({ resource }: { resource: 'cover' | 'pulse' }) {
  return <span className="cipher-resource-art" data-art-resource={resource} aria-hidden="true" />;
}

export function CipherMetrics({ G }: { G: CipherState }) {
  return <div className="cipher-metrics" aria-label="任務狀態">
    <div><CipherResourceArtwork resource="cover" /><span>剩餘掩護</span><strong className={G.cover <= 1 ? 'amber' : ''}>{G.cover}<small> / 6</small></strong></div>
    <div><CipherResourceArtwork resource="pulse" /><span>靜默脈衝</span><strong>{G.pulses}<small> / 3</small></strong></div>
    <div><span>尚待傳送</span><strong>{Object.values(G.players).reduce((sum, p) => sum + p.cardCount, 0)}<small> 張</small></strong></div>
  </div>;
}

export function CipherStatus({ G }: { G: CipherState }) {
  const labels = {
    lobby: ['等待特務就位', '準備好後，由房主開始這次行動。'],
    syncing: ['正在建立同步', '全員確認後解除靜默封鎖。請勿透露牌面、比暗號或一起倒數。'],
    playing: ['保持靜默 · 自行判斷傳送時機', '沒有固定順序。全隊要把訊號由小到大送出，不提供共同計時。'],
    pulse: ['傳送暫停 · 等待脈衝決議', '每位特務都必須回應。決議結束後會重新確認同步。'],
    intermission: [`頻段 ${G.level} 完成`, '掩護與脈衝補給已結算。全員確認後重新洗牌，進入下一頻段。'],
    finished: G.winner === 'agents'
      ? ['全頻段同步 · 情報安全送達', '特務小隊完成所有頻段，行動成功。']
      : ['通話遭到攔截', '掩護已耗盡，這次行動失敗。'],
  };
  const [title, description] = labels[G.status];
  return <section className={`cipher-status cipher-status-${G.status}`} role="status" aria-live="polite">
    <span className="cipher-status-symbol" aria-hidden="true"><Icon type={G.status === 'finished' ? 'shield' : 'signal'} size={24} /></span>
    <div><strong>{title}</strong><p>{description}</p></div>
  </section>;
}

export function CipherTransmission({ G }: { G: CipherState }) {
  const last = G.transmitted.at(-1);
  return <section className="panel cipher-transmission">
    <div className="section-heading"><h2>公開通話紀錄</h2><span>本頻段</span></div>
    <div className="cipher-last"><div><span>最近傳送</span><strong>{last ?? '—'}</strong></div>
      <p>{last == null ? '第一道訊號，等待你們的默契。' : '下一道訊號，必須比這個數字大。'}<small>已傳送 {G.transmitted.length} 張 · 已棄置 {G.discarded.length} 張</small></p>
    </div>
    {!!G.transmitted.length && <div className="cipher-number-strip" aria-label="已傳送的公開訊號">
      {G.transmitted.map(card => <span key={card}>{card}</span>)}
    </div>}
    {!!G.discarded.length && <div className="cipher-discarded"><span>公開棄牌</span><div className="cipher-number-strip">
      {G.discarded.map(({ card, playerID }) => <span key={`${playerID}-${card}`}>{card}</span>)}
    </div></div>}
  </section>;
}

export function CipherAgents({ G, nameOf, ownID, god = false }: { G: CipherState; nameOf: NameOf; ownID?: string; god?: boolean }) {
  return <section className="panel cipher-agents">
    <div className="section-heading"><h2>同頻特務</h2><span>{Object.keys(G.players).length} 人合作</span></div>
    <div className="cipher-agent-list">{Object.entries(G.players).map(([id, player]) => {
      const vote = G.pulse?.votes[id];
      const state = G.status === 'pulse' ? vote === true ? '已同意' : '等待回應'
        : G.status === 'syncing' || G.status === 'intermission' ? player.acknowledged ? '已確認' : '待確認'
          : player.cardCount === 0 ? '傳送完成' : '靜默中';
      return <div key={id} className={`cipher-agent ${id === ownID ? 'cipher-agent-mine' : ''}`}>
        <div className="cipher-agent-heading"><span className="cipher-agent-index" aria-hidden="true">{String(Number(id) + 1).padStart(2, '0')}</span>
          <strong>{nameOf(id)}{id === ownID && <span className="you-label">你</span>}</strong><span>{state}</span></div>
        <p>剩餘 <strong>{player.cardCount}</strong> 張訊號牌</p>
        {god && G.private?.[id] && <div className="cipher-god-hand"><span>未公開手牌</span><div className="cipher-number-strip">
          {G.private[id].cards.map(card => <span key={card}>{card}</span>)}
          {!G.private[id].cards.length && <small>無剩餘手牌</small>}
        </div></div>}
      </div>;
    })}</div>
  </section>;
}

export function cipherEventText(event: CipherEvent, nameOf: NameOf): string {
  const name = event.actorID ? nameOf(event.actorID) : '全隊';
  if (event.type === 'transmit') return `${name} 傳送訊號 ${event.card}`;
  if (event.type === 'breach') return `${name} 傳送訊號 ${event.card}，有較小訊號尚未送出，掩護 −1`;
  if (event.type === 'pulse') return '全員同意，靜默脈衝已發動';
  if (event.type === 'level-complete') return `頻段 ${event.level} 全部訊號處理完成`;
  return '全隊重新確認同步';
}

export function CipherLog({ G, nameOf }: { G: CipherState; nameOf: NameOf }) {
  return <section className="panel event-log cipher-log">
    <div className="section-heading"><h2>行動檔案</h2><span>公開資訊</span></div>
    {G.log.length ? <ol>{G.log.slice(-32).reverse().map((event, index) => <li key={G.log.length - index}>
      <span className={`log-dot ${event.type === 'breach' ? 'hazard' : 'repair'}`} /><div>
        <p>{cipherEventText(event, nameOf)}</p>
        {!!event.discarded?.length && <span className="cipher-log-discarded">棄置：{event.discarded.map(({ playerID, card }) => `${nameOf(playerID)} ${card}`).join('、')}</span>}
        {event.type === 'level-complete' && <span className="mint">剩餘掩護 {event.cover} · 靜默脈衝 {event.pulses}</span>}
        <small>頻段 {event.level}</small>
      </div>
    </li>)}</ol> : <p className="small muted">開始傳送後，公開事件會記錄在這裡。</p>}
  </section>;
}

export function CipherRuleSummary() {
  return <div className="rule-summary">
    <p>你們是潛伏在監聽網中的同一支特務小隊。適合 8 歲以上，2–4 人合作，把 1–100 的訊號牌由小到大全部傳送，讓情報悄悄抵達友方。</p>
    <p>第 1 頻段每人 1 張牌，第 2 頻段每人 2 張，以此類推；每個新頻段都從完整牌組重新洗牌發牌。2 人完成 12 個頻段、3 人完成 10 個、4 人完成 8 個。</p>
    <p>全員確認同步後，任何人都能傳送自己最小的一張牌。不能透露數字、打暗號、用動作提示，或一起倒數；只靠默契決定時機。觀戰者也請保持靜默。網路對局以伺服器收到的順序裁定，同時點擊可能受連線延遲影響。</p>
    <p>如果傳送時仍有更小的牌未出，全隊只扣 1 點掩護，並公開棄掉所有更小的手牌。剩餘掩護歸零即遭攔截；若仍有掩護，重新確認同步後繼續。</p>
    <p>掩護起始值等於特務人數，靜默脈衝起始 1 次。全員同意消耗脈衝，就能公開棄掉每人最小的一張牌；有人拒絕則取消。脈衝棄牌不會提高「最近傳送」數字；之後仍依剩餘訊號的大小順序傳送。傳送期間可要求重新同步，但不能藉此暗示牌面。</p>
    <p>完成第 2、5、8 頻段各補 1 次脈衝（最多 3 次）；完成第 3、6、9 頻段各補 1 點掩護（最多 6 點）。通過最後頻段，全隊共同獲勝。</p>
  </div>;
}
