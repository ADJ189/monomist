import type { ApiArtwork } from '../../src/api/types';

/**
 * Server-side counterpart to the frontend's MusicProvider
 * (src/music/provider.ts). Routes (worker/routes/*.ts) only ever call
 * through this interface -- they never import a specific implementation
 * or do provider-specific fetching themselves. That's what keeps
 * YouTube-specific (or, later, other services') logic out of the routing
 * layer.
 *
 * This is intentionally source-agnostic: nothing here mentions YouTube,
 * Innertube, or YouTube.js. A given implementation (see
 * server-youtube-provider.ts) picks a `sourceKind` and is free to change
 * how it fetches data without the route contracts changing.
 */
export interface ProviderSearchResult {
  sourceId: string;
  sourceKind: string;
  title: string;
  artist: string;
  durationSec: number;
  artwork?: ApiArtwork;
}

export type ProviderVideoMetadata = ProviderSearchResult;

/**
 * Mirrors the frontend's PlayableSource. A provider may resolve either a
 * temporary, provider-issued media URL (`audio-url`, with an optional
 * `expiresAt` the frontend uses to schedule a refresh -- see
 * player/backends.ts) or an embed URL for a compliant, official embedded
 * player (`iframe`).
 */
export type ProviderPlaybackInfo =
  | { kind: 'audio-url'; url: string; expiresAt?: number }
  | { kind: 'iframe'; embedUrl: string };

export interface RemoteMusicProvider {
  readonly id: string;
  search(query: string, opts?: { signal?: AbortSignal }): Promise<ProviderSearchResult[]>;
  getVideoMetadata(sourceId: string, opts?: { signal?: AbortSignal }): Promise<ProviderVideoMetadata>;
  getPlaybackInfo(sourceId: string, opts?: { signal?: AbortSignal }): Promise<ProviderPlaybackInfo>;
}
