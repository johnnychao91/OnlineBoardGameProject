import { useState } from 'react';
import type { AuthSession, RoomInfo } from './api';
import { clientGames, gameResultLabel } from './game-registry';
import { ReplayPanel } from './ReplayViewer';

export function RoomHistory({ seat, info }: { seat: AuthSession; info: RoomInfo }) {
  const [selected, setSelected] = useState<string | null>(null);
  const history = info.history ?? [];
  const latest = history[history.length - 1];
  if (!latest) return null;
  const latestGame = latest.gameName ?? info.gameName;
  const definition = clientGames[latestGame];
  const current = history.find(entry => entry.matchID === selected && entry.ending === 'completed');
  return <section className="room-history">
    <div className="panel previous-result">
      <div className="eyebrow">MISSION ARCHIVE</div>
      <h2 className={latestGame === 'space-station' && latest.ending === 'completed' && latest.winner === 'saboteur' ? 'role-saboteur' : undefined}>{latest.ending === 'completed'
        ? gameResultLabel(latestGame, latest.winner)
        : '上一局已提前結束'}</h2>
      <span className="history-game-name">{definition?.name || latestGame}</span>
      <p className="muted">{latest.ending === 'completed'
        ? definition?.reasonLabels[latest.reason ?? ''] ?? '對局已完成，結果已保存。'
        : latest.ending === 'host-ended' ? '房主提前結束本局，不計入勝敗。' : '所有人已離開或離線逾時，本局不計入勝敗。'}</p>
      <p className="small muted">仍在同一個房間，邀請繼續有效。可換遊戲，全員重新準備後開始下一局。</p>
      {latest.ending === 'completed' && <button className="button secondary" onClick={() => setSelected(current?.matchID === latest.matchID ? null : latest.matchID)}>
        {current?.matchID === latest.matchID ? '收起結果與復盤' : '查看上一局結果與復盤'}
      </button>}
      {history.some(entry => entry.ending === 'completed' && entry.matchID !== latest.matchID) && <details className="history-list">
        <summary>這個房間的已完成對局</summary>
        {history.map((entry, index) => entry.ending === 'completed' && <button className="text-button" key={entry.matchID}
          onClick={() => setSelected(entry.matchID)}>
          第 {index + 1} 局 · {clientGames[entry.gameName ?? info.gameName]?.name || entry.gameName} · {entry.numPlayers} 人 · <span className={(entry.gameName ?? info.gameName) === 'space-station' && entry.winner === 'saboteur' ? 'role-saboteur' : undefined}>{gameResultLabel(entry.gameName ?? info.gameName, entry.winner)}</span>
        </button>)}
      </details>}
    </div>
    {current && <div className="room-history-replay">
      <button className="button secondary close-history" onClick={() => setSelected(null)}>收起復盤，返回等待室</button>
      <ReplayPanel key={current.matchID} seat={seat} info={info} matchID={current.matchID} initialLast />
    </div>}
  </section>;
}
