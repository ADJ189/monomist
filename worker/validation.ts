import { ApiError } from './errors';

const MAX_QUERY_LENGTH = 200;
/** YouTube video ids are 11 chars of [A-Za-z0-9_-]; other providers may loosen this later. */
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Validates and trims the `q` search query param. Throws ApiError('BAD_REQUEST') on failure. */
export function parseSearchQuery(url: URL): string {
  const q = url.searchParams.get('q');
  if (!q || !q.trim()) throw new ApiError('BAD_REQUEST', 'Query parameter "q" is required.');
  const trimmed = q.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new ApiError('BAD_REQUEST', `Query parameter "q" must be at most ${MAX_QUERY_LENGTH} characters.`);
  }
  return trimmed;
}

/** Validates a `:id` path param naming a provider source id. */
export function parseSourceId(params: Record<string, string>, key = 'id'): string {
  const value = params[key];
  if (!value || !SOURCE_ID_PATTERN.test(value)) {
    throw new ApiError('BAD_REQUEST', `Path parameter "${key}" is missing or invalid.`);
  }
  return value;
}
