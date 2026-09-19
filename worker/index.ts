import type { Env } from './env';
import { ApiError, toErrorResponse } from './errors';
import { callerKey, getRateLimiter } from './rate-limit';
import { handleHealth } from './routes/health';
import { handlePlaybackInfo } from './routes/playback';
import { handleSearch } from './routes/search';
import { handleVideoMetadata } from './routes/video';
import { Router } from './router';

/**
 * Routes contain no provider-specific logic -- they parse/validate the
 * request, call the provider abstraction (worker/providers/registry.ts),
 * and shape the typed response. See worker/providers/types.ts for that
 * boundary. `env` is threaded through as the router's context (third
 * handler argument) rather than any shared/global state -- see
 * router.ts's doc comment for why that matters under concurrent requests.
 */
export const apiRouter = new Router<Env>()
  .get('/api/health', () => handleHealth())
  .get('/api/search', (request, params, env) => handleSearch(request, params, env))
  .get('/api/video/:id', (request, params, env) => handleVideoMetadata(request, params, env))
  .get('/api/playback/:id', (request, params, env) => handlePlaybackInfo(request, params, env));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, url, env);
    }

    // Everything else is the static frontend build (Vite output), served
    // via the Worker's assets binding.
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

/**
 * Handles all /api/* requests: applies rate limiting, routes to the appropriate
 * handler, and converts thrown errors to typed JSON responses.
 */
export async function handleApi(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    const limiter = getRateLimiter(env);
    const limitResult = await limiter.check(`${url.pathname}:${callerKey(request)}`);
    if (!limitResult.allowed) {
      throw new ApiError('RATE_LIMITED', 'Too many requests -- please slow down and try again shortly.');
    }

    const match = apiRouter.match(request.method, url.pathname);
    if (!match) throw new ApiError('NOT_FOUND', `No route for ${request.method} ${url.pathname}`);

    return await match.handler(request, match.params, env);
  } catch (err) {
    // Deliberately never log `request` headers/body here -- that's where
    // an Authorization header or session cookie would end up. Only the
    // method+path are safe, stable things to log for an API error.
    if (!(err instanceof ApiError)) {
      console.error(`Unhandled error for ${request.method} ${url.pathname}:`, err);
    }
    return toErrorResponse(err);
  }
}
