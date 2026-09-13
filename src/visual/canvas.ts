import type { VisualizerData } from '../player/audiograph';
import { settingsStore, type AppSettings } from '../storage/settings-store';

export interface AccentColor {
  h: number;
  s: number;
  l: number;
}

/**
 * Session Clock's existing renderer.ts does this same "canvas background
 * reacting to state" job for its 100+ themes on the main thread, so this
 * follows the same pattern rather than introducing OffscreenCanvas/worker
 * rendering here -- per the plan doc's own "start with zero workers, add
 * one only once a specific main-thread cost is measured" guidance, and
 * because this canvas needs to read the same accent-color custom
 * properties the DOM uses, which a worker can't see. What it does add:
 * pausing entirely when the tab is hidden, honoring prefers-reduced-motion
 * (with a user override via Settings > Appearance > Motion) instead of
 * quietly ignoring it, several visualizer styles, and a ResizeObserver
 * instead of a window resize listener so it also reacts correctly to
 * container-driven size changes (split-screen, foldables, orientation).
 */
export class CanvasVisualizer {
  private ctx: CanvasRenderingContext2D;
  private raf: number | null = null;
  private systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private settings: AppSettings = settingsStore.get();
  private particles: { x: number; y: number; r: number; vy: number; phase: number }[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribeSettings: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private getFrequencies: () => VisualizerData,
    private getArtworkAccent: () => AccentColor
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    } else {
      // Very old browsers only -- everything else gets the ResizeObserver above.
      window.addEventListener('resize', () => this.resize());
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.start();
    });
    window
      .matchMedia('(prefers-reduced-motion: reduce)')
      .addEventListener('change', (e) => (this.systemReducedMotion = e.matches));

    this.unsubscribeSettings = settingsStore.subscribe((s) => {
      const styleChanged = s.visualizerStyle !== this.settings.visualizerStyle;
      this.settings = s;
      if (styleChanged) this.seedParticles();
    });
    this.seedParticles();
  }

  /** Reduced motion is either the OS setting or a user override -- see settings.ts's "Motion" segmented control. */
  private get reducedMotion(): boolean {
    if (this.settings.motionPreference === 'always') return true;
    if (this.settings.motionPreference === 'never') return false;
    return this.systemReducedMotion;
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private seedParticles(): void {
    const count = this.settings.visualizerStyle === 'ambient' ? 40 : 28;
    this.particles = Array.from({ length: count }, () => ({
      x: Math.random() * this.canvas.clientWidth,
      y: Math.random() * this.canvas.clientHeight,
      r: 1 + Math.random() * 2.2,
      vy: 6 + Math.random() * 14,
      phase: Math.random() * Math.PI * 2
    }));
  }

  private getAccent(): AccentColor {
    if (this.settings.accentMode === 'fixed') {
      return { h: this.settings.fixedHue, s: 55, l: 55 };
    }
    return this.getArtworkAccent();
  }

  start(): void {
    if (this.raf !== null || document.hidden) return;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /** Detaches observers/listeners -- call if this canvas is ever torn down without a page reload. */
  destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.unsubscribeSettings();
  }

  private draw(dt: number): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const { h: hue, s, l } = this.getAccent();
    const { frequencies } = this.getFrequencies();
    const intensity = this.settings.backgroundIntensity;

    this.ctx.clearRect(0, 0, w, h);

    // Soft vertical wash from the accent color, matching the now-playing bar's tint.
    const grad = this.ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `hsl(${hue} ${s}% ${Math.min(30, l)}% / ${clampPct(35 * intensity)}%)`);
    grad.addColorStop(1, 'transparent');
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, w, h);

    switch (this.settings.visualizerStyle) {
      case 'bars':
        this.drawBars(w, h, hue, s, frequencies, intensity);
        break;
      case 'wave':
        this.drawWave(w, h, hue, s, frequencies, intensity);
        break;
      case 'radial':
        this.drawRadial(w, h, hue, s, frequencies, intensity);
        break;
      case 'ambient':
        break; // gradient + particles only -- no frequency shapes
    }

    // Slow drifting particles -- pure ambience, unaffected by audio data.
    if (!this.reducedMotion) this.drawParticles(dt, h, hue, s, intensity);
  }

  private drawBars(w: number, h: number, hue: number, s: number, freq: Uint8Array, intensity: number): void {
    const barCount = Math.min(48, freq.length);
    const barWidth = w / (barCount * 2);
    this.ctx.fillStyle = `hsl(${hue} ${Math.min(70, s + 10)}% 60% / ${clampPct(55 * intensity)}%)`;
    for (let i = 0; i < barCount; i++) {
      const v = freq[i] / 255;
      const barH = this.reducedMotion ? 4 : v * h * 0.22 * intensity;
      const x1 = w / 2 + i * barWidth;
      const x2 = w / 2 - (i + 1) * barWidth;
      this.ctx.fillRect(x1, h - barH, barWidth - 1, barH);
      this.ctx.fillRect(x2, h - barH, barWidth - 1, barH);
    }
  }

  private drawWave(w: number, h: number, hue: number, s: number, freq: Uint8Array, intensity: number): void {
    const midY = h * 0.82;
    this.ctx.strokeStyle = `hsl(${hue} ${Math.min(70, s + 10)}% 65% / ${clampPct(70 * intensity)}%)`;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    const step = w / (freq.length - 1);
    for (let i = 0; i < freq.length; i++) {
      const v = this.reducedMotion ? 0.15 : freq[i] / 255;
      const y = midY - v * h * 0.35 * intensity;
      const x = i * step;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
  }

  private drawRadial(w: number, h: number, hue: number, s: number, freq: Uint8Array, intensity: number): void {
    const cx = w / 2;
    const cy = h * 0.55;
    const baseR = Math.min(w, h) * 0.18;
    const bars = Math.min(64, freq.length);
    this.ctx.strokeStyle = `hsl(${hue} ${Math.min(70, s + 10)}% 62% / ${clampPct(60 * intensity)}%)`;
    this.ctx.lineWidth = 2;
    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2;
      const v = this.reducedMotion ? 0.2 : freq[i] / 255;
      const len = baseR * 0.5 + v * baseR * 1.4 * intensity;
      const x1 = cx + Math.cos(angle) * baseR;
      const y1 = cy + Math.sin(angle) * baseR;
      const x2 = cx + Math.cos(angle) * (baseR + len);
      const y2 = cy + Math.sin(angle) * (baseR + len);
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    }
  }

  private drawParticles(dt: number, h: number, hue: number, s: number, intensity: number): void {
    this.ctx.fillStyle = `hsl(${hue} ${s}% 85% / ${clampPct(40 * Math.min(1, intensity))}%)`;
    for (const p of this.particles) {
      p.y -= p.vy * dt;
      if (p.y < -10) p.y = h + 10;
      const wob = Math.sin(performance.now() / 1000 + p.phase) * 6;
      this.ctx.beginPath();
      this.ctx.arc(p.x + wob, p.y, p.r, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}
