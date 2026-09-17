import type { Env } from '../env';

/**
 * Server-side Google OAuth2 (standard, documented endpoints -- this is
 * "sign in with Google" plumbing, not anything YouTube-internal). It
 * exists so a future login flow has somewhere to live; nothing in this
 * repo currently calls `exchangeCodeForTokens` from a route, and no
 * route issues a session from it yet.
 *
 * Explicitly out of scope here, per this repo's rules: extracting or
 * storing raw YouTube cookies, PO-token generation, BotGuard, or any
 * other anti-bot bypass. Whatever this flow authenticates is a Google
 * account sign-in; it is not a substitute for, and must never be wired
 * into, YouTube.js/Innertube stream resolution.
 *
 * Secrets note: `GOOGLE_OAUTH_CLIENT_SECRET` and any resulting access/
 * refresh tokens must only ever live server-side (Worker env / a future
 * KV or D1-backed token store keyed by session userId) -- never returned
 * to the frontend, never put in a cookie, never logged. See
 * docs/ARCHITECTURE.md "Environment & secrets".
 */

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

export class OAuthNotConfiguredError extends Error {
  constructor() {
    super('Google OAuth is not configured (missing client id/secret).');
    this.name = 'OAuthNotConfiguredError';
  }
}

/** Builds the URL to redirect the user to for Google's consent screen. */
export function buildGoogleAuthUrl(env: Env, state: string, scopes: string[]): string {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) throw new OAuthNotConfiguredError();

  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', buildRedirectUri(env));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

/** Exchanges an authorization code from the OAuth callback for tokens. Server-side only. */
export async function exchangeCodeForTokens(env: Env, code: string): Promise<GoogleTokenResponse> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new OAuthNotConfiguredError();

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: buildRedirectUri(env)
    })
  });

  if (!res.ok) {
    // Never surface the response body -- it can include request echoes
    // that touch client_secret in error cases. Status only.
    throw new Error(`Google token exchange failed with status ${res.status}`);
  }

  return (await res.json()) as GoogleTokenResponse;
}

function buildRedirectUri(env: Env): string {
  return new URL('/api/auth/google/callback', env.PUBLIC_APP_URL).toString();
}
