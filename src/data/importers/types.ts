import type { MediaType, WatchStatus } from '../types'

// A source-agnostic representation of one tracked title, produced by a per-source
// parser and then resolved to a TMDB id before being written into the app.
export interface ImportItem {
  mediaType: MediaType
  title: string
  /** External ids from the source; at least one is needed to find the TMDB id. */
  imdbId?: string
  tvdbId?: number
  status: WatchStatus
  /** For a watched movie: when it was watched (epoch ms). */
  movieWatchedAt?: number
  /** For a show: the episodes marked watched. */
  watchedEpisodes?: { season: number; episode: number; watchedAt?: number }[]
}

/** An {@link ImportItem} after TMDB resolution. */
export interface ResolvedImportItem extends ImportItem {
  tmdbId: number
  posterPath?: string
  year?: number
}
