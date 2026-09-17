import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthNotConfiguredError, buildGoogleAuthUrl, exchangeCodeForTokens } from '../auth/oauth';
import type { Env } from '../env';

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    PUBLIC_APP_URL: 'http://localhost:8787',
    ASSETS: {} as Env['ASSETS'],
    ...overrides
  };
}

describe('buildGoogleAuthUrl', () => {
  it('throws OAuthNotConfiguredError when the client id is missing', () => {
    expect(() => buildGoogleAuthUrl(fakeEnv(), 'state123', ['scope'])).toThrow(OAuthNotConfiguredError);
  });

  it('builds a well-formed Google consent URL and never embeds the client secret', () => {
    const env = fakeEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-id-abc', GOOGLE_OAUTH_CLIENT_SECRET: 'super-secret' });
    const url = buildGoogleAuthUrl(env, 'state123', ['openid', 'email']);

    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('client-id-abc');
    expect(parsed.searchParams.get('state')).toBe('state123');
    expect(parsed.searchParams.get('scope')).toBe('openid email');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:8787/api/auth/google/callback');
    expect(url).not.toContain('super-secret');
  });
});

describe('exchangeCodeForTokens', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws OAuthNotConfiguredError when secrets are missing', async () => {
    await expect(exchangeCodeForTokens(fakeEnv(), 'code123')).rejects.toBeInstanceOf(OAuthNotConfiguredError);
  });

  it('posts the code to Google token endpoint and returns the parsed token response', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, scope: 's', token_type: 'Bearer' }), {
        status: 200
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const env = fakeEnv({ GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' });
    const result = await exchangeCodeForTokens(env, 'code123');

    expect(result.access_token).toBe('tok');
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://oauth2.googleapis.com/token');
    expect(init?.method).toBe('POST');
  });

  it('does not leak the response body (which could echo the client secret) on failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response('client_secret=secret is invalid', { status: 400 })) as unknown as typeof fetch;

    const env = fakeEnv({ GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' });
    await expect(exchangeCodeForTokens(env, 'bad-code')).rejects.toThrow(/status 400/);
  });
});
