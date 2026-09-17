import type { SearchResponseBody } from '../../src/api/types';
import type { Env } from '../env';
import { jsonOk } from '../errors';
import { getProvider } from '../providers/registry';
import { parseSearchQuery } from '../validation';

export async function handleSearch(request: Request, _params: Record<string, string>, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = parseSearchQuery(url);

  const provider = getProvider(env);
  const results = await provider.search(query, { signal: request.signal });

  const body: SearchResponseBody = {
    tracks: results.map((r) => ({
      sourceId: r.sourceId,
      sourceKind: r.sourceKind as 'youtube',
      title: r.title,
      artist: r.artist,
      durationSec: r.durationSec,
      artwork: r.artwork
    }))
  };
  return jsonOk(body);
}
