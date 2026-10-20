import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { StationState } from '../games/station/game';
import './station-sounds.css';

const MUTE_KEY = 'friends-table.station-sound-muted';
const VOLUME_KEY = 'friends-table.station-sound-volume';
const DEFAULT_VOLUME = 50;
type SoundState = Pick<StationState, 'status' | 'round' | 'activePlayer' | 'log'>;
export interface StationSoundInput {
  G?: SoundState;
  matchID: string;
  playerID?: string;
  enabled?: boolean;
  connected?: boolean;
}
export interface StationSoundEvents { reveals: number; ownTurn: boolean }
const silent = (): StationSoundEvents => ({ reveals: 0, ownTurn: false });
const revealKey = (G: SoundState, index: number) => {
  const entry = G.log[index];
  return entry ? JSON.stringify([entry.round, entry.actorID, entry.targetID, entry.slot, entry.kind]) : '';
};
const turnKey = (G: SoundState) => `${G.round}:${G.log.length}:${G.activePlayer}`;

/** A public-state cursor: snapshots, reconnects and stale deliveries never replay history. */
export class StationSoundTracker {
  private previous: { matchID: string; playerID?: string; round: number; length: number; last: string; ownTurn: boolean } | null = null;
  private announcedTurns = new Set<string>();

  update({ G, matchID, playerID, enabled = true, connected = true }: StationSoundInput): StationSoundEvents {
    if (!G || !enabled || !connected) {
      this.previous = null;
      this.announcedTurns.clear();
      return silent();
    }
    const ownTurn = !!playerID && G.status === 'playing' && G.activePlayer === playerID;
    const next = { matchID, playerID, round: G.round, length: G.log.length, last: revealKey(G, G.log.length - 1), ownTurn };
    const previous = this.previous;
    if (!previous || previous.matchID !== matchID || previous.playerID !== playerID) {
      this.previous = next;
      this.announcedTurns.clear();
      if (ownTurn) this.announcedTurns.add(turnKey(G));
      return silent();
    }
    // Keep the high-water mark when a response predates a newer socket / poll delivery.
    if (G.round < previous.round || G.log.length < previous.length) return silent();
    if (previous.length && revealKey(G, previous.length - 1) !== previous.last) return silent();
    const events = {
      reveals: G.log.length - previous.length,
      ownTurn: ownTurn && (!previous.ownTurn || G.log.length > previous.length || G.round > previous.round)
        && !this.announcedTurns.has(turnKey(G)),
    };
    if (ownTurn) this.announcedTurns.add(turnKey(G));
    this.previous = next;
    return events;
  }
}

type AudioConstructor = new () => AudioContext;
function audioConstructor(): AudioConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext || (window as Window & { webkitAudioContext?: AudioConstructor }).webkitAudioContext;
}

export function stationSoundsMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

function saveMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* Playback still works without persistent storage. */ }
}

function normalizeVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : DEFAULT_VOLUME;
}

export function stationSoundsVolume(): number {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    return stored === null || stored.trim() === '' ? DEFAULT_VOLUME : normalizeVolume(Number(stored));
  } catch { return DEFAULT_VOLUME; }
}

export function saveStationSoundVolume(volume: number): number {
  const next = normalizeVolume(volume);
  try { localStorage.setItem(VOLUME_KEY, String(next)); } catch { /* Volume still works without persistent storage. */ }
  return next;
}

/** Web Audio is created only from a user gesture; a failed cue must never affect a move. */
export class StationAudio {
  private context: AudioContext | null = null;
  private disposed = false;
  private muted = false;
  private volume = DEFAULT_VOLUME;
  private voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  private stateChanged = () => {
    if (this.disposed) return;
    const running = this.context?.state === 'running';
    if (!running) this.stop();
    this.onReady(!!running);
  };

  constructor(
    private createContext: () => AudioContext | null = () => {
      const Constructor = audioConstructor();
      return Constructor ? new Constructor() : null;
    },
    private onReady: (ready: boolean) => void = () => {},
  ) {}

  setMuted(value: boolean): void {
    this.muted = value;
    if (value) this.stop();
  }

  setVolume(value: number): void {
    const next = normalizeVolume(value);
    if (next !== this.volume) this.stop();
    this.volume = next;
  }

  async unlock(): Promise<boolean> {
    if (this.disposed || this.muted || this.volume === 0) return false;
    try {
      if (!this.context) {
        this.context = this.createContext();
        this.context?.addEventListener('statechange', this.stateChanged);
      }
      const context = this.context;
      if (!context) return false;
      if (context.state !== 'running') await context.resume();
      if (this.disposed || this.context !== context) return false;
      this.stateChanged();
      return context.state === 'running';
    } catch {
      if (!this.disposed) this.onReady(false);
      return false;
    }
  }

  play({ reveals, ownTurn }: StationSoundEvents): void {
    const context = this.context;
    if (this.disposed || this.muted || this.volume === 0 || !context || context.state !== 'running' || (!reveals && !ownTurn)) return;
    // A newer move replaces any still-pending cue instead of building a notification backlog.
    this.stop();
    try {
      const now = context.currentTime + 0.01;
      const count = Math.max(0, Math.min(8, Math.trunc(reveals)));
      for (let index = 0; index < count; index += 1) {
        const start = now + index * 0.19;
        this.tone(context, 720, start, 0.065, 'sine', 0.045);
        this.tone(context, 1060, start + 0.09, 0.065, 'sine', 0.045);
      }
      if (ownTurn) {
        const start = now + (count ? (count - 1) * 0.19 + 0.22 : 0);
        [520, 780, 1040].forEach((frequency, index) => this.tone(context, frequency, start + index * 0.12, 0.09, 'triangle', 0.035));
      }
    } catch {
      this.stop();
      this.onReady(false);
    }
  }

