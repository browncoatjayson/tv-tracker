import { useEffect, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useSearchParams } from 'react-router-dom'
import {
  getGenreMap,
  getImdbId,
  getMovieDetails,
  getPersonCredits,
  getTvDetails,
  hasTmdbToken,
  imageUrl,
  searchMulti,
  searchPerson,
  watchNames,
  type TmdbMediaResult,
} from '../api/tmdb'
import { db, itemKey } from '../data/db'
import { addItem } from '../data/library'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { matchesFilter, parseQuery } from '../utils/filter'
import type { MediaType } from '../data/types'

const HOUR = 1000 * 60 * 60

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
  const [input, setInput] = useState('')
  const query = useDebouncedValue(input, 350)
  const [addingId, setAddingId] = useState<number | null>(null)

  // Prefill from a ?q= link (e.g. the cast links on the detail page).
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const q = searchParams.get('q')
    if (q !== null) setInput(q)
  }, [searchParams])

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

  // Service filtering needs per-result providers, so fetch details for the shown
  // results — but only when a service: token is actually in use.
  const servicesActive = parsed.services.length > 0
  const providerQueries = useQueries({
    queries: (allResults ?? []).map((r) => ({
      queryKey: [r.media_type === 'tv' ? 'tv' : 'movie', r.id],
      queryFn: () => (r.media_type === 'tv' ? getTvDetails(r.id) : getMovieDetails(r.id)),
      enabled: servicesActive,
      staleTime: HOUR,
    })),
  })

  const results = (allResults ?? []).filter((r, i) => {
    const providers = servicesActive
      ? providerQueries[i]?.data
        ? watchNames(providerQueries[i].data)
        : []
      : []
    // In actor mode, the free text filters the actor's credits by title; in text
    // mode TMDB already handled the text, and the actor filter doesn't apply here.
    return matchesFilter(
      {
        title: resultTitle(r),
        genres: resultGenres(r),
        providers,
        mediaType: toMediaType(r),
      },
      { ...parsed, actors: [], text: actorName ? parsed.text : '' },
    )
  })

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
      <input
        className="search__input"
        type="search"
        placeholder="Search… name, genre:comedy, service:apple"
        value={input}
        onChange={(e) => setInput(e.target.value)}
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
        {results.map((r) => {
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
          return (
            <li key={`${r.media_type}:${r.id}`} className="result-row">
              {/* Once added, the tile links to the show's detail page. */}
              {added ? (
                <Link to={`/item/${encodeURIComponent(id)}`} className="result-row__link">
                  {inner}
                </Link>
              ) : (
                <div className="result-row__link">{inner}</div>
              )}
              <button
                className="btn btn--small"
                disabled={added || addingId === r.id}
                onClick={() => void handleAdd(r)}
              >
                {added ? '✓ In library' : addingId === r.id ? 'Adding…' : 'Add'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
