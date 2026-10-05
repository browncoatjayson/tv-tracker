import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { markMovieWatched, setMovieWatchedDate } from '../data/library'
import type { TrackedItem } from '../data/types'

type Precision = 'day' | 'month' | 'year'

/** Parse "YYYY", "YYYY-MM", or "YYYY-MM-DD" into an epoch + precision. */
function parsePartialDate(raw: string): { ms: number; precision: Precision } | null {
  const s = raw.trim()
  if (/^\d{4}$/.test(s)) return { ms: new Date(`${s}-07-01T12:00:00`).getTime(), precision: 'year' }
  if (/^\d{4}-\d{2}$/.test(s)) return { ms: new Date(`${s}-15T12:00:00`).getTime(), precision: 'month' }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = new Date(`${s}T12:00:00`).getTime()
    return Number.isNaN(t) ? null : { ms: t, precision: 'day' }
  }
  return null
}

function toInputValue(ms: number, precision: Precision): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  if (precision === 'year') return `${y}`
  if (precision === 'month') return `${y}-${m}`
  return `${y}-${m}-${day}`
}

function formatWatched(ms: number, precision: Precision): string {
  const d = new Date(ms)
  if (precision === 'year') return String(d.getFullYear())
  if (precision === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  return d.toLocaleDateString()
}

export default function MovieWatch({ item }: { item: TrackedItem }) {
  // Each watch (including rewatches) is one row in the append-only log.
  const events = useLiveQuery(
    () => db.watchEvents.where('itemId').equals(item.id).toArray(),
    [item.id],
  )
  const count = events?.length ?? 0

  const precision = item.movieWatchedPrecision ?? 'day'
  const [draft, setDraft] = useState<string | null>(null)
  const inputValue = draft ?? (item.movieWatchedAt ? toInputValue(item.movieWatchedAt, precision) : '')

  function commit(value: string) {
    const parsed = parsePartialDate(value)
    if (parsed) void setMovieWatchedDate(item.id, parsed.ms, parsed.precision)
    setDraft(null)
  }

  return (
    <section className="movie-watch">
      <button className="btn" onClick={() => void markMovieWatched(item.id, count > 0)}>
        {count === 0 ? 'Mark as watched' : 'Log a rewatch'}
      </button>

      {count > 0 && (
        <>
          <p className="muted movie-watch__count">
            Watched {count} {count === 1 ? 'time' : 'times'}
            {item.movieWatchedAt && <> · last on {formatWatched(item.movieWatchedAt, precision)}</>}
          </p>
          <label className="field movie-watch__date">
            <span>Watched on (year, YYYY-MM, or YYYY-MM-DD)</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 2009, 2009-06, or 2009-06-15"
              value={inputValue}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
              }}
            />
          </label>
        </>
      )}
    </section>
  )
}
