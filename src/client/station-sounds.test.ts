import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RevealRecord, StationState } from '../games/station/game';
import { StationAudio, StationSoundTracker, stationSoundsMuted } from './station-sounds';

type Frame = Pick<StationState, 'round' | 'status' | 'activePlayer' | 'log'>;
const frame = (changes: Partial<Frame> = {}): Frame => ({ round: 1, status: 'claiming', activePlayer: '0', log: [], ...changes });
const reveal = (targetID = '1', slot = 0): RevealRecord => ({ round: 1, actorID: '0', targetID, slot, kind: 'stable' });
const noSound = { reveals: 0, ownTurn: false };

describe('station sound event cursor', () => {
  it('is silent on mount, remount, match changes and observer perspective-only updates', () => {
    const G = frame({ status: 'playing', log: [reveal()] });
    const cursor = new StationSoundTracker();
    expect(cursor.update({ G, matchID: 'one', playerID: '0' })).toEqual(noSound);
    expect(cursor.update({ G: { ...G }, matchID: 'one', playerID: '0' })).toEqual(noSound);
    expect(cursor.update({ G, matchID: 'two', playerID: '0' })).toEqual(noSound);
    expect(new StationSoundTracker().update({ G, matchID: 'one', playerID: '0' })).toEqual(noSound);
    expect(cursor.update({ G, matchID: 'two' })).toEqual(noSound);
    expect(cursor.update({ G: { ...G }, matchID: 'two' })).toEqual(noSound);
  });

  it('signals only new public reveals and the local player becoming actionable', () => {
    const cursor = new StationSoundTracker();
    const update = (G: Frame) => cursor.update({ G, matchID: 'one', playerID: '0' });
    expect(update(frame())).toEqual(noSound);
    expect(update(frame({ status: 'playing' }))).toEqual({ reveals: 0, ownTurn: true });
    // A selection or a duplicate update changes neither the public log nor turn ownership.
    expect(update(frame({ status: 'playing' }))).toEqual(noSound);
    expect(update(frame({ status: 'playing', activePlayer: '1', log: [reveal()] }))).toEqual({ reveals: 1, ownTurn: false });
    expect(update(frame({ status: 'playing', log: [reveal(), reveal('0', 2)] }))).toEqual({ reveals: 1, ownTurn: true });
    expect(update(frame({ status: 'round-review', log: [reveal(), reveal('0', 2), reveal('2', 3)] }))).toEqual({ reveals: 1, ownTurn: false });
    expect(update(frame({ round: 2, status: 'briefing', log: [reveal(), reveal('0', 2), reveal('2', 3)] }))).toEqual(noSound);
    expect(update(frame({ round: 2, status: 'playing', log: [reveal(), reveal('0', 2), reveal('2', 3)] }))).toEqual({ reveals: 0, ownTurn: true });
  });

  it('counts multiple new reveals in a poll and catches a turn returning after skipped intermediate states', () => {
    const cursor = new StationSoundTracker();
    cursor.update({ G: frame({ status: 'playing' }), matchID: 'one', playerID: '0' });
    expect(cursor.update({
      G: frame({ status: 'playing', log: [reveal(), reveal('0', 1)] }), matchID: 'one', playerID: '0',
    })).toEqual({ reveals: 2, ownTurn: true });
  });

  it('never announces a turn for observers or a different player', () => {
    for (const playerID of [undefined, '3']) {
      const cursor = new StationSoundTracker();
      cursor.update({ G: frame(), matchID: 'one', playerID });
      expect(cursor.update({ G: frame({ status: 'playing' }), matchID: 'one', playerID })).toEqual(noSound);
      expect(cursor.update({ G: frame({ status: 'finished', log: [reveal()] }), matchID: 'one', playerID })).toEqual({ reveals: 1, ownTurn: false });
    }
  });

  it('rejects stale log/round responses and repeated turn transitions', () => {
    const cursor = new StationSoundTracker();
    cursor.update({ G: frame(), matchID: 'one', playerID: '0' });
    const playing = frame({ status: 'playing', log: [reveal()] });
    expect(cursor.update({ G: playing, matchID: 'one', playerID: '0' })).toEqual({ reveals: 1, ownTurn: true });
    expect(cursor.update({ G: frame({ status: 'playing' }), matchID: 'one', playerID: '0' })).toEqual(noSound);
    expect(cursor.update({ G: { ...playing, round: 0 }, matchID: 'one', playerID: '0' })).toEqual(noSound);
    expect(cursor.update({ G: { ...playing, log: [reveal('2')] }, matchID: 'one', playerID: '0' })).toEqual(noSound);
    expect(cursor.update({ G: { ...playing, status: 'claiming' }, matchID: 'one', playerID: '0' })).toEqual(noSound);
    expect(cursor.update({ G: playing, matchID: 'one', playerID: '0' })).toEqual(noSound);
  });

  it('discards missed events across reconnect, absent snapshots and disabled playback', () => {
    for (const pause of [{ connected: false }, { enabled: false }, { G: undefined }]) {
      const cursor = new StationSoundTracker();
      cursor.update({ G: frame(), matchID: 'one', playerID: '0' });
      expect(cursor.update({ G: frame(), matchID: 'one', playerID: '0', ...pause })).toEqual(noSound);
      const G = frame({ status: 'playing', log: [reveal(), reveal('0', 1)] });
      expect(cursor.update({ G, matchID: 'one', playerID: '0' })).toEqual(noSound);
      expect(cursor.update({ G: { ...G, activePlayer: '2', log: [...G.log, reveal('2', 2)] }, matchID: 'one', playerID: '0' }))
        .toEqual({ reveals: 1, ownTurn: false });
    }
  });
});

