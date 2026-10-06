import { useEffect, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useSearchParams } from 'react-router-dom'
import {
  getCreditEpisodes,
  getGenreMap,
  getImdbId,
  getMovieDetails,
  getPersonCredits,
  getTvDetails,
  hasTmdbToken,
  imageUrl,
  isEndedStatus,
  runtimeOf,
  searchMulti,
  searchPerson,
  watchNames,
  type CreditEpisode,
  type TmdbMediaResult,
} from '../api/tmdb'
import { db, itemKey } from '../data/db'
import { addItem } from '../data/library'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePersistentFilter } from '../hooks/usePersistentFilter'
import { matchesFilter, parseQuery } from '../utils/filter'
import FilterBar from '../components/FilterBar'
import type { MediaType } from '../data/types'

const HOUR = 1000 * 60 * 60
// Results are revealed a page at a time so an actor's credits only poll TMDB
// (for guest-appearance episodes) as far down the list as you actually look.
const PAGE = 12

/** TMDB uses 'tv'; our domain uses 'show'. */
function toMediaType(r: TmdbMediaResult): MediaType {
  return r.media_type === 'tv' ? 'show' : 'movie'
}

function resultTitle(r: TmdbMediaResult): string {
  return r.title || r.name || 'Untitled'
}

function resultYear(r: TmdbMediaResult): number | undefined {
  const date = r.release_date || r.first_air_date
  const year = date ? Number(date.slice(0, 4)) : NaN
  return Number.isFinite(year) ? year : undefined
}

