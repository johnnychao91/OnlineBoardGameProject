import type { AuthSession, Perspective, RoomInfo } from './api';

export interface LobbyOptionsProps {
  seat: AuthSession; info: RoomInfo; disabled: boolean;
  onBusy: (busy: boolean) => void; onUpdate: (info: RoomInfo) => void;
}

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
