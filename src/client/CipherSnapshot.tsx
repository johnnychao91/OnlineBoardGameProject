import type { CipherState } from '../games/cipher/game';
import type { SnapshotProps } from './game-types';
import { BattleReport } from './BattleReport';
import { CipherAgents, CipherHeading, CipherLog, CipherMetrics, CipherStatus, CipherTransmission } from './CipherBoard';
import './cipher.css';

/** Observers and replay viewers receive no game client or move callbacks. */
export function CipherSnapshot({ G: unknownState, info, perspective, replay = false }: SnapshotProps) {
  const G = unknownState as CipherState;
  const nameOf = (id: string) => info.players.find(p => String(p.id) === id)?.name || `特務 ${Number(id) + 1}`;
  return <div className="snapshot-layout cipher-snapshot">
    <section>
      <CipherHeading G={G} />
      <CipherMetrics G={G} />
      <CipherStatus G={G} />
      <p className="small muted">{replay ? '這是歷史畫面，不會改變線上對局。' : '你正在觀戰，不占特務名額；請勿透露牌面或提示時機。'}
        {' · '}{perspective === 'god' ? '上帝視角：可查看未公開手牌' : '盲視角：只顯示公開訊息'}</p>
      <CipherTransmission G={G} />
      <CipherAgents G={G} nameOf={nameOf} god={perspective === 'god'} />
      {G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective={perspective} label="製作本局任務戰報" />}
    </section>
    <aside><CipherLog G={G} nameOf={nameOf} /></aside>
  </div>;
}
