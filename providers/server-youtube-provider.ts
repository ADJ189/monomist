import { NotImplementedError } from '../errors';
import type { ProviderPlaybackInfo, ProviderSearchResult, ProviderVideoMetadata, RemoteMusicProvider } from './types';

/**
 * Placeholder for the future server-side YouTube provider.
 *
 * DELIBERATELY NOT IMPLEMENTED. This class exists to give the routing
 * layer (worker/routes/*.ts) and the provider registry (registry.ts)
 * something concrete to depend on today, so that wiring in a real
 * implementation later is a one-file change with no route or client
 * changes required.
 *
 * When that implementation is written, it is expected to wrap a
 * YouTube.js/Innertube client (constructed elsewhere, not in this repo
 * as it stands) to do:
 *   - search(): Innertube search -> map results to ProviderSearchResult[]
 *   - getVideoMetadata(): Innertube video info -> ProviderVideoMetadata
 *   - getPlaybackInfo(): resolve an adaptive/audio stream URL -> a
 *     `{ kind: 'audio-url', url, expiresAt }` ProviderPlaybackInfo, with
 *     `expiresAt` set from the stream's actual expiry so the frontend
 *     backend (see src/player/backends.ts DirectAudioBackend) knows when
 *     to refresh it.
 *
 * Explicitly out of scope for that future work, per this repo's rules:
 * PO-token generation, BotGuard/attestation solving, or any other
 * anti-bot bypass. If Innertube playback requires one of those to
 * function, getPlaybackInfo() should keep throwing (or fall back to
 * `{ kind: 'iframe', embedUrl }`) rather than the adapter growing a
 * workaround for it.
 *
 * Until then, every method here throws NotImplementedError, which routes
 * translate into a 501 NOT_IMPLEMENTED response. The frontend's
 * MusicProvider (src/music/providers/youtube.ts) treats that response as
 * a signal to fall back to its existing direct-to-Data-API-v3 path, so
 * the app keeps working exactly as it did before this scaffolding was
 * added -- see that file's `search`/`resolvePlayableSource` for the
 * fallback.
 */
export class ServerYouTubeProvider implements RemoteMusicProvider {
  readonly id = 'youtube';

  async search(_query: string, _opts?: { signal?: AbortSignal }): Promise<ProviderSearchResult[]> {
    throw new NotImplementedError(
      'Server-side YouTube search is not implemented yet. A future YouTube.js/Innertube adapter plugs in here.'
    );
  }

  async getVideoMetadata(_sourceId: string, _opts?: { signal?: AbortSignal }): Promise<ProviderVideoMetadata> {
    throw new NotImplementedError(
      'Server-side YouTube video metadata is not implemented yet. A future YouTube.js/Innertube adapter plugs in here.'
    );
  }

  async getPlaybackInfo(_sourceId: string, _opts?: { signal?: AbortSignal }): Promise<ProviderPlaybackInfo> {
    throw new NotImplementedError(
      'Server-side YouTube playback resolution is not implemented yet. A future YouTube.js/Innertube adapter plugs in here.'
    );
  }
}
