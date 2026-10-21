import { ROOM_CAPACITY } from '../games/catalog';
import { isRoomHost, type AuthSession, type RoomInfo } from './api';
import './test-room.css';

export function TestRoomBadge({ info }: { info: RoomInfo }) {
  return info.testRoom ? <span className="test-room-badge">測試房間 · 不計戰績</span> : null;
}

export function TestRoomBots({ seat, info, disabled, onAdd }: {
  seat: AuthSession; info: RoomInfo; disabled: boolean; onAdd: () => void;
}) {
  if (!info.testRoom || info.status !== 'lobby') return null;
  const count = info.players.filter(player => player.name).length;
  const capacity = info.gameSelected === false ? info.roomCapacity ?? ROOM_CAPACITY : info.maxPlayers;
  const full = count >= capacity;
  return <div className="test-room-bots">
    <div><strong>虛擬玩家陪你試玩</strong><p>自動準備並隨機行動，真人仍可透過原邀請加入。本房所有對局都不計入戰績。</p></div>
    {isRoomHost(seat, info) ? <><button type="button" className="button secondary" disabled={disabled || full} onClick={onAdd}>
      {full ? `已達 ${capacity} 位玩家上限` : '加入一位虛擬玩家'}
    </button><p className="small muted">開始前可移出虛擬玩家，替朋友空出席位。{!full && `還可加入 ${capacity - count} 位。`}</p></>
      : <p className="small muted">由房主在開始前新增或移出虛擬玩家。</p>}
  </div>;
}
