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

/** A tracked title is a movie, a TV show, or a sports team (season of games). */
export type MediaType = 'movie' | 'show' | 'sport'

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
  /** Most recent *aired* episode date (shows) or release date (movies), YYYY-MM-DD.
   *  Backfilled from TMDB; used for the "Last episode date" sort and the
   *  Released:aired filter. */
  lastAirDate?: string
  /** Next *upcoming* episode air date (shows) or future release date (movies),
   *  YYYY-MM-DD. Backfilled from TMDB; powers the Released:upcoming filter (a
   *  currently-airing show has both this and lastAirDate). Cleared once nothing
   *  is scheduled. */
  nextAirDate?: string
  /** Broad genres (e.g. ["Drama","Crime"]) — backfilled for filtering (also
   *  drives the Style filter: an "Animation" genre = animated, else live action). */
  genres?: string[]
  /** ISO 639-1 original-language code (e.g. "en") — backfilled for the language
   *  filter (English vs foreign). */
  language?: string
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
  /** Movie franchise / collection name (e.g. "Halloween Collection") — backfilled
   *  for the Related section and the series: filter. Movies only. */
  series?: string
  /** Wikidata shared-universe / franchise name (e.g. "Child's Play"), spanning
   *  movies and shows. Backfilled from the detail page; broadens the series:
   *  filter across media. */
  universe?: string
  /** Set when indexing couldn't fetch TMDB data for this title, so the stats
   *  "needs indexing" prompt stops flagging it. A full rebuild retries it. */
  indexFailed?: boolean
  /** Sports team metadata — present only when mediaType === 'sport'. Games are
   *  tracked as "episodes" (season = year, episode = game number), so the whole
   *  episode-tracking + sync machinery is reused. */
  sport?: {
    /** ESPN league key (e.g. "cfb"). */
    league: string
    /** ESPN team id (e.g. "158"). */
    teamId: string
    teamName: string
    /** Team logo URL (full URL, not a TMDB path). */
    logo?: string
  }
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
  /** Sport games only: ESPN's "game finished" flag. Lets callers tell a real
   *  upcoming game from one ESPN never marked complete even though its date
   *  passed (see `sportAirState`). Undefined for TV episodes. */
  completed?: boolean
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

/**
 * A "starred" actor (IMDb-style). Drives the Search "Starring Your Favorites"
 * section and the Stats "Favorite Actors" list. `removed` is a soft-delete so an
 * un-favorite propagates on sync (merge is last-write-wins by `updatedAt`).
 */
export interface FavoritePerson {
  /** TMDB person id. */
  id: number
  name: string
  /** TMDB profile photo path fragment (e.g. "/abc.jpg"). */
  profilePath?: string | null
  favoritedAt: number
  updatedAt: number
  /** Soft-delete flag (kept in the record so un-favoriting syncs). */
  removed?: boolean
}

/**
 * A streaming service the user subscribes to (drives the Search "Now Streaming"
 * section). `id` is the service key (e.g. "netflix"). `removed` is a soft-delete
 * so an un-favorite propagates on sync (merge is last-write-wins by updatedAt).
 */
export interface FavoriteService {
  /** Service key, e.g. "netflix" / "disney plus". */
  id: string
  label: string
  addedAt: number
  updatedAt: number
  removed?: boolean
}

/** A gamification badge the user has earned. Append-only — a badge is never
 *  un-earned (deleting titles can't take it back), so merges keep the earliest
 *  earnedAt and there are no tombstones. */
export interface EarnedBadge {
  /** Matches a {@link BadgeDef} id in data/badges.ts. */
  id: string
  earnedAt: number
}
