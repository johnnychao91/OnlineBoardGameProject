import { useEffect, useRef, useState } from 'react';
import { api, isRoomHost, type AuthSession, type GameInfo, type RoomInfo } from './api';
import { ErrorMessage } from './ui';
import './room-game-picker.css';

export function RoomGamePicker({ seat, info, disabled, onBusy, onUpdate }: {
  seat: AuthSession; info: RoomInfo; disabled: boolean;
  onBusy: (busy: boolean) => void; onUpdate: (info: RoomInfo) => void;
}) {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const sending = useRef(false);
  const host = isRoomHost(seat, info);
  const selected = info.gameSelected !== false;
  const game = selected ? games.find(game => game.id === info.gameName) : undefined;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    api<{ games: GameInfo[] }>('/api/games', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setGames(result.games); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  async function choose(gameId: string) {
    if (!host || disabled || sending.current || info.status !== 'lobby' || (selected && gameId === info.gameName)) return;
    sending.current = true; setBusy(true); setError(''); onBusy(true);
    try {
      const next = await api<RoomInfo>(`/api/rooms/${seat.roomId}/game`, {
        method: 'POST', body: JSON.stringify({ matchID: info.matchID, gameId }),
      }, seat);
      if (mounted.current) onUpdate(next);
    } catch (error) { if (mounted.current) setError((error as Error).message); }
    finally { sending.current = false; if (mounted.current) { setBusy(false); onBusy(false); } }
  }
  return <section className="panel room-game-picker" aria-label="本房遊戲">
    <div className="room-game-picker-heading"><label htmlFor="room-game">這一局玩什麼</label><span>{busy ? '正在切換…' : selected ? '已選擇' : '尚未選擇'}</span></div>
    {host ? <select id="room-game" aria-label="選擇房間遊戲" value={selected ? info.gameName : ''}
      disabled={disabled || busy || !games.length} onChange={event => void choose(event.target.value)}>
      <option value="" disabled>請選擇遊戲</option>
      {games.map(game => <option key={game.id} value={game.id}>{game.name} · {game.minPlayers}～{game.maxPlayers} 人</option>)}
    </select> : <strong className="room-game-name">{game?.name || (selected ? '正在讀取遊戲…' : '等待房主選擇遊戲')}</strong>}
    {game && <p className="small muted">{game.description} · {game.minPlayers}～{game.maxPlayers} 人</p>}
    <p className="small muted">{host ? '選擇後即時套用；切換會清除全員準備，成員與邀請連結保留。' : '房主可在開局前切換遊戲；切換後請重新準備。'}</p>
    <ErrorMessage>{error}</ErrorMessage>
  </section>;
}
