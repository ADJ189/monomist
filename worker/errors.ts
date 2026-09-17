import type { ApiErrorBody, ApiErrorCode } from '../src/api/types';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500
};

/**
 * A typed, throwable API error. Route handlers throw this (or let it
 * propagate from a provider) and the top-level dispatcher in
 * worker/index.ts converts it to a JSON response via `toResponse`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }

  toResponse(): Response {
    return jsonError(this.code, this.message);
  }
}

/** Thrown by provider placeholders (see providers/server-youtube-provider.ts). */
export class NotImplementedError extends ApiError {
  constructor(message: string) {
    super('NOT_IMPLEMENTED', message);
    this.name = 'NotImplementedError';
  }
}

export function jsonError(code: ApiErrorCode, message: string, extraHeaders?: HeadersInit): Response {
  const status = STATUS_BY_CODE[code];
  const body: ApiErrorBody = { error: { code, message, status } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders }
  });
}

export function jsonOk<T>(body: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers }
  });
}

/**
 * Normalizes anything thrown by a route or provider into a Response.
 * Never includes the raw error's message for unrecognized errors --
 * only ApiError's own message is trusted to be user/client-safe;
 * everything else risks leaking internals (stack traces, upstream
 * response bodies that might carry secrets/tokens).
 */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof ApiError) return err.toResponse();
  return jsonError('INTERNAL_ERROR', 'Internal server error');
}
