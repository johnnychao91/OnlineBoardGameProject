import type { Perspective, RoomInfo } from './api';

/** Shared read-only rendering contract; no game actions or credentials are passed. */
export interface SnapshotProps {
  G: unknown;
  info: RoomInfo;
  perspective: Perspective;
  replay?: boolean;
}

export interface PosterOptions {
  G: unknown;
  info: RoomInfo;
  step: number;
  totalSteps: number;
}
