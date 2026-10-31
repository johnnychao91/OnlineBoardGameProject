import { useEffect } from 'react';
import type { RoomInfo } from './api';
import { completedReturnPath } from './game-return';

/** Use a normal same-tab anchor so AdSense can handle an eligible navigation. */
export function CompletedGameReturn({ info, matchID, onContinue }: {
  info: RoomInfo; matchID: string; onContinue: () => void;
}) {
  useEffect(() => { if (info.status !== 'lobby') onContinue(); }, [info.status, onContinue]);
  return <main className="narrow"><section className="panel">
    <h1>本局已結束</h1><p className="muted">對局紀錄已保留，回到同一房間準備下一局。</p>
    <a className="button primary full completed-return-link" href={completedReturnPath(info.roomId, matchID)}
      onClick={event => { if (info.status !== 'lobby') { event.preventDefault(); onContinue(); } }}>
      返回等待室
    </a>
  </section></main>;
}
