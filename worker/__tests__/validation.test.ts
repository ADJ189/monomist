import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { parseSearchQuery, parseSourceId } from '../validation';

describe('parseSearchQuery', () => {
  it('returns the trimmed query', () => {
    expect(parseSearchQuery(new URL('https://x.test/api/search?q=%20hello%20'))).toBe('hello');
  });

  it('throws BAD_REQUEST when q is missing', () => {
    try {
      parseSearchQuery(new URL('https://x.test/api/search'));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('BAD_REQUEST');
    }
  });

  it('throws BAD_REQUEST when q is only whitespace', () => {
    expect(() => parseSearchQuery(new URL('https://x.test/api/search?q=%20%20'))).toThrow(ApiError);
  });

  it('throws BAD_REQUEST when q exceeds the max length', () => {
    const long = 'a'.repeat(201);
    expect(() => parseSearchQuery(new URL(`https://x.test/api/search?q=${long}`))).toThrow(ApiError);
  });

  it('accepts a query right at the max length', () => {
    const max = 'a'.repeat(200);
    expect(parseSearchQuery(new URL(`https://x.test/api/search?q=${max}`))).toBe(max);
  });
});

describe('parseSourceId', () => {
  it('returns a valid id', () => {
    expect(parseSourceId({ id: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ');
  });

  it('throws BAD_REQUEST when missing', () => {
    expect(() => parseSourceId({})).toThrow(ApiError);
  });

  it('throws BAD_REQUEST for path-traversal-like input', () => {
    expect(() => parseSourceId({ id: '../secret' })).toThrow(ApiError);
  });

  it('throws BAD_REQUEST for whitespace/control characters', () => {
    expect(() => parseSourceId({ id: 'abc def' })).toThrow(ApiError);
  });

  it('supports a custom param key', () => {
    expect(parseSourceId({ videoId: 'abc123' }, 'videoId')).toBe('abc123');
  });
});
