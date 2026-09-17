// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YouTubeProvider } from '../youtube';

const originalFetch = globalThis.fetch;

describe('YouTubeProvider', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('search', () => {
    it('uses Monomist API results when the API returns a well-formed response', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/search')) {
          return new Response(
            JSON.stringify({
              tracks: [
                { sourceId: 'abc123', sourceKind: 'youtube', title: 'Song', artist: 'Artist', durationSec: 180 }
              ]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        throw new Error(`Unexpected fetch to ${url} -- direct Data API should not be called in this test`);
      }) as unknown as typeof fetch;

      const provider = new YouTubeProvider(async () => 'unused-token');
      const results = await provider.search('some song');

      expect(results.tracks).toHaveLength(1);
      expect(results.tracks[0]).toMatchObject({ id: 'yt:abc123', title: 'Song', artist: 'Artist', durationSec: 180 });
    });

    it('falls back to the direct Data API v3 call when the Monomist API responds 501 NOT_IMPLEMENTED', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/search')) {
          return new Response(
            JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: 'not yet', status: 501 } }),
            { status: 501, headers: { 'content-type': 'application/json' } }
          );
        }
        if (url.includes('googleapis.com/youtube/v3/search')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: { videoId: 'xyz789' },
                  snippet: { title: 'Direct Song', channelTitle: 'Direct Artist', thumbnails: {} }
                }
              ]
            }),
            { status: 200 }
          );
        }
        if (url.includes('googleapis.com/youtube/v3/videos')) {
          return new Response(JSON.stringify({ items: [{ id: 'xyz789', contentDetails: { duration: 'PT2M30S' } }] }), {
            status: 200
          });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as unknown as typeof fetch;

      const provider = new YouTubeProvider(async () => 'real-token');
      const results = await provider.search('some song');

      expect(results.tracks).toHaveLength(1);
      expect(results.tracks[0]).toMatchObject({ id: 'yt:xyz789', title: 'Direct Song', durationSec: 150 });
    });

    it('falls back to the direct Data API v3 call when the Monomist API is unreachable (network error)', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/search')) throw new TypeError('Failed to fetch');
        if (url.includes('googleapis.com/youtube/v3/search')) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as unknown as typeof fetch;

      const provider = new YouTubeProvider(async () => 'real-token');
      const results = await provider.search('some song');
      expect(results.tracks).toEqual([]);
    });

    it('falls back when no token is available and the Monomist API is not reachable (matches original no-token behavior)', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch;

      const provider = new YouTubeProvider(async () => null);
      const results = await provider.search('some song');
      expect(results).toEqual({ tracks: [], albums: [], artists: [], playlists: [] });
    });
  });

  describe('resolvePlayableSource', () => {
    const track = {
      id: 'yt:abc123',
      title: 'Song',
      artist: 'Artist',
      durationSec: 180,
      sourceId: 'abc123',
      sourceKind: 'youtube' as const
    };

    it('uses the Monomist API playback info when available', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/playback/')) {
          return new Response(JSON.stringify({ kind: 'audio-url', url: 'https://cdn.test/audio.mp3', expiresAt: 123 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as unknown as typeof fetch;

      const provider = new YouTubeProvider(async () => 'token');
      const source = await provider.resolvePlayableSource(track);
      expect(source).toEqual({ kind: 'audio-url', url: 'https://cdn.test/audio.mp3', expiresAt: 123 });
    });

    it('falls back to the official IFrame embed when the Monomist API is not implemented', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/playback/')) {
          return new Response(JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: 'x', status: 501 } }), {
            status: 501,
            headers: { 'content-type': 'application/json' }
          });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }) as unknown as typeof fetch;

      const provider = new YouTubeProvider(async () => 'token');
      const source = await provider.resolvePlayableSource(track);
      expect(source).toEqual({
        kind: 'iframe',
        embedUrl: 'https://www.youtube.com/embed/abc123?autoplay=1&enablejsapi=1'
      });
    });
  });
});
