import { isPlayer, type AuthSession, type RoomInfo } from './api';
import { Icon } from './ui';
import './spectator-roster.css';

export function SpectatorRoster({ info, seat }: { info: RoomInfo; seat: AuthSession }) {
  const spectators = info.spectators;
  const count = spectators?.length ?? info.spectatorCount;

  return <section className="spectator-roster" aria-label="觀戰席名單">
    <details className="spectator-roster-panel" open>
      <summary>
        <Icon type="signal" size={18} />
        <span className="spectator-roster-title">觀戰席</span>
        <span className="spectator-roster-count">{count} 位</span>
        <span className="spectator-roster-chevron" aria-hidden="true">⌄</span>
      </summary>
      <p className="spectator-roster-note">觀戰者不計入參與人數。</p>
      {spectators?.length ? <ul className="spectator-roster-list" aria-label="觀戰者">
        {spectators.map(spectator => {
          const mine = !isPlayer(seat) && seat.observerID === spectator.id;
          return <li key={spectator.id} className={mine ? 'spectator-roster-person mine' : 'spectator-roster-person'}>
            <span className="spectator-roster-avatar" aria-hidden="true"><Icon type="signal" size={15} /></span>
            <span className="spectator-roster-name">{spectator.name}</span>
            {info.hostObserverID === spectator.id && <span className="spectator-roster-you spectator-roster-host">房主</span>}
            {mine && <span className="spectator-roster-you">你</span>}
          </li>;
        })}
      </ul> : <p className="spectator-roster-empty">{count ? '正在同步觀戰名單…' : '目前沒有觀戰者，朋友可以透過邀請連結加入觀戰。'}</p>}
    </details>
  </section>;
}
