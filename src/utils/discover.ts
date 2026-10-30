// Maps our filter tokens (genre/service/type/status/released/length/rating) to
// TMDB /discover query params. Discover filters, sorts, and paginates server-
// side, so a filter-only browse fetches only the page it shows — no pulling a
// huge result set down to sort on the client.

import type { GenreMaps, TmdbProvider } from '../api/tmdb'
import type { ParsedQuery } from './filter'

const REGION = 'US'
// A vote floor so sorting by rating surfaces well-known titles, not an obscure
// film carried by a handful of 10s.
const RATING_VOTE_FLOOR = '100'

/** Whether a parsed query carries enough to run a filter-only (no title) browse. */
export function hasDiscoverFilters(q: ParsedQuery): boolean {
  return (
    q.genres.length > 0 ||
    q.genresExclude.length > 0 ||
    q.services.length > 0 ||
    q.types.length > 0 ||
    q.typesExclude.length > 0 ||
    q.ended.length > 0 ||
    q.released.length === 1 ||
    q.lengths.length > 0 ||
    q.years.length > 0 ||
    q.languages.length === 1 ||
    q.rating !== undefined
  )
}

/** Resolve genre-name tokens to TMDB genre ids for one media type's genre map. */
function genreIds(tokens: string[], map: Record<number, string>): number[] {
  const ids: number[] = []
  for (const tok of tokens) {
    for (const [id, name] of Object.entries(map)) {
      if (name.toLowerCase().includes(tok)) {
        ids.push(Number(id))
        break
      }
    }
  }
  return ids
}

/** Resolve service tokens to provider ids (prefer an exact name, else the most
 *  specific — shortest — matching provider, e.g. "Max" over "Cinemax"). */
export function resolveProviderIds(tokens: string[], providers: TmdbProvider[]): number[] {
  const ids: number[] = []
  for (const tok of tokens) {
    const matches = providers.filter((p) => p.provider_name.toLowerCase().includes(tok))
    if (!matches.length) continue
    const exact = matches.find((p) => p.provider_name.toLowerCase() === tok)
    const pick =
      exact ?? [...matches].sort((a, b) => a.provider_name.length - b.provider_name.length)[0]
    ids.push(pick.provider_id)
  }
  return ids
}

/**
 * /discover params for "new releases now on these providers": recent releases
 * (within `days`) available on any of the given providers, popular first. TMDB
 * has no "date added to the service", so recent release date is the closest
 * proxy for a fresh-arrivals feed.
 *
 * Monetization spans flatrate + ads + free (but not rent/buy): free, ad-
 * supported services like Tubi, Pluto TV, The Roku Channel and Freevee list
 * their catalogs as "ads"/"free", not "flatrate", so a flatrate-only query
 * returns little or nothing for them. Subscription services are unaffected
 * (their catalogs are flatrate) beyond also picking up any free-with-ads tier.
 */
export function newReleasesParams(
  mediaType: 'movie' | 'tv',
  providerIds: number[],
  days = 90,
): Record<string, string> {
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const dateKey = mediaType === 'tv' ? 'first_air_date' : 'primary_release_date'
  return {
    with_watch_providers: providerIds.join('|'),
    watch_region: REGION,
    with_watch_monetization_types: 'flatrate|ads|free',
    sort_by: 'popularity.desc',
    [`${dateKey}.gte`]: since,
    [`${dateKey}.lte`]: today,
  }
}

/** TMDB sort_by value for the current filters (rating when a rating filter is set). */
export function discoverSortBy(q: ParsedQuery): 'vote_average.desc' | 'popularity.desc' {
  return q.rating !== undefined ? 'vote_average.desc' : 'popularity.desc'
}

/**
 * Build the /discover params for one media type, or null when this type can't
 * satisfy the filters (e.g. a genre with no equivalent in TV's genre list, or a
 * status filter against movies) so the caller can drop it from the query.
 */
