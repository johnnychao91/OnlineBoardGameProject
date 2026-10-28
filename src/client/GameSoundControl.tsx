import { useContext } from 'react';
import { createPortal } from 'react-dom';
import { GameHeaderContext } from './game-header-context';
import { clientGames } from './game-registry';
import { StationSoundToggle, useGameSounds } from './station-sounds';

/** Shared volume, mute, gesture-unlock and reconnect behavior for every live table. */
export function GameSoundControl({ gameID, G, matchID, playerID, connected = true }: {
  gameID: string; G: unknown; matchID: string; playerID?: string; connected?: boolean;
}) {
  const adapter = clientGames[gameID]?.soundAdapter;
  const controls = useGameSounds({ G: G && adapter ? adapter(G, playerID) : undefined,
    matchID, playerID, connected, enabled: !!adapter });
  const header = useContext(GameHeaderContext);
  const toggle = <StationSoundToggle controls={controls} />;
  return header?.soundTarget ? createPortal(toggle, header.soundTarget) : toggle;
}
