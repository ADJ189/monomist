import Dexie, { type EntityTable } from 'dexie';
import type { Album, Artist, Playlist, QueueState, Track } from '../core/types';

export interface LikedRow {
  trackId: string;
  likedAt: number;
}

export interface HistoryRow {
  id?: number;
  trackId: string;
  playedAt: number;
}

/** Cached dominant-color result from the artwork worker, keyed by artwork URL. */
export interface ArtworkColorRow {
  artworkUrl: string;
  h: number;
  s: number;
  l: number;
  computedAt: number;
}

export interface RecentSearchRow {
  query: string;
  searchedAt: number;
}

/** User-pasted LRC text for a track — see lyrics/provider.ts for why this is local-only. */
export interface LyricsRow {
  trackId: string;
  lrcText: string;
  savedAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

class MusicDB extends Dexie {
  tracks!: EntityTable<Track, 'id'>;
  albums!: EntityTable<Album, 'id'>;
  artists!: EntityTable<Artist, 'id'>;
  playlists!: EntityTable<Playlist, 'id'>;
  liked!: EntityTable<LikedRow, 'trackId'>;
  history!: EntityTable<HistoryRow, 'id'>;
  artworkColors!: EntityTable<ArtworkColorRow, 'artworkUrl'>;
  recentSearches!: EntityTable<RecentSearchRow, 'query'>;
  lyrics!: EntityTable<LyricsRow, 'trackId'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor() {
    super('session-clock-music');
    this.version(1).stores({
      tracks: 'id, artist, album',
      albums: 'id, artist',
      artists: 'id',
      playlists: 'id, updatedAt',
      liked: 'trackId, likedAt',
      // auto-increment id lets repeat plays of the same track coexist in history
      history: '++id, trackId, playedAt',
      artworkColors: 'artworkUrl, computedAt',
      recentSearches: 'query, searchedAt',
      lyrics: 'trackId, savedAt',
      settings: 'key'
    });
  }
}

export const db = new MusicDB();

/**
 * Persists the current queue state to IndexedDB.
 */
export async function saveQueueState(state: QueueState): Promise<void> {
  await db.settings.put({ key: 'queue', value: state });
}

/**
 * Loads the saved queue state from IndexedDB, or null if none exists.
 */
export async function loadQueueState(): Promise<QueueState | null> {
  const row = await db.settings.get('queue');
  return (row?.value as QueueState) ?? null;
}

/**
 * Records a track play in the history table. Automatically trims old entries
 * to keep history bounded to the most recent 2000 plays.
 */
export async function recordHistory(trackId: string): Promise<void> {
  await db.history.add({ trackId, playedAt: Date.now() });
  // Keep history bounded -- trim anything past the most recent 2000 plays
  // in the background rather than on every write.
  const count = await db.history.count();
  if (count > 2000) {
    const overflow = count - 2000;
    const oldest = await db.history.orderBy('playedAt').limit(overflow).primaryKeys();
    await db.history.bulkDelete(oldest);
  }
}

/**
 * Records a search query in the recent searches table. Automatically trims
 * old entries to keep only the most recent 25 searches.
 */
export async function recordSearch(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  await db.recentSearches.put({ query: q, searchedAt: Date.now() });
  const count = await db.recentSearches.count();
  if (count > 25) {
    const overflow = count - 25;
    const oldest = await db.recentSearches.orderBy('searchedAt').limit(overflow).primaryKeys();
    await db.recentSearches.bulkDelete(oldest);
  }
}

/**
 * Retrieves recent search queries, most recent first.
 */
export async function getRecentSearches(limit = 8): Promise<string[]> {
  const rows = await db.recentSearches.orderBy('searchedAt').reverse().limit(limit).toArray();
  return rows.map((r) => r.query);
}
