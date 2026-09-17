import type { PlaybackInfoResponseBody } from '../../src/api/types';
import type { Env } from '../env';
import { jsonOk } from '../errors';
import { getProvider } from '../providers/registry';
import { parseSourceId } from '../validation';

export async function handlePlaybackInfo(
  request: Request,
  params: Record<string, string>,
  env: Env
): Promise<Response> {
  const sourceId = parseSourceId(params);

  const provider = getProvider(env);
  const info = await provider.getPlaybackInfo(sourceId, { signal: request.signal });

  const body: PlaybackInfoResponseBody =
    info.kind === 'audio-url'
      ? { kind: 'audio-url', url: info.url, expiresAt: info.expiresAt }
      : { kind: 'iframe', embedUrl: info.embedUrl };
  return jsonOk(body);
}
