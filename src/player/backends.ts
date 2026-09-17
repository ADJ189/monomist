import type { PlayableSource } from '../core/types';

export interface PlaybackBackend {
  load(source: PlayableSource): Promise<void>;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  setVolume(v: number): void; // 0..1
  setMuted(muted: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDurationSec(): number;
  destroy(): void;
  onTimeUpdate(cb: (sec: number) => void): void;
  onEnded(cb: () => void): void;
  onError(cb: (err: unknown) => void): void;
  /**
   * Returns the underlying <audio>/<video> element for Web Audio analysis,
   * or null when playback happens in a cross-origin surface the page
   * can't attach an AnalyserNode to (the YouTube IFrame backend -- its
   * audio lives in a separate browsing context, so real FFT data simply
   * isn't available there; see player/analyser.ts for the fallback).
   */
  getMediaElement(): HTMLMediaElement | null;
}

/** Native <audio> backend for provider-issued, licensed audio-url sources. */
export class AudioBackend implements PlaybackBackend {
  private el: HTMLAudioElement;

  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
  }

  async load(source: PlayableSource): Promise<void> {
    if (source.kind !== 'audio-url') throw new Error('AudioBackend requires an audio-url source');
    this.el.src = source.url;
  }

  play(): void {
    void this.el.play();
  }
  pause(): void {
    this.el.pause();
  }
  seek(sec: number): void {
    this.el.currentTime = sec;
  }
  setVolume(v: number): void {
    this.el.volume = Math.min(1, Math.max(0, v));
  }
  setMuted(muted: boolean): void {
    this.el.muted = muted;
  }
  setPlaybackRate(rate: number): void {
    this.el.playbackRate = rate;
  }
  getCurrentTime(): number {
    return this.el.currentTime;
  }
  getDurationSec(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }
  getMediaElement(): HTMLMediaElement | null {
    return this.el;
  }
  destroy(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }
  onTimeUpdate(cb: (sec: number) => void): void {
    this.el.addEventListener('timeupdate', () => cb(this.el.currentTime));
  }
  onEnded(cb: () => void): void {
    this.el.addEventListener('ended', cb);
  }
  onError(cb: (err: unknown) => void): void {
    this.el.addEventListener('error', () => cb(this.el.error));
  }
}

/**
 * A source of temporary, provider-issued audio URLs that expire. This is
 * the seam the future server-side backend (item 5 of the Monomist
 * architecture work) plugs into: today, `src/music/providers/youtube.ts`
 * is the only implementer (it tries the Monomist API before falling back
 * to a direct call -- see that file's class doc), and neither path
 * currently returns a source with `expiresAt` set (the placeholder
 * ServerYouTubeProvider isn't implemented -- see worker/providers). Once
 * a real direct-audio-capable provider exists, `resolve()` returning a
 * fresh `{ kind: 'audio-url', url, expiresAt }` is all `DirectAudioBackend`
 * needs to keep playback going past the original URL's expiry.
 */
export type PlayableSourceResolver = () => Promise<PlayableSource>;

/**
 * Direct-audio backend for provider-issued, licensed `audio-url` sources.
 * Wraps `AudioBackend` (unchanged, still usable standalone) and adds one
 * thing on top: if the loaded source carries an `expiresAt`, it schedules
 * a refresh shortly before that deadline, re-resolves the source via the
 * given resolver, and swaps the `<audio>` element's `src` in place --
 * same element throughout, so a `MediaElementAudioSourceNode` already
 * attached by AudioGraph (see player/audiograph.ts) keeps working without
 * needing to be re-attached, and playback continues from the same
 * position rather than restarting.
 *
 * This is what PlayerEngine now constructs for every `audio-url` source
 * (see engine.ts) -- when `expiresAt` is absent (the common case today,
 * since no current provider returns one), the refresh timer simply never
 * fires and this behaves exactly like plain `AudioBackend`.
 */
export class DirectAudioBackend implements PlaybackBackend {
  private inner = new AudioBackend();
  private refreshTimer: number | null = null;
  private destroyed = false;
  private errorCb?: (err: unknown) => void;
  /** Tracked locally (rather than read off the element) so refresh() can restore it without reaching into AudioBackend's private state. */
  private isPlaying = false;

  constructor(private resolve: PlayableSourceResolver) {}

  async load(source: PlayableSource): Promise<void> {
    if (source.kind !== 'audio-url') throw new Error('DirectAudioBackend requires an audio-url source');
    // AudioBackend.load() only ever assigns `.src` on the one <audio>
    // element it creates in its constructor -- calling it again for a
    // refresh (below) reuses that same element, which is what keeps an
    // already-attached MediaElementAudioSourceNode valid.
    await this.inner.load(source);
    this.isPlaying = false;
    this.scheduleRefresh(source.expiresAt);
  }

  private scheduleRefresh(expiresAt: number | undefined): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (!expiresAt) return;

