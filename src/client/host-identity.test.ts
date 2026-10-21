import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isRoomHost, roomHostPlayerID, type AuthSession, type ObserverSession, type RoomInfo, type SeatSession } from './api';
import { RoleSwitcher } from './RoleSwitcher';
import { RoomActions } from './RoomActions';
import { SpectatorRoster } from './SpectatorRoster';

const room: RoomInfo = {
  roomId: 'host-test-room', matchID: 'host-test-match', gameName: 'space-station', status: 'lobby',
  numPlayers: 4, minPlayers: 4, maxPlayers: 8,
  players: Array.from({ length: 4 }, (_, id) => ({ id, name: `Player ${id}`, ready: true, isConnected: true })),
  spectatorCount: 2, spectators: [{ id: 'host-observer', name: 'Observer host' }, { id: 'other-observer', name: 'Guest observer' }],
  godViewAllowed: true, hostPlayerID: '0', hostObserverID: null,
};
const player: SeatSession = { ...room, access: 'player', playerID: '0', credentials: 'test-player-credential' };
const observer: ObserverSession = { ...room, access: 'spectator', observerID: 'host-observer', credentials: 'test-observer-credential' };
const spectatorHosted: RoomInfo = { ...room, hostPlayerID: null, hostObserverID: observer.observerID };

describe('player and spectator host presentation', () => {
  it('keeps exactly the selected typed identity as host when moving between player and observer seats', () => {
    expect(isRoomHost(player, room)).toBe(true);
    expect(isRoomHost(observer, room)).toBe(false);
    expect(isRoomHost(player, spectatorHosted)).toBe(false);
    expect(isRoomHost(observer, spectatorHosted)).toBe(true);
    expect(isRoomHost({ ...observer, observerID: 'other-observer' }, spectatorHosted)).toBe(false);
    const returnedHost = { ...spectatorHosted, hostObserverID: null, hostPlayerID: '2' };
    expect(isRoomHost(observer, returnedHost)).toBe(false);
    expect(isRoomHost({ ...player, playerID: '2' }, returnedHost)).toBe(true);
  });

  it('uses player zero only for legacy missing fields and never for an explicit unassigned or spectator host', () => {
    const legacy = { ...room };
    delete legacy.hostPlayerID;
    delete legacy.hostObserverID;
    expect(roomHostPlayerID(legacy)).toBe('0');
    expect(isRoomHost({ ...player, access: undefined }, legacy)).toBe(true);
    expect(roomHostPlayerID({ ...legacy, hostPlayerID: null })).toBeNull();
    expect(roomHostPlayerID({ ...legacy, hostObserverID: null })).toBeNull();
    expect(roomHostPlayerID(spectatorHosted)).toBeNull();
    expect(isRoomHost(player, { ...legacy, hostPlayerID: null })).toBe(false);
    expect(isRoomHost(player, { ...legacy, hostObserverID: observer.observerID })).toBe(false);
  });

  it('does not match hosts by another identity field, malformed IDs or a different room', () => {
    expect(isRoomHost({ ...observer, playerID: '0' } as AuthSession, room)).toBe(false);
    expect(isRoomHost({ ...player, observerID: 'host-observer' } as AuthSession, spectatorHosted)).toBe(false);
    expect(isRoomHost({ ...observer, roomId: 'different-room' }, spectatorHosted)).toBe(false);
    expect(isRoomHost({ ...player, roomId: 'different-room' }, room)).toBe(false);
    expect(isRoomHost({ ...player, access: 'invalid' } as unknown as AuthSession, room)).toBe(false);
    expect(isRoomHost({ ...observer, observerID: '' }, { ...spectatorHosted, hostObserverID: '' })).toBe(false);
    expect(isRoomHost({ ...player, playerID: '' }, { ...room, hostPlayerID: '' })).toBe(false);
  });

  it('labels the spectator host for every viewer without marking unrelated observers as host', () => {
    for (const seat of [player, observer, { ...observer, observerID: 'other-observer' }]) {
      const html = renderToStaticMarkup(createElement(SpectatorRoster, { info: spectatorHosted, seat }));
      expect(html.match(/spectator-roster-host/g)).toHaveLength(1);
      expect(html).toMatch(/Observer host<\/span><span class="spectator-roster-you spectator-roster-host">房主/);
      expect(html).not.toMatch(/Guest observer<\/span><span class="spectator-roster-you spectator-roster-host">房主/);
    }
    expect(renderToStaticMarkup(createElement(SpectatorRoster, { info: room, seat: observer }))).not.toContain('spectator-roster-host');
  });

  it('explains that both host role-switch directions retain room management rights', () => {
    const outgoing = renderToStaticMarkup(createElement(RoleSwitcher, { seat: player, info: room, onChange: () => {} }));
    expect(outgoing).toContain('改為觀戰會釋出玩家席位，仍保留房主權限');
    expect(outgoing).not.toContain('交接房主');
    const returning = renderToStaticMarkup(createElement(RoleSwitcher, { seat: observer, info: spectatorHosted, onChange: () => {} }));
    expect(returning).toContain('加入玩家席位後仍保留房主權限，但需重新準備');
  });

  it('uses shared waiting-room capacity instead of a selected game limit when offering a player seat', () => {
    const info = { ...spectatorHosted, gameName: 'encrypted-call', minPlayers: 2, maxPlayers: 4, roomCapacity: 8 };
    const render = (numPlayers: number) => renderToStaticMarkup(createElement(RoleSwitcher, {
      seat: observer, info: { ...info, numPlayers }, onChange: () => {},
    }));
    const available = render(4);
    const full = render(8);
    expect(available).not.toContain('disabled=""');
    expect(available).toContain('改為參加遊戲');
    expect(full).toContain('disabled=""');
    expect(full).toContain('玩家席位已滿');
  });

  it('shows the active-game abort control to the spectator host but not a regular observer or player zero', () => {
    const info = { ...spectatorHosted, status: 'playing' };
    const markup = (seat: AuthSession) => renderToStaticMarkup(createElement(RoomActions, { seat, info, onUpdate: () => {} }));
    expect(markup(observer)).toContain('提前結束本局</button>');
    expect(markup({ ...observer, observerID: 'other-observer' })).not.toContain('提前結束本局</button>');
    expect(markup(player)).not.toContain('提前結束本局</button>');
  });
});
