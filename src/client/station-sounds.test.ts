import { afterEach, describe, expect, it, vi } from 'vitest';
import { StationAudio, saveStationSoundVolume, stationSoundsMuted, stationSoundsVolume } from './station-sounds';

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
    expect(fake.context.createGain.mock.results.map(result => result.value.gain.linearRampToValueAtTime.mock.calls[0][0]))
      .toEqual([0.045, 0.045, 0.035, 0.035, 0.035]);
    expect(fake.voices[2].start.mock.calls[0][0]).toBeGreaterThan(fake.voices[1].stop.mock.calls[0][0]);
    audio.dispose();
  });

  it.each([[25, .5], [50, 1], [100, 2], [125, 2], [NaN, 1]])('scales both cue types at %s%% without changing their timing', async (volume, factor) => {
    const fake = fakeAudioContext();
    const audio = new StationAudio(() => fake.asContext);
    audio.setVolume(volume);
    await audio.unlock();
    audio.play({ reveals: 1, ownTurn: true });
    const amplitudes = fake.context.createGain.mock.results.map(result => result.value.gain.linearRampToValueAtTime.mock.calls[0][0]);
    expect(amplitudes).toHaveLength(5);
    amplitudes.forEach((amplitude, index) => expect(amplitude).toBeCloseTo((index < 2 ? .045 : .035) * factor));
    expect(fake.voices[2].start.mock.calls[0][0]).toBeGreaterThan(fake.voices[1].stop.mock.calls[0][0]);
    audio.dispose();
  });

  it('zero volume immediately cancels pending cues and creates no silent voices or replay backlog', async () => {
    const fake = fakeAudioContext();
    const audio = new StationAudio(() => fake.asContext);
    await audio.unlock();
    audio.play({ reveals: 1, ownTurn: true });
    audio.setVolume(0);
    expect(fake.voices.every(voice => voice.disconnect.mock.calls.length === 1)).toBe(true);
    audio.play({ reveals: 3, ownTurn: true });
    expect(await audio.unlock()).toBe(false);
    expect(fake.voices).toHaveLength(5);
    audio.setVolume(50);
    await audio.unlock();
    expect(fake.voices).toHaveLength(5);
    audio.play({ reveals: 1, ownTurn: false });
    expect(fake.voices).toHaveLength(7);
    audio.setVolume(-1);
    audio.play({ reveals: 1, ownTurn: true });
    expect(fake.voices).toHaveLength(7);
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

  it.each([[null, 50], ['', 50], [' ', 50], ['0', 0], ['25', 25], ['50', 50], ['100', 100], ['125', 100], ['-10', 0], ['36.7', 37], ['garbage', 50], ['Infinity', 50]])(
    'loads stored volume %s as %s%%', (stored, expected) => {
      vi.stubGlobal('localStorage', { getItem: () => stored });
      expect(stationSoundsVolume()).toBe(expected);
    },
  );

  it('remembers bounded volume independently of the existing mute preference', () => {
    const data = new Map([['friends-table.station-sound-muted', '1']]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    expect(stationSoundsVolume()).toBe(50);
    expect(stationSoundsMuted()).toBe(true);
    expect(saveStationSoundVolume(73)).toBe(73);
    expect(stationSoundsVolume()).toBe(73);
    expect(stationSoundsMuted()).toBe(true);
    expect(saveStationSoundVolume(400)).toBe(100);
    expect(stationSoundsVolume()).toBe(100);
    expect(saveStationSoundVolume(-400)).toBe(0);
    expect(stationSoundsVolume()).toBe(0);
  });

  it('keeps volume adjustment usable when browser storage is denied', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage denied'); }, setItem: () => { throw new Error('storage denied'); } });
    expect(stationSoundsVolume()).toBe(50);
    expect(saveStationSoundVolume(67)).toBe(67);
  });
});
