import { describe, expect, it } from 'vitest';
import { ApiError, toErrorResponse } from '../errors';
import { readJson } from './test-utils';
import type { Env } from '../env';
import { handleHealth } from '../routes/health';
import { handlePlaybackInfo } from '../routes/playback';
import { handleSearch } from '../routes/search';
import { handleVideoMetadata } from '../routes/video';

/**
 * Route handlers throw ApiError rather than returning error Responses
 * themselves -- worker/index.ts's `handleApi` is the single place that
 * catches and converts (see its doc comment). These tests exercise that
 * same throw-then-convert contract via `toErrorResponse`, the same
 * helper the real dispatcher uses, rather than reimplementing it.
 */

function fakeEnv(): Env {
  return {
    ENVIRONMENT: 'development',
    PUBLIC_APP_URL: 'http://localhost:8787',
    ASSETS: {} as Env['ASSETS']
  };
}

async function runRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return toErrorResponse(err);
  }
}

describe('GET /api/health', () => {
  it('returns status ok with a timestamp', async () => {
    const res = await handleHealth();
    expect(res.status).toBe(200);
    const body = await readJson<{ status: string; time: number }>(res);
    expect(body.status).toBe('ok');
    expect(typeof body.time).toBe('number');
  });
});

describe('GET /api/search', () => {
  it('rejects a missing query with 400', async () => {
    const request = new Request('https://x.test/api/search');
    const res = await runRoute(() => handleSearch(request, {}, fakeEnv()));
    expect(res.status).toBe(400);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('throws a BAD_REQUEST ApiError (not some other error type) for a missing query', async () => {
    const request = new Request('https://x.test/api/search');
    await expect(handleSearch(request, {}, fakeEnv())).rejects.toBeInstanceOf(ApiError);
  });

  it('returns 501 NOT_IMPLEMENTED against the placeholder provider', async () => {
    const request = new Request('https://x.test/api/search?q=test+song');
    const res = await runRoute(() => handleSearch(request, {}, fakeEnv()));
    expect(res.status).toBe(501);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('GET /api/video/:id', () => {
  it('rejects an invalid id with 400', async () => {
    const request = new Request('https://x.test/api/video/..%2f..');
    const res = await runRoute(() => handleVideoMetadata(request, { id: '../..' }, fakeEnv()));
    expect(res.status).toBe(400);
  });

  it('returns 501 NOT_IMPLEMENTED for a well-formed id', async () => {
    const request = new Request('https://x.test/api/video/dQw4w9WgXcQ');
    const res = await runRoute(() => handleVideoMetadata(request, { id: 'dQw4w9WgXcQ' }, fakeEnv()));
    expect(res.status).toBe(501);
  });
});

describe('GET /api/playback/:id', () => {
  it('rejects an invalid id with 400', async () => {
    const request = new Request('https://x.test/api/playback/bad id');
    const res = await runRoute(() => handlePlaybackInfo(request, { id: 'bad id' }, fakeEnv()));
    expect(res.status).toBe(400);
  });

  it('returns 501 NOT_IMPLEMENTED for a well-formed id', async () => {
    const request = new Request('https://x.test/api/playback/dQw4w9WgXcQ');
    const res = await runRoute(() => handlePlaybackInfo(request, { id: 'dQw4w9WgXcQ' }, fakeEnv()));
    expect(res.status).toBe(501);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