export function buildDiscoverParams(
  mediaType: 'movie' | 'tv',
  q: ParsedQuery,
  genreMap: GenreMaps,
  providers: TmdbProvider[],
): Record<string, string> | null {
  const p: Record<string, string> = {}
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  p.sort_by = discoverSortBy(q)
  if (q.rating !== undefined) {
    p['vote_average.gte'] = String(q.rating)
    p['vote_count.gte'] = RATING_VOTE_FLOOR
  }

  const map = mediaType === 'tv' ? genreMap.tv : genreMap.movie
  // Genres must resolve to at least one id, or this media type can't match.
  if (q.genres.length) {
    const ids = genreIds(q.genres, map)
    if (!ids.length) return null
    p.with_genres = ids.join(',')
  }
  // Excluded genres that resolve are dropped server-side (no match = nothing to do).
  if (q.genresExclude.length) {
    const ids = genreIds(q.genresExclude, map)
    if (ids.length) p.without_genres = ids.join(',')
  }

  // Streaming (flatrate) on any of the chosen providers.
  if (q.services.length) {
    const ids = resolveProviderIds(q.services, providers)
    if (!ids.length) return null
    p.with_watch_providers = ids.join('|')
    p.watch_region = REGION
    p.with_watch_monetization_types = 'flatrate'
  }

  // Released state — only a single pick restricts.
  if (q.released.length === 1) {
    const dateKey = mediaType === 'tv' ? 'first_air_date' : 'release_date'
    if (q.released[0] === 'aired') p[`${dateKey}.lte`] = today
    else p[`${dateKey}.gte`] = tomorrow
  }

  // Release year (applied after released: so a specific year wins the date range).
  for (const y of q.years) {
    const dateKey = mediaType === 'tv' ? 'first_air_date' : 'release_date'
    if (y.op === '=') {
      p[`${dateKey}.gte`] = `${y.value}-01-01`
      p[`${dateKey}.lte`] = `${y.value}-12-31`
    } else if (y.op === '~') {
      const d = Math.floor(y.value / 10) * 10
      p[`${dateKey}.gte`] = `${d}-01-01`
      p[`${dateKey}.lte`] = `${d + 9}-12-31`
    } else if (y.op === '<') {
      p[`${dateKey}.lte`] = `${y.value - 1}-12-31`
    } else {
      p[`${dateKey}.gte`] = `${y.value + 1}-01-01`
    }
  }

  // Language: English maps to a single original-language param. "Foreign" (not
  // English) can't be a discover param, so it's applied client-side instead.
  if (q.languages.length === 1 && q.languages[0] === 'english') {
    p.with_original_language = 'en'
  }

  // Runtime.
  for (const l of q.lengths) {
    if (l.op === '<') p['with_runtime.lte'] = String(Math.max(0, l.value - 1))
    else if (l.op === '<=') p['with_runtime.lte'] = String(l.value)
    else if (l.op === '>') p['with_runtime.gte'] = String(l.value + 1)
    else if (l.op === '>=') p['with_runtime.gte'] = String(l.value)
    else {
      p['with_runtime.gte'] = String(l.value)
      p['with_runtime.lte'] = String(l.value)
    }
  }

  // Status is TV-only (Returning Series vs Ended/Canceled).
  if (q.ended.length) {
    if (mediaType !== 'tv') return null
    const codes = new Set<number>()
    for (const e of q.ended) {
      if (e === 'ended') {
        codes.add(3) // Ended
        codes.add(4) // Canceled
      } else {
        codes.add(0) // Returning Series
      }
    }
    p.with_status = [...codes].join('|')
  }

  return p
}

export interface DiscoverQueryPlan {
  mediaType: 'movie' | 'tv'
  params: Record<string, string>
}

/** The set of /discover calls to make: the selected types (or both), minus any
 *  that can't satisfy the current filters. */
export function planDiscover(
  q: ParsedQuery,
  genreMap: GenreMaps,
  providersByType: { movie: TmdbProvider[]; tv: TmdbProvider[] },
): DiscoverQueryPlan[] {
  const base: ('movie' | 'tv')[] = q.types.length
    ? q.types.map((t) => (t === 'show' ? 'tv' : 'movie'))
    : ['movie', 'tv']
  // Excluded types are dropped from the browse (e.g. type:-show → movies only).
  const excluded = new Set(q.typesExclude.map((t) => (t === 'show' ? 'tv' : t)))
  const types = base.filter((t) => !excluded.has(t))
  const plans: DiscoverQueryPlan[] = []
  for (const t of types) {
    const params = buildDiscoverParams(t, q, genreMap, providersByType[t])
    if (params) plans.push({ mediaType: t, params })
  }
  return plans
}
