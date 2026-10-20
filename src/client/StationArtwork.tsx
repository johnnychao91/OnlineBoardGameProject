import type { CardKind, Role } from '../games/station/game';

/** Decorative only. Callers pass information already visible in their view;
 * these components never inspect a game state or hidden card position. */
export function DeviceArtwork({ kind }: { kind: CardKind | null }) {
  return kind ? <span className="station-device-art" data-art-kind={kind} aria-hidden="true" /> : null;
}

export function RoleArtwork({ role }: { role: Role | undefined }) {
  return role ? <span className="station-role-art" data-art-role={role} aria-hidden="true" /> : null;
}