  private tone(context: AudioContext, frequency: number, at: number, duration: number, type: OscillatorType, volume: number): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const voice = { oscillator, gain };
    this.voices.add(voice);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0, at);
    // 50% retains the original cue amplitude; 100% doubles it.
    gain.gain.linearRampToValueAtTime(volume * this.volume / DEFAULT_VOLUME, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      this.voices.delete(voice);
      try { oscillator.disconnect(); gain.disconnect(); } catch { /* Nodes can already be disconnected during teardown. */ }
    };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }

  stop(): void {
    for (const { oscillator, gain } of this.voices) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* An oscillator may already have ended. */ }
      try { oscillator.disconnect(); gain.disconnect(); } catch { /* Best-effort audio cleanup. */ }
    }
    this.voices.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    const context = this.context;
    this.context = null;
    if (context) {
      context.removeEventListener('statechange', this.stateChanged);
      try { void context.close().catch(() => {}); } catch { /* Closing audio cannot block navigation. */ }
    }
  }
}

export interface StationSoundControls {
  muted: boolean;
  volume: number;
  available: boolean;
  ready: boolean;
  label: string;
  toggle: () => void;
  setVolume: (volume: number) => void;
}

export function useStationSounds(input: StationSoundInput): StationSoundControls {
  const { G, matchID, playerID, connected = true, enabled = true } = input;
  const [muted, setMuted] = useState(stationSoundsMuted);
  const [volume, setVolumeState] = useState(stationSoundsVolume);
  const [ready, setReady] = useState(false);
  const available = !!audioConstructor();
  const audio = useRef<StationAudio | null>(null);
  const tracker = useRef(new StationSoundTracker());
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  mutedRef.current = muted;
  volumeRef.current = volume;

  useEffect(() => {
    if (!enabled || !available) { setReady(false); return; }
    const engine = new StationAudio(undefined, setReady);
    engine.setMuted(mutedRef.current);
    engine.setVolume(volumeRef.current);
    audio.current = engine;
    const unlock = (event: Event) => {
      if (event instanceof KeyboardEvent && event.repeat) return;
      // The toggle handles its own gesture. Unlocking on pointerdown first
      // would make its following click unexpectedly mute the new context.
      if (event.target instanceof Element && event.target.closest('.station-sound-toggle')) return;
      void engine.unlock();
    };
    const syncPreference = (event: StorageEvent) => {
      if (event.key === MUTE_KEY || event.key === null) {
        const next = stationSoundsMuted();
        engine.setMuted(next);
        setMuted(next);
      }
      if (event.key === VOLUME_KEY || event.key === null) {
        const next = stationSoundsVolume();
        engine.setVolume(next);
        setVolumeState(next);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('storage', syncPreference);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('storage', syncPreference);
      audio.current = null;
      engine.dispose();
    };
  }, [enabled, available]);

  useEffect(() => {
    const events = tracker.current.update({ G, matchID, playerID, connected, enabled });
    audio.current?.setMuted(muted);
    audio.current?.setVolume(volume);
    if (!enabled || !connected || !G) audio.current?.stop();
    else audio.current?.play(events);
  }, [G, matchID, playerID, connected, enabled, muted, volume]);

  const setVolume = useCallback((value: number) => {
    if (!available || !enabled) return;
    const next = saveStationSoundVolume(value);
    volumeRef.current = next;
    mutedRef.current = false;
    audio.current?.setVolume(next);
    audio.current?.setMuted(false);
    setVolumeState(next);
    saveMuted(false);
    setMuted(false);
    if (next > 0) void audio.current?.unlock();
  }, [available, enabled]);

  const toggle = useCallback(() => {
    if (!available || !enabled) return;
    if (volume === 0) { setVolume(DEFAULT_VOLUME); return; }
    if (!muted && !ready) { void audio.current?.unlock(); return; }
    const next = !muted;
    mutedRef.current = next;
    audio.current?.setMuted(next);
    saveMuted(next);
    setMuted(next);
    if (!next) void audio.current?.unlock();
  }, [available, enabled, muted, ready, volume, setVolume]);
  const silent = muted || volume === 0;
  const label = !available ? '音效不支援' : silent ? '音效：關' : ready ? '音效：開' : '啟用音效';
  return { muted: silent, volume, available, ready, toggle, setVolume, label };
}

export function StationSoundToggle({ controls }: { controls: StationSoundControls }) {
  const { muted, volume, available, ready, toggle, setVolume, label } = controls;
  const volumeID = useId();
  return <div className="station-sound-controls"><button type="button" className="station-sound-toggle" onClick={toggle}
    disabled={!available} aria-pressed={!muted && ready}
    title={!available ? '此瀏覽器不支援音效。' : muted ? '開啟翻牌與自己回合的提示音。'
      : ready ? '關閉這台瀏覽器的遊戲提示音。' : '點一下允許瀏覽器播放音效；先前的提示不會補播。'}>
    <span aria-hidden="true">{!muted && ready ? '♪' : '♩'}</span>{label}
  </button><label className="station-sound-volume" htmlFor={volumeID}><span>音量</span>
    <input id={volumeID} type="range" min="0" max="100" step="1" value={volume}
      aria-label="提示音效音量" aria-valuetext={`${volume}%${volume === 0 ? '，靜音' : ''}`}
      disabled={!available} onChange={event => setVolume(Number(event.currentTarget.value))} />
    <output htmlFor={volumeID}>{volume}%</output>
  </label></div>;
}
