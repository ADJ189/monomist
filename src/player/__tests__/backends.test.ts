// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectAudioBackend } from '../backends';
import type { PlayableSource } from '../../core/types';

describe('DirectAudioBackend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('behaves like a plain audio backend when the source has no expiresAt', async () => {
    const resolve = vi.fn();
    const backend = new DirectAudioBackend(resolve);
    await backend.load({ kind: 'audio-url', url: 'https://example.test/a.mp3' });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000); // way past any plausible expiry
    expect(resolve).not.toHaveBeenCalled();
    backend.destroy();
  });

  it('refreshes the source shortly before expiresAt and keeps the same media element', async () => {
    const originalEl = new Audio();
    const now = Date.now();
    const fresh: PlayableSource = { kind: 'audio-url', url: 'https://example.test/fresh.mp3', expiresAt: now + 120_000 };
    const resolve = vi.fn(async () => fresh);

    const backend = new DirectAudioBackend(resolve);
    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });

    const elBeforeRefresh = backend.getMediaElement();
    expect(elBeforeRefresh?.src).toContain('original.mp3');

    // Refresh fires 30s before expiry -> ~30s from load() here.
    await vi.advanceTimersByTimeAsync(31_000);

    expect(resolve).toHaveBeenCalledTimes(1);
    const elAfterRefresh = backend.getMediaElement();
    expect(elAfterRefresh).toBe(elBeforeRefresh); // same element -- see class doc on why this matters for AudioGraph
    expect(elAfterRefresh?.src).toContain('fresh.mp3');

    backend.destroy();
    void originalEl; // reference kept only to make the "separate element" contrast explicit to a reader
  });

  it('preserves playback position across a refresh', async () => {
    const now = Date.now();
    const fresh: PlayableSource = { kind: 'audio-url', url: 'https://example.test/fresh.mp3', expiresAt: now + 120_000 };
    const resolve = vi.fn(async () => fresh);

    const backend = new DirectAudioBackend(resolve);
    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });
    backend.seek(42);

    await vi.advanceTimersByTimeAsync(31_000);

    expect(backend.getCurrentTime()).toBeCloseTo(42, 0);
    backend.destroy();
  });

  it('resumes playing after a refresh only if it was playing before', async () => {
    const now = Date.now();
    const fresh: PlayableSource = { kind: 'audio-url', url: 'https://example.test/fresh.mp3', expiresAt: now + 120_000 };
    const resolve = vi.fn(async () => fresh);

    const backend = new DirectAudioBackend(resolve);
    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });
    // Never called play() -- should still be paused after refresh.

    await vi.advanceTimersByTimeAsync(31_000);
    expect(backend.getMediaElement()?.paused).toBe(true);
    backend.destroy();
  });

  it('retries a failed refresh while the current URL still has runway, without surfacing an error yet', async () => {
    const now = Date.now();
    const resolve = vi.fn(async () => {
      throw new Error('upstream failed');
    });
    const backend = new DirectAudioBackend(resolve);
    const onError = vi.fn();
    backend.onError(onError);

    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });

    // First refresh attempt (~31s in) fails; 29s of runway remains before
    // the original URL's expiresAt, well past the 10s retry delay, so it
    // should retry quietly rather than call onError yet.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    // Second attempt (~41s in) also fails; 19s of runway still remains.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();

    backend.destroy();
  });

  it('surfaces the error via onError once there is no runway left to retry into', async () => {
    const now = Date.now();
    const resolve = vi.fn(async () => {
      throw new Error('upstream failed');
    });
    const backend = new DirectAudioBackend(resolve);
    const onError = vi.fn();
    backend.onError(onError);

    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });

    await vi.advanceTimersByTimeAsync(31_000); // attempt 1 (~29s runway left) -- retries
    await vi.advanceTimersByTimeAsync(10_000); // attempt 2 (~19s runway left) -- retries
    await vi.advanceTimersByTimeAsync(10_000); // attempt 3 (~9s runway left, <= retry delay) -- gives up

    expect(resolve).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);

    backend.destroy();
  });

  it('does not schedule a further retry once it has given up (does not spin forever)', async () => {
    const now = Date.now();
    const resolve = vi.fn(async () => {
      throw new Error('upstream failed');
    });
    const backend = new DirectAudioBackend(resolve);
    const onError = vi.fn();
    backend.onError(onError);

    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });
    await vi.advanceTimersByTimeAsync(51_000); // enough for onError to have fired (see previous test)
    expect(onError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000); // well past the original expiry -- nothing further should happen
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);

    backend.destroy();
  });

  it('recovers automatically if a retried refresh succeeds after an earlier failure', async () => {
    const now = Date.now();
    const fresh: PlayableSource = { kind: 'audio-url', url: 'https://example.test/fresh.mp3', expiresAt: now + 120_000 };
    let callCount = 0;
    const resolve = vi.fn(async (): Promise<PlayableSource> => {
      callCount += 1;
      if (callCount === 1) throw new Error('transient failure');
      return fresh;
    });
    const backend = new DirectAudioBackend(resolve);
    const onError = vi.fn();
    backend.onError(onError);

    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });

    await vi.advanceTimersByTimeAsync(31_000); // attempt 1 fails, retry scheduled
    await vi.advanceTimersByTimeAsync(10_000); // attempt 2 succeeds

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    expect(backend.getMediaElement()?.src).toContain('fresh.mp3');

    backend.destroy();
  });

  it('does not retry once destroy() has been called mid-retry-window', async () => {
    const now = Date.now();
    const resolve = vi.fn(async () => {
      throw new Error('upstream failed');
    });
    const backend = new DirectAudioBackend(resolve);
    const onError = vi.fn();
    backend.onError(onError);

    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });
    await vi.advanceTimersByTimeAsync(31_000); // attempt 1 fails, retry scheduled ~10s out
    expect(resolve).toHaveBeenCalledTimes(1);

    backend.destroy();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(resolve).toHaveBeenCalledTimes(1); // the scheduled retry never fired
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops refreshing after destroy()', async () => {
    const now = Date.now();
    const resolve = vi.fn(async (): Promise<PlayableSource> => ({
      kind: 'audio-url',
      url: 'https://example.test/fresh.mp3',
      expiresAt: now + 120_000
    }));
    const backend = new DirectAudioBackend(resolve);
    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });

    backend.destroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects loading a non audio-url source', async () => {
    const backend = new DirectAudioBackend(vi.fn());
    await expect(backend.load({ kind: 'iframe', embedUrl: 'https://youtube.com/embed/x' })).rejects.toThrow();
  });
});
