import { describe, expect, it } from 'vitest';
import { NotImplementedError } from '../errors';
import { ServerYouTubeProvider } from '../providers/server-youtube-provider';

describe('ServerYouTubeProvider (placeholder)', () => {
  const provider = new ServerYouTubeProvider();

  it('has the expected provider id', () => {
    expect(provider.id).toBe('youtube');
  });

  it('search() rejects with NotImplementedError', async () => {
    await expect(provider.search('some query')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('getVideoMetadata() rejects with NotImplementedError', async () => {
    await expect(provider.getVideoMetadata('abc123')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('getPlaybackInfo() rejects with NotImplementedError', async () => {
    await expect(provider.getPlaybackInfo('abc123')).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('every rejection carries the 501 NOT_IMPLEMENTED code', async () => {
    const results = await Promise.allSettled([
      provider.search('q'),
      provider.getVideoMetadata('id'),
      provider.getPlaybackInfo('id')
    ]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(NotImplementedError);
        expect(result.reason.status).toBe(501);
        expect(result.reason.code).toBe('NOT_IMPLEMENTED');
      }
    }
  });
});
