import type { Server } from 'boardgame.io';

/** Kept at the metadata root, outside the player records sent by Socket.IO. */
export type EchoRankMetadata = Server.MatchData & {
  echoBrowserHashes?: Record<string, string>;
  echoRankedSeats?: Record<string, { browserHash: string; name: string }>;
};
