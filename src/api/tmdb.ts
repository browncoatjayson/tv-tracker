// ---------------------------------------------------------------------------
// Thin TMDB client. Phase 1 only wires up auth + the image helper and a basic
// multi-search so the plumbing is proven; Phase 2 expands this (details,
// episodes, air dates, IMDb ids).
//
// Auth: TMDB v4 "Read Access Token" sent as a Bearer header. The token lives in
// .env as VITE_TMDB_TOKEN and is embedded in the client bundle at build time —
// that's expected for a static app (it's a read-only key). Never commit .env.
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p'

const token = import.meta.env.VITE_TMDB_TOKEN

export function hasTmdbToken(): boolean {
  return typeof token === 'string' && token.length > 0
}

/** Build a TMDB poster/backdrop URL from a path fragment, or undefined if none. */
export function imageUrl(path: string | undefined, size = 'w342'): string | undefined {
  return path ? `${IMAGE_BASE}/${size}${path}` : undefined
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!hasTmdbToken()) {
    throw new Error('Missing TMDB token. Add VITE_TMDB_TOKEN to your .env file.')
  }
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}): ${path}`)
  }
  return res.json() as Promise<T>
}

// --- Minimal types for the multi-search endpoint (expanded in Phase 2) --------
export interface TmdbSearchResult {
  id: number
  media_type: 'movie' | 'tv' | 'person'
  title?: string // movies
  name?: string // tv / person
  release_date?: string // movies
  first_air_date?: string // tv
  poster_path?: string | null
  overview?: string
}

interface TmdbSearchResponse {
  results: TmdbSearchResult[]
}

/** A movie/TV search result (people are filtered out upstream). */
export type TmdbMediaResult = TmdbSearchResult & { media_type: 'movie' | 'tv' }

/** Search movies + TV in one call. Filters out people client-side. */
export async function searchMulti(query: string): Promise<TmdbMediaResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const data = await tmdbGet<TmdbSearchResponse>('/search/multi', {
    query: trimmed,
    include_adult: 'false',
  })
  return data.results.filter(
    (r): r is TmdbMediaResult => r.media_type === 'movie' || r.media_type === 'tv',
  )
}

/** Fetch a title's IMDb id (e.g. "tt0944947") for outbound links, if TMDB has it. */
export async function getImdbId(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<string | undefined> {
  const path = `/${mediaType}/${tmdbId}/external_ids`
  const data = await tmdbGet<{ imdb_id?: string | null }>(path)
  return data.imdb_id ?? undefined
}

// --- TV details & episodes (Phase 3) -----------------------------------------

export interface TmdbSeasonSummary {
  season_number: number
  name: string
  episode_count: number
  air_date: string | null
  poster_path: string | null
}

/** A pointer to a single episode (used by next/last_episode_to_air). */
export interface TmdbEpisodePointer {
  season_number: number
  episode_number: number
  air_date: string | null
  name?: string
}

export interface TmdbTvDetails {
  id: number
  name: string
  number_of_episodes: number
  number_of_seasons: number
  status: string
  seasons: TmdbSeasonSummary[]
  /** The next episode scheduled to air, or null if none is scheduled. */
  next_episode_to_air: TmdbEpisodePointer | null
  last_episode_to_air: TmdbEpisodePointer | null
}

export async function getTvDetails(tmdbId: number): Promise<TmdbTvDetails> {
  return tmdbGet<TmdbTvDetails>(`/tv/${tmdbId}`)
}

export interface TmdbEpisode {
  episode_number: number
  season_number: number
  name: string
  air_date: string | null
  overview: string
  runtime: number | null
}

export async function getSeasonEpisodes(
  tmdbId: number,
  seasonNumber: number,
): Promise<TmdbEpisode[]> {
  const data = await tmdbGet<{ episodes: TmdbEpisode[] }>(`/tv/${tmdbId}/season/${seasonNumber}`)
  return data.episodes
}

/** True if an air date is today or in the past (i.e. the episode has aired). */
export function hasAired(airDate: string | null): boolean {
  if (!airDate) return false
  // Compare by date only; TMDB air dates are YYYY-MM-DD with no time.
  const today = new Date().toISOString().slice(0, 10)
  return airDate <= today
}
