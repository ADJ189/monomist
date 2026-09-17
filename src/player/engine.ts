import type { QueueState, Track } from '../core/types';
import type { MusicProvider } from '../music/provider';
import { db, recordHistory, saveQueueState } from '../storage/db';
import { AudioGraph } from './audiograph';
import { DirectAudioBackend, YouTubeIframeBackend, type PlaybackBackend } from './backends';
import { Queue } from './queue';

export type PlayerEvent =
  | { type: 'trackchange'; track: Track | null }
  | { type: 'playstate'; playing: boolean }
  | { type: 'timeupdate'; currentSec: number; durationSec: number }
  | { type: 'error'; error: unknown };

type Listener = (e: PlayerEvent) => void;

export class PlayerEngine {
  private queue = new Queue();
  private tracksById = new Map<string, Track>();
  private backend: PlaybackBackend | null = null;
  private listeners = new Set<Listener>();
  private playing = false;
  private muted = false;
  private rate = 1;
  /** Named `analyser` for historical/minimal-diff reasons -- it's actually the full
   *  audio graph now (EQ chain included). See player/audiograph.ts. */
  readonly analyser = new AudioGraph();
  /** Debounces queue persistence — see comment on `scheduleQueueSave`. */
  private saveTimer: number | null = null;

  constructor(
    private provider: MusicProvider,
    private iframeContainer: HTMLElement
  ) {}

  /** Called once the real DOM node exists — see main.ts bootstrap order. */
  setIframeContainer(el: HTMLElement): void {
    this.iframeContainer = el;
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: PlayerEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  get currentTrack(): Track | null {
    const id = this.queue.currentTrackId;
    return id ? this.tracksById.get(id) ?? null : null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get shuffle(): boolean {
    return this.queue.shuffle;
  }

  get repeat() {
    return this.queue.repeat;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get playbackRate(): number {
    return this.rate;
  }

  get activeQueueIds(): readonly string[] {
    return this.queue.activeIds;
  }

  getTrack(id: string): Track | undefined {
    return this.tracksById.get(id);
  }

  async playTracks(tracks: Track[], startIndex = 0): Promise<void> {
    for (const t of tracks) this.tracksById.set(t.id, t);
    void db.tracks.bulkPut(tracks); // fire-and-forget cache so a reload can restore the queue by id
    this.queue.set(
      tracks.map((t) => t.id),
      startIndex
    );
    this.scheduleQueueSave();
    await this.loadCurrent();
  }

  addToQueue(tracks: Track[]): void {
    for (const t of tracks) this.tracksById.set(t.id, t);
    void db.tracks.bulkPut(tracks);
    this.queue.append(tracks.map((t) => t.id));
    this.scheduleQueueSave();
  }

  removeFromQueue(trackId: string): void {
    this.queue.remove(trackId);
    this.scheduleQueueSave();
  }

  /** Repopulates the queue from a saved state without starting playback (see main.ts). */
  async restoreQueue(state: QueueState): Promise<void> {
    const tracks = await db.tracks.bulkGet(state.trackIds);
    for (const t of tracks) if (t) this.tracksById.set(t.id, t);
    this.queue.restore(state);
    this.emit({ type: 'trackchange', track: this.currentTrack });
  }

  toggleShuffle(): void {
    this.queue.setShuffle(!this.queue.shuffle);
    this.scheduleQueueSave();
  }

  cycleRepeat(): void {
    this.queue.cycleRepeat();
    this.scheduleQueueSave();
  }

  togglePlayPause(): void {
    if (!this.backend) return;
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    this.backend?.play();
    this.playing = true;
    this.emit({ type: 'playstate', playing: true });
  }

  pause(): void {
    this.backend?.pause();
    this.playing = false;
    this.emit({ type: 'playstate', playing: false });
  }

  seek(sec: number): void {
    this.backend?.seek(sec);
  }

  setVolume(v: number): void {
    this.backend?.setVolume(v);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.backend?.setMuted(this.muted);
  }

  setPlaybackRate(rate: number): void {
    this.rate = rate;
    this.backend?.setPlaybackRate(rate);
  }

  /** Relative seek, clamped to the track's bounds -- used by ±10/±30 skip buttons and Media Session. */
  skip(deltaSec: number): void {
    const duration = this.backend?.getDurationSec() ?? 0;
    const target = Math.max(0, Math.min(duration, (this.backend?.getCurrentTime() ?? 0) + deltaSec));
    this.backend?.seek(target);
  }

  async next(): Promise<void> {
    const nextId = this.queue.advance();
    if (!nextId) {
      this.pause();
      return;
    }
    await this.loadCurrent();
  }

  async previous(): Promise<void> {
    // Restart the current track if we're more than 3s in — matches the
    // behavior every music player's "previous" button actually has.
    if ((this.backend?.getCurrentTime() ?? 0) > 3) {
      this.backend?.seek(0);
      return;
    }
    const prevId = this.queue.previous();
    if (!prevId) return;
    await this.loadCurrent();
  }

  private async loadCurrent(): Promise<void> {
    const track = this.currentTrack;
    this.emit({ type: 'trackchange', track });
    if (!track) return;

    this.backend?.destroy();
    try {
      const source = await this.provider.resolvePlayableSource(track);
      this.backend =
        source.kind === 'iframe'
          ? new YouTubeIframeBackend(this.iframeContainer)
          : // Passing a resolver (rather than resolving once) is what lets
            // DirectAudioBackend refresh a temporary media URL before it
            // expires -- see backends.ts. Re-resolving the same track is
            // safe/idempotent for every current provider.
            new DirectAudioBackend(() => this.provider.resolvePlayableSource(track));
      await this.backend.load(source);
      this.backend.setMuted(this.muted);
      this.backend.setPlaybackRate(this.rate);
      // Reattach the analyser to whatever media element (if any) this
      // backend exposes -- real FFT data for AudioBackend, none for the
      // iframe backend (see analyser.ts for why that's a hard boundary).
      this.analyser.attach(this.backend.getMediaElement());

      this.backend.onTimeUpdate((sec) => {
        this.emit({ type: 'timeupdate', currentSec: sec, durationSec: this.backend?.getDurationSec() ?? 0 });
      });
      this.backend.onEnded(() => void this.next());
      this.backend.onError((err) => this.emit({ type: 'error', error: err }));

      this.play();
      void recordHistory(track.id);
    } catch (error) {
      this.emit({ type: 'error', error });
    }
  }

  /**
   * Queue state is written on every shuffle/repeat/track change, but a
   * skip-happy user can fire several of those a second. Debounce the
   * IndexedDB write instead of persisting on every single mutation —
   * the queue only needs to survive a reload, not every intermediate state.
   */
  private scheduleQueueSave(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void saveQueueState(this.queue.snapshot());
    }, 400);
  }
}
