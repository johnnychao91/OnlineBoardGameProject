import { useEffect, useState } from 'react';
import { api, type AuthSession, type Perspective, type RoomInfo } from './api';
import { clientGames } from './game-registry';
import { ErrorMessage } from './ui';

export function PerspectiveSwitch({ perspective, onChange, disabled = false }: { perspective: Perspective; onChange: (value: Perspective) => void; disabled?: boolean }) {
  return <div className="perspective-switch" role="group" aria-label="觀察視角"><button disabled={disabled} className={perspective === 'blind' ? 'selected' : ''} aria-pressed={perspective === 'blind'} onClick={() => onChange('blind')}>盲視角</button><button disabled={disabled} className={perspective === 'god' ? 'selected' : ''} aria-pressed={perspective === 'god'} onClick={() => onChange('god')}>上帝視角</button></div>;
}

export function PerspectiveNote({ perspective, shared = false }: { perspective: Perspective; shared?: boolean }) {
  return <p className={`perspective-note ${perspective === 'god' ? 'god-note' : ''}`}>{perspective === 'god' ? shared ? '此分享公開所有陣營、設備組成與暗牌順序。請避免透露給尚在遊玩的朋友。' : '上帝視角包含所有陣營與暗牌順序。觀戰時請勿透露秘密給正在遊玩的隊員。' : '盲視角只顯示公開資訊；未揭開的設備與尚未公布的陣營保持隱藏。'}</p>;
}

export function ObservationPanel({ seat, info }: { seat: AuthSession; info: RoomInfo }) {
  const [perspective, setPerspective] = useState<Perspective>('blind');
  const [view, setView] = useState<{ G: unknown; stateID: number; perspective: Perspective } | null>(null);
  const [error, setError] = useState('');
  const definition = clientGames[info.gameName];
  useEffect(() => {
    const controller = new AbortController(); let timer: number | undefined;
    setView(null); setError('');
    const refresh = async () => {
      try {
        const next = await api<{ G: unknown; stateID: number; perspective: Perspective }>(`/api/rooms/${seat.roomId}/view?perspective=${perspective}`, { signal: controller.signal }, seat);
        if (!controller.signal.aborted) { setView(next); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      if (!controller.signal.aborted) timer = window.setTimeout(refresh, 2000);
    };
    void refresh();
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [seat.roomId, seat.credentials, info.matchID, perspective]);
  if (!definition) return <ErrorMessage>此遊戲尚未註冊觀戰介面。</ErrorMessage>;
  const Snapshot = definition.Snapshot;
  return <section className="observation-panel"><div className="observer-toolbar"><div><span className="eyebrow">READ-ONLY OBSERVATION</span><h2>觀戰席</h2><p className="small muted">{info.spectatorCount} 位已加入觀戰 · 不占玩家座位</p></div><PerspectiveSwitch perspective={perspective} onChange={setPerspective} /></div><PerspectiveNote perspective={perspective} /><ErrorMessage>{error}</ErrorMessage>{view?.perspective === perspective ? <Snapshot G={view.G} info={info} perspective={perspective} /> : <p className="loading" role="status">正在同步{perspective === 'god' ? '上帝' : '盲'}視角…</p>}</section>;
}
