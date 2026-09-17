import { db } from '../storage/db';
import type { DedupeHistoryRequest, DedupeHistoryResponse } from '../../workers/data.worker';

// Below this many rows, a direct main-thread loop is faster than the
// postMessage round-trip to a worker -- see data.worker.ts's header comment.
const WORKER_THRESHOLD = 300;

let worker: Worker | null = null;
let nextRequestId = 0;

/**
 * Lazily creates and returns the shared data worker instance.
 */
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/data.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

/**
 * Deduplicates history rows in a worker, returning distinct track IDs newest-first.
 */
function dedupeInWorker(rows: { trackId: string; playedAt: number }[], limit: number): Promise<string[]> {
  return new Promise((resolve) => {
    const w = getWorker();
    const requestId = ++nextRequestId;
    const handler = (e: MessageEvent<DedupeHistoryResponse>) => {
      if (e.data.requestId !== requestId) return;
      w.removeEventListener('message', handler);
      resolve(e.data.trackIds);
    };
    w.addEventListener('message', handler);
    const msg: DedupeHistoryRequest = { requestId, rows, limit };
    w.postMessage(msg);
  });
}

/**
 * Deduplicates history rows on the main thread, returning distinct track IDs newest-first.
 */
function dedupeInline(rows: { trackId: string; playedAt: number }[], limit: number): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of rows) {
    if (seen.has(row.trackId)) continue;
    seen.add(row.trackId);
    ordered.push(row.trackId);
    if (ordered.length >= limit) break;
  }
  return ordered;
}

/** Most recent distinct tracks played -- "Continue listening" rail. */
export async function getContinueListening(limit = 12): Promise<string[]> {
  // Cap how much we pull from IndexedDB itself; the DB query is already
  // ordered newest-first so we only need enough rows to find `limit`
  // distinct tracks, not the entire table.
  const rows = await db.history.orderBy('playedAt').reverse().limit(1000).toArray();
  return rows.length > WORKER_THRESHOLD ? dedupeInWorker(rows, limit) : dedupeInline(rows, limit);
}

/** Raw recently-played log, most recent first, duplicates included. */
export async function getRecentlyPlayed(limit = 50): Promise<{ trackId: string; playedAt: number }[]> {
  return db.history.orderBy('playedAt').reverse().limit(limit).toArray();
}
