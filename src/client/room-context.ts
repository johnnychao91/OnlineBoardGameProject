import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AuthSession, RoomInfo } from './api';

export interface RoomContextValue {
  seat: AuthSession;
  info: RoomInfo;
  inviteUrl: string;
  setInviteUrl: (url: string) => void;
  onUpdate?: (info: RoomInfo) => void;
  managementContainer?: HTMLElement | null;
}
export const RoomContext = createContext<RoomContextValue | null>(null);

/** Keep live game state and callbacks in the game while displaying its controls in the room menu. */
export function RoomManagementContent({ children }: { children: ReactNode }) {
  const target = useContext(RoomContext)?.managementContainer;
  return target ? createPortal(children, target) : null;
}
