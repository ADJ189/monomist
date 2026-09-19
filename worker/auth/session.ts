import type { Env } from '../env';

/**
 * Minimal session payload. Kept small and non-sensitive -- this is an
 * identifier, not a place to stash tokens (see oauth.ts's doc comment for
 * where actual OAuth tokens belong: server-side storage, never the
 * cookie).
 */
export interface SessionPayload {
  /** Opaque local user id, not a Google account id -- avoid leaking that identifier into a cookie. */
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

const SESSION_COOKIE_NAME = 'monomist_session';
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Signs and verifies session cookies with HMAC-SHA256 over
 * `${base64url(payload)}.${base64url(signature)}`. This is infrastructure
 * for a future login flow (see auth/oauth.ts) -- nothing in this repo
 * issues a session yet, but routes that need "is someone logged in" can
 * depend on `readSession` today without knowing how the session got
 * created.
 */
export class SessionManager {
  constructor(private secret: string) {}

  async create(userId: string, ttlMs: number = DEFAULT_SESSION_TTL_MS): Promise<string> {
    const now = Date.now();
    const payload: SessionPayload = { userId, issuedAt: now, expiresAt: now + ttlMs };
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const signature = await this.sign(payloadB64);
    return `${payloadB64}.${signature}`;
  }

  async verify(token: string): Promise<SessionPayload | null> {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;

    const expectedSignature = await this.sign(payloadB64);
    if (!timingSafeEqual(signature, expectedSignature)) return null;

    let payload: SessionPayload;
    try {
      payload = JSON.parse(base64UrlDecode(payloadB64)) as SessionPayload;
    } catch {
      return null;
    }

    if (typeof payload.userId !== 'string' || typeof payload.expiresAt !== 'number') return null;
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  }

  private async sign(data: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
  }
}

/** Reads and verifies the session cookie from an incoming request, if present and valid. */
export async function readSession(request: Request, env: Env): Promise<SessionPayload | null> {
  if (!env.SESSION_SECRET) return null;
  const cookie = parseCookies(request.headers.get('cookie') ?? '')[SESSION_COOKIE_NAME];
  if (!cookie) return null;
  return new SessionManager(env.SESSION_SECRET).verify(cookie);
}

/** Builds the Set-Cookie header value for a freshly issued session token. */
/**
 * Builds the Set-Cookie header value for a freshly issued session token.
 */
export function buildSessionCookie(token: string, env: Env): string {
  const secure = env.ENVIRONMENT === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${Math.floor(
    DEFAULT_SESSION_TTL_MS / 1000
  )}`;
}

/**
 * Builds a Set-Cookie header that clears/expires the session cookie.
 */
export function buildSessionClearCookie(env: Env): string {
  const secure = env.ENVIRONMENT === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

/**
 * Parses a Cookie header value into a key-value map.
 */
function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join('='));
  }
  return out;
}

/**
 * Encodes a string as base64url (base64 with URL-safe characters, no padding).
 */
function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a base64url string back to plain text.
 */
function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return atob(padded);
}

/** Constant-time string comparison -- avoids leaking signature match progress via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
