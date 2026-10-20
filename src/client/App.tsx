import { useContext, useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, captureInvite, forgetSeat, isPlayer, loadSeat, pendingRequestID, pendingToken, rememberedName,
  rememberName, resetAdmission, savedInvite, saveSeat, type Admission, type AuthSession, type GameInfo, type RoomInfo,
} from './api';
import { clientGames } from './game-registry';
import { CreationPassword } from './CreationPassword';
import { rememberedCreateKey, rememberCreateKey } from './creation-password';
import { RemovePlayer } from './RemovePlayer';
import { ObservationPanel } from './ObservationPanel';
import { captureReplayShare, ReplayPanel, SharedReplay } from './ReplayViewer';
import { RoomContext } from './room-context';
import { ShareInvite } from './ShareInvite';
import { initials } from './StationBoard';
import { Statistics } from './Statistics';
import { ErrorMessage, Header, Icon, navigate, Note, Submit } from './ui';

captureInvite();
captureReplayShare();

function Home({ onEnter }: { onEnter: (seat: AuthSession) => void }) {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [gameId, setGameId] = useState('space-station');
  const [name, setName] = useState(rememberedName);
  const [createKey, setCreateKey] = useState(rememberedCreateKey);
  const [rememberKey, setRememberKey] = useState(() => !!rememberedCreateKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); api<{ games: GameInfo[] }>('/api/games', { signal: controller.signal }).then(r => setGames(r.games)).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => controller.abort(); }, []);
  const game = games.find(item => item.id === gameId);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<Admission>('/api/rooms', { method: 'POST', body: JSON.stringify({ gameId, displayName: name.trim(), ...(createKey ? { createKey } : {}) }) });
      rememberCreateKey(rememberKey ? createKey : '');
      rememberName(name.trim()); onEnter(saveSeat(result));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><Header /><main className="home-layout"><section className="intro"><div className="eyebrow"><span className="status-dot" /> THE NEXT SHIFT IS YOURS</div><h1>朋友到齊，<br />一起進入軌道。</h1><p className="intro-copy">先開一桌，再慢慢集合。<br />有人上場、有人觀戰，每個人都有位置。</p><div className="station-illustration" aria-hidden="true"><div className="orbit-ring one" /><div className="orbit-ring two" /><span className="planet" /><div className="station-object"><div className="solar-panel" /><div className="station-body"><Icon type="orbit" size={44} /><span>STATION 07</span></div><div className="solar-panel" /></div><span className="orbital-label">CREW CONNECTION / ACTIVE</span></div><div className="feature-row"><span><Icon type="link" /> 一鍵邀請</span><span><Icon type="signal" /> 朋友也能觀戰</span></div></section><section className="panel create-panel"><div className="section-label">01 / 開一桌</div><h2>準備登艦</h2><form onSubmit={create}><label htmlFor="game">今晚玩什麼</label>{games.length > 1 ? <select id="game" value={gameId} onChange={e => setGameId(e.target.value)}>{games.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <div className="game-choice"><span className="game-icon"><Icon type="orbit" size={30} /></span><div><strong>{game?.name || '太空維修站'}</strong><small>隱藏陣營 · 討論與抉擇 · {game?.minPlayers || 4}～{game?.maxPlayers || 8} 人</small></div><Icon type="check" /></div>}<label htmlFor="host-name">你的暱稱</label><input id="host-name" autoComplete="nickname" maxLength={20} placeholder="朋友怎麼叫你？" required value={name} onChange={e => setName(e.target.value)} /><div className="room-flexibility"><Icon type="check" /><span>不用先決定人數。{game?.minPlayers || 4}～{game?.maxPlayers || 8} 位玩家準備好，房主就能開始。</span></div><CreationPassword saved={!!rememberedCreateKey()} value={createKey} onChange={setCreateKey} remember={rememberKey} onRemember={value => { setRememberKey(value); if (!value) rememberCreateKey(''); }} onForget={() => { rememberCreateKey(''); setCreateKey(''); setRememberKey(false); }} /><ErrorMessage>{error}</ErrorMessage><Submit busy={busy} disabled={!name.trim()}>建立私人房間</Submit></form><Note>用同一連結邀請參與或觀戰。每人都有獨立憑證，分享不會交出你的座位權限。</Note><p className="muted small">已經收到邀請？直接開啟朋友傳來的連結。</p></section></main><div className="home-statistics"><Statistics /></div><footer>相聚不必在同一張桌子。<span>PRIVATE ROOMS · SHARED MOMENTS</span></footer></>;
}

