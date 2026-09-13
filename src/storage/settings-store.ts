import { db } from './db';

export type VisualizerStyle = 'bars' | 'wave' | 'radial' | 'ambient';
export type AccentMode = 'artwork' | 'fixed';
export type MotionPreference = 'system' | 'always' | 'never';

/** Standard 10-band graphic EQ centre frequencies (Hz), low → high. */
export const EQ_BAND_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

/** Named starting points for the EQ. 'custom' is not a real target — it's
 * just what the preset field becomes once a user drags a single band away
 * from whatever preset produced the current values. */
export const EQ_PRESETS: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'bass-boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'treble-boost': [0, 0, 0, 0, 0, 2, 4, 5, 6, 6],
  vocal: [-2, -2, 0, 2, 4, 4, 3, 1, 0, -1],
  acoustic: [3, 3, 2, 1, 0, 1, 2, 2, 3, 3],
  electronic: [4, 3, 1, 0, -1, 0, 1, 2, 3, 4],
  loudness: [5, 3, 0, -1, -2, -1, 0, 3, 4, 5]
};

export interface AppSettings {
  visualizerStyle: VisualizerStyle;
  /** 0..1.5 — multiplies the gradient wash and frequency-shape opacity/height. 1 = default. */
  backgroundIntensity: number;
  accentMode: AccentMode;
  /** 0-360, used only when accentMode === 'fixed'. */
  fixedHue: number;
  eqEnabled: boolean;
  /** Key into EQ_PRESETS, or 'custom' once a band has been hand-tuned. */
  eqPreset: string;
  eqPreampDb: number;
  /** One entry per EQ_BAND_HZ index, -12..12 dB. */
  eqBandsDb: number[];
  compactDensity: boolean;
  rememberSpeed: boolean;
  /** Last playback rate chosen — only reapplied on new tracks/reload when rememberSpeed is on. */
  lastSpeed: number;
  motionPreference: MotionPreference;
}

export const DEFAULT_SETTINGS: AppSettings = {
  visualizerStyle: 'bars',
  backgroundIntensity: 1,
  accentMode: 'artwork',
  fixedHue: 210,
  eqEnabled: false,
  eqPreset: 'flat',
  eqPreampDb: 0,
  eqBandsDb: [...EQ_PRESETS.flat],
  compactDensity: false,
  rememberSpeed: false,
  lastSpeed: 1,
  motionPreference: 'system'
};

const STORAGE_KEY = 'app-settings';

type Listener = (settings: AppSettings) => void;

/**
 * Every consumer (visualizer canvas, audio graph, settings panel) needs a
 * current value synchronously, before the async IndexedDB read can
 * possibly complete — so this starts with defaults immediately and
 * republishes once the persisted value loads. Nothing blocks first paint
 * on a database round trip, matching the rest of this project's storage
 * access (see storage/db.ts's queue/search helpers).
 */
class SettingsStore {
  private current: AppSettings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<Listener>();
  private ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const row = await db.settings.get(STORAGE_KEY);
      if (row?.value) {
        this.current = { ...DEFAULT_SETTINGS, ...(row.value as Partial<AppSettings>) };
        this.notify();
      }
    } catch (err) {
      console.warn('Failed to load settings, using defaults', err);
    }
  }

  /** Resolves once the persisted value (if any) has loaded and been applied. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  get(): AppSettings {
    return this.current;
  }

  update(patch: Partial<AppSettings>): void {
    this.current = { ...this.current, ...patch };
    this.notify();
    void db.settings.put({ key: STORAGE_KEY, value: this.current });
  }

  /** Fires immediately with the current value, then again on every change. */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.current);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb(this.current);
  }
}

export const settingsStore = new SettingsStore();
