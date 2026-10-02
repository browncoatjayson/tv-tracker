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
  await db.trackedItems.add(item)
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

/** Set (1–10) or clear (undefined) the user's personal rating. */
export async function setRating(id: string, rating: number | undefined): Promise<void> {
  await updateItem(id, { userRating: rating })
}

/** Remove a title and all of its watch history. */
export async function removeItem(id: string): Promise<void> {
  await db.transaction('rw', db.trackedItems, db.watchEvents, db.episodeStates, async () => {
    await db.trackedItems.delete(id)
    await db.watchEvents.where('itemId').equals(id).delete()
    await db.episodeStates.where('itemId').equals(id).delete()
  })
}

/**
 * Toggle an episode's watched flag and append a watch event when marking watched.
 * If the episode was already watched, marking it again is recorded as a rewatch.
 */
export async function markEpisode(
  itemId: string,
  season: number,
  episode: number,
  watched: boolean,
): Promise<void> {
  const id = episodeKey(itemId, season, episode)
  await db.transaction('rw', db.episodeStates, db.watchEvents, db.trackedItems, async () => {
    const prev = await db.episodeStates.get(id)
    const now = Date.now()

    await db.episodeStates.put({
      id,
      itemId,
      season,
      episode,
      watched,
      watchedAt: watched ? now : undefined,
      updatedAt: now,
    })

    if (watched) {
      await db.watchEvents.add({
        itemId,
        episodeId: `${season}x${episode}`,
        watchedAt: now,
        isRewatch: prev?.watched === true,
      })
    }
    await db.trackedItems.update(itemId, { updatedAt: now })
  })
}

/** Log a (re)watch of a movie. */
export async function markMovieWatched(itemId: string, isRewatch = false): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.watchEvents, db.trackedItems, async () => {
    await db.watchEvents.add({ itemId, episodeId: null, watchedAt: now, isRewatch })
    await db.trackedItems.update(itemId, { updatedAt: now, status: 'completed' })
  })
}
