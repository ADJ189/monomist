import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import worker, { handleApi } from '../index';
import { readJson } from './test-utils';

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    PUBLIC_APP_URL: 'http://localhost:8787',
    ASSETS: { fetch: vi.fn(async () => new Response('<html>app shell</html>')) } as unknown as Env['ASSETS'],
    ...overrides
  };
}

describe('handleApi', () => {
  it('returns 404 NOT_FOUND for an unknown API route', async () => {
    const env = fakeEnv();
    const request = new Request('https://x.test/api/does-not-exist');
    const res = await handleApi(request, new URL(request.url), env);
    expect(res.status).toBe(404);
    expect((await readJson<{ error: { code: string } }>(res)).error.code).toBe('NOT_FOUND');
  });

  it('dispatches a known route (health)', async () => {
    const env = fakeEnv();
    const request = new Request('https://x.test/api/health');
    const res = await handleApi(request, new URL(request.url), env);
    expect(res.status).toBe(200);
    expect((await readJson<{ status: string }>(res)).status).toBe('ok');
  });

  it('enforces the rate limit across repeated calls to the same route', async () => {
    // Every route in this suite shares the module-level in-memory limiter
    // fallback (no MONOMIST_KV bound), keyed by pathname+caller -- use a
    // route path unique to this test so it doesn't interact with the
    // 30-req/60s default budget other tests in this file consume.
    const env = fakeEnv();
    const path = '/api/health';
    const makeRequest = () =>
      new Request(`https://ratelimit-test.example${path}`, { headers: { 'cf-connecting-ip': '203.0.113.9' } });

    let lastStatus = 200;
    for (let i = 0; i < 35; i++) {
      const request = makeRequest();
      const res = await handleApi(request, new URL(request.url), env);
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
  it('returns 400 BAD_REQUEST (not an unhandled 500) for a malformed percent-encoded param', async () => {
    const env = fakeEnv();
    const request = new Request('https://x.test/api/video/%ZZ');
    const res = await handleApi(request, new URL(request.url), env);
    expect(res.status).toBe(400);
    expect((await readJson<{ error: { code: string } }>(res)).error.code).toBe('BAD_REQUEST');
  });
});

describe('worker default export (fetch)', () => {
  it('routes /api/* to the API dispatcher', async () => {
    const env = fakeEnv();
    const request = new Request('https://x.test/api/health');
    const res = await worker.fetch(request, env);
    expect(res.status).toBe(200);
  });

  it('falls back to the ASSETS binding for non-API paths', async () => {
    const env = fakeEnv();
    const request = new Request('https://x.test/some/frontend/route');
    const res = await worker.fetch(request, env);
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
    expect(await res.text()).toBe('<html>app shell</html>');
  });
});
