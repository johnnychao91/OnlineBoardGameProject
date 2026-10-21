import { fogObserverView, type FogState } from '../games/fog/game';
import type { SnapshotProps } from './game-types';
import { BattleReport } from './BattleReport';
import { FogHeading, FogLog, FogParticipants, FogPrivatePanel, FogPublicPhase, FogRuleSummary, FogStatus, FogTrack } from './FogBoard';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';

/** Defense against a previous god frame remaining visible during a perspective switch. */
export function fogSnapshotState(G: FogState, perspective: SnapshotProps['perspective']): FogState {
  const view = fogObserverView(G, perspective);
  if (view.status !== 'finished') for (const player of Object.values(view.players)) {
    delete player.revealedRole; delete player.revealedFaction;
  }
  return view;
}

/** Read-only: neither this component nor its public table accepts move callbacks. */
export function FogSnapshot({ G: state, info, perspective, replay = false }: SnapshotProps) {
  const G = fogSnapshotState(state as FogState, perspective);
  const nameOf = (id: string) => info.players.find(player => String(player.id) === id)?.name || `巡夜者 ${Number(id) + 1}`;
  const playerIDs = Object.keys(G.players);
  const [selectedID, setSelectedID] = useInspectedPlayer(playerIDs);
  return <div className="game-layout fog-layout fog-snapshot">
    <section className="game-main fog-main"><FogHeading G={G} subtitle={replay ? 'NIGHT WATCH REPLAY' : 'OBSERVATION DECK'} /><FogStatus G={G} nameOf={nameOf} /><FogTrack G={G} /><FogParticipants G={G} nameOf={nameOf} /><section className="panel fog-action-panel"><FogPublicPhase G={G} nameOf={nameOf} /><p className="small muted">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 不占參與席位'}。觀戰者無需表決或確認。</p></section></section>
    <aside className="fog-personal-aside"><FogPrivatePanel G={G} playerID={selectedID} nameOf={nameOf} observer><div className="fog-inspector"><SnapshotPlayerSelect playerIDs={playerIDs} value={selectedID} onChange={setSelectedID} nameOf={nameOf} label={`查看巡夜者情報（${perspective === 'god' ? '上帝視角' : '盲視角'}）`} /></div></FogPrivatePanel></aside>
    <aside className="game-aside fog-history-aside"><FogLog G={G} nameOf={nameOf} /><details className="panel rules-details"><summary>巡夜規則速查</summary><FogRuleSummary /></details>{G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective={perspective} label="製作巡夜戰報" />}</aside>
  </div>;
}
