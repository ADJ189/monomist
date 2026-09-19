import type {
  ApiErrorCode,
  HealthResponseBody,
  PlaybackInfoResponseBody,
  SearchResponseBody,
  VideoMetadataResponseBody
} from './types';
import { isApiErrorBody } from './types';

/**
 * Thrown for any non-2xx Monomist API response. Carries the typed error
 * code from the server so callers can branch (e.g. `NOT_IMPLEMENTED` while
 * the server-side YouTube.js adapter doesn't exist yet) without parsing
 * `message` strings.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /** True for the specific "server-side adapter isn't wired up yet" case. */
  get isNotImplemented(): boolean {
    return this.code === 'NOT_IMPLEMENTED';
  }
}

export interface MonomistApiClientOptions {
  /** Defaults to same-origin '/api' -- the Worker serves both the app and the API. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin, typed wrapper around the Monomist API (`/api/*`, served by the
 * Cloudflare Worker in worker/). This is the only place in the frontend
 * that should know the API's URL shape -- providers and UI code call
 * these methods instead of constructing fetch() calls themselves.
 */
export class MonomistApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: MonomistApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api';
    // Deliberately NOT resolved/bound here: binding `fetch` once at
    // construction time would freeze the default `monomistApi` singleton
    // (below) to whatever `globalThis.fetch` was when this module first
    // loaded -- e.g. tests that swap `global.fetch` for a mock afterward
    // would silently keep hitting the real implementation. Resolving in
    // `request()` instead picks up the current global at call time, same
    // as any other code that calls bare `fetch(...)`.
    this.fetchImpl = options.fetchImpl;
  }

  async health(signal?: AbortSignal): Promise<HealthResponseBody> {
    return this.request<HealthResponseBody>('GET', '/health', signal);
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResponseBody> {
    const params = new URLSearchParams({ q: query });
    return this.request<SearchResponseBody>('GET', `/search?${params.toString()}`, signal);
  }

  async getVideoMetadata(sourceId: string, signal?: AbortSignal): Promise<VideoMetadataResponseBody> {
    return this.request<VideoMetadataResponseBody>('GET', `/video/${encodeURIComponent(sourceId)}`, signal);
  }

  async getPlaybackInfo(sourceId: string, signal?: AbortSignal): Promise<PlaybackInfoResponseBody> {
    return this.request<PlaybackInfoResponseBody>('GET', `/playback/${encodeURIComponent(sourceId)}`, signal);
  }

  private async request<T>(method: string, path: string, signal?: AbortSignal): Promise<T> {
    // Resolved here (not cached from the constructor) so the default
    // singleton always calls whatever `fetch` is current -- see the
    // constructor's comment.
    const fetchImpl = this.fetchImpl ?? fetch.bind(globalThis);

    let res: Response;
    try {
      res = await fetchImpl(`${this.baseUrl}${path}`, { method, signal });
    } catch (err) {
      // Network failure, not an API-shaped error -- surface distinctly so
      // callers can tell "server said no" from "couldn't reach the server".
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new ApiError('UPSTREAM_ERROR', 0, err instanceof Error ? err.message : 'Network request failed');
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      if (isApiErrorBody(body)) {
        throw new ApiError(body.error.code, body.error.status, body.error.message);
      }
      throw new ApiError('INTERNAL_ERROR', res.status, `Request failed with status ${res.status}`);
    }

    return body as T;
  }
}

/** Default singleton -- most call sites just need this. */
export const monomistApi = new MonomistApiClient();
