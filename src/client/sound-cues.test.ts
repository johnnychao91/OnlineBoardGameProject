import { describe, expect, it } from 'vitest';
import { GameSoundTracker, type GameSoundInput } from './sound-cues';
const snapshot = (revision: number, events: string[], attention?: string): GameSoundInput => ({ matchID: 'room-a', playerID: '2', G: { revision, events, attention } });
describe('Shared live sound cursor', () => {
  it('plays only new public results and new action prompts', () => {
    const tracker = new GameSoundTracker();
    expect(tracker.update(snapshot(1, ['begin']))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(2, ['begin', 'vote-result'], 'leader-2'))).toEqual({ reveals: 1, ownTurn: true });
    expect(tracker.update(snapshot(2, ['begin', 'vote-result'], 'leader-2'))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(1, ['begin']))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(3, ['changed-history']))).toEqual({ reveals: 0, ownTurn: false });
  });
  it('does not replay on mount, reconnect, spectator perspective or room changes', () => {
    const tracker = new GameSoundTracker();
    tracker.update(snapshot(5, ['start', 'result'], 'action'));
    expect(tracker.update({ ...snapshot(5, ['start', 'result']), connected: false })).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update(snapshot(7, ['start', 'result', 'result2'], 'next-action'))).toEqual({ reveals: 0, ownTurn: false });
    expect(tracker.update({ ...snapshot(9, ['a', 'b'], 'other'), matchID: 'room-b' })).toEqual({ reveals: 0, ownTurn: false });
  });
});
