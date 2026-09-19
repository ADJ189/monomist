/**
 * Typed environment for the Monomist Worker.
 *
 * Public, non-secret config (feature flags, environment name) is separated
 * from secrets (OAuth client secret, session signing key) so it's obvious
 * at a glance what's safe to reference in error messages/logs and what
 * isn't. See docs/ARCHITECTURE.md "Environment & secrets" for the full list
 * and how each is provisioned. Every field here should also appear in
 * .env.example / .dev.vars.example with a placeholder value.
 */
export interface Env {
  // --- Public config -------------------------------------------------------
  /** 'development' | 'preview' | 'production' -- drives logging verbosity only, never gates auth. */
  ENVIRONMENT: string;
  /** Public origin the app is served from, used to build OAuth redirect URIs. */
  PUBLIC_APP_URL: string;

  // --- Secrets (set via `wrangler secret put`, never committed) ------------
  /** Google OAuth client id. Not itself sensitive, but kept alongside the secret. */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  /** Google OAuth client secret. Server-side only -- never sent to the frontend. */
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** HMAC key used to sign session cookies (see worker/auth/session.ts). */
  SESSION_SECRET?: string;

  // --- Bindings --------------------------------------------------------------
  /** Static frontend build output (Wrangler "assets" binding). */
  ASSETS: Fetcher;
  /** Optional KV namespace backing the rate limiter and session store in production. Falls back to an in-memory limiter/store when absent (e.g. local dev without KV provisioned). */
  MONOMIST_KV?: KVNamespace;
}

/** True in any non-production environment -- used to relax cookie `Secure` flags etc. locally. */
export function isDevEnvironment(env: Env): boolean {
  return env.ENVIRONMENT !== 'production';
}
