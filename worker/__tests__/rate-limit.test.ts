import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from '../rate-limit';

describe('InMemoryRateLimiter', () => {
  it('allows requests under the limit', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
    const results = await Promise.all([limiter.check('k'), limiter.check('k'), limiter.check('k')]);
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results[2].remaining).toBe(0);
  });

  it('blocks once the limit is exceeded within the window', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    await limiter.check('k');
    await limiter.check('k');
    const third = await limiter.check('k');
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('tracks separate keys independently', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    const a = await limiter.check('a');
    const b = await limiter.check('b');
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it('resets after the window elapses', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 10 });
    const first = await limiter.check('k');
    expect(first.allowed).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    const second = await limiter.check('k');
    expect(second.allowed).toBe(true);
  });
});
