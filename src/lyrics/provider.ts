import { db } from '../storage/db';

/**
 * There's no bundled lyrics API here. Third-party lyrics services generally
 * require their own API key/ToS acceptance, and several popular "free"
 * lyrics endpoints used by other YouTube Music clients are themselves
 * unofficial/scraped APIs -- the same category of problem as the
 * stream-extraction question elsewhere in this project. Rather than wire
 * one in silently, lyrics here are user-supplied: paste an LRC file's
 * contents (something you already have the rights to use) and it's stored
 * locally, keyed by track id. Swap this out for a real licensed provider
 * later if you have one.
 */

/**
 * Saves user-supplied LRC lyrics for a track to local storage.
 */
export async function saveLyrics(trackId: string, lrcText: string): Promise<void> {
  await db.lyrics.put({ trackId, lrcText, savedAt: Date.now() });
}

/**
 * Retrieves saved LRC lyrics for a track, or null if none exist.
 */
export async function getLyrics(trackId: string): Promise<string | null> {
  const row = await db.lyrics.get(trackId);
  return row?.lrcText ?? null;
}

/**
 * Deletes saved lyrics for a track.
 */
export async function clearLyrics(trackId: string): Promise<void> {
  await db.lyrics.delete(trackId);
}
