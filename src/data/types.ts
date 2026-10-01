// ---------------------------------------------------------------------------
// Domain types for the user's tracked data.
//
// Design notes:
//  - We store only *user data* (what you track, watch, and rate). Rich metadata
//    about shows/movies/episodes is fetched from TMDB and cached separately; it
//    is disposable and never part of a backup's "truth".
//  - `WatchEvent` is an append-only log. Never mutate past events — add new ones.
//    This makes multi-device merge (Phase 5: Google Drive sync) trivial.
// ---------------------------------------------------------------------------

/** A tracked title is either a movie or a TV show. */
export type MediaType = 'movie' | 'show'

/** Where a title sits in your personal pipeline. */
export type WatchStatus = 'watchlist' | 'watching' | 'completed' | 'dropped'

/**
 * A show or movie the user is tracking.
 * `id` is a stable composite key `"<mediaType>:<tmdbId>"` so the same TMDB title
 * can never be added twice and merges across devices are unambiguous.
 */
export interface TrackedItem {
  id: string
  tmdbId: number
  /** IMDb id (e.g. "tt0903747") for outbound links. May be filled in later. */
  imdbId?: string
  mediaType: MediaType
  title: string
  /** TMDB poster path fragment (e.g. "/abc.jpg"); combine with an image base. */
  posterPath?: string
  /** Release year (movie) or first-air year (show). */
  year?: number
  status: WatchStatus
  /** Personal rating, 1–10. Undefined if unrated. */
  userRating?: number
  /** Epoch milliseconds. */
  addedAt: number
  updatedAt: number
}

/**
 * An append-only record that the user watched something at a point in time.
 * For movies, `episodeId` is null. For shows it identifies the episode.
 */
export interface WatchEvent {
  /** Auto-incrementing local id (Dexie `++id`). */
  id?: number
  /** FK to {@link TrackedItem.id}. */
  itemId: string
  /** `"<season>x<episode>"` for shows, or null for movies. */
  episodeId: string | null
  watchedAt: number
  /** True if this was a rewatch (the episode/movie was already marked watched). */
  isRewatch: boolean
}

/**
 * Current watched/unwatched state of a single episode, for quick UI toggles.
 * (The WatchEvent log is the history; this is the derived "latest" flag.)
 */
export interface EpisodeState {
  /** `"<itemId>:<season>:<episode>"`. */
  id: string
  itemId: string
  season: number
  episode: number
  watched: boolean
  watchedAt?: number
}
