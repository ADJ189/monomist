import { db } from '../storage/db';

/**
 * Checks if a track is currently liked.
 */
export async function isLiked(trackId: string): Promise<boolean> {
  return (await db.liked.get(trackId)) !== undefined;
}

/**
 * Toggles like status for a track. Returns the new liked state.
 */
export async function toggleLike(trackId: string): Promise<boolean> {
  const existing = await db.liked.get(trackId);
  if (existing) {
    await db.liked.delete(trackId);
    return false;
  }
  await db.liked.put({ trackId, likedAt: Date.now() });
  return true;
}

/**
 * Retrieves all liked track IDs, ordered by most recently liked.
 */
export async function getLikedTrackIds(): Promise<string[]> {
  const rows = await db.liked.orderBy('likedAt').reverse().toArray();
  return rows.map((r) => r.trackId);
}
