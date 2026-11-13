import Dexie, { type Table } from 'dexie'
import type {
  CachedEpisode,
  CustomList,
  EarnedBadge,
  EpisodeState,
  FavoritePerson,
  FavoriteService,
  TrackedItem,
  Tombstone,
  WatchEvent,
} from './types'

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
  episodeCache!: Table<CachedEpisode, string>
  tombstones!: Table<Tombstone, string>
  favoritePeople!: Table<FavoritePerson, number>
  favoriteServices!: Table<FavoriteService, string>
  badges!: Table<EarnedBadge, string>
  lists!: Table<CustomList, string>
  listTombstones!: Table<Tombstone, string>

  constructor() {
    super('tvtracker')
    this.version(1).stores({
      trackedItems: 'id, mediaType, status, title, updatedAt',
      watchEvents: '++id, itemId, watchedAt',
      episodeStates: 'id, itemId, [itemId+season], watched',
    })
    // v2: add a disposable episode-metadata cache (names + air dates).
    this.version(2).stores({
      episodeCache: 'id, itemId, [itemId+season], airDate',
    })
    // v3: delete tombstones so removals propagate through sync (no resurrection).
    this.version(3).stores({
      tombstones: 'id, deletedAt',
    })
    // v4: starred actors (favorite people).
    this.version(4).stores({
      favoritePeople: 'id, updatedAt, removed',
    })
    // v5: favorite streaming services (synced). Migrate any that were previously
    // kept in localStorage so the preference isn't lost on upgrade.
    this.version(5)
      .stores({
        favoriteServices: 'id, updatedAt, removed',
      })
      .upgrade(async (tx) => {
        try {
          const raw = localStorage.getItem('tvtracker.favoriteServices')
          const vals: unknown = raw ? JSON.parse(raw) : []
          if (Array.isArray(vals) && vals.length) {
            const now = Date.now()
            await tx.table('favoriteServices').bulkPut(
              vals
                .filter((v): v is string => typeof v === 'string')
                .map((v) => ({ id: v, label: v, addedAt: now, updatedAt: now, removed: false })),
            )
          }
        } catch {
          // best-effort migration; ignore
        }
      })
    // v6: earned gamification badges (synced).
    this.version(6).stores({
      badges: 'id, earnedAt',
    })
    // v7: user-created Lists (own store). Kept OUT of the core backup — uploaded
    // banners would bloat routine syncs, so lists sync as their own file (wired
    // up later). Ordered by updatedAt for the Stats "Lists" row.
    this.version(7).stores({
      lists: 'id, updatedAt',
    })
    // v8: delete markers for lists, so removing a list and then syncing doesn't
    // resurrect it from another device's stale copy (mirrors `tombstones`).
    this.version(8).stores({
      listTombstones: 'id, deletedAt',
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
