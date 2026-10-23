import { useState } from 'react';
import { turingObserverView, type TuringState } from '../games/turing/game';
import { isRoomHost, type AuthSession, type Perspective, type RoomInfo } from './api';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';
import { TuringLayout, turingNameOf, useTuringPrivacy } from './TuringBoard';
import { TuringFinishControl, useTuringHostAction } from './TuringApprovalControls';
import { TuringPolicySettings } from './TuringPolicySettings';
import { RoomManagementContent } from './room-context';

/** Only the authenticated live observer surface supplies authority; snapshots remain read-only. */
export function TuringLiveObservation({ G: state, info, seat, perspective, onRefresh }: {
  G: unknown; info: RoomInfo; seat: AuthSession; perspective: Perspective; onRefresh: () => void;
}) {
  const G = turingObserverView(state as TuringState, perspective);
  const [selectedID, setSelectedID] = useInspectedPlayer(Object.keys(G.players));
  const [visible, setVisible] = useTuringPrivacy();
  const nameOf = turingNameOf(info), host = isRoomHost(seat, info);
  const action = useTuringHostAction(seat, info.matchID, G.epoch, onRefresh);
  const [policyPending, setPolicyPending] = useState(false);
  const controls = host && G.status !== 'finished' && (G.targetRounds === null || action.pending || action.error) ? <>
    <TuringFinishControl G={G} canAct={!action.pending && !policyPending} onFinish={() => void action.send('finish')} />
    {action.pending && <p className="small muted" role="status">正在確認操作…</p>}
    {action.error && <p className="error-message" role="status">{action.error}</p>}
  </> : undefined;
  return <>
    {host && G.status !== 'finished' && <RoomManagementContent>
      {G.rulesVersion >= 4 && <TuringPolicySettings seat={seat} info={info} policies={G.options} epoch={G.epoch} disabled={action.pending} onBusy={setPolicyPending} onRefresh={onRefresh} compact />}
      {controls}
    </RoomManagementContent>}
    <TuringLayout G={G} info={info} nameOf={nameOf} ownID={selectedID} visible={visible} onVisible={setVisible} readonly
      inspector={<SnapshotPlayerSelect playerIDs={Object.keys(G.players)} value={selectedID} onChange={setSelectedID} nameOf={nameOf} label={`查看情報（${perspective === 'god' ? '上帝視角' : '盲視角'}）`} />} />
  </>;
}
