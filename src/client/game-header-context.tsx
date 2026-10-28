import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface GameHeaderState {
  soundTarget: HTMLDivElement | null;
  setSoundTarget: (target: HTMLDivElement | null) => void;
  replayGameID: string | undefined;
  setReplayGameID: (id: string | undefined) => void;
}
export const GameHeaderContext = createContext<GameHeaderState | null>(null);
export function GameHeaderProvider({ children }: { children: ReactNode }) {
  const [soundTarget, setSoundTarget] = useState<HTMLDivElement | null>(null);
  const [replayGameID, setReplayGameID] = useState<string>();
  const value = useMemo(() => ({ soundTarget, setSoundTarget, replayGameID, setReplayGameID }), [soundTarget, replayGameID]);
  return <GameHeaderContext.Provider value={value}>{children}</GameHeaderContext.Provider>;
}
/** An open historical replay owns the heading until it closes. */
export function useReplayHeader(gameID: string | undefined) {
  const setGameID = useContext(GameHeaderContext)?.setReplayGameID;
  useEffect(() => {
    if (!gameID || !setGameID) return;
    setGameID(gameID);
    return () => setGameID(undefined);
  }, [gameID, setGameID]);
}
