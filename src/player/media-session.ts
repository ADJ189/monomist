import type { PlayerEngine } from './engine';

/**
 * Binds Media Session API handlers for hardware media controls. This is
 * pure progressive enhancement -- every call is guarded, and the app works
 * identically if the API doesn't exist.
 */
export function bindMediaSession(engine: PlayerEngine): void {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;

  ms.setActionHandler('play', () => engine.play());
  ms.setActionHandler('pause', () => engine.pause());
  ms.setActionHandler('previoustrack', () => void engine.previous());
  ms.setActionHandler('nexttrack', () => void engine.next());
  ms.setActionHandler('seekbackward', (details) => engine.skip(-(details.seekOffset ?? 10)));
  ms.setActionHandler('seekforward', (details) => engine.skip(details.seekOffset ?? 10));
  try {
    ms.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') engine.seek(details.seekTime);
    });
  } catch {
    // Some browsers support the other handlers but not 'seekto' -- fine to skip.
  }

  engine.on((event) => {
    if (event.type === 'trackchange') {
      const t = event.track;
      ms.metadata = t
        ? new MediaMetadata({
            title: t.title,
            artist: t.artist,
            album: t.album ?? '',
            artwork: t.artwork ? [{ src: t.artwork.url, sizes: '512x512', type: 'image/jpeg' }] : []
          })
        : null;
    }
    if (event.type === 'playstate') {
      ms.playbackState = event.playing ? 'playing' : 'paused';
    }
  });
}
