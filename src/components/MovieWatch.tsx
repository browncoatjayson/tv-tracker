import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { markMovieWatched, setMovieWatchedDate } from '../data/library'
import type { TrackedItem } from '../data/types'
import WatchedDateField from './WatchedDateField'
import { formatWatched } from '../utils/watchedDate'

export default function MovieWatch({ item }: { item: TrackedItem }) {
  // Each watch (including rewatches) is one row in the append-only log.
  const events = useLiveQuery(
    () => db.watchEvents.where('itemId').equals(item.id).toArray(),
    [item.id],
  )
  const count = events?.length ?? 0
  const precision = item.movieWatchedPrecision ?? 'day'

  return (
    <div className="movie-watch">
      <button className="btn" onClick={() => void markMovieWatched(item.id, count > 0)}>
        {count === 0 ? 'Mark as watched' : 'Log a rewatch'}
      </button>

      {count > 0 && (
        <div className="movie-watch__info">
          <p className="muted movie-watch__count">
            Watched {count} {count === 1 ? 'time' : 'times'}
            {item.movieWatchedAt !== undefined && (
              <> · last on {formatWatched(item.movieWatchedAt, precision)}</>
            )}
          </p>
          <WatchedDateField
            watchedAt={item.movieWatchedAt}
            precision={precision}
            onChange={(ms, p) => void setMovieWatchedDate(item.id, ms, p)}
            label="Watched on"
            className="movie-watch__date"
          />
        </div>
      )}
    </div>
  )
}
