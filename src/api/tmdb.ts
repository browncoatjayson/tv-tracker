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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Exponential backoff with jitter, capped — used between retries.
function backoffMs(attempt: number): number {
  return Math.min(4000, 300 * 2 ** attempt) + Math.random() * 300
}

/**
 * Fetch JSON from TMDB with retries. Bulk operations (e.g. importing a large
 * library) can trip TMDB's abuse protection with 429s and dropped connections;
 * we retry those (and 5xx and network errors) with backoff, honoring Retry-After.
 * A genuine 4xx (bad token, not-found) is NOT retried.
 */
async function tmdbGet<T>(
  path: string,
  params: Record<string, string> = {},
  retries = 5,
): Promise<T> {
  if (!hasTmdbToken()) {
    throw new Error('Missing TMDB token. Add VITE_TMDB_TOKEN to your .env file.')
  }
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      })
    } catch (err) {
      // Network error (connection reset under load, offline, etc.) — retry.
      if (attempt >= retries) throw err
      await sleep(backoffMs(attempt))
      continue
    }

    if (res.ok) return res.json() as Promise<T>

    // Throttling / transient server errors are retryable.
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt))
      continue
    }

    throw new Error(`TMDB request failed (${res.status}): ${path}`)
  }
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
  genre_ids?: number[]
  /** Person-credit results only: this specific credit's id (for episode lookups). */
  credit_id?: string
  /** Person-credit results only: how many episodes the person appeared in. */
  episode_count?: number
}

/** TMDB genre id -> name maps (separate for movies and TV). Cached indefinitely. */
export interface GenreMaps {
  movie: Record<number, string>
  tv: Record<number, string>
}

