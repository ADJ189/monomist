import type { Env } from './env';

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Unix-ms timestamp the current window resets at. */
  resetAt: number;
}

export interface RateLimiter {
  /** `key` should identify the caller + route, e.g. `search:203.0.113.4`. */
  check(key: string): Promise<RateLimitResult>;
}

export interface RateLimitConfig {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60_000 };

/**
 * Fixed-window limiter backed by in-memory state. Good enough for local
 * dev and for a single Worker isolate, but each isolate has its own
 * memory -- it does NOT coordinate across Cloudflare's edge locations.
 * Use `KvRateLimiter` (backed by the optional MONOMIST_KV binding) for a
 * real production limit; this class exists so the abstraction has a
 * dependency-free default and routes never need an `if (kv)` branch.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private config: RateLimitConfig = DEFAULT_RATE_LIMIT) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      const resetAt = now + this.config.windowMs;
      this.hits.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.config.limit - 1, resetAt };
    }

    if (entry.count >= this.config.limit) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count += 1;
    return { allowed: true, remaining: this.config.limit - entry.count, resetAt: entry.resetAt };
  }
}

/**
 * KV-backed fixed-window limiter. Approximate under concurrent writes
 * (KV is eventually consistent and has no atomic increment), which is an
 * acceptable trade-off for a courtesy rate limit -- this is defense
 * against accidental hammering, not a security boundary.
 */
export class KvRateLimiter implements RateLimiter {
  constructor(
    private kv: KVNamespace,
    private config: RateLimitConfig = DEFAULT_RATE_LIMIT
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowId = Math.floor(now / this.config.windowMs);
    const kvKey = `ratelimit:${key}:${windowId}`;
    const resetAt = (windowId + 1) * this.config.windowMs;

    const current = Number((await this.kv.get(kvKey)) ?? '0');
    if (current >= this.config.limit) {
      return { allowed: false, remaining: 0, resetAt };
    }

    const next = current + 1;
    await this.kv.put(kvKey, String(next), { expirationTtl: Math.ceil(this.config.windowMs / 1000) + 5 });
    return { allowed: true, remaining: this.config.limit - next, resetAt };
  }
}

let sharedInMemoryLimiter: InMemoryRateLimiter | null = null;

/** Picks the KV-backed limiter when available, otherwise the in-memory fallback. */
export function getRateLimiter(env: Env, config?: RateLimitConfig): RateLimiter {
  if (env.MONOMIST_KV) return new KvRateLimiter(env.MONOMIST_KV, config);
  sharedInMemoryLimiter ??= new InMemoryRateLimiter(config);
  return sharedInMemoryLimiter;
}

/** Best-effort caller identity for rate-limit keys -- not an auth mechanism. */
export function callerKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
