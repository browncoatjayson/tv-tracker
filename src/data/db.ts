import Dexie, { type Table } from 'dexie'
import type { EpisodeState, TrackedItem, WatchEvent } from './types'

// ---------------------------------------------------------------------------
// IndexedDB (via Dexie) is our source of truth on each device.
//
// The string after each table name in `.stores()` is an *index spec*, not a
// column list — IndexedDB is schemaless, so these just declare which fields we
// can query/sort by efficiently. The first entry is the primary key.
//   'id'            -> primary key is `id`
//   '++id'          -> auto-incrementing primary key
//   '[itemId+season]' -> compound index for "episodes of a show in a season"
// Bump `.version(n)` and add a new `.stores({...})` block to change the schema.
// ---------------------------------------------------------------------------
export class TvTrackerDB extends Dexie {
  trackedItems!: Table<TrackedItem, string>
  watchEvents!: Table<WatchEvent, number>
  episodeStates!: Table<EpisodeState, string>

  constructor() {
    super('tvtracker')
    this.version(1).stores({
      trackedItems: 'id, mediaType, status, title, updatedAt',
      watchEvents: '++id, itemId, watchedAt',
      episodeStates: 'id, itemId, [itemId+season], watched',
    })
  }
}

export const db = new TvTrackerDB()

/** Build the stable composite key used as {@link TrackedItem.id}. */
export function itemKey(mediaType: TrackedItem['mediaType'], tmdbId: number): string {
  return `${mediaType}:${tmdbId}`
}

/** Build the per-episode key used as {@link EpisodeState.id}. */
export function episodeKey(itemId: string, season: number, episode: number): string {
  return `${itemId}:${season}:${episode}`
}
