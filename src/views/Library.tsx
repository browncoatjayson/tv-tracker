import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../data/db'
import { imageUrl } from '../api/tmdb'
import type { WatchStatus } from '../data/types'

// Order statuses sensibly in the UI.
const STATUS_ORDER: WatchStatus[] = ['watching', 'watchlist', 'completed', 'dropped']
const STATUS_LABEL: Record<WatchStatus, string> = {
  watching: 'Watching',
  watchlist: 'Watchlist',
  completed: 'Completed',
  dropped: 'Dropped',
}

export default function Library() {
  // useLiveQuery re-renders automatically whenever the underlying table changes
  // — no manual state wiring. Returns undefined on first render while loading.
  const items = useLiveQuery(() => db.trackedItems.orderBy('updatedAt').reverse().toArray())

  if (items === undefined) {
    return <p className="muted">Loading…</p>
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__emoji">📺</p>
        <h2>Your library is empty</h2>
        <p className="muted">
          Head to <Link to="/search">Search</Link> to add the first show or movie.
        </p>
      </div>
    )
  }

  return (
    <div className="library">
      {STATUS_ORDER.map((status) => {
        const group = items.filter((i) => i.status === status)
        if (group.length === 0) return null
        return (
          <section key={status} className="library__section">
            <h2 className="section-title">
              {STATUS_LABEL[status]} <span className="count">{group.length}</span>
            </h2>
            <ul className="poster-grid">
              {group.map((item) => (
                <li key={item.id}>
                  <Link to={`/item/${encodeURIComponent(item.id)}`} className="poster-card">
                    {imageUrl(item.posterPath) ? (
                      <img
                        className="poster-card__img"
                        src={imageUrl(item.posterPath)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="poster-card__img poster-card__img--placeholder">
                        {item.mediaType === 'movie' ? '🎬' : '📺'}
                      </div>
                    )}
                    <span className="poster-card__title">{item.title}</span>
                    {item.userRating !== undefined && (
                      <span className="poster-card__rating">★ {item.userRating}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
