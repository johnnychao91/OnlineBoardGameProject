import { ROOM_CAPACITY, isGameID } from '../games/catalog';
import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api, ApiError, captureInvite, forgetSeat, isPlayer, isRoomHost, loadSeat, pendingRequestID, pendingToken, rememberedName,
  rememberName, resetAdmission, roomHostPlayerID, savedInvite, saveSeat, type Admission, type AuthSession, type RoomInfo,
} from './api';
import { clientGames } from './game-registry';
import { CreationPassword } from './CreationPassword';
import { rememberedCreateKey, rememberCreateKey } from './creation-password';
import { RemovePlayer } from './RemovePlayer';
import { ObservationPanel } from './ObservationPanel';
import { captureReplayShare, SharedReplay } from './ReplayViewer';
import { RoomContext } from './room-context';
import { RoomActions } from './RoomActions';
import { RoomHistory } from './RoomHistory';
import { RoomGamePicker } from './RoomGamePicker';
import { RoleSwitcher } from './RoleSwitcher';
import { SpectatorRoster } from './SpectatorRoster';
import { isIdentityStorageKey, readRoleSwitch } from './role-switch';
import { ShareInvite } from './ShareInvite';
import { initials } from './StationBoard';
import { Statistics } from './Statistics';
import { RulesPage, type RulesGameID } from './RulesPage';
import { ErrorMessage, Header, Icon, navigate, Note, Submit } from './ui';

captureInvite();
captureReplayShare();

