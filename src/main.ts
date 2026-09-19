import './style.css';
import { PlayerEngine } from './player/engine';
import { YouTubeProvider } from './music/providers/youtube';
import { mountShell } from './ui/shell';
import { db, loadQueueState } from './storage/db';

/** How long the startup splash (index.html's inline #splash) stays up at minimum,
 *  so a fast boot doesn't just flash the logo for one frame. */
const MIN_SPLASH_MS = 650;

/**
 * Retrieves the stored YouTube OAuth token from IndexedDB, if present.
 */
async function getStoredYouTubeToken(): Promise<string | null> {
  // Wire this to Session Clock's existing OAuth flow: ensureFreshToken()
  // in integrations.ts already does this token refresh for the
  // 'youtube.readonly' scope used by the current musicdock.ts integration.
  const row = await db.settings.get('youtube-token');
  return (row?.value as string) ?? null;
}

/**
 * Fades out and removes index.html's inline splash. Safe to call more than once.
 */
function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('splash--hide');
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
}

/**
 * Initializes the player engine, provider, and UI. Restores the saved queue if
 * available, and registers the service worker.
 */
async function bootstrap(): Promise<void> {
  const splashShownAt = performance.now();
  const provider = new YouTubeProvider(getStoredYouTubeToken);
  await provider.connect();

  // A placeholder container at construction time -- mountShell below creates
  // the real #yt-surface node synchronously, and we hand it to the engine
  // right after. The engine never touches this container until the first
  // track actually needs the YouTube backend, so the swap is safe.
  const engine = new PlayerEngine(provider, document.createElement('div'));

  const root = document.getElementById('app')!;
  mountShell(root, engine, provider);

  const realSurface = document.getElementById('yt-surface');
  if (realSurface) engine.setIframeContainer(realSurface);

  // The shell is interactive now -- clear the splash once its minimum
  // display time has elapsed, rather than waiting on the queue restore or
  // service worker registration below (neither affects what's on screen).
  const elapsed = performance.now() - splashShownAt;
  window.setTimeout(hideSplash, Math.max(0, MIN_SPLASH_MS - elapsed));

  const savedQueue = await loadQueueState();
  if (savedQueue && savedQueue.trackIds.length > 0) {
    // Restore the queue's contents/position silently, but don't call play()
    // -- browsers block autoplay without a user gesture anyway, and Session
    // Clock's own "opt-in, not always-on" stance says not to try.
    await engine.restoreQueue(savedQueue);
  }

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed', err));
  }
}

void bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  hideSplash(); // don't leave the user staring at a frozen splash screen
});
