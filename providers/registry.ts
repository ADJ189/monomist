import type { Env } from '../env';
import { ServerYouTubeProvider } from './server-youtube-provider';
import type { RemoteMusicProvider } from './types';

/**
 * Single point of provider selection. Routes call `getProvider(env)` and
 * never construct a provider directly -- when a second provider exists,
 * it gets added here (e.g. keyed by a `provider` query param or an
 * Accept-style header), not sprinkled through the routes.
 */
export function getProvider(_env: Env): RemoteMusicProvider {
  return sharedServerYouTubeProvider;
}

const sharedServerYouTubeProvider = new ServerYouTubeProvider();
