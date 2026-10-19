import { createContext } from 'react';
import type { AuthSession, RoomInfo } from './api';

export interface RoomContextValue {
  seat: AuthSession;
  info: RoomInfo;
  inviteUrl: string;
  setInviteUrl: (url: string) => void;
}
export const RoomContext = createContext<RoomContextValue | null>(null);
