import Liricle from 'liricle';

export interface LyricsLine {
  index?: number;
  time: number;
  text: string;
}

type LineListener = (line: LyricsLine | null) => void;

/**
 * Thin wrapper around Liricle so ui/shell.ts doesn't need to know the
 * library's event API. `feed(seconds)` is meant to be called from the
 * player engine's existing timeupdate event -- no separate polling loop.
 */
export class LyricsSync {
  private liricle = new Liricle();
  private listeners = new Set<LineListener>();
  private loaded = false;

  constructor() {
    this.liricle.on('sync', (line) => {
      for (const cb of this.listeners) cb(line as LyricsLine | null);
    });
  }

  /**
   * Registers a callback to be notified when the active lyrics line changes.
   * Returns an unsubscribe function.
   */
  onLineChange(cb: LineListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Loads and parses LRC text. Returns true on success, false if parsing failed.
   */
  load(lrcText: string): boolean {
    try {
      this.liricle.load({ text: lrcText });
      this.loaded = true;
      return true;
    } catch {
      this.loaded = false;
      return false;
    }
  }

  /**
   * Clears the currently loaded lyrics.
   */
  clear(): void {
    this.loaded = false;
  }

  /**
   * Returns true if lyrics are currently loaded.
   */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Returns the parsed lyrics lines with timestamps.
   */
  get lines(): LyricsLine[] {
    return this.liricle.data?.lines ?? [];
  }

  /**
   * Updates the sync state with the current playback time in seconds.
   */
  feed(currentSec: number): void {
    if (this.loaded) this.liricle.sync(currentSec);
  }
}
