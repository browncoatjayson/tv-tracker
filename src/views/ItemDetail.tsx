import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { db } from '../data/db'
import { getImdbId, imageUrl } from '../api/tmdb'
import { removeItem, setRating, setStatus } from '../data/library'
import type { WatchStatus } from '../data/types'
import ShowEpisodes from '../components/ShowEpisodes'
import MovieWatch from '../components/MovieWatch'

const STATUSES: WatchStatus[] = ['watchlist', 'watching', 'completed', 'dropped']

export default function ItemDetail() {
  const { id = '' } = useParams()
  const itemId = decodeURIComponent(id)
  // Normalize "not found" to null so we can tell it apart from useLiveQuery's
  // own "still loading" undefined.
  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])

  // Backfill a missing IMDb id (e.g. shows imported from TV Time, which only had
  // a TVDB id). Written without bumping updatedAt so it doesn't churn sync.
  useEffect(() => {
    if (!item || item.imdbId) return
    const source = item.mediaType === 'show' ? 'tv' : 'movie'
    getImdbId(source, item.tmdbId)
      .then((imdb) => {
        if (imdb) void db.trackedItems.update(item.id, { imdbId: imdb })
      })
      .catch(() => {})
  }, [item?.id, item?.imdbId])

  if (item === undefined) return <p className="muted">Loading…</p>
  if (item === null) {
    return (
      <div className="placeholder">
        <p>That title isn’t in your library.</p>
        <Link to="/library">← Back to Library</Link>
      </div>
    )
  }

  const imdbUrl = item.imdbId ? `https://www.imdb.com/title/${item.imdbId}/` : undefined

  return (
    <div className="detail">
      <div className="detail__header">
        {imageUrl(item.posterPath, 'w185') ? (
          <img className="detail__poster" src={imageUrl(item.posterPath, 'w185')} alt="" />
        ) : (
          <div className="detail__poster detail__poster--placeholder">
            {item.mediaType === 'movie' ? '🎬' : '📺'}
          </div>
        )}
        <div>
          <h2 className="detail__title">
            {item.title} {item.year && <span className="muted">({item.year})</span>}
          </h2>
          <p className="muted">{item.mediaType === 'movie' ? 'Movie' : 'TV Show'}</p>
          {imdbUrl ? (
            <a href={imdbUrl} target="_blank" rel="noopener noreferrer" className="link-out">
              View on IMDb ↗
            </a>
          ) : (
            <span className="muted">IMDb link added in Phase 2</span>
          )}
        </div>
      </div>

      <label className="field">
        <span>Status</span>
        <select
          value={item.status}
          onChange={(e) => setStatus(item.id, e.target.value as WatchStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Your rating</span>
        <select
          value={item.userRating ?? ''}
          onChange={(e) =>
            setRating(item.id, e.target.value ? Number(e.target.value) : undefined)
          }
        >
          <option value="">—</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      {/* Media-specific tracking: episodes for shows, watch log for movies. */}
      {item.mediaType === 'show' ? (
        <ShowEpisodes item={item} />
      ) : (
        <MovieWatch item={item} />
      )}

      <button
        className="btn btn--danger"
        onClick={() => {
          if (confirm(`Remove "${item.title}" and its watch history?`)) {
            void removeItem(item.id)
          }
        }}
      >
        Remove from library
      </button>
    </div>
  )
}
