import { db } from '../storage/db';
import type { Playlist } from '../core/types';

/**
 * Generates a unique playlist ID with timestamp and random suffix.
 */
function newId(): string {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a new playlist with the given title and returns it.
 */
export async function createPlaylist(title: string): Promise<Playlist> {
  const now = Date.now();
  const playlist: Playlist = { id: newId(), title: title.trim() || 'Untitled playlist', trackIds: [], createdAt: now, updatedAt: now };
  await db.playlists.put(playlist);
  return playlist;
}

/**
 * Renames an existing playlist.
 */
export async function renamePlaylist(id: string, title: string): Promise<void> {
  await db.playlists.update(id, { title: title.trim() || 'Untitled playlist', updatedAt: Date.now() });
}

/**
 * Deletes a playlist by ID.
 */
export async function deletePlaylist(id: string): Promise<void> {
  await db.playlists.delete(id);
}

/**
 * Adds a track to a playlist. No-ops if the track is already in the playlist.
 */
export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
  const pl = await db.playlists.get(playlistId);
  if (!pl || pl.trackIds.includes(trackId)) return;
  await db.playlists.update(playlistId, { trackIds: [...pl.trackIds, trackId], updatedAt: Date.now() });
}

/**
 * Removes a track from a playlist.
 */
export async function removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  const pl = await db.playlists.get(playlistId);
  if (!pl) return;
  await db.playlists.update(playlistId, {
    trackIds: pl.trackIds.filter((id) => id !== trackId),
    updatedAt: Date.now()
  });
}

/**
 * Retrieves all playlists, ordered by most recently updated.
 */
export async function getAllPlaylists(): Promise<Playlist[]> {
  return db.playlists.orderBy('updatedAt').reverse().toArray();
}