export async function getGenreMap(): Promise<GenreMaps> {
  const [movie, tv] = await Promise.all([
    tmdbGet<{ genres: { id: number; name: string }[] }>('/genre/movie/list'),
    tmdbGet<{ genres: { id: number; name: string }[] }>('/genre/tv/list'),
  ])
  const toMap = (list: { id: number; name: string }[]) =>
    Object.fromEntries(list.map((g) => [g.id, g.name]))
  return { movie: toMap(movie.genres), tv: toMap(tv.genres) }
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

/** Find a person by name; returns the best-match TMDB person id, or null. */
export async function searchPerson(name: string): Promise<number | null> {
  const data = await tmdbGet<{ results: { id: number }[] }>('/search/person', {
    query: name.trim(),
    include_adult: 'false',
  })
  return data.results?.[0]?.id ?? null
}

/** Minimal title info by TMDB id (poster + year), e.g. for Trakt imports. */
export async function getTitleBrief(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
): Promise<TmdbFindResult | null> {
  try {
    const d = await tmdbGet<TmdbFindHit>(`/${mediaType}/${tmdbId}`)
    const date = d.release_date || d.first_air_date
    const year = date ? Number(date.slice(0, 4)) : NaN
    return {
      tmdbId,
      title: d.title || d.name || 'Untitled',
      posterPath: d.poster_path ?? undefined,
      year: Number.isFinite(year) ? year : undefined,
    }
  } catch {
    return null
  }
}

/** A person's movie + TV credits as search results, deduped and popularity-sorted. */
export async function getPersonCredits(personId: number): Promise<TmdbMediaResult[]> {
  const data = await tmdbGet<{
    cast: (TmdbSearchResult & { popularity?: number })[]
  }>(`/person/${personId}/combined_credits`)
  const seen = new Set<number>()
  return (data.cast ?? [])
    .filter((r): r is TmdbMediaResult & { popularity?: number } =>
      (r.media_type === 'movie' || r.media_type === 'tv') &&
      (seen.has(r.id) ? false : (seen.add(r.id), true)),
    )
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
}

/** A single episode a person guest-starred in (from a credit's detail). */
export interface CreditEpisode {
  season_number: number
  episode_number: number
  name?: string
  air_date?: string | null
}

/**
 * The specific episodes a person appeared in for one TV credit. TMDB populates
 * `media.episodes` only for guest/recurring appearances; it's empty for series
 * regulars (so an empty result means "main cast — no per-episode breakdown").
 */
export async function getCreditEpisodes(creditId: string): Promise<CreditEpisode[]> {
  const data = await tmdbGet<{ media?: { episodes?: CreditEpisode[] } }>(`/credit/${creditId}`)
  const eps = data.media?.episodes ?? []
  return [...eps].sort(
    (a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number,
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

// --- External-id lookup (for importing from other trackers) ------------------

export interface TmdbFindResult {
  tmdbId: number
  title: string
  posterPath?: string
  year?: number
}

interface TmdbFindHit {
  id: number
  title?: string
  name?: string
  poster_path?: string | null
  release_date?: string
  first_air_date?: string
}

/**
 * Resolve an external id (IMDb or TheTVDB) to a TMDB title. Returns null if TMDB
 * has no match. Used by the importer to translate other trackers' ids to ours.
 */
export async function findByExternalId(
  source: 'imdb_id' | 'tvdb_id',
  externalId: string | number,
  mediaType: 'movie' | 'tv',
): Promise<TmdbFindResult | null> {
  const data = await tmdbGet<{ movie_results: TmdbFindHit[]; tv_results: TmdbFindHit[] }>(
    `/find/${externalId}`,
    { external_source: source },
  )
  const hit = (mediaType === 'movie' ? data.movie_results : data.tv_results)?.[0]
  if (!hit) return null
  const date = hit.release_date || hit.first_air_date
  const year = date ? Number(date.slice(0, 4)) : NaN
  return {
    tmdbId: hit.id,
    title: hit.title || hit.name || 'Untitled',
    posterPath: hit.poster_path ?? undefined,
    year: Number.isFinite(year) ? year : undefined,
  }
}

// --- TV details & episodes (Phase 3) -----------------------------------------

export interface TmdbSeasonSummary {
  season_number: number
  name: string
  episode_count: number
  air_date: string | null
  poster_path: string | null
  /** Average rating 0–10 for the season. */
  vote_average?: number
}

/** A pointer to a single episode (used by next/last_episode_to_air). */
export interface TmdbEpisodePointer {
  season_number: number
  episode_number: number
  air_date: string | null
  name?: string
}

export interface TmdbWatchProviders {
  results?: Record<string, { flatrate?: { provider_name: string }[] }>
}

/** The minimal shape {@link whereToWatch} needs (satisfied by TV and movie details). */
export interface TmdbCredits {
  cast?: { name: string; character?: string; order?: number; profile_path?: string | null }[]
}

export interface WatchInfo {
  networks?: { name: string }[]
  'watch/providers'?: TmdbWatchProviders
  genres?: { name: string }[]
  /** Average rating 0–10 (TMDB's own). */
  vote_average?: number
  /** Synopsis. */
  overview?: string
  credits?: TmdbCredits
  /** Movie runtime in minutes. */
  runtime?: number
  /** Show's typical episode runtime(s) in minutes. */
  episode_run_time?: number[]
  /** Total episodes across all seasons (shows only). */
  number_of_episodes?: number
  /** Show airing status: "Ended", "Returning Series", "Canceled", etc. */
  status?: string
  /** Title + poster + dates (for the preview Details screen). */
  name?: string
  title?: string
  poster_path?: string | null
  first_air_date?: string | null
  release_date?: string | null
}

/** Typical runtime in minutes (movie length, or a show's episode length). */
export function runtimeOf(details: WatchInfo): number | undefined {
  if (typeof details.runtime === 'number' && details.runtime > 0) return details.runtime
  const r = details.episode_run_time?.find((n) => n > 0)
  return r
}

/** True if a show's airing status means it's finished. */
export function isEndedStatus(status: string | undefined): boolean {
  return status === 'Ended' || status === 'Canceled' || status === 'Cancelled'
}

/** Top-billed cast names (ordered), limited to `limit`. */
export function castNames(details: WatchInfo, limit = 12): string[] {
  const cast = details.credits?.cast ?? []
  return [...cast]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, limit)
    .map((c) => c.name)
}

export interface TmdbTvDetails {
  id: number
  name: string
  number_of_episodes: number
  number_of_seasons: number
  status: string
  /** TMDB average score 0–10. */
  vote_average?: number
  overview?: string
  genres?: { name: string }[]
  /** Wide hero image path fragment. */
  backdrop_path?: string | null
  poster_path?: string | null
  first_air_date?: string | null
  last_air_date?: string | null
  in_production?: boolean
  created_by?: { name: string }[]
  credits?: TmdbCredits
  episode_run_time?: number[]
  seasons: TmdbSeasonSummary[]
  /** Broadcast networks (e.g. CBS). */
  networks?: { name: string }[]
  /** Region -> streaming providers (from append_to_response). */
  'watch/providers'?: TmdbWatchProviders
  /** The next episode scheduled to air, or null if none is scheduled. */
  next_episode_to_air: TmdbEpisodePointer | null
  last_episode_to_air: TmdbEpisodePointer | null
}

/** A TMDB image reference (backdrop / still) for the screencap gallery. */
export interface TmdbImage {
  file_path: string
}

/** Backdrop images for a title, for the screencap gallery. */
export async function getImages(mediaType: 'tv' | 'movie', tmdbId: number): Promise<TmdbImage[]> {
  const data = await tmdbGet<{ backdrops?: TmdbImage[] }>(`/${mediaType}/${tmdbId}/images`, {
    include_image_language: 'en,null',
  })
  return data.backdrops ?? []
}

/** Still frames for a single episode, for the screencap gallery. */
export async function getEpisodeImages(
  tmdbId: number,
  season: number,
  episode: number,
): Promise<TmdbImage[]> {
  const data = await tmdbGet<{ stills?: TmdbImage[] }>(
    `/tv/${tmdbId}/season/${season}/episode/${episode}/images`,
  )
  return data.stills ?? []
}

/** A YouTube video (trailer, teaser, clip, featurette…) for a title. */
export interface TmdbVideo {
  key: string
  site: string
  type: string
  name: string
  official?: boolean
}

/** Trailers / teasers / clips etc. for a title (YouTube only). */
export async function getVideos(mediaType: 'tv' | 'movie', tmdbId: number): Promise<TmdbVideo[]> {
  const data = await tmdbGet<{ results?: TmdbVideo[] }>(`/${mediaType}/${tmdbId}/videos`)
  return (data.results ?? []).filter((v) => v.site === 'YouTube' && v.key)
}

/** A recommended / similar title. */
export interface TmdbRecommendation {
  id: number
  title?: string
  name?: string
  poster_path?: string | null
  media_type?: 'movie' | 'tv'
}

/** "You might also like" titles for a movie or show. */
export async function getRecommendations(
  mediaType: 'tv' | 'movie',
  tmdbId: number,
): Promise<TmdbRecommendation[]> {
  const data = await tmdbGet<{ results?: TmdbRecommendation[] }>(
    `/${mediaType}/${tmdbId}/recommendations`,
  )
  return data.results ?? []
}

export async function getTvDetails(tmdbId: number): Promise<TmdbTvDetails> {
  return tmdbGet<TmdbTvDetails>(`/tv/${tmdbId}`, { append_to_response: 'watch/providers,credits' })
}

export interface TmdbMovieDetails {
  id: number
  title: string
  release_date: string | null
  status: string
  runtime?: number
  /** TMDB average score 0–10. */
  vote_average?: number
  overview?: string
  genres?: { name: string }[]
  poster_path?: string | null
  backdrop_path?: string | null
  credits?: TmdbCredits
  'watch/providers'?: TmdbWatchProviders
}

export async function getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
  return tmdbGet<TmdbMovieDetails>(`/movie/${tmdbId}`, { append_to_response: 'watch/providers,credits' })
}

/**
 * A short "where to watch" string: broadcast networks + streaming services for
 * the given region (default US). Both come free with the details call.
 */
// TMDB lists many provider variants ("Paramount Plus Premium", "... Amazon
// Channel", etc.). Collapse them to the base brand so the label stays short.
function normalizeProvider(name: string): string {
  return name
    .replace(/\s+(Premium|Essential|Standard|Basic|with Ads|Ad-Free)$/i, '')
    .replace(/\s+(Apple TV|Amazon|Roku Premium)\s+Channel$/i, '')
    .replace(/\bPlus\b/g, '+')
    .replace(/\s+\+/g, '+')
    .trim()
}

/** All networks + streaming service names (deduped) for the given region. */
export function watchNames(details: WatchInfo, region = 'US'): string[] {
  const names: string[] = []
  for (const n of details.networks ?? []) names.push(n.name)
  for (const p of details['watch/providers']?.results?.[region]?.flatrate ?? []) {
    names.push(normalizeProvider(p.provider_name))
  }
  return [...new Set(names)]
}

/** Broad genre names (e.g. ["Drama","Crime"]). */
export function genreNames(details: WatchInfo): string[] {
  return (details.genres ?? []).map((g) => g.name)
}

export function whereToWatch(details: WatchInfo, region = 'US'): string | undefined {
  const names = watchNames(details, region)
  // Keep it concise: networks come first, then up to a couple of streamers.
  return names.length ? names.slice(0, 3).join(' / ') : undefined
}

export interface TmdbEpisode {
  episode_number: number
  season_number: number
  name: string
  air_date: string | null
  overview: string
  runtime: number | null
  still_path?: string | null
  vote_average?: number
  guest_stars?: { name: string; character?: string }[]
}

export async function getSeasonEpisodes(
  tmdbId: number,
  seasonNumber: number,
): Promise<TmdbEpisode[]> {
  const data = await tmdbGet<{ episodes: TmdbEpisode[] }>(`/tv/${tmdbId}/season/${seasonNumber}`)
  return data.episodes
}

export interface TmdbCredit {
  name: string
  character?: string
  profile_path?: string | null
}

/** A single episode with its full credits (regular cast + guest stars + crew). */
export interface TmdbEpisodeDetails extends TmdbEpisode {
  crew?: { name: string; job?: string; department?: string; profile_path?: string | null }[]
  credits?: {
    cast?: TmdbCredit[]
    guest_stars?: TmdbCredit[]
  }
}

/** Full details for one episode (overview, still, rating, cast + guest stars). */
export async function getEpisodeDetails(
  tmdbId: number,
  season: number,
  episode: number,
): Promise<TmdbEpisodeDetails> {
  return tmdbGet<TmdbEpisodeDetails>(`/tv/${tmdbId}/season/${season}/episode/${episode}`, {
    append_to_response: 'credits',
  })
}

/** Fetch a single episode's IMDb id (for a direct IMDb link), if TMDB has it. */
export async function getEpisodeImdbId(
  tmdbId: number,
  season: number,
  episode: number,
): Promise<string | undefined> {
  const data = await tmdbGet<{ imdb_id?: string | null }>(
    `/tv/${tmdbId}/season/${season}/episode/${episode}/external_ids`,
  )
  return data.imdb_id ?? undefined
}

/** True if an air date is today or in the past (i.e. the episode has aired). */
export function hasAired(airDate: string | null): boolean {
  if (!airDate) return false
  // Compare by date only; TMDB air dates are YYYY-MM-DD with no time.
  const today = new Date().toISOString().slice(0, 10)
  return airDate <= today
}
