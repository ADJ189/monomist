import type { RepeatMode } from '../core/types';

export class Queue {
  private order: string[] = [];
  private shuffledOrder: string[] | null = null;
  private index = 0;
  private _repeat: RepeatMode = 'off';
  private _shuffle = false;

  get repeat(): RepeatMode {
    return this._repeat;
  }

  get shuffle(): boolean {
    return this._shuffle;
  }

  get currentTrackId(): string | undefined {
    return this.active[this.index];
  }

  get length(): number {
    return this.order.length;
  }

  /** The order actually being played right now (shuffled or not). */
  get activeIds(): readonly string[] {
    return this.active;
  }

  get currentIndexInActive(): number {
    return this.index;
  }

  /** Removes a track from both orderings. No-ops if it's the currently playing track. */
  remove(trackId: string): void {
    if (trackId === this.currentTrackId) return;
    const activeIdx = this.active.indexOf(trackId);
    if (activeIdx !== -1 && activeIdx < this.index) this.index -= 1;
    this.order = this.order.filter((id) => id !== trackId);
    if (this.shuffledOrder) this.shuffledOrder = this.shuffledOrder.filter((id) => id !== trackId);
  }

  private get active(): string[] {
    return this._shuffle && this.shuffledOrder ? this.shuffledOrder : this.order;
  }

  /**
   * Replaces the queue with new track IDs and sets the starting index.
   */
  set(trackIds: string[], startIndex = 0): void {
    this.order = [...trackIds];
    this.shuffledOrder = this._shuffle ? shuffled(this.order, this.order[startIndex]) : null;
    this.index = Math.max(0, Math.min(startIndex, this.order.length - 1));
  }

  /**
   * Appends track IDs to the end of the queue.
   */
  append(trackIds: string[]): void {
    this.order.push(...trackIds);
    if (this.shuffledOrder) this.shuffledOrder.push(...shuffled(trackIds));
  }

  /**
   * Enables or disables shuffle mode, reordering the queue accordingly.
   */
  setShuffle(on: boolean): void {
    if (on === this._shuffle) return;
    this._shuffle = on;
    this.shuffledOrder = on ? shuffled(this.order, this.currentTrackId) : null;
    if (on) this.index = 0;
    else this.index = Math.max(0, this.order.indexOf(this.currentTrackId ?? ''));
  }

  /**
   * Cycles the repeat mode: off -> all -> one -> off.
   */
  cycleRepeat(): RepeatMode {
    const next: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
    this._repeat = next[this._repeat];
    return this._repeat;
  }

  /** Returns the next track id, or undefined if the queue has genuinely ended. */
  advance(): string | undefined {
    if (this._repeat === 'one') return this.currentTrackId;
    if (this.index + 1 < this.active.length) {
      this.index += 1;
      return this.currentTrackId;
    }
    if (this._repeat === 'all' && this.active.length > 0) {
      this.index = 0;
      return this.currentTrackId;
    }
    return undefined;
  }

  /**
   * Moves to the previous track, or wraps to the end if repeat-all is on.
   */
  previous(): string | undefined {
    if (this.index === 0) return this._repeat === 'all' ? this.active.at(-1) : undefined;
    this.index -= 1;
    return this.currentTrackId;
  }

  /**
   * Captures the current queue state for persistence.
   */
  snapshot() {
    return {
      trackIds: this.order,
      currentIndex: this.index,
      shuffle: this._shuffle,
      repeat: this._repeat
    };
  }

  /**
   * Restores the queue from a saved state.
   */
  restore(state: { trackIds: string[]; currentIndex: number; shuffle: boolean; repeat: RepeatMode }): void {
    this.order = state.trackIds;
    this._repeat = state.repeat;
    this._shuffle = state.shuffle;
    this.shuffledOrder = state.shuffle ? shuffled(this.order, this.order[state.currentIndex]) : null;
    this.index = state.currentIndex;
  }
}

/** Fisher–Yates shuffle, with the anchor track (usually "currently playing") pinned first. */
function shuffled(ids: string[], anchor?: string): string[] {
  const rest = ids.filter((id) => id !== anchor);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return anchor ? [anchor, ...rest] : rest;
}
