import { isGameID, type GameID } from './catalog';

export type MediaID = 'endless-bar' | GameID;

export function mediaPageID(pathname: string): MediaID | undefined {
  if (pathname === '/media.html') return 'endless-bar';
  const match = /^\/media(?:\/([a-z0-9-]+))?\/?$/.exec(pathname);
  if (!match) return undefined;
  const game = match[1];
  if (!game || game === 'endless-bar') return 'endless-bar';
  return isGameID(game) ? game : undefined;
}
