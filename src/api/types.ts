/**
 * Shared typed models for the Monomist API.
 *
 * This file is imported from both sides of the wire:
 *   - the frontend client (src/api/client.ts)
 *   - the Cloudflare Worker (worker/routes/*.ts)
 *
 * Keeping one definition avoids the request/response shape drifting between
 * client and server. Nothing in this file is provider-specific — it mirrors
 * (and is deliberately kept close to) the domain types in core/types.ts, but
 * lives separately because the wire format and the in-app domain model are
 * allowed to diverge over time (e.g. dates as numbers on the wire).
 */

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface ApiArtwork {
  url: string;
  width?: number;
  height?: number;
}

export interface ApiTrackSummary {
  /** Opaque per-provider id (e.g. a YouTube video id). Never assume a shape. */
  sourceId: string;
  sourceKind: 'youtube';
  title: string;
  artist: string;
  durationSec: number;
  artwork?: ApiArtwork;
}

export interface SearchRequestQuery {
  q: string;
}

export interface SearchResponseBody {
  tracks: ApiTrackSummary[];
}

// ---------------------------------------------------------------------------
// Video metadata
// ---------------------------------------------------------------------------

export interface VideoMetadataResponseBody {
  sourceId: string;
  sourceKind: 'youtube';
  title: string;
  artist: string;
  durationSec: number;
  artwork?: ApiArtwork;
}

// ---------------------------------------------------------------------------
// Playback info
// ---------------------------------------------------------------------------

/**
 * Mirrors core/types.ts's `PlayableSource`, minus the discriminant-only
 * fields that don't need to cross the wire. `expiresAt` is a unix-ms
 * timestamp; the frontend backend layer uses it to schedule a refresh
 * before a temporary media URL goes stale (see player/backends.ts).
 */
export type PlaybackInfoResponseBody =
  | { kind: 'audio-url'; url: string; expiresAt?: number }
  | { kind: 'iframe'; embedUrl: string };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Stable machine-readable error codes. Add to this list rather than
 * inventing ad-hoc strings, so the frontend can branch on `code` instead of
 * parsing `message`.
 */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** HTTP status this error was sent with, duplicated here for convenience. */
    status: number;
  };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'object'
  );
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponseBody {
  status: 'ok';
  time: number;
}
