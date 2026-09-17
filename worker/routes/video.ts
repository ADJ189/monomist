import type { VideoMetadataResponseBody } from '../../src/api/types';
import type { Env } from '../env';
import { jsonOk } from '../errors';
import { getProvider } from '../providers/registry';
import { parseSourceId } from '../validation';

/**
 * Handles GET /api/video/:id. Fetches metadata for a single video from the
 * configured provider.
 */
export async function handleVideoMetadata(
  request: Request,
  params: Record<string, string>,
  env: Env
): Promise<Response> {
  const sourceId = parseSourceId(params);

  const provider = getProvider(env);
  const meta = await provider.getVideoMetadata(sourceId, { signal: request.signal });

  const body: VideoMetadataResponseBody = {
    sourceId: meta.sourceId,
    sourceKind: meta.sourceKind as 'youtube',
    title: meta.title,
    artist: meta.artist,
    durationSec: meta.durationSec,
    artwork: meta.artwork
  };
  return jsonOk(body);
}
