import { settingsStore, EQ_BAND_HZ, type AppSettings } from '../storage/settings-store';

/**
 * Feeds visual/canvas.ts frequency data to react to, and — new here — owns
 * the equalizer for whichever <audio> element is currently playing. Two
 * data sources for the visualizer, chosen automatically by what the
 * current backend can actually offer:
 *
 * - AudioBackend (a real audio-url source): a genuine Web Audio
 *   AnalyserNode reading actual FFT data off the playing <audio> element,
 *   after it's passed through the EQ chain below.
 * - YouTubeIframeBackend: none exists, and neither does the EQ. The
 *   IFrame Player's audio plays inside a separate, cross-origin browsing
 *   context, and the Web Audio API has no way to tap or reroute audio it
 *   doesn't own -- that's a browser security boundary, not a missing
 *   feature. The visualizer falls back to a clearly-labeled ambient pulse
 *   in that case (see ambientPulse below); the EQ has nothing to fall
 *   back to and is simply inert, which the settings panel says outright
 *   rather than pretending to apply.
 */

const FFT_SIZE = 256;

export interface VisualizerData {
  /** 0..255 per band, low → high frequency. Real FFT data, or the ambient fallback. */
  frequencies: Uint8Array;
  /** True only when `frequencies` comes from an actual AnalyserNode. */
  isRealAudioData: boolean;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export class AudioGraph {
  private ctx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private preamp: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private data: Uint8Array<ArrayBuffer>;
  private ambientStart = performance.now();
  private attached = false;
  private latestSettings: AppSettings = settingsStore.get();

  constructor() {
    this.data = new Uint8Array(new ArrayBuffer(FFT_SIZE / 2));
    settingsStore.subscribe((s) => {
      this.latestSettings = s;
      this.applyEqSettings(s);
    });
  }

  /** True only when the current track is actually routed through Web Audio (see class doc). */
  get supportsRealAudio(): boolean {
    return this.attached;
  }

  /** Call once per new backend/track. Safe to call with `null` (iframe case) -- just detaches. */
  attach(el: HTMLMediaElement | null): void {
    this.source?.disconnect();
    this.source = null;
    this.attached = false;
    if (!el) return;

    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return; // no Web Audio support at all -- ambient fallback stays in effect

    this.ctx ??= new Ctor();
    this.ensureGraph();

    // A given <audio> element can only ever be wrapped by one
    // MediaElementAudioSourceNode -- each track gets a fresh element from
    // AudioBackend, so this only runs once per element, not once per call.
    this.source = this.ctx.createMediaElementSource(el);
    this.source.connect(this.preamp!);
    this.attached = true;
  }

  /**
   * Builds the fixed preamp -> band0 -> ... -> bandN -> analyser -> destination chain once.
   */
  private ensureGraph(): void {
    if (this.analyserNode) return;
    const ctx = this.ctx!;

    this.preamp = ctx.createGain();
    this.filters = EQ_BAND_HZ.map((freq) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });
    this.analyserNode = ctx.createAnalyser();
    this.analyserNode.fftSize = FFT_SIZE;

    let node: AudioNode = this.preamp;
    for (const filter of this.filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(this.analyserNode);
    this.analyserNode.connect(ctx.destination);

    this.applyEqSettings(this.latestSettings);
  }

  /**
   * Bypass is implemented as "every node is a no-op," not by rewiring the graph.
   */
  private applyEqSettings(s: AppSettings): void {
    if (!this.preamp || this.filters.length === 0 || !this.ctx) return;
    const t = this.ctx.currentTime;
    const enabled = s.eqEnabled;
    this.preamp.gain.setTargetAtTime(enabled ? dbToGain(s.eqPreampDb) : 1, t, 0.01);
    this.filters.forEach((filter, i) => {
      filter.gain.setTargetAtTime(enabled ? (s.eqBandsDb[i] ?? 0) : 0, t, 0.01);
    });
  }

  /**
   * Reads frequency data from the analyser, or returns an ambient fallback if
   * no real audio source is attached.
   */
  read(): VisualizerData {
    if (this.attached && this.analyserNode) {
      this.analyserNode.getByteFrequencyData(this.data);
      return { frequencies: this.data, isRealAudioData: true };
    }
    return { frequencies: ambientPulse(this.data, this.ambientStart), isRealAudioData: false };
  }
}

/**
 * Converts a decibel value to linear gain.
 */
function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Generates a smooth, breathing ambient pulse pattern for the visualizer when
 * no real audio data is available.
 */
function ambientPulse(out: Uint8Array, start: number): Uint8Array {
  const t = (performance.now() - start) / 1000;
  for (let i = 0; i < out.length; i++) {
    const band = i / out.length;
    // A few slow sine waves at different phases/frequencies per band --
    // reads as "breathing," not literally random noise, and never claims
    // to be frequency data from the actual track.
    const wave =
      Math.sin(t * 0.6 + band * 6) * 0.5 + Math.sin(t * 1.3 + band * 2) * 0.3 + Math.sin(t * 0.25) * 0.2;
    out[i] = Math.max(0, Math.min(255, Math.round((wave * 0.5 + 0.5) * 140)));
  }
  return out;
}
