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

  it('surfaces a resolver rejection via onError instead of throwing unhandled', async () => {
    const now = Date.now();
    const resolve = vi.fn(async () => {
      throw new Error('upstream failed');
    });
    const backend = new DirectAudioBackend(resolve);
    const onError = vi.fn();
    backend.onError(onError);

    await backend.load({ kind: 'audio-url', url: 'https://example.test/original.mp3', expiresAt: now + 60_000 });
    await vi.advanceTimersByTimeAsync(31_000);

    expect(onError).toHaveBeenCalledTimes(1);
    backend.destroy();
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