export default function Search() {
  const [input, setInput] = usePersistentFilter('tvtracker.filter.search')
  const query = useDebouncedValue(input, 350)
  const [addingId, setAddingId] = useState<number | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const [loadingMore, setLoadingMore] = useState(false)

  // Prefill from a ?q= link (e.g. the cast links on the detail page).
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const q = searchParams.get('q')
    if (q !== null) setInput(q)
  }, [searchParams])

  // A new query collapses the list back to the first page.
  useEffect(() => {
    setVisibleCount(PAGE)
  }, [query])

  // Live set of ids already in the library, so results can show "in library".
  const trackedIds = useLiveQuery(() => db.trackedItems.toCollection().primaryKeys(), [])
  const trackedSet = new Set(trackedIds ?? [])

  // The free-text part drives the TMDB search; the tokens filter / redirect it.
  const parsed = parseQuery(query)
  const searchText = parsed.text
  const actorName = parsed.actors[0] // actor: switches to person-credit search

  const textQuery = useQuery({
    queryKey: ['search', searchText],
    queryFn: () => searchMulti(searchText),
    enabled: hasTmdbToken() && !actorName && searchText.length > 0,
  })
  const actorQuery = useQuery({
    queryKey: ['actor', actorName],
    queryFn: async () => {
      const personId = await searchPerson(actorName)
      return personId ? getPersonCredits(personId) : []
    },
    enabled: hasTmdbToken() && !!actorName,
  })

  const allResults = actorName ? actorQuery.data : textQuery.data
  const isFetching = actorName ? actorQuery.isFetching : textQuery.isFetching
  const isError = actorName ? actorQuery.isError : textQuery.isError
  const error = actorName ? actorQuery.error : textQuery.error

  // Genre id -> name maps (so genre: tokens can match search results).
  const { data: genreMap } = useQuery({
    queryKey: ['genres'],
    queryFn: getGenreMap,
    staleTime: Infinity,
    enabled: hasTmdbToken(),
  })
  const resultGenres = (r: TmdbMediaResult): string[] => {
    const map = r.media_type === 'tv' ? genreMap?.tv : genreMap?.movie
    return (r.genre_ids ?? []).map((id) => map?.[id]).filter((n): n is string => Boolean(n))
  }

  // service:, length:, and status: filtering need per-result details, so fetch
  // them for the shown results — but only when one of those tokens is in use.
  const needDetails =
    parsed.services.length > 0 || parsed.lengths.length > 0 || parsed.ended.length > 0
  const detailQueries = useQueries({
    queries: (allResults ?? []).map((r) => ({
      queryKey: [r.media_type === 'tv' ? 'tv' : 'movie', r.id],
      queryFn: () => (r.media_type === 'tv' ? getTvDetails(r.id) : getMovieDetails(r.id)),
      enabled: needDetails,
      staleTime: HOUR,
    })),
  })

  const results = (allResults ?? []).filter((r, i) => {
    const d = needDetails ? detailQueries[i]?.data : undefined
    const providers = parsed.services.length ? (d ? watchNames(d) : []) : []
    const runtime = parsed.lengths.length ? (d ? runtimeOf(d) : undefined) : undefined
    const ended =
      parsed.ended.length && r.media_type === 'tv'
        ? d
          ? isEndedStatus(d.status)
          : undefined
        : undefined
    // In actor mode, the free text filters the actor's credits by title; in text
    // mode TMDB already handled the text, and the actor filter doesn't apply here.
    return matchesFilter(
      {
        title: resultTitle(r),
        genres: resultGenres(r),
        providers,
        runtime,
        ended,
        mediaType: toMediaType(r),
      },
      { ...parsed, actors: [], text: actorName ? parsed.text : '' },
    )
  })

  const visibleResults = results.slice(0, visibleCount)
  const hasMore = results.length > visibleResults.length

  // In actor mode, pull each shown TV credit's specific episodes so guest /
  // recurring appearances can be listed. TMDB returns episodes only for guests;
  // series regulars come back empty (so no appearances strip). Scoped to the
  // visible page — this is person-per-show data TMDB keeps only in the credit
  // detail, so it can't come from our local index even for library titles.
  const creditSource = actorName ? visibleResults : []
  const creditQueries = useQueries({
    queries: creditSource.map((r) => ({
      queryKey: ['credit-eps', r.credit_id],
      queryFn: () => getCreditEpisodes(r.credit_id as string),
      enabled: r.media_type === 'tv' && !!r.credit_id,
      staleTime: HOUR,
    })),
  })
  const creditEpsByCreditId = new Map<string, CreditEpisode[]>()
  creditSource.forEach((r, i) => {
    const data = creditQueries[i]?.data
    if (r.credit_id && data) creditEpsByCreditId.set(r.credit_id, data)
  })

  // Reveal the next page after a brief beat, so the new rows' credit lookups
  // don't all fire the instant the button is pressed.
  function showMore() {
    setLoadingMore(true)
    window.setTimeout(() => {
      setVisibleCount((n) => n + PAGE)
      setLoadingMore(false)
    }, 300)
  }

  async function handleAdd(r: TmdbMediaResult) {
    setAddingId(r.id)
    try {
      // Fetch the IMDb id so the detail page's IMDb link works; don't fail the
      // add if that lookup errors.
      const imdbId = await getImdbId(r.media_type, r.id).catch(() => undefined)
      await addItem({
        tmdbId: r.id,
        mediaType: toMediaType(r),
        title: resultTitle(r),
        imdbId,
        posterPath: r.poster_path ?? undefined,
        year: resultYear(r),
        status: 'watchlist',
      })
    } finally {
      setAddingId(null)
    }
  }

  if (!hasTmdbToken()) {
    return (
      <div className="placeholder">
        <h2>Search</h2>
        <p className="badge badge--warn">
          TMDB token not set — add VITE_TMDB_TOKEN to .env (local) or the repo secret (deploy).
        </p>
      </div>
    )
  }

  return (
    <div className="search">
      <FilterBar
        value={input}
        onChange={setInput}
        placeholder="Search for a title"
        autoFocus
      />

      {isFetching && <p className="muted">Searching…</p>}
      {isError && (
        <p className="badge badge--warn">
          {error instanceof Error ? error.message : 'Search failed.'}
        </p>
      )}
      {results.length === 0 && searchText && !isFetching && (
        <p className="muted">No results for “{searchText}”.</p>
      )}

      <ul className="result-list">
        {visibleResults.map((r) => {
          const id = itemKey(toMediaType(r), r.id)
          const added = trackedSet.has(id)
          const poster = imageUrl(r.poster_path ?? undefined, 'w92')
          const inner = (
            <>
              {poster ? (
                <img className="result-row__poster" src={poster} alt="" loading="lazy" />
              ) : (
                <div className="result-row__poster result-row__poster--placeholder">
                  {r.media_type === 'movie' ? '🎬' : '📺'}
                </div>
              )}
              <div className="result-row__info">
                <span className="result-row__title">
                  {resultTitle(r)}
                  {resultYear(r) && <span className="muted"> ({resultYear(r)})</span>}
                </span>
                <span className="type-badge">{r.media_type === 'tv' ? 'TV' : 'Movie'}</span>
                {r.overview && <span className="muted result-row__overview">{r.overview}</span>}
              </div>
            </>
          )
          // Guest/recurring appearances (actor mode, TV only) — series regulars
          // come back with no episodes, so this strip is skipped for main cast.
          const appearances =
            actorName && r.media_type === 'tv' && r.credit_id
              ? creditEpsByCreditId.get(r.credit_id) ?? []
              : []
          return (
            <li key={`${r.media_type}:${r.id}`} className="result-item">
              <div className="result-row">
                {/* Tiles always link to the detail page — a preview before adding,
                    the full tracking view once in the library. */}
                <Link to={`/item/${encodeURIComponent(id)}`} className="result-row__link">
                  {inner}
                </Link>
                <button
                  className="btn btn--small"
                  disabled={added || addingId === r.id}
                  onClick={() => void handleAdd(r)}
                >
                  {added ? '✓ In library' : addingId === r.id ? 'Adding…' : 'Add'}
                </button>
              </div>
              {appearances.length > 0 && (
                <div className="appearances">
                  <span className="appearances__label">Appearances</span>
                  <span className="appearances__eps">
                    {appearances.map((ep, i) => (
                      <span key={`${ep.season_number}:${ep.episode_number}`}>
                        {i > 0 && <span className="appearances__sep">, </span>}
                        <Link
                          className="appearances__ep"
                          to={`/item/${encodeURIComponent(id)}/episode/${ep.season_number}/${ep.episode_number}`}
                          title={ep.name || undefined}
                        >
                          S{String(ep.season_number).padStart(2, '0')}E
                          {String(ep.episode_number).padStart(2, '0')}
                        </Link>
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <div className="show-more">
          <button className="btn btn--ghost" onClick={showMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Show more (${results.length - visibleResults.length})`}
          </button>
        </div>
      )}
    </div>
  )
}
