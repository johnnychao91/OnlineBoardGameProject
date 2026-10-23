import { isTuringSharedTable, turingObserverView, type TuringState } from '../games/turing/game';
import { isRoomHost, type AuthSession, type Perspective, type RoomInfo } from './api';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';
import { TuringLayout, turingNameOf, useTuringPrivacy } from './TuringBoard';
import { TuringOrderControl, TuringRedrawControls, useTuringHostAction } from './TuringApprovalControls';

/** Only the authenticated live observer surface supplies authority; snapshots remain read-only. */
export function TuringLiveObservation({ G: state, info, seat, perspective, onRefresh }: {
  G: unknown; info: RoomInfo; seat: AuthSession; perspective: Perspective; onRefresh: () => void;
}) {
  const G = turingObserverView(state as TuringState, perspective);
  const [selectedID, setSelectedID] = useInspectedPlayer(Object.keys(G.players));
  const [visible, setVisible] = useTuringPrivacy();
  const nameOf = turingNameOf(info), host = isRoomHost(seat, info);
  const action = useTuringHostAction(seat, info.matchID, G.epoch, onRefresh);
  const redraw = host && G.options.redrawApproval === 'host';
  const order = host && G.options.orderApproval === 'host' && isTuringSharedTable(G) && G.status === 'sorting';
  const controls = host && (order || action.pending || action.error) ? <>
    {order && <TuringOrderControl G={G} canAct={!action.pending} onApprove={() => void action.send('order')} />}
    {action.pending && <p className="small muted" role="status">正在確認操作…</p>}
    {action.error && <p className="error-message" role="status">{action.error}</p>}
  </> : undefined;
  return <TuringLayout G={G} info={info} nameOf={nameOf} ownID={selectedID} visible={visible} onVisible={setVisible} readonly controls={controls}
    observerQuestionControls={redraw ? <TuringRedrawControls G={G} nameOf={nameOf} canAct={!action.pending} onApprove={() => void action.send('redraw')} /> : undefined}
    inspector={<SnapshotPlayerSelect playerIDs={Object.keys(G.players)} value={selectedID} onChange={setSelectedID} nameOf={nameOf} label={`查看情報（${perspective === 'god' ? '上帝視角' : '盲視角'}）`} />} />;
}
