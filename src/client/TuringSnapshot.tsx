import { turingObserverView, type TuringState } from '../games/turing/game';
import type { SnapshotProps } from './game-types';
import { TuringLayout, turingNameOf, useTuringPrivacy } from './TuringBoard';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';

export function TuringSnapshot({ G: state, info, perspective, replay = false }: SnapshotProps) {
  // Re-project when changing from a god frame to blind; no cached secrets remain.
  const G = turingObserverView(state as TuringState, perspective);
  const ids = Object.keys(G.players);
  const [selectedID, setSelectedID] = useInspectedPlayer(ids);
  const [visible, setVisible] = useTuringPrivacy();
  const nameOf = turingNameOf(info);
  return <TuringLayout G={G} info={info} nameOf={nameOf} ownID={selectedID} visible={visible} onVisible={setVisible} readonly replay={replay}
    inspector={<SnapshotPlayerSelect playerIDs={ids} value={selectedID} onChange={setSelectedID} nameOf={nameOf} label={`查看情報（${perspective === 'god' ? '上帝視角' : '盲視角'}）`} />} />;
}
