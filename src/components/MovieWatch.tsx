import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { markMovieWatched } from '../data/library'
import type { TrackedItem } from '../data/types'

export default function MovieWatch({ item }: { item: TrackedItem }) {
  // Each watch (including rewatches) is one row in the append-only log.
  const events = useLiveQuery(
    () => db.watchEvents.where('itemId').equals(item.id).toArray(),
    [item.id],
  )
  const count = events?.length ?? 0

  return (
    <section className="movie-watch">
      <button className="btn" onClick={() => void markMovieWatched(item.id, count > 0)}>
        {count === 0 ? 'Mark as watched' : 'Log a rewatch'}
      </button>
      {count > 0 && (
        <p className="muted">
          Watched {count} {count === 1 ? 'time' : 'times'}
          {events && events.length > 0 && (
            <> · last on {new Date(Math.max(...events.map((e) => e.watchedAt))).toLocaleDateString()}</>
          )}
        </p>
      )}
    </section>
  )
}
