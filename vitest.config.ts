import { defineConfig } from 'vitest/config';

/**
 * Worker route handlers are written as plain functions over the standard
 * Request/Response/URL globals (see worker/index.ts's doc comment), so
 * they're testable directly under Node's environment -- Node 22 provides
 * native fetch/Request/Response/crypto.subtle, which is all this repo's
 * worker code touches. No Miniflare/workerd pool needed for these tests;
 * a real `wrangler dev`/`wrangler deploy` still exercises the actual
 * Workers runtime (see package.json's worker:dev/worker:deploy scripts).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    coverage: {
      enabled: false
    }
  }
});
