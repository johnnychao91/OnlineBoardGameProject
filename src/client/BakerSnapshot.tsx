import { bakerObserverView, type BakerState } from '../games/baker/game';
import type { SnapshotProps } from './game-types';
import { BakerLayout, useBakerPrivacy } from './BakerBoard';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';

/** A cached authorized frame must be projected again when switching to blind. */
export function BakerSnapshot({ G: state, info, perspective, replay = false }: SnapshotProps) {
  const G = bakerObserverView(state as BakerState, perspective);
  const ids = [...new Set([...(G.holmesID ? [G.holmesID] : []), ...G.turnOrder, ...Object.keys(G.players)])].filter(id => G.players[id]);
  const [id, setID] = useInspectedPlayer(ids), [visible, setVisible] = useBakerPrivacy();
  const nameOf = (target: string) => info.players.find(player => String(player.id) === target)?.name || `警員 ${Number(target) + 1}`;
  return <BakerLayout G={G} info={info} ownID={id} nameOf={nameOf} visible={visible} onVisible={setVisible} readonly replay={replay}
    inspector={<div className="baker-inspector"><SnapshotPlayerSelect playerIDs={ids} value={id} onChange={setID} nameOf={nameOf}
      label={`查看秘密卷宗（${perspective === 'god' ? '上帝視角' : '盲視角'}）`} /></div>} />;
}