    // Refresh 30s ahead of expiry, but never schedule less than 5s out --
    // an `expiresAt` that's already imminent (or in the past, e.g. clock
    // skew) still gets one refresh attempt rather than firing instantly
    // in a tight loop if that attempt also comes back near-expired.
    const delay = Math.max(5_000, expiresAt - Date.now() - 30_000);
    this.refreshTimer = window.setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    if (this.destroyed) return;
    try {
      const fresh = await this.resolve();
      if (this.destroyed) return;
      if (fresh.kind !== 'audio-url') {
        // The provider switched to an iframe source (e.g. a direct stream
        // stopped being available) -- PlayerEngine owns backend swaps on
        // track change, but mid-track it can't retarget the backend type.
        // Surface it as a playback error so the engine's onError handler
        // decides what to do (matches how any other unrecoverable
        // playback failure is handled today).
        this.errorCb?.(new Error('Refreshed source is no longer a direct audio URL'));
        return;
      }
      const resumeAt = this.inner.getCurrentTime();
      const wasPlaying = this.isPlaying;
      await this.inner.load(fresh);
      this.inner.seek(resumeAt);
      if (wasPlaying) this.inner.play();
      this.scheduleRefresh(fresh.expiresAt);
    } catch (err) {
      this.errorCb?.(err);
    }
  }

  play(): void {
    this.isPlaying = true;
    this.inner.play();
  }
  pause(): void {
    this.isPlaying = false;
    this.inner.pause();
  }
  seek(sec: number): void {
    this.inner.seek(sec);
  }
  setVolume(v: number): void {
    this.inner.setVolume(v);
  }
  setMuted(muted: boolean): void {
    this.inner.setMuted(muted);
  }
  setPlaybackRate(rate: number): void {
    this.inner.setPlaybackRate(rate);
  }
  getCurrentTime(): number {
    return this.inner.getCurrentTime();
  }
  getDurationSec(): number {
    return this.inner.getDurationSec();
  }
  getMediaElement(): HTMLMediaElement | null {
    return this.inner.getMediaElement();
  }
  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.inner.destroy();
  }
  onTimeUpdate(cb: (sec: number) => void): void {
    this.inner.onTimeUpdate(cb);
  }
  onEnded(cb: () => void): void {
    this.inner.onEnded(cb);
  }
  onError(cb: (err: unknown) => void): void {
    this.errorCb = cb;
    this.inner.onError(cb);
  }
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

/**
 * Loads YouTube's official IFrame API script exactly once, however many players need it.
 */
function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

/**
 * Official YouTube IFrame Player backend. Mounts YouTube's own embedded
 * player and drives it through the documented postMessage-based API —
 * this is the compliant playback path (video attached, official player),
 * not a stream-extraction shortcut.
 */
export class YouTubeIframeBackend implements PlaybackBackend {
  private player: any = null;
  private ready: Promise<void>;
  private timeUpdateCb?: (sec: number) => void;
  private endedCb?: () => void;
  private errorCb?: (err: unknown) => void;
  private pollHandle: number | null = null;

  constructor(private container: HTMLElement) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await loadYouTubeApi();
    await new Promise<void>((resolve) => {
      this.player = new window.YT.Player(this.container, {
        height: '100%',
        width: '100%',
        playerVars: { playsinline: 1, controls: 0, rel: 0 },
        events: {
          onReady: () => resolve(),
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.ENDED) this.endedCb?.();
          },
          onError: (e: any) => this.errorCb?.(e)
        }
      });
    });
    this.pollHandle = window.setInterval(() => {
      if (this.timeUpdateCb && this.player?.getCurrentTime) {
        this.timeUpdateCb(this.player.getCurrentTime());
      }
    }, 500);
  }

  async load(source: PlayableSource): Promise<void> {
    if (source.kind !== 'iframe') throw new Error('YouTubeIframeBackend requires an iframe source');
    await this.ready;
    const videoId = new URL(source.embedUrl).pathname.split('/').pop();
    this.player.loadVideoById(videoId);
  }

  play(): void {
    this.player?.playVideo?.();
  }
  pause(): void {
    this.player?.pauseVideo?.();
  }
  seek(sec: number): void {
    this.player?.seekTo?.(sec, true);
  }
  setVolume(v: number): void {
    this.player?.setVolume?.(Math.round(v * 100));
  }
  setMuted(muted: boolean): void {
    if (muted) this.player?.mute?.();
    else this.player?.unMute?.();
  }
  setPlaybackRate(rate: number): void {
    this.player?.setPlaybackRate?.(rate);
  }
  getCurrentTime(): number {
    return this.player?.getCurrentTime?.() ?? 0;
  }
  getDurationSec(): number {
    return this.player?.getDuration?.() ?? 0;
  }
  getMediaElement(): HTMLMediaElement | null {
    return null; // cross-origin iframe -- not attachable to Web Audio, see interface doc
  }
  destroy(): void {
    if (this.pollHandle) window.clearInterval(this.pollHandle);
    this.player?.destroy?.();
  }
  onTimeUpdate(cb: (sec: number) => void): void {
    this.timeUpdateCb = cb;
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }
  onError(cb: (err: unknown) => void): void {
    this.errorCb = cb;
  }
}
