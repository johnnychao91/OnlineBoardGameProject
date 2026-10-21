import { fogObserverView, type FogState } from '../games/fog/game';
import type { SnapshotProps } from './game-types';
import { BattleReport } from './BattleReport';
import { FogHeading, FogLog, FogParticipants, FogPrivatePanel, FogPublicPhase, FogReviewFooter, FogRuleSummary, FogStatus, FogTrack, useFogPrivacy } from './FogBoard';
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
  const [secretsVisible, setSecretsVisible] = useFogPrivacy();
  const review = ['briefing', 'vote-review', 'quest-review'].includes(G.status);
  return <div className="game-layout fog-layout fog-snapshot">
    <section className={`game-main fog-main ${review ? 'fog-reviewing' : ''}`}><FogHeading G={G} subtitle={replay ? 'NIGHT WATCH REPLAY' : 'OBSERVATION DECK'} /><FogStatus G={G} nameOf={nameOf} /><FogTrack G={G} /><FogParticipants G={G} nameOf={nameOf} secretsVisible={secretsVisible} godView={perspective === 'god'} /><section className={`panel fog-action-panel ${review ? 'fog-review-panel' : ''}`}><div className="fog-action-content"><FogPublicPhase G={G} nameOf={nameOf} showWaiting={false} /><p className="small muted fog-readonly-note">{replay ? '歷史畫面 · 唯讀復盤' : '觀戰席 · 不占參與席位'}。觀戰者無需表決或確認。</p></div>{review && <FogReviewFooter G={G} nameOf={nameOf} />}</section></section>
    <aside className="fog-personal-aside"><FogPrivatePanel G={G} playerID={selectedID} nameOf={nameOf} observer expanded={secretsVisible} onExpandedChange={setSecretsVisible}><div className="fog-inspector"><SnapshotPlayerSelect playerIDs={playerIDs} value={selectedID} onChange={setSelectedID} nameOf={nameOf} label={`查看巡夜者情報（${perspective === 'god' ? '上帝視角' : '盲視角'}）`} /></div></FogPrivatePanel></aside>
    <aside className="game-aside fog-history-aside"><FogLog G={G} nameOf={nameOf} /><details className="panel rules-details"><summary>巡夜規則速查</summary><FogRuleSummary /></details>{G.status === 'finished' && !replay && <BattleReport G={G} info={info} perspective={perspective} label="製作巡夜戰報" />}</aside>
  </div>;
}
