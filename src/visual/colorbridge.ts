import type { ArtworkColorRequest, ArtworkColorResponse } from '../../workers/artwork.worker';

/**
 * Drives the now-playing bar's ambient tint. Registered custom properties
 * (see style.css's @property --accent-h/--accent-s/--accent-l) are natively
 * interpolable, so setting a new value on :root is enough to get a smooth
 * compositor-driven crossfade — no requestAnimationFrame loop, no per-frame
 * JS, no main-thread cost for the animation itself. Same technique LiMusic
 * uses for its artwork tint; the pixel sampling that feeds it runs in
 * artwork.worker.ts so decoding never competes with that transition or with
 * scrolling/dragging on the UI thread.
 */
export class ColorBridge {
  private worker = new Worker(new URL('../../workers/artwork.worker.ts', import.meta.url), { type: 'module' });
  private nextRequestId = 0;
  private latestRequestId = 0; // guards against a slow, stale response clobbering a newer track's color
  private root = document.documentElement;
  private currentColor = { h: 210, s: 40, l: 50 };

  /** Last applied color -- canvas.ts reads this each frame instead of re-parsing CSS custom properties. */
  get current(): { h: number; s: number; l: number } {
    return this.currentColor;
  }

  constructor() {
    this.worker.onmessage = (e: MessageEvent<ArtworkColorResponse>) => {
      if (e.data.requestId !== this.latestRequestId) return; // stale — a newer track already superseded it
      this.applyColor(e.data.h, e.data.s, e.data.l);
    };
  }

  /**
   * Requests dominant color extraction for the given artwork URL. Falls back
   * to a neutral color if the URL is undefined.
   */
  setArtwork(artworkUrl: string | undefined): void {
    if (!artworkUrl) {
      this.applyColor(0, 0, 20); // neutral fallback when a track has no artwork
      return;
    }
    const requestId = ++this.nextRequestId;
    this.latestRequestId = requestId;
    const msg: ArtworkColorRequest = { requestId, artworkUrl };
    this.worker.postMessage(msg);
  }

  /**
   * Applies an HSL color to the document root's CSS custom properties.
   */
  private applyColor(h: number, s: number, l: number): void {
    this.currentColor = { h, s, l };
    this.root.style.setProperty('--accent-h', String(h));
    this.root.style.setProperty('--accent-s', `${s}%`);
    this.root.style.setProperty('--accent-l', `${l}%`);
  }

  /**
   * Terminates the artwork worker.
   */
  destroy(): void {
    this.worker.terminate();
  }
}
