import { mailObserverView, type MailState } from '../games/post/game';
import type { SnapshotProps } from './game-types';
import { MailLayout, useMailPrivacy } from './MailBoard';
import { SnapshotPlayerSelect, useInspectedPlayer } from './SnapshotPlayerSelect';

/** Reproject even a cached god frame before a blind render. No move callbacks. */
export function MailSnapshot({ G: state, info, perspective, replay = false }: SnapshotProps) {
  const G = mailObserverView(state as MailState, perspective);
  const ids = Object.keys(G.players);
  const [id, setID] = useInspectedPlayer(ids);
  const [visible, setVisible] = useMailPrivacy();
  const nameOf = (target: string) => info.players.find(player => String(player.id) === target)?.name || `信使 ${Number(target) + 1}`;
  return <MailLayout G={G} info={info} ownID={id} nameOf={nameOf} visible={visible} onVisible={setVisible} readonly replay={replay}
    inspector={<div className="mail-inspector"><SnapshotPlayerSelect playerIDs={ids} value={id} onChange={setID} nameOf={nameOf}
      label={`查看信使信袋（${perspective === 'god' ? '上帝視角' : '盲視角'}）`} /></div>} />;
}
