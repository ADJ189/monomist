import { describe, expect, it, vi } from 'vitest';
import { Router } from '../router';

describe('Router', () => {
  it('matches a static path and method', () => {
    const router = new Router();
    const handler = vi.fn(async () => new Response('ok'));
    router.get('/api/health', handler);

    const match = router.match('GET', '/api/health');
    expect(match).not.toBeNull();
    expect(match?.handler).toBe(handler);
    expect(match?.params).toEqual({});
  });

  it('extracts named params', () => {
    const router = new Router();
    router.get('/api/video/:id', async () => new Response('ok'));

    const match = router.match('GET', '/api/video/abc123');
    expect(match?.params).toEqual({ id: 'abc123' });
  });

  it('decodes percent-encoded param segments', () => {
    const router = new Router();
    router.get('/api/video/:id', async () => new Response('ok'));

    const match = router.match('GET', '/api/video/a%20b');
    expect(match?.params).toEqual({ id: 'a b' });
  });

  it('is case-insensitive on method but not on path segments', () => {
    const router = new Router();
    router.get('/api/Health', async () => new Response('ok'));

    expect(router.match('get', '/api/Health')).not.toBeNull();
    expect(router.match('GET', '/api/health')).toBeNull();
  });

  it('returns null for no match (wrong method)', () => {
    const router = new Router();
    router.get('/api/health', async () => new Response('ok'));
    expect(router.match('POST', '/api/health')).toBeNull();
  });

  it('returns null for no match (wrong segment count)', () => {
    const router = new Router();
    router.get('/api/video/:id', async () => new Response('ok'));
    expect(router.match('GET', '/api/video')).toBeNull();
    expect(router.match('GET', '/api/video/a/b')).toBeNull();
  });

  it('does not match a literal segment against a value that differs', () => {
    const router = new Router();
    router.get('/api/search', async () => new Response('ok'));
    router.get('/api/video/:id', async () => new Response('ok'));

    // "/api/search" must not accidentally match "/api/video/:id"'s pattern
    // or vice versa.
    expect(router.match('GET', '/api/searchxyz')).toBeNull();
  });

  it('threads an arbitrary context through to the matched handler', async () => {
    const router = new Router<{ label: string }>();
    router.get('/api/thing', async (_req, _params, ctx) => new Response(ctx.label));

    const match = router.match('GET', '/api/thing');
    const res = await match!.handler(new Request('https://example.com/api/thing'), {}, { label: 'hello' });
    expect(await res.text()).toBe('hello');
  });
});
