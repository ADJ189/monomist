import { describe, expect, it, vi } from 'vitest';
import { ApiError, MonomistApiClient } from '../client';
import type { ApiErrorBody, HealthResponseBody, SearchResponseBody } from '../types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('MonomistApiClient', () => {
  it('health() hits GET /api/health and parses the body', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ status: 'ok', time: 123 } satisfies HealthResponseBody)
    );
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.health();

    expect(fetchImpl).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ status: 'ok', time: 123 });
  });

  it('search() encodes the query string', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ tracks: [] } satisfies SearchResponseBody)
    );
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.search('hello world & friends');

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/search?q=hello+world+%26+friends');
  });

  it('getVideoMetadata() and getPlaybackInfo() build the expected paths', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}));
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getVideoMetadata('abc 123');
    await client.getPlaybackInfo('xyz');

    expect(fetchImpl.mock.calls[0][0]).toBe('/api/video/abc%20123');
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/playback/xyz');
  });

  it('respects a custom baseUrl', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ status: 'ok', time: 1 }));
    const client = new MonomistApiClient({
      baseUrl: 'https://worker.example.com/api',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await client.health();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://worker.example.com/api/health');
  });

  it('throws a typed ApiError for a non-2xx typed error body', async () => {
    const errorBody: ApiErrorBody = { error: { code: 'NOT_IMPLEMENTED', message: 'not yet', status: 501 } };
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(errorBody, 501));
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.search('x')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_IMPLEMENTED',
      status: 501
    });
  });

  it('ApiError.isNotImplemented is true only for NOT_IMPLEMENTED', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ error: { code: 'NOT_IMPLEMENTED', message: 'x', status: 501 } } satisfies ApiErrorBody, 501)
    );
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    try {
      await client.search('x');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).isNotImplemented).toBe(true);
    }
  });

  it('throws a generic ApiError when the error body is not typed/shaped as expected', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('Internal Server Error', { status: 500 }));
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.health()).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
  });

  it('handles a 200 response whose body is not valid JSON (e.g. a dev-server SPA fallback)', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('<html>not json</html>', { status: 200 }));
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    // Should not throw -- callers are expected to validate the shape of
    // what comes back (see YouTubeProvider's fallback logic).
    const result = await client.health();
    expect(result).toBeNull();
  });

  it('wraps a network failure in an ApiError instead of throwing raw', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      throw new TypeError('Failed to fetch');
    });
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.health()).rejects.toMatchObject({ name: 'ApiError', code: 'UPSTREAM_ERROR' });
  });

  it('propagates AbortError as-is rather than wrapping it', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const client = new MonomistApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.health()).rejects.toBeInstanceOf(DOMException);
  });
});
