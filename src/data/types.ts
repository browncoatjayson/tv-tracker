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
  /** Pinned to the Favorites section at the top of the Library. */
  favorite?: boolean
  /** Most recent episode air date (shows) or release date (movies), YYYY-MM-DD.
   *  Backfilled from TMDB when a title is viewed or appears in Upcoming; used for
   *  the "Last episode date" sort. */
  lastAirDate?: string
  /** Broad genres (e.g. ["Drama","Crime"]) — backfilled for filtering. */
  genres?: string[]
  /** Where to watch (networks + streaming names) — backfilled for filtering. */
  providers?: string[]
  /** Top-billed cast names — backfilled for the actor filter. */
  cast?: string[]
  /** Whether the show has ended/been cancelled (undefined for movies). */
  ended?: boolean
  /** Typical runtime in minutes (movie length, or a show's episode length). */
  runtime?: number
  /** Total episodes (shows only) — backfilled for the stats completion ratio. */
  episodeCount?: number
  /** TMDB's average score 0–10 — backfilled for the stats "critic profile". */
  tmdbRating?: number
  /** Set when indexing couldn't fetch TMDB data for this title, so the stats
   *  "needs indexing" prompt stops flagging it. A full rebuild retries it. */
  indexFailed?: boolean
  /** When a movie was watched (editable; supports partial precision). */
  movieWatchedAt?: number
  /** Precision of movieWatchedAt for display. */
  movieWatchedPrecision?: 'day' | 'month' | 'year'
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
 * Cached episode metadata (name + air date) for a tracked show. This is a
 * disposable cache fetched from TMDB — it powers episode-name search in the
 * Library and the Upcoming calendar. Never part of a backup.
 */
export interface CachedEpisode {
  /** `"<itemId>:<season>:<episode>"`. */
  id: string
  itemId: string
  season: number
  episode: number
  name: string
  /** YYYY-MM-DD, or null if unknown. */
  airDate: string | null
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
  /** How many times watched (0 = unwatched, 2 = watched twice). Enables rewatches. */
  watchCount?: number
  watchedAt?: number
  /** Personal rating of this episode, 1–10. Undefined if unrated. */
  userRating?: number
  /** When this flag last changed (watch OR unwatch). Drives last-write-wins on sync. */
  updatedAt?: number
}

/**
 * A marker that a tracked item was deleted. Carried in backups so a sync removes
 * the title from Drive (and other devices) instead of resurrecting it. Kept until
 * a later re-add (with a newer `updatedAt`) supersedes it.
 */
export interface Tombstone {
  /** The deleted {@link TrackedItem.id}. */
  id: string
  deletedAt: number
}
