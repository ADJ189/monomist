import { describe, expect, it } from 'vitest';
import { SessionManager, buildSessionClearCookie, buildSessionCookie, readSession } from '../auth/session';
import type { Env } from '../env';

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    PUBLIC_APP_URL: 'http://localhost:8787',
    ASSETS: {} as Env['ASSETS'],
    SESSION_SECRET: 'test-secret',
    ...overrides
  };
}

describe('SessionManager', () => {
  it('round-trips a valid session token', async () => {
    const manager = new SessionManager('test-secret');
    const token = await manager.create('user-1');
    const payload = await manager.verify(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe('user-1');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await new SessionManager('secret-a').create('user-1');
    const payload = await new SessionManager('secret-b').verify(token);
    expect(payload).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const manager = new SessionManager('test-secret');
    const token = await manager.create('user-1');
    const [payloadB64, signature] = token.split('.');
    const tamperedPayload = payloadB64.slice(0, -1) + (payloadB64.at(-1) === 'a' ? 'b' : 'a');
    const tampered = `${tamperedPayload}.${signature}`;
    expect(await manager.verify(tampered)).toBeNull();
  });

  it('rejects an expired session', async () => {
    const manager = new SessionManager('test-secret');
    const token = await manager.create('user-1', -1000); // already expired
    expect(await manager.verify(token)).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const manager = new SessionManager('test-secret');
    expect(await manager.verify('not-a-valid-token')).toBeNull();
    expect(await manager.verify('')).toBeNull();
  });
});

describe('readSession', () => {
  it('returns null when there is no SESSION_SECRET configured', async () => {
    const env = fakeEnv({ SESSION_SECRET: undefined });
    const request = new Request('https://x.test/', { headers: { cookie: 'monomist_session=whatever' } });
    expect(await readSession(request, env)).toBeNull();
  });

  it('returns null when there is no cookie', async () => {
    const env = fakeEnv();
    const request = new Request('https://x.test/');
    expect(await readSession(request, env)).toBeNull();
  });

  it('reads and verifies a valid session cookie end-to-end', async () => {
    const env = fakeEnv();
    const token = await new SessionManager(env.SESSION_SECRET!).create('user-42');
    const request = new Request('https://x.test/', {
      headers: { cookie: `monomist_session=${token}; other=1` }
    });
    const session = await readSession(request, env);
    expect(session?.userId).toBe('user-42');
  });
});

describe('cookie helpers', () => {
  it('marks the cookie Secure in production', () => {
    const cookie = buildSessionCookie('tok', fakeEnv({ ENVIRONMENT: 'production' }));
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });

  it('omits Secure outside production (for local http dev)', () => {
    const cookie = buildSessionCookie('tok', fakeEnv({ ENVIRONMENT: 'development' }));
    expect(cookie).not.toContain('Secure');
  });

  it('clear-cookie expires immediately', () => {
    expect(buildSessionClearCookie(fakeEnv())).toContain('Max-Age=0');
  });
});
