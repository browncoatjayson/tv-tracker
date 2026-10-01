import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getImdbId,
  hasTmdbToken,
  imageUrl,
  searchMulti,
  type TmdbMediaResult,
} from '../api/tmdb'
import { db, itemKey } from '../data/db'
import { addItem } from '../data/library'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { MediaType } from '../data/types'

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

  // Live set of ids already in the library, so results can show "in library".
  const trackedIds = useLiveQuery(() => db.trackedItems.toCollection().primaryKeys(), [])
  const trackedSet = new Set(trackedIds ?? [])

  const {
    data: results,
    isFetching,
    isError,
    error,
  } = useQuery({
    queryKey: ['search', query],
    queryFn: () => searchMulti(query),
    enabled: hasTmdbToken() && query.trim().length > 0,
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
        placeholder="Search movies & shows…"
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
      {results && results.length === 0 && query.trim() && !isFetching && (
        <p className="muted">No results for “{query}”.</p>
      )}

      <ul className="result-list">
        {results?.map((r) => {
          const added = trackedSet.has(itemKey(toMediaType(r), r.id))
          const poster = imageUrl(r.poster_path ?? undefined, 'w92')
          return (
            <li key={`${r.media_type}:${r.id}`} className="result-row">
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
              </div>
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
