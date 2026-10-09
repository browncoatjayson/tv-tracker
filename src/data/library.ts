import { db, episodeKey, itemKey } from './db'
import type { MediaType, TrackedItem, WatchStatus } from './types'

// ---------------------------------------------------------------------------
// The "repository": every write to user data goes through one of these helpers
// so that invariants (timestamps, the append-only watch log, composite keys)
// live in exactly one place. Views never touch `db` directly for writes.
// ---------------------------------------------------------------------------

/** Minimal info needed to start tracking a title (comes from a TMDB search result). */
export interface NewTrackedItem {
  tmdbId: number
  mediaType: MediaType
  title: string
  imdbId?: string
  posterPath?: string
  year?: number
  status?: WatchStatus
}

/** Add a title to the library (or return the existing one if already tracked). */
export async function addItem(input: NewTrackedItem): Promise<TrackedItem> {
  const id = itemKey(input.mediaType, input.tmdbId)
  const existing = await db.trackedItems.get(id)
  if (existing) return existing

  const now = Date.now()
  const item: TrackedItem = {
    id,
    tmdbId: input.tmdbId,
    imdbId: input.imdbId,
    mediaType: input.mediaType,
    title: input.title,
    posterPath: input.posterPath,
    year: input.year,
    status: input.status ?? 'watchlist',
    addedAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.trackedItems, db.tombstones, async () => {
    await db.trackedItems.add(item)
    // Re-adding supersedes any prior deletion so sync won't fight over it.
    await db.tombstones.delete(id)
  })
  return item
}

/** Patch fields on a tracked item and bump `updatedAt`. */
export async function updateItem(
  id: string,
  changes: Partial<Omit<TrackedItem, 'id' | 'tmdbId' | 'mediaType' | 'addedAt'>>,
): Promise<void> {
  await db.trackedItems.update(id, { ...changes, updatedAt: Date.now() })
}

export async function setStatus(id: string, status: WatchStatus): Promise<void> {
  await updateItem(id, { status })
}

/** Backfill filterable metadata (genres, providers, cast) without bumping updatedAt. */
export async function setItemMeta(
  id: string,
  meta: {
    genres?: string[]
    providers?: string[]
    cast?: string[]
    ended?: boolean
    runtime?: number
    episodeCount?: number
    tmdbRating?: number
    /** Last aired episode date (shows) or release date (movies), YYYY-MM-DD. */
    lastAirDate?: string
  },
): Promise<void> {
  await db.trackedItems.update(id, meta)
}

/** Toggle a title's Favorite flag. */
export async function toggleFavorite(id: string, favorite: boolean): Promise<void> {
  await updateItem(id, { favorite })
}

/**
 * Change the recorded watched date of an already-watched episode (the user can
 * correct the auto-filled date). No-op if the episode isn't marked watched.
 */
export async function setEpisodeWatchedDate(
  itemId: string,
  season: number,
  episode: number,
  watchedAt: number,
): Promise<void> {
  const id = episodeKey(itemId, season, episode)
  const now = Date.now()
  await db.transaction('rw', db.episodeStates, db.trackedItems, async () => {
    const prev = await db.episodeStates.get(id)
    if (!prev?.watched) return
    await db.episodeStates.update(id, { watchedAt, updatedAt: now })
    await db.trackedItems.update(itemId, { updatedAt: now })
  })
}

/** Set (1–10) or clear (undefined) the user's personal rating. */
export async function setRating(id: string, rating: number | undefined): Promise<void> {
  await updateItem(id, { userRating: rating })
}

/**
 * Set (1–10) or clear (undefined) the user's rating for a single episode. Rating
 * an episode does not mark it watched; it just records the score. Creates the
 * episode-state row if needed and bumps the show's updatedAt for sync.
 */
