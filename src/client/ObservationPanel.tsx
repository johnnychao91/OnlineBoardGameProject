import { useEffect, useRef, useState } from 'react';
import { api, type AuthSession, type Perspective, type RoomInfo } from './api';
import { clientGames } from './game-registry';
import { ErrorMessage } from './ui';
import { GameSoundControl } from './GameSoundControl';
import { TuringLiveObservation } from './TuringLiveObservation';

export function PerspectiveSwitch({ perspective, onChange, disabled = false }: { perspective: Perspective; onChange: (value: Perspective) => void; disabled?: boolean }) {
  return <div className="perspective-switch" role="group" aria-label="觀察視角"><button disabled={disabled} className={perspective === 'blind' ? 'selected' : ''} aria-pressed={perspective === 'blind'} onClick={() => onChange('blind')}>盲視角</button><button disabled={disabled} className={perspective === 'god' ? 'selected' : ''} aria-pressed={perspective === 'god'} onClick={() => onChange('god')}>上帝視角</button></div>;
}

export function PerspectiveNote({ perspective, shared = false }: { perspective: Perspective; shared?: boolean }) {
  return <p className={`perspective-note ${perspective === 'god' ? 'god-note' : ''}`}>{perspective === 'god' ? shared ? '此分享包含所有參與者的秘密資訊與手牌。請避免透露給尚在遊玩的朋友。' : '上帝視角包含所有參與者的秘密資訊與手牌。觀戰時請勿透露給正在遊玩的朋友。' : '盲視角只顯示當時已公開的資訊，尚未公開的手牌與身分保持隱藏。'}</p>;
}

export function ObservationPanel({ seat, info }: { seat: AuthSession; info: RoomInfo }) {
  const [perspective, setPerspective] = useState<Perspective>('blind');
  const [view, setView] = useState<{ G: unknown; stateID: number; perspective: Perspective; matchID: string } | null>(null);
  const [error, setError] = useState('');
  const refreshNow = useRef<() => void>(() => {});
  const definition = clientGames[info.gameName];
  useEffect(() => {
    const controller = new AbortController(); let timer: number | undefined;
    setView(null); setError('');
    const refresh = async (schedule = true) => {
      try {
        const response = await api<{ G: unknown; stateID: number; perspective: Perspective }>(`/api/rooms/${seat.roomId}/view?perspective=${perspective}`, { signal: controller.signal }, seat);
        const next = { ...response, matchID: info.matchID };
        if (!controller.signal.aborted) { setView(previous => previous?.matchID === next.matchID && previous.perspective === next.perspective && previous.stateID > next.stateID ? previous : next); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      if (!controller.signal.aborted && schedule) timer = window.setTimeout(() => void refresh(), 2000);
    };
    refreshNow.current = () => void refresh(false);
    void refresh();
    return () => { controller.abort(); refreshNow.current = () => {}; if (timer !== undefined) clearTimeout(timer); };
  }, [seat.roomId, seat.credentials, info.matchID, perspective]);
  if (!definition) return <ErrorMessage>此遊戲尚未註冊觀戰介面。</ErrorMessage>;
  const Snapshot = definition.Snapshot;
  const currentView = view?.matchID === info.matchID && view.perspective === perspective ? view : null;
  return <section className="observation-panel"><div className="observer-toolbar"><div><span className="eyebrow">READ-ONLY OBSERVATION</span><h2>觀戰席</h2><p className="small muted">{info.spectatorCount} 位已加入觀戰 · 不占玩家座位</p></div><div className="observer-controls"><GameSoundControl gameID={info.gameName} G={currentView?.G} matchID={info.matchID} connected={!error && !!currentView} /><PerspectiveSwitch perspective={perspective} onChange={setPerspective} /></div></div><PerspectiveNote perspective={perspective} /><ErrorMessage>{error}</ErrorMessage>{currentView ? info.gameName === 'turing-test' ? <TuringLiveObservation G={currentView.G} info={info} seat={seat} perspective={perspective} onRefresh={() => refreshNow.current()} /> : <Snapshot G={currentView.G} info={info} perspective={perspective} /> : <p className="loading" role="status">正在同步{perspective === 'god' ? '上帝' : '盲'}視角…</p>}</section>;
}
