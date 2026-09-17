import { monomistApi } from '../../api/client';
import type { PlayableSource, SearchResults, Track } from '../../core/types';
import type { MusicProvider } from '../provider';

/**
 * YouTube provider.
 *
 * As of the Monomist API/Worker scaffolding (see worker/ and src/api/),
 * this provider's `search` and `resolvePlayableSource` first try going
 * through the Monomist API client (`monomistApi`, src/api/client.ts) --
 * that's the "where appropriate" refactor: it's the path a future
 * server-side YouTube.js/Innertube adapter would serve real results on,
 * once worker/providers/server-youtube-provider.ts stops being a
 * placeholder.
 *
 * Today that placeholder always responds 501 NOT_IMPLEMENTED (or the
 * Worker may not even be deployed in this environment), so every call
 * below falls straight through to the exact same direct-to-official-
 * Data-API-v3 implementation this provider always had. That fallback
 * path is unchanged from before this refactor -- same requests, same
 * OAuth token, same official IFrame Player embed for playback. Nothing
 * about the app's current behavior changes; only the entry point does,
 * and only once the server side actually has something to serve.
 *
 * The fallback is deliberately broad (any thrown error, or an
 * unexpected/empty response shape) rather than narrowly checking for
 * `ApiError.isNotImplemented` -- a Worker that isn't deployed at all in
 * a given environment (e.g. plain `vite dev` with no `wrangler dev`
 * alongside it) won't produce a typed API error either, and should fall
 * back exactly the same way.
 *
 * Deliberate scope note (unchanged): `resolvePlayableSource` must return
 * either a licensed/official audio URL or an 'iframe' source that mounts
 * the provider's own official embedded player. It must never resolve a
 * track by deciphering or reverse-engineering a private streaming API.
 */
export class YouTubeProvider implements MusicProvider {
  readonly id = 'youtube';

  constructor(private getToken: () => Promise<string | null>) {}

  /**
   * Returns true if the provider has a valid OAuth token.
   */
  isAuthenticated(): boolean {
    return this._authenticated;
  }

  private _authenticated = false;

  /**
   * Initializes the provider by checking for an available OAuth token.
   */
  async connect(): Promise<void> {
    const token = await this.getToken();
    this._authenticated = Boolean(token);
  }

  /**
   * Searches for tracks matching the given query. Tries the Monomist API first,
   * then falls back to direct Data API v3 calls.
   */
  async search(query: string, signal?: AbortSignal): Promise<SearchResults> {
    const remote = await this.searchViaApi(query, signal).catch(() => null);
    if (remote) return remote;
    return this.searchDirect(query, signal);
  }

  /** Tries the Monomist API. Returns null (never throws) for the caller to fall back on. */
  private async searchViaApi(query: string, signal?: AbortSignal): Promise<SearchResults | null> {
    const res = await monomistApi.search(query, signal);
    if (!res || !Array.isArray(res.tracks)) return null; // defends against a dev-server SPA-fallback HTML body parsed as null, see class doc
    const tracks: Track[] = res.tracks.map((t): Track => ({
      id: `yt:${t.sourceId}`,
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
      artwork: t.artwork,
      sourceId: t.sourceId,
      sourceKind: 'youtube'
    }));
    return { tracks, albums: [], artists: [], playlists: [] };
  }

  /** Original implementation: official Data API v3, OAuth-gated. */
  private async searchDirect(query: string, signal?: AbortSignal): Promise<SearchResults> {
    const token = await this.getToken();
    if (!token) return { tracks: [], albums: [], artists: [], playlists: [] };

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoCategoryId', '10'); // Music
    url.searchParams.set('maxResults', '25');
    url.searchParams.set('q', query);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal
    });
    if (!res.ok) throw new Error(`YouTube search failed: ${res.status}`);
    const data = await res.json();

    const tracks: Track[] = (data.items ?? []).map((item: any): Track => ({
      id: `yt:${item.id.videoId}`,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      durationSec: 0, // filled in below
      artwork: item.snippet.thumbnails?.medium
        ? { url: item.snippet.thumbnails.medium.url }
        : undefined,
      sourceId: item.id.videoId,
      sourceKind: 'youtube'
    }));

    await this.fillDurations(tracks, token, signal);
    return { tracks, albums: [], artists: [], playlists: [] };
  }

  /**
   * search.list doesn't return durations -- a second, official videos.list
   * call is required. Batched into one request for up to 50 ids rather
   * than one request per track, since that's what the API actually allows
   * and it avoids burning quota per-row.
   */
  private async fillDurations(tracks: Track[], token: string, signal?: AbortSignal): Promise<void> {
    if (tracks.length === 0) return;
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'contentDetails');
    url.searchParams.set('id', tracks.map((t) => t.sourceId).join(','));

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!res.ok) return; // duration is a nice-to-have -- don't fail the whole search over it
    const data = await res.json();
    const durationById = new Map<string, number>(
      (data.items ?? []).map((item: any) => [item.id, parseIso8601Duration(item.contentDetails.duration)])
    );
    for (const t of tracks) t.durationSec = durationById.get(t.sourceId) ?? 0;
  }

  /**
   * Resolves a playable source for the given track. Tries the Monomist API first,
   * then falls back to the IFrame Player embed.
   */
  async resolvePlayableSource(track: Track): Promise<PlayableSource> {
    const remote = await this.resolveViaApi(track).catch(() => null);
    if (remote) return remote;
    return this.resolveIframeSourceDirect(track);
  }

  /** Tries the Monomist API's playback route. Returns null (never throws) for the caller to fall back on. */
  private async resolveViaApi(track: Track): Promise<PlayableSource | null> {
    const info = await monomistApi.getPlaybackInfo(track.sourceId);
    if (!info || (info.kind !== 'audio-url' && info.kind !== 'iframe')) return null;
    return info.kind === 'audio-url'
      ? { kind: 'audio-url', url: info.url, expiresAt: info.expiresAt }
      : { kind: 'iframe', embedUrl: info.embedUrl };
  }

  /** Original implementation: mounts YouTube's own official IFrame Player. */
  private async resolveIframeSourceDirect(track: Track): Promise<PlayableSource> {
    return {
      kind: 'iframe',
      embedUrl: `https://www.youtube.com/embed/${track.sourceId}?autoplay=1&enablejsapi=1`
    };
  }
}

/**
 * Parses YouTube's ISO 8601 durations (e.g. "PT3M45S") into whole seconds.
 */
function parseIso8601Duration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}
