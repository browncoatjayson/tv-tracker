import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { db } from '../data/db'
import { imageUrl } from '../api/tmdb'
import { removeItem, setRating, setStatus } from '../data/library'
import type { WatchStatus } from '../data/types'

const STATUSES: WatchStatus[] = ['watchlist', 'watching', 'completed', 'dropped']

// Phase 1: shows the stored item, lets you change status/rating/remove, and
// links out to IMDb. Phase 3 adds per-episode tracking; Phase 2 fills imdbId.
export default function ItemDetail() {
  const { id = '' } = useParams()
  const itemId = decodeURIComponent(id)
  // Normalize "not found" to null so we can tell it apart from useLiveQuery's
  // own "still loading" undefined.
  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])

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
