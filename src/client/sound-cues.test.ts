import { describe, expect, it } from 'vitest';
import { GameSoundTracker, type GameSoundInput } from './sound-cues';
import { clientGames } from './game-registry';
import type { StationState } from '../games/station/game';
const snapshot = (revision: number, events: string[], attention?: string): GameSoundInput => ({ matchID: 'room-a', playerID: '2', G: { revision, events, attention } });
describe('Shared live sound cursor', () => {
  it('plays only new public results and new action prompts', () => {
    const tracker = new GameSoundTracker();
    expect(tracker.update(snapshot(1, ['begin']))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(2, ['begin', 'vote-result'], 'leader-2'))).toEqual({ reveals: 1, ownTurn: true });
    expect(tracker.update(snapshot(2, ['begin', 'vote-result'], 'leader-2'))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(1, ['begin']))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(3, ['changed-history']))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(1, ['begin', 'vote-result', 'stale-result']))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(3, ['tampered-history', 'vote-result']))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(3, ['begin', 'vote-result'], 'another-prompt'))).toEqual({ reveals: 0, ownTurn: true });
    expect(tracker.update(snapshot(4, ['begin', 'vote-result'], 'leader-2'))).toEqual({ reveals: 0, ownTurn: false });
  });
  it('does not replay on mount, reconnect, spectator perspective or room changes', () => {
    const tracker = new GameSoundTracker();
    tracker.update(snapshot(5, ['start', 'result'], 'action'));
    expect(tracker.update({ ...snapshot(5, ['start', 'result']), connected: false })).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(7, ['start', 'result', 'result2'], 'next-action'))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update({ ...snapshot(9, ['a', 'b'], 'other'), matchID: 'room-b' })).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update({ ...snapshot(10, ['a', 'b', 'c'], 'other'), playerID: undefined })).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update({ ...snapshot(11, ['a', 'b', 'c'], 'other'), playerID: '3' })).toEqual({ reveals: 0, ownTurn: false });
    expect(new GameSoundTracker().update(snapshot(12, ['existing'], 'action'))).toEqual({ reveals: 0, ownTurn: false });
  });
  it('drops missed events while disconnected, disabled or without a snapshot and only plays future cues', () => {
    for (const pause of [{ connected: false }, { enabled: false }, { G: undefined }]) {
      const tracker = new GameSoundTracker();
      tracker.update(snapshot(1, ['begin']));
      expect(tracker.update({ ...snapshot(2, ['begin', 'missed'], 'missed-turn'), ...pause })).toEqual({ reveals: 0, ownTurn: false });
      expect(tracker.update(snapshot(3, ['begin', 'missed', 'also-missed'], 'next-turn'))).toEqual({ reveals: 0, ownTurn: false });
      expect(tracker.update(snapshot(4, ['begin', 'missed', 'also-missed', 'future'], 'future-turn'))).toEqual({ reveals: 1, ownTurn: true });
    }
  });
  const frame = (changes: Partial<StationState> = {}) => ({ round: 1, status: 'claiming', activePlayer: '0', log: [], ...changes } as StationState);
  const reveal = (targetID: string, slot: number) => ({ round: 1, actorID: '0', targetID, slot, kind: 'stable' as const });
  const stationInput = (G: StationState, playerID?: string): GameSoundInput => ({
    G: clientGames['space-station'].soundAdapter(G, playerID), matchID: 'station', playerID,
  });
  it('uses the live Station adapter for reveals, skipped turns, selection-only updates and the next round', () => {
    const tracker = new GameSoundTracker();
    const update = (G: StationState) => tracker.update(stationInput(G, '0'));
    expect(update(frame())).toEqual({ reveals: 0, ownTurn: false });
    expect(update(frame({ status: 'playing' }))).toEqual({ reveals: 0, ownTurn: true });
    expect(update(frame({ status: 'playing' }))).toEqual({ reveals: 0, ownTurn: false });
    const log = [reveal('1', 0), reveal('0', 1)];
    expect(update(frame({ status: 'playing', log }))).toEqual({ reveals: 2, ownTurn: true });
    expect(update(frame({ status: 'playing', log: [reveal('2', 0)] }))).toEqual({ reveals: 0, ownTurn: false });
    expect(update(frame({ status: 'round-review', log: [...log, reveal('2', 2)] }))).toEqual({ reveals: 1, ownTurn: false });
    expect(update(frame({ round: 2, status: 'briefing', log: [...log, reveal('2', 2)] }))).toEqual({ reveals: 0, ownTurn: false });
    expect(update(frame({ round: 2, status: 'playing', log: [...log, reveal('2', 2)] }))).toEqual({ reveals: 0, ownTurn: true });
  });
  it('uses the live Station adapter to keep observer and other-player turns silent while announcing public reveals', () => {
    for (const playerID of [undefined, '3']) {
      const tracker = new GameSoundTracker();
      tracker.update(stationInput(frame(), playerID));
      expect(tracker.update(stationInput(frame({ status: 'playing' }), playerID))).toEqual({ reveals: 0, ownTurn: false });
      expect(tracker.update(stationInput(frame({ status: 'finished', log: [reveal('1', 0)] }), playerID))).toEqual({ reveals: 1, ownTurn: false });
    }
  });
});
