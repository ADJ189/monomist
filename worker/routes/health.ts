import type { HealthResponseBody } from '../../src/api/types';
import { jsonOk } from '../errors';

/**
 * Handles GET /api/health. Returns a minimal health check response with
 * server timestamp.
 */
export async function handleHealth(): Promise<Response> {
  const body: HealthResponseBody = { status: 'ok', time: Date.now() };
  return jsonOk(body);
}