function Join({ roomId, onEnter }: { roomId: string; onEnter: (seat: AuthSession) => void }) {
  const [name, setName] = useState(rememberedName);
  const [access, setAccess] = useState<'player' | 'spectator'>('player');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const token = pendingToken(roomId);
  const [existing, setExisting] = useState(() => loadSeat(roomId));
  const [checking, setChecking] = useState(!!existing);
  useEffect(() => {
    if (!existing) { setChecking(false); return; }
    const controller = new AbortController();
    api<RoomInfo>(`/api/rooms/${roomId}`, { signal: controller.signal }, existing)
      .catch(e => {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) {
          forgetSeat(roomId, existing.credentials);
          setExisting(null);
        } else setError((e as Error).message);
      })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [roomId, existing]);
  async function join(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<Admission>(`/api/rooms/${encodeURIComponent(roomId)}/${access === 'spectator' ? 'watch' : 'join'}`, { method: 'POST', body: JSON.stringify({ inviteToken: token, displayName: name.trim(), requestID: pendingRequestID(roomId, access) }) });
      rememberName(name.trim()); onEnter(saveSeat(result));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ADMISSION_REMOVED') {
        resetAdmission(roomId, access);
        setError('上次加入已被房主移出。若仍要參與，請再按一次加入；需要有效邀請，且房間尚未開局。');
      } else setError((e as Error).message);
    } finally { setBusy(false); }
  }
  return <><Header /><main className="narrow"><section className="panel join-panel"><span className="large-orbit"><Icon type="orbit" size={46} /></span><div className="eyebrow">AN INVITATION TO ORBIT</div><h1>一起上場，或在旁加油。</h1><p className="muted">朋友的私人桌遊室</p>{checking ? <p role="status">正在確認原本的房間身分…</p> : existing ? <><p>這個瀏覽器已以{isPlayer(existing) ? '玩家' : '觀戰者'}身分加入，可直接回到原位置。</p><button className="button primary full" onClick={() => onEnter(existing)}>{isPlayer(existing) ? '回到我的座位' : '回到觀戰席'}<Icon type="arrow" /></button></> : token ? <form onSubmit={join}><fieldset className="access-picker"><legend>這次想怎麼加入</legend><div><button type="button" disabled={busy} className={access === 'player' ? 'selected' : ''} aria-pressed={access === 'player'} onClick={() => { setAccess('player'); setError(''); }}><strong>參與遊戲</strong><small>加入隊員，影響任務</small></button><button type="button" disabled={busy} className={access === 'spectator' ? 'selected' : ''} aria-pressed={access === 'spectator'} onClick={() => { setAccess('spectator'); setError(''); }}><strong>先來觀戰</strong><small>不占席，隨時可加入</small></button></div></fieldset><p className="small muted">{access === 'spectator' ? '觀戰可切換盲視角與上帝視角。這局身分固定，不會轉為玩家。' : '任務開始前才能加入隊員；這局身分固定。若已經開局，請改選觀戰。'}</p><label htmlFor="guest-name">你的暱稱</label><input autoFocus id="guest-name" autoComplete="nickname" maxLength={20} placeholder="讓朋友認得你" required value={name} onChange={e => setName(e.target.value)} /><ErrorMessage>{error}</ErrorMessage><Submit busy={busy} disabled={!name.trim()}>{access === 'player' ? '加入隊員' : '進入觀戰席'}</Submit></form> : <ErrorMessage>邀請資訊不完整，請重新開啟房主分享的完整連結。若連結已失效，請房主產生新邀請。</ErrorMessage>}<Note>一個瀏覽器在同一房間保留一種身分。重新整理可恢復，清除網站資料後憑證就會遺失。</Note></section></main></>;
}

