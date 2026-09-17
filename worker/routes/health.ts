import type { HealthResponseBody } from '../../src/api/types';
import { jsonOk } from '../errors';

export async function handleHealth(): Promise<Response> {
  const body: HealthResponseBody = { status: 'ok', time: Date.now() };
  return jsonOk(body);
}