export async function setEpisodeRating(
  itemId: string,
  season: number,
  episode: number,
  rating: number | undefined,
): Promise<void> {
  const id = episodeKey(itemId, season, episode)
  const now = Date.now()
  await db.transaction('rw', db.episodeStates, db.trackedItems, async () => {
    const prev = await db.episodeStates.get(id)
    await db.episodeStates.put({
      id,
      itemId,
      season,
      episode,
      watched: prev?.watched ?? false,
      watchCount: prev?.watchCount,
      watchedAt: prev?.watchedAt,
      userRating: rating,
      updatedAt: now,
    })
    await db.trackedItems.update(itemId, { updatedAt: now })
  })
}

/**
 * Remove a title and all of its watch history, and record a tombstone so the
 * deletion propagates on the next Google Drive sync (removing it from Drive and
 * other devices) instead of being resurrected from a stale copy.
 */
export async function removeItem(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.trackedItems,
    db.watchEvents,
    db.episodeStates,
    db.tombstones,
    async () => {
      await db.trackedItems.delete(id)
      await db.watchEvents.where('itemId').equals(id).delete()
      await db.episodeStates.where('itemId').equals(id).delete()
      await db.tombstones.put({ id, deletedAt: Date.now() })
    },
  )
}

/**
 * Set an episode's absolute watch count (0 = unwatched, 2 = watched twice). Logs
 * one watch event per increment (rewatch flagged for counts beyond the first),
 * which is what enables per-episode rewatch passes.
 */
export async function setEpisodeWatchCount(
  itemId: string,
  season: number,
  episode: number,
  count: number,
): Promise<void> {
  const id = episodeKey(itemId, season, episode)
  await db.transaction('rw', db.episodeStates, db.watchEvents, db.trackedItems, async () => {
    const prev = await db.episodeStates.get(id)
    const prevCount = prev?.watchCount ?? (prev?.watched ? 1 : 0)
    const now = Date.now()

    await db.episodeStates.put({
      id,
      itemId,
      season,
      episode,
      watched: count > 0,
      watchCount: count,
      watchedAt: count > 0 ? now : undefined,
      updatedAt: now,
    })

    // Append a watch event for each new watch (the 2nd+ are rewatches).
    for (let k = prevCount; k < count; k++) {
      await db.watchEvents.add({
        itemId,
        episodeId: `${season}x${episode}`,
        watchedAt: now,
        isRewatch: k >= 1,
      })
    }
    // Watching an episode moves a watchlist title into "watching" (never touches
    // completed/dropped — those are deliberate states).
    const item = await db.trackedItems.get(itemId)
    const promote = count > 0 && item?.status === 'watchlist' ? { status: 'watching' as const } : {}
    await db.trackedItems.update(itemId, { updatedAt: now, ...promote })
  })
}

/**
 * Simple watched toggle (first-pass). Marking watched keeps any existing higher
 * rewatch count; unmarking sets it to 0.
 */
export async function markEpisode(
  itemId: string,
  season: number,
  episode: number,
  watched: boolean,
): Promise<void> {
  const prev = await db.episodeStates.get(episodeKey(itemId, season, episode))
  const prevCount = prev?.watchCount ?? (prev?.watched ? 1 : 0)
  await setEpisodeWatchCount(itemId, season, episode, watched ? Math.max(1, prevCount) : 0)
}

/** Log a (re)watch of a movie. */
export async function markMovieWatched(itemId: string, isRewatch = false): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.watchEvents, db.trackedItems, async () => {
    await db.watchEvents.add({ itemId, episodeId: null, watchedAt: now, isRewatch })
    await db.trackedItems.update(itemId, {
      updatedAt: now,
      status: 'completed',
      movieWatchedAt: now,
      movieWatchedPrecision: 'day',
    })
  })
}

/** Set a movie's (editable) watched date, with day/month/year precision. */
export async function setMovieWatchedDate(
  itemId: string,
  watchedAt: number,
  precision: 'day' | 'month' | 'year',
): Promise<void> {
  await db.trackedItems.update(itemId, {
    movieWatchedAt: watchedAt,
    movieWatchedPrecision: precision,
    updatedAt: Date.now(),
  })
}