function Lobby({ onUpdate }: { onUpdate: (info: RoomInfo) => void }) {
  const { seat, info } = useContext(RoomContext)!;
  const presentation = clientGames[info.gameName];
  const Rules = presentation?.Rules;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rules, setRules] = useState(false);
  const players = info.players.filter(p => p.name);
  const own = isPlayer(seat) ? players.find(p => String(p.id) === seat.playerID) : undefined;
  const host = isPlayer(seat) && seat.playerID === '0';
  const ready = players.filter(p => p.ready).length;
  const eligible = players.length >= info.minPlayers && players.length <= info.maxPlayers && ready === players.length;
  async function action(endpoint: 'ready' | 'start' | 'remove', body: object) {
    setBusy(true); setError('');
    try { onUpdate(await api<RoomInfo>(`/api/rooms/${seat.roomId}/${endpoint}`, { method: 'POST', body: JSON.stringify(body) }, seat)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="room-layout"><section><div className="eyebrow">CREW ASSEMBLY</div><h1>隊員到齊，就能出發。</h1><p className="muted">{players.length} 位玩家 · {info.minPlayers}～{info.maxPlayers} 人可開始 · {info.spectatorCount} 位已加入觀戰</p><section className="panel roster"><div className="section-heading"><h2>登艦名單</h2><span>{players.length} / {info.maxPlayers}</span></div>{players.map(player => <div className="roster-row" key={player.membershipID || player.id}><span className={`avatar ${isPlayer(seat) && String(player.id) === seat.playerID ? 'mine' : ''}`}>{initials(player.name || '')}</span><div><strong>{player.name}{isPlayer(seat) && String(player.id) === seat.playerID && <small className="you-label">你</small>}</strong><small>{String(player.id) === '0' ? '房主' : `隊員 ${Number(player.id) + 1}`}</small></div><span className={`ready-pill ${player.ready ? 'ready' : ''}`}>{player.ready ? '已準備' : '準備中'}</span>{host && String(player.id) !== '0' && <RemovePlayer player={player} busy={busy} onRemove={target => action('remove', { playerID: String(target.id), membershipID: target.membershipID })} />}</div>)}{host && <p className="small muted">開局前可移出隊員；持有效邀請的人仍可重新加入。</p>}{players.length < info.minPlayers && <p className="small muted lobby-missing">再邀請 {info.minPlayers - players.length} 位玩家，就達到出發人數。</p>}{players.length >= info.minPlayers && <p className="small muted lobby-missing">{players.length < info.maxPlayers ? '還有朋友要上場？開始前都能加入。' : '玩家已滿，其他朋友仍可觀戰。'}</p>}</section><ErrorMessage>{error}</ErrorMessage>{isPlayer(seat) ? <div className="action-dock"><button className={`button full ${own?.ready ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => action('ready', { ready: !own?.ready })}>{own?.ready ? '已準備好 · 點此取消' : '我準備好了'}<Icon type="check" /></button>{host && <button className="button primary full" disabled={busy || !eligible} onClick={() => action('start', {})}>以目前 {players.length} 位隊員開始<Icon type="arrow" /></button>}<p className="small muted center">{ready} / {players.length} 位已準備 · {host ? '開始時鎖定隊員名單與本局人數。' : '全員準備後，等待房主開始。'}</p></div> : <Note>你已在觀戰席，無需準備，也不計入開局人數。房主開始後，這裡會自動切換到對局。</Note>}</section><aside>{host ? <ShareInvite active /> : <Note>邀請由房主管理。遊戲開始後，仍可邀請其他朋友來觀戰。</Note>}{Rules && <div className="panel mission-brief"><div className="section-label">任務簡報</div><h2>{presentation.lobbyTitle || '遊戲簡介'}</h2><p>{presentation.lobbyDescription}</p><button className="text-button" onClick={() => setRules(!rules)}>{rules ? '收起玩法' : '展開玩法說明'} ↓</button>{rules && <Rules />}</div>}</aside></main>;
}

function Room({ seat }: { seat: AuthSession }) {
  const [info, setInfo] = useState<RoomInfo>(seat);
  const [inviteUrl, setInviteUrl] = useState(() => savedInvite(seat.roomId) || '');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [invalidSeat, setInvalidSeat] = useState(false);
  const [replay, setReplay] = useState(false);
  function acceptInfo(next: RoomInfo) {
    setInfo(previous => (previous.status === 'finished' && next.status !== 'finished') || (previous.status && previous.status !== 'lobby' && next.status === 'lobby') ? previous : next);
  }
  useEffect(() => {
    const controller = new AbortController(); let timer: number | undefined;
    const refresh = async () => {
      try { const next = await api<RoomInfo>(`/api/rooms/${seat.roomId}`, { signal: controller.signal }, seat); if (!controller.signal.aborted) { acceptInfo(next); setLoaded(true); setError(''); } }
      catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) {
          forgetSeat(seat.roomId, seat.credentials);
          setInvalidSeat(true);
          return;
        }
        setError((e as Error).message);
      }
      if (!controller.signal.aborted) timer = window.setTimeout(refresh, 2000);
    };
    void refresh();
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [seat.roomId, seat.credentials]);
  const definition = clientGames[info.gameName];
  const PlayerClient = definition?.PlayerClient;
  const host = isPlayer(seat) && seat.playerID === '0';
  const finished = info.status === 'finished';
  if (invalidSeat) return <><Header /><main className="narrow"><section className="panel">
    <h1>你已離開這個房間</h1>
    <p>可能已被房主移出，或這次加入的憑證已失效。若要重新加入，請開啟有效的完整邀請連結。</p>
    {pendingToken(seat.roomId) && <button className="button primary full" onClick={() => navigate(`/join/${seat.roomId}`)}>重新使用邀請加入</button>}
    <button className="button secondary full" onClick={() => navigate('/')}>回到首頁</button>
  </section></main></>;
  return <><Header room={seat.roomId} />{error && <div className="room-error"><ErrorMessage>{error}</ErrorMessage><p className="small muted">連線恢復後會自動重試。若房間已過期，可返回首頁建立新房間。</p></div>}{!loaded ? !error && <main className="narrow"><p className="loading" role="status">正在確認你的房間身分…</p></main> : <RoomContext.Provider value={{ seat, info, inviteUrl, setInviteUrl }}>{info.status === 'lobby' ? <Lobby onUpdate={acceptInfo} /> : <><div className="room-tools"><div className="room-status-line"><span>{isPlayer(seat) ? '玩家座位' : '觀戰席'} · {info.numPlayers} 位玩家 · {info.spectatorCount} 位已加入觀戰</span>{finished && <div className="perspective-switch" role="group" aria-label="結局與復盤"><button className={!replay ? 'selected' : ''} aria-pressed={!replay} onClick={() => setReplay(false)}>任務結果</button><button className={replay ? 'selected' : ''} aria-pressed={replay} onClick={() => setReplay(true)}>逐步復盤</button></div>}</div>{host && <details className="post-start-invite"><summary>邀請朋友觀戰{finished ? '與復盤' : ''}</summary><ShareInvite active /></details>}</div>{replay && finished ? <ReplayPanel seat={seat} info={info} /> : isPlayer(seat) ? PlayerClient ? <PlayerClient matchID={seat.matchID} playerID={seat.playerID} credentials={seat.credentials} /> : <main className="narrow"><ErrorMessage>此遊戲尚未提供玩家介面。</ErrorMessage></main> : <ObservationPanel seat={seat} info={info} />}</>}</RoomContext.Provider>}</>;
}

export function App() {
  const [path, setPath] = useState(location.pathname);
  const [seatRevision, setSeatRevision] = useState(0);
  useEffect(() => {
    const update = () => { captureInvite(); captureReplayShare(); setPath(location.pathname); setSeatRevision(n => n + 1); };
    window.addEventListener('popstate', update); window.addEventListener('hashchange', update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update); };
  }, []);
  function enter(seat: AuthSession) { setSeatRevision(n => n + 1); navigate(`/room/${seat.roomId}`); }
  const match = path.match(/^\/(join|room|replay)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return <Home onEnter={enter} />;
  const roomId = match[2];
  if (match[1] === 'replay') return <SharedReplay key={`${roomId}-${seatRevision}`} roomId={roomId} />;
  if (match[1] === 'join') return <Join key={`${roomId}-${seatRevision}`} roomId={roomId} onEnter={enter} />;
  const seat = loadSeat(roomId);
  return seat ? <Room key={roomId} seat={seat} /> : <><Header /><main className="narrow"><section className="panel"><h1>這個瀏覽器還沒加入房間。</h1><p className="muted">請開啟房主分享的完整邀請連結，選擇參與遊戲或觀戰。已加入過的朋友，請使用原本的瀏覽器。</p><button className="button secondary" onClick={() => navigate('/')}>回到首頁</button></section></main></>;
}
