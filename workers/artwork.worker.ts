/// <reference lib="webworker" />

/**
 * Runs entirely off the main thread: fetches artwork, decodes it, downsamples
 * it on an OffscreenCanvas, and reduces the pixels to one dominant HSL color.
 * This is the same "sample the artwork for an ambient tint" idea LiMusic's
 * artcolor.ts and Monochrome's theming use — done here as a worker so a
 * rapid string of track changes (skip-spamming) never blocks scrolling,
 * queue drag, or animation on the UI thread while artwork decodes.
 */

export interface ArtworkColorRequest {
  requestId: number;
  artworkUrl: string;
}

export interface ArtworkColorResponse {
  requestId: number;
  artworkUrl: string;
  ok: boolean;
  h: number;
  s: number;
  l: number;
}

const SAMPLE_SIZE = 24; // small on purpose — this only needs to find "the" color, not detail

self.onmessage = async (e: MessageEvent<ArtworkColorRequest>) => {
  const { requestId, artworkUrl } = e.data;
  try {
    const bitmap = await loadBitmap(artworkUrl);
    const { h, s, l } = dominantColor(bitmap);
    bitmap.close();
    respond({ requestId, artworkUrl, ok: true, h, s, l });
  } catch {
    // Artwork failed to load/decode (CORS, network, bad URL) — fall back to
    // a neutral color rather than leaving the caller hanging.
    respond({ requestId, artworkUrl, ok: false, h: 0, s: 0, l: 50 });
  }
};

/**
 * Posts a response message back to the main thread.
 */
function respond(msg: ArtworkColorResponse): void {
  (self as unknown as Worker).postMessage(msg);
}

/**
 * Fetches and decodes an image, downsampling it to a small fixed size.
 */
async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { mode: 'cors' });
  const blob = await res.blob();
  return createImageBitmap(blob, { resizeWidth: SAMPLE_SIZE, resizeHeight: SAMPLE_SIZE, resizeQuality: 'low' });
}

/**
 * Extracts the dominant color from a bitmap by averaging all non-transparent pixels.
 */
function dominantColor(bitmap: ImageBitmap): { h: number; s: number; l: number } {
  const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 32) continue; // skip near-transparent pixels (letterboxing)
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return { h: 0, s: 0, l: 50 };
  return rgbToHsl(r / n, g / n, b / n);
}

/**
 * Converts RGB color values (0-255) to HSL (hue 0-360, saturation/lightness 0-100).
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}