function Home({ onEnter }: { onEnter: (seat: AuthSession) => void }) {
  const [name, setName] = useState(rememberedName);
  const [createKey, setCreateKey] = useState(rememberedCreateKey);
  const [rememberKey, setRememberKey] = useState(() => !!rememberedCreateKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<Admission>('/api/rooms', { method: 'POST', body: JSON.stringify({ displayName: name.trim(), ...(createKey ? { createKey } : {}) }) });
      rememberCreateKey(rememberKey ? createKey : '');
      rememberName(name.trim()); onEnter(saveSeat(result));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="home-page page-home"><Header /><main className="home-layout">
    <section className="intro"><div className="eyebrow"><span className="status-dot" /> YOUR NEXT GAME STARTS HERE</div>
      <h1>朋友到齊，<br />今晚開哪一桌？</h1><p className="intro-copy">先開房、邀朋友，再一起選遊戲。<br />有人上場、有人觀戰，每個人都有位置。</p>
      <div className="station-illustration" aria-hidden="true"><div className="orbit-ring one" /><div className="orbit-ring two" /><span className="planet" /><div className="station-object"><div className="solar-panel" /><div className="station-body"><Icon type="orbit" size={44} /><span>FRIENDS AT THE TABLE</span></div><div className="solar-panel" /></div><span className="orbital-label">ONE ROOM / MANY GAMES</span></div>
      <div className="feature-row"><span><Icon type="link" /> 一鍵邀請</span><span><Icon type="signal" /> 房內換遊戲</span></div>
    </section>
    <section className="panel create-panel"><div className="section-label">01 / 開一桌</div><h2>先開房，邀朋友加入</h2>
      <p className="small muted">不用先選遊戲。房主可在等待室選擇或切換，大家繼續留在同一桌。</p>
      <form onSubmit={create}><label htmlFor="host-name">你的暱稱</label><input id="host-name" autoComplete="nickname" maxLength={20} placeholder="朋友怎麼叫你？" required value={name} onChange={e => setName(e.target.value)} />
        <div className="room-flexibility"><Icon type="check" /><span>最多 {ROOM_CAPACITY} 個參與席位，觀戰不占席；開局人數依選擇的遊戲決定。</span></div>
        <CreationPassword saved={!!rememberedCreateKey()} value={createKey} onChange={setCreateKey} remember={rememberKey} onRemember={value => { setRememberKey(value); if (!value) rememberCreateKey(''); }} onForget={() => { rememberCreateKey(''); setCreateKey(''); setRememberKey(false); }} />
        <ErrorMessage>{error}</ErrorMessage><Submit busy={busy} disabled={!name.trim()}>建立私人房間</Submit>
      </form>
      <Note>用同一連結邀請參與或觀戰。每人都有獨立憑證，分享不會交出你的座位權限。</Note><p className="muted small">已經收到邀請？直接開啟朋友傳來的連結。</p>
    </section>
  </main><div className="home-statistics"><Statistics /></div><footer>相聚不必在同一張桌子。<span>PRIVATE ROOMS · SHARED MOMENTS</span></footer></div>;
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
        if (e instanceof ApiError && [401, 404, 410].includes(e.status) && !(e.status === 401 && readRoleSwitch(existing))) {
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
  return <div className="join-page page-join"><Header /><main className="narrow"><section className="panel join-panel"><span className="large-orbit"><Icon type="orbit" size={46} /></span><div className="eyebrow">AN INVITATION TO PLAY</div><h1>一起上場，或在旁加油。</h1><p className="muted">朋友的私人桌遊室</p>{checking ? <p role="status">正在確認原本的房間身分…</p> : existing ? <><p>這個瀏覽器已以{isPlayer(existing) ? '玩家' : '觀戰者'}身分加入，可直接回到原位置。</p><button className="button primary full" onClick={() => onEnter(existing)}>{isPlayer(existing) ? '回到我的座位' : '回到觀戰席'}<Icon type="arrow" /></button></> : token ? <form onSubmit={join}><fieldset className="access-picker"><legend>這次想怎麼加入</legend><div><button type="button" disabled={busy} className={access === 'player' ? 'selected' : ''} aria-pressed={access === 'player'} onClick={() => { setAccess('player'); setError(''); }}><strong>參與遊戲</strong><small>加入隊員，影響任務</small></button><button type="button" disabled={busy} className={access === 'spectator' ? 'selected' : ''} aria-pressed={access === 'spectator'} onClick={() => { setAccess('spectator'); setError(''); }}><strong>先來觀戰</strong><small>不占席，隨時可加入</small></button></div></fieldset><p className="small muted">{access === 'spectator' ? '觀戰可切換盲視角與上帝視角。等待室有空位時，可以改為參加遊戲。' : '任務開始前可以入座或改為觀戰；開局後身分固定。若已經開局，請改選觀戰。'}</p><label htmlFor="guest-name">你的暱稱</label><input autoFocus id="guest-name" autoComplete="nickname" maxLength={20} placeholder="讓朋友認得你" required value={name} onChange={e => setName(e.target.value)} /><ErrorMessage>{error}</ErrorMessage><Submit busy={busy} disabled={!name.trim()}>{access === 'player' ? '加入隊員' : '進入觀戰席'}</Submit></form> : <ErrorMessage>邀請資訊不完整，請重新開啟房主分享的完整連結。若連結已失效，請房主產生新邀請。</ErrorMessage>}<Note>一個瀏覽器在同一房間保留一種身分。重新整理可恢復，清除網站資料後憑證就會遺失。</Note></section></main></div>;
}

function Lobby({ onUpdate }: { onUpdate: (info: RoomInfo) => void }) {
  const { seat, info } = useContext(RoomContext)!;
  const selected = info.gameSelected !== false;
  const presentation = selected ? clientGames[info.gameName] : undefined;
  const Rules = presentation?.Rules;
  const [busy, setBusy] = useState(false);
  const [gameBusy, setGameBusy] = useState(false);
  const [error, setError] = useState('');
  const [rules, setRules] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const players = info.players.filter(p => p.name);
  const own = isPlayer(seat) ? players.find(p => String(p.id) === seat.playerID) : undefined;
  const host = isRoomHost(seat, info);
  const hostPlayerID = roomHostPlayerID(info);
  const ready = players.filter(p => p.ready).length;
  const overCapacity = selected && players.length > info.maxPlayers;
  const eligible = selected && players.length >= info.minPlayers && !overCapacity && ready === players.length;
  const locked = busy || gameBusy;
  async function action(endpoint: 'ready' | 'start' | 'remove', body: object) {
    setBusy(true); setError('');
    try {
      const next = await api<RoomInfo>(`/api/rooms/${seat.roomId}/${endpoint}`, {
        method: 'POST', body: JSON.stringify({ ...(endpoint === 'remove' ? {} : { matchID: info.matchID }), ...body }),
      }, seat);
      // A game or role change remounts the lobby. Late replies belong to the old room state.
      if (mounted.current) onUpdate(next);
    }
    catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <main className="room-layout"><section className="lobby-player-column">
    <div className="lobby-heading"><div className="eyebrow">FRIENDS AT THE TABLE</div><h1>{!selected ? '先集合，再選遊戲。' : info.gameName === 'encrypted-call' ? '特務到齊，準備接通。' : '隊員到齊，就能出發。'}</h1>
      <p className="muted">{players.length} 位玩家 · {selected ? `這款遊戲需 ${info.minPlayers}～${info.maxPlayers} 人` : '等待房主選擇遊戲'} · {info.spectatorCount} 位已加入觀戰</p>
    </div>
    <RoomGamePicker seat={seat} info={info} disabled={busy} onBusy={setGameBusy} onUpdate={onUpdate} />
    <section className="panel roster"><div className="section-heading"><h2>參與名單</h2><span>{players.length} / {info.roomCapacity ?? ROOM_CAPACITY} 席</span></div>
      <div className="roster-players">{players.map(player => <div className="roster-row" key={player.membershipID || player.id}><span className={`avatar ${isPlayer(seat) && String(player.id) === seat.playerID ? 'mine' : ''}`}>{initials(player.name || '')}</span><div><strong>{player.name}{isPlayer(seat) && String(player.id) === seat.playerID && <small className="you-label">你</small>}</strong><small>{String(player.id) === hostPlayerID ? '房主' : `隊員 ${Number(player.id) + 1}`}</small></div><span className={`ready-pill ${player.ready ? 'ready' : ''}`}>{player.ready ? '已準備' : selected ? '準備中' : '待選遊戲'}</span>{host && String(player.id) !== hostPlayerID && String(player.id) !== (isPlayer(seat) ? seat.playerID : null) && <RemovePlayer player={player} busy={locked} onRemove={target => action('remove', { playerID: String(target.id), membershipID: target.membershipID })} />}</div>)}</div>
      {host && <p className="small muted">開局前可移出隊員；持有效邀請的人仍可重新加入。</p>}
      {overCapacity ? <p className="small amber lobby-missing" role="status">這款遊戲最多 {info.maxPlayers} 人，請 {players.length - info.maxPlayers} 位玩家改為觀戰，或由房主切換遊戲。所有人仍保留在房間內。</p>
        : selected && players.length < info.minPlayers ? <p className="small muted lobby-missing">再邀請 {info.minPlayers - players.length} 位玩家，就達到開局人數。</p>
          : <p className="small muted lobby-missing">{players.length < (info.roomCapacity ?? ROOM_CAPACITY) ? '還有朋友要上場？開始前都能加入。' : '參與席位已滿，其他朋友仍可觀戰。'}</p>}
    </section>
    <ErrorMessage>{error}</ErrorMessage><div className="action-dock">
      {isPlayer(seat) ? <button className={`button full ${own?.ready ? 'secondary' : 'primary'}`} disabled={locked || !selected} onClick={() => action('ready', { ready: !own?.ready })}>
        {!selected ? '請先由房主選擇遊戲' : own?.ready ? '已準備好 · 點此取消' : '我準備好了'}<Icon type="check" />
      </button> : <Note>{host ? '你是觀戰房主，無需準備，也不計入開局人數。選好遊戲且參與玩家全員準備後，即可開始。'
        : '你已在觀戰席，無需準備，也不計入開局人數。房主開始後，這裡會自動切換到對局。'}</Note>}
      {host && <button className="button primary full" disabled={locked || !eligible} onClick={() => action('start', {})}>
        以目前 {players.length} 位隊員開始<Icon type="arrow" />
      </button>}
      {(isPlayer(seat) || host) && <p className="small muted center">{selected ? `${ready} / ${players.length} 位已準備 · ${host ? '開始時鎖定隊員名單與本局人數。' : '全員準備後，等待房主開始。'}` : '先選遊戲，再一起準備；切換遊戲後需要重新準備。'}</p>}
    </div>
  </section><aside className="lobby-info-column">{host ? <ShareInvite active /> : <Note>邀請由房主管理。遊戲開始後，仍可邀請其他朋友來觀戰。</Note>}
    {Rules && presentation && <div className="panel mission-brief"><div className="section-label">任務簡報</div><h2>{presentation.lobbyTitle || '遊戲簡介'}</h2><p>{presentation.lobbyDescription}</p><button className="text-button" onClick={() => setRules(!rules)}>{rules ? '收起玩法' : '展開玩法說明'} ↓</button>{rules && <Rules />}<a className="full-rules-link" href={`/rules/${info.gameName}`} target="_blank" rel="noopener noreferrer">閱讀完整詳細規則 ↗</a></div>}
    {!selected && <div className="panel mission-brief"><div className="section-label">同一桌，隨時換玩法</div><h2>朋友先到，遊戲慢慢選。</h2><p>房主可在等待室切換遊戲，成員與邀請連結都會保留。開始後先完成或提前結束本局，再回到這裡換下一款。</p></div>}
  </aside></main>;
}

function Room({ seat, onSwitch }: { seat: AuthSession; onSwitch: (seat: AuthSession) => void }) {
  const [info, setInfo] = useState<RoomInfo>(seat);
  const [inviteUrl, setInviteUrl] = useState(() => savedInvite(seat.roomId) || '');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [invalidSeat, setInvalidSeat] = useState(false);
  const acceptedRevision = useRef(0);
  const sessionID = useRef(crypto.randomUUID());
  function acceptInfo(next: RoomInfo) {
    acceptedRevision.current += 1;
    setInfo(next);
    // Room metadata is refreshed on load. Polls must never persist an old
    // credential over an identity that another tab has just switched.
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let heartbeatTimer: number | undefined;
    let revoked = false;
    const invalid = (e: unknown) => {
      if (e instanceof ApiError && [401, 404, 410].includes(e.status)) {
        const replacement = loadSeat(seat.roomId);
        if (replacement && replacement.credentials !== seat.credentials) {
          onSwitch(replacement);
          return true;
        }
        if (e.status === 401 && readRoleSwitch(seat)) {
          // The role may already have changed but its response was lost. Keep
          // the old key + request UUID solely to recover that committed switch.
          setLoaded(true);
          return false;
        }
        forgetSeat(seat.roomId, seat.credentials);
        revoked = true;
        setInvalidSeat(true);
        return true;
      }
      return false;
    };
    const refresh = async () => {
      const revision = acceptedRevision.current;
      try {
        const next = await api<RoomInfo>(`/api/rooms/${seat.roomId}`, { signal: controller.signal }, seat);
        if (!controller.signal.aborted && revision === acceptedRevision.current) {
          acceptInfo(next); setLoaded(true); setError('');
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (invalid(e)) return;
        setError((e as Error).message);
      }
      if (!controller.signal.aborted && !revoked) timer = window.setTimeout(refresh, 2000);
    };
    const heartbeat = async () => {
      if (controller.signal.aborted || revoked) return;
      try {
        await api(`/api/rooms/${seat.roomId}/heartbeat`, {
          method: 'POST', body: JSON.stringify({ sessionID: sessionID.current }), signal: controller.signal,
        }, seat);
      } catch (e) { if (!controller.signal.aborted) invalid(e); }
      if (!controller.signal.aborted && !revoked) heartbeatTimer = window.setTimeout(heartbeat, 20000);
    };
    void refresh();
    void heartbeat();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
    };
  }, [seat.roomId, seat.credentials]);
  const definition = clientGames[info.gameName];
  const PlayerClient = definition?.PlayerClient;
  const host = isRoomHost(seat, info);
  const stationActive = loaded && info.gameName === 'space-station' && info.status !== 'lobby';
  const session: AuthSession = { ...seat, ...info };
  if (invalidSeat) return <div className="join-page page-join"><Header /><main className="narrow"><section className="panel">
    <h1>你已離開這個房間</h1>
    <p>可能已主動離開、被房主移出，或這次加入已失效。若要重新加入，請開啟有效的完整邀請連結。</p>
    {pendingToken(seat.roomId) && <button className="button primary full" onClick={() => navigate(`/join/${seat.roomId}`)}>重新使用邀請加入</button>}
    <button className="button secondary full" onClick={() => navigate('/')}>回到首頁</button>
  </section></main></div>;
  return <div data-art-game={info.gameSelected !== false ? info.gameName : undefined} className={`room-page ${info.status === 'lobby' ? 'room-lobby' : isPlayer(seat) ? 'room-playing room-game' : 'room-observer room-game'}${stationActive ? ' station-active-room' : ''}`}>
    <Header room={seat.roomId} rulesGame={info.gameSelected !== false ? info.gameName : undefined} />
    {error && <div className="room-error"><ErrorMessage>{error}</ErrorMessage><p className="small muted">連線恢復後會自動重試。請保留這個頁面。</p></div>}
    {!loaded ? !error && <main className="narrow"><p className="loading" role="status">正在確認你的房間身分…</p></main>
      : <RoomContext.Provider value={{ seat: session, info, inviteUrl, setInviteUrl }}>
        <div className="room-chrome">
        <div className="room-tools">
          <div className="room-status-line"><span>{host && '房主 · '}{isPlayer(seat) ? '玩家座位' : '觀戰席'} · {info.numPlayers} 位玩家 · {info.spectatorCount} 位已加入觀戰</span></div>
          {info.status === 'lobby' ? <>
            <RoleSwitcher seat={session} info={info} onChange={onSwitch} />
            <RoomActions seat={session} info={info} onUpdate={acceptInfo} />
          </> : <details className="station-room-menu"><summary>房間管理</summary><div className="station-room-menu-content">
            <RoleSwitcher seat={session} info={info} onChange={onSwitch} />
            <RoomActions seat={session} info={info} onUpdate={acceptInfo} />
            {host && info.status !== 'lobby' && <details className="post-start-invite"><summary>邀請朋友觀戰</summary><ShareInvite active /></details>}
          </div></details>}
        </div>
        <SpectatorRoster info={info} seat={session} />
        </div>
        {info.status === 'lobby' ? <><RoomHistory seat={session} info={info} /><Lobby key={info.matchID} onUpdate={acceptInfo} /></>
          : isPlayer(seat) ? PlayerClient
            ? <PlayerClient key={info.matchID} matchID={info.matchID} playerID={seat.playerID} credentials={seat.credentials} />
            : <main className="narrow"><ErrorMessage>此遊戲尚未提供玩家介面。</ErrorMessage></main>
          : <ObservationPanel key={info.matchID} seat={session} info={info} />}
      </RoomContext.Provider>}
  </div>;
}
export function App() {
  const [path, setPath] = useState(location.pathname);
  const [seatRevision, setSeatRevision] = useState(0);
  useEffect(() => {
    const update = () => { captureInvite(); captureReplayShare(); setPath(location.pathname); setSeatRevision(n => n + 1); };
    const identityChanged = (event: StorageEvent) => {
      if (event.storageArea === localStorage && isIdentityStorageKey(event.key)) setSeatRevision(n => n + 1);
    };
    window.addEventListener('popstate', update); window.addEventListener('hashchange', update);
    window.addEventListener('storage', identityChanged);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update); window.removeEventListener('storage', identityChanged); };
  }, []);
  function enter(seat: AuthSession) { setSeatRevision(n => n + 1); navigate(`/room/${seat.roomId}`); }
  const rulesMatch = path.match(/^\/rules(?:\/([a-z0-9-]+))?\/?$/);
  if (rulesMatch && (!rulesMatch[1] || isGameID(rulesMatch[1]))) return <RulesPage gameID={rulesMatch[1] as RulesGameID | undefined} />;
  const match = path.match(/^\/(join|room|replay)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return <Home onEnter={enter} />;
  const roomId = match[2];
  if (match[1] === 'replay') return <SharedReplay key={`${roomId}-${seatRevision}`} roomId={roomId} />;
  if (match[1] === 'join') return <Join key={`${roomId}-${seatRevision}`} roomId={roomId} onEnter={enter} />;
  const seat = loadSeat(roomId);
  return seat ? <Room key={`${roomId}-${seat.credentials}`} seat={seat} onSwitch={enter} /> : <div className="join-page page-join"><Header /><main className="narrow"><section className="panel"><h1>這個瀏覽器還沒加入房間。</h1><p className="muted">請開啟房主分享的完整邀請連結，選擇參與遊戲或觀戰。已加入過的朋友，請使用原本的瀏覽器。</p><button className="button secondary" onClick={() => navigate('/')}>回到首頁</button></section></main></div>;
}
