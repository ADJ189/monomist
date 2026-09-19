import { describe, expect, it } from 'vitest';
import { ApiError, NotImplementedError, jsonError, jsonOk, toErrorResponse } from '../errors';
import { readJson } from './test-utils';

describe('ApiError', () => {
  it('maps codes to the right HTTP status', () => {
    expect(new ApiError('BAD_REQUEST', 'x').status).toBe(400);
    expect(new ApiError('UNAUTHENTICATED', 'x').status).toBe(401);
    expect(new ApiError('NOT_FOUND', 'x').status).toBe(404);
    expect(new ApiError('RATE_LIMITED', 'x').status).toBe(429);
    expect(new ApiError('NOT_IMPLEMENTED', 'x').status).toBe(501);
    expect(new ApiError('UPSTREAM_ERROR', 'x').status).toBe(502);
    expect(new ApiError('INTERNAL_ERROR', 'x').status).toBe(500);
  });

  it('serializes to a typed JSON error body', async () => {
    const err = new ApiError('NOT_FOUND', 'no such thing');
    const res = err.toResponse();
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await readJson(res);
    expect(body).toEqual({ error: { code: 'NOT_FOUND', message: 'no such thing', status: 404 } });
  });
});

describe('NotImplementedError', () => {
  it('is a 501 ApiError', () => {
    const err = new NotImplementedError('not yet');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(501);
    expect(err.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('jsonOk / jsonError', () => {
  it('jsonOk returns 200 with the given body', async () => {
    const res = jsonOk({ status: 'ok', time: 123 });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ status: 'ok', time: 123 });
  });

  it('jsonError returns the status for the given code', () => {
    const res = jsonError('RATE_LIMITED', 'slow down');
    expect(res.status).toBe(429);
  });
});

describe('toErrorResponse', () => {
  it('uses ApiError.toResponse for ApiError instances', async () => {
    const res = toErrorResponse(new ApiError('BAD_REQUEST', 'bad input'));
    expect(res.status).toBe(400);
    expect((await readJson<{ error: { message: string } }>(res)).error.message).toBe('bad input');
  });

  it('never leaks an arbitrary thrown error message', async () => {
    const res = toErrorResponse(new Error('some internal detail with a secret token abc123'));
    expect(res.status).toBe(500);
    const body = await readJson<{ error: { message: string } }>(res);
    expect(body.error.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('abc123');
  });

  it('handles non-Error thrown values the same safe way', async () => {
    const res = toErrorResponse('a plain string throw');
    expect(res.status).toBe(500);
    expect((await readJson<{ error: { code: string } }>(res)).error.code).toBe('INTERNAL_ERROR');
  });
});