function fakeAudioContext() {
  const voices: Array<{
    type: string; frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
    connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null;
  }> = [];
  const listeners = new Set<() => void>();
  const context = {
    state: 'suspended', currentTime: 10, destination: {},
    addEventListener: vi.fn((_name: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_name: string, listener: () => void) => listeners.delete(listener)),
    resume: vi.fn(async () => { context.state = 'running'; listeners.forEach(listener => listener()); }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    createOscillator: vi.fn(() => {
      const oscillator = {
        type: 'sine', frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null,
      };
      voices.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(), disconnect: vi.fn(),
    })),
  };
  return { context, voices, listeners, asContext: context as unknown as AudioContext };
}

describe('station generated audio', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('requires unlock, never queues earlier cues, and separates reveal from own-turn tones', async () => {
    const fake = fakeAudioContext();
    const factory = vi.fn(() => fake.asContext);
    const audio = new StationAudio(factory);
    audio.play({ reveals: 1, ownTurn: true });
    expect(factory).not.toHaveBeenCalled();
    expect(await audio.unlock()).toBe(true);
    expect(fake.voices).toHaveLength(0);
    audio.play({ reveals: 1, ownTurn: true });
    expect(fake.voices.map(voice => voice.frequency.setValueAtTime.mock.calls[0][0])).toEqual([720, 1060, 520, 780, 1040]);
    expect(fake.voices.map(voice => voice.type)).toEqual(['sine', 'sine', 'triangle', 'triangle', 'triangle']);
    expect(fake.voices[2].start.mock.calls[0][0]).toBeGreaterThan(fake.voices[1].stop.mock.calls[0][0]);
    audio.dispose();
  });

  it('mutes immediately, drops events while muted and does not replay them after unmuting', async () => {
    const fake = fakeAudioContext();
    const audio = new StationAudio(() => fake.asContext);
    await audio.unlock();
    audio.play({ reveals: 1, ownTurn: false });
    audio.setMuted(true);
    expect(fake.voices.every(voice => voice.disconnect.mock.calls.length === 1)).toBe(true);
    audio.play({ reveals: 3, ownTurn: true });
    expect(await audio.unlock()).toBe(false);
    audio.setMuted(false);
    await audio.unlock();
    expect(fake.voices).toHaveLength(2);
    audio.play({ reveals: 0, ownTurn: true });
    expect(fake.voices).toHaveLength(5);
    audio.dispose();
  });

  it('cancels pending notes when audio is interrupted, then only plays future events', async () => {
    const fake = fakeAudioContext();
    const ready = vi.fn();
    const audio = new StationAudio(() => fake.asContext, ready);
    await audio.unlock();
    audio.play({ reveals: 1, ownTurn: true });
    fake.context.state = 'suspended';
    fake.listeners.forEach(listener => listener());
    expect(ready).toHaveBeenLastCalledWith(false);
    expect(fake.voices.every(voice => voice.disconnect.mock.calls.length === 1)).toBe(true);
    audio.play({ reveals: 1, ownTurn: false });
    await audio.unlock();
    expect(fake.voices).toHaveLength(5);
    audio.dispose();
  });

  it('replaces old cues and releases contexts/listeners/nodes on cleanup', async () => {
    const fake = fakeAudioContext();
    const audio = new StationAudio(() => fake.asContext);
    await audio.unlock();
    audio.play({ reveals: 1, ownTurn: true });
    audio.play({ reveals: 1, ownTurn: false });
    expect(fake.voices.slice(0, 5).every(voice => voice.disconnect.mock.calls.length === 1)).toBe(true);
    audio.dispose();
    expect(fake.context.close).toHaveBeenCalledOnce();
    expect(fake.listeners.size).toBe(0);
    expect(fake.voices.every(voice => voice.disconnect.mock.calls.length === 1)).toBe(true);
    audio.play({ reveals: 1, ownTurn: true });
    expect(await audio.unlock()).toBe(false);
    expect(fake.voices).toHaveLength(7);
  });

  it('treats missing APIs, denied autoplay and failed tone creation as nonfatal', async () => {
    const absent = new StationAudio(() => null);
    expect(await absent.unlock()).toBe(false);
    expect(() => absent.play({ reveals: 1, ownTurn: true })).not.toThrow();
    absent.dispose();
    const denied = new StationAudio(() => { throw new Error('audio unavailable'); });
    expect(await denied.unlock()).toBe(false);
    denied.dispose();
    const fake = fakeAudioContext();
    fake.context.resume.mockRejectedValueOnce(new Error('autoplay denied'));
    const audio = new StationAudio(() => fake.asContext);
    expect(await audio.unlock()).toBe(false);
    expect(await audio.unlock()).toBe(true);
    fake.context.createOscillator.mockImplementation(() => { throw new Error('audio failed'); });
    expect(() => audio.play({ reveals: 1, ownTurn: true })).not.toThrow();
    audio.dispose();
  });

  it('can be disposed while a browser resume promise is still pending', async () => {
    const fake = fakeAudioContext();
    let release: () => void = () => {};
    fake.context.resume.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const ready = vi.fn();
    const audio = new StationAudio(() => fake.asContext, ready);
    const unlocking = audio.unlock();
    audio.dispose();
    release();
    expect(await unlocking).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    expect(fake.context.close).toHaveBeenCalledOnce();
  });

  it('uses enabled-by-default preference and survives inaccessible browser storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => '1' });
    expect(stationSoundsMuted()).toBe(true);
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(stationSoundsMuted()).toBe(false);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage denied'); } });
    expect(stationSoundsMuted()).toBe(false);
  });
});
