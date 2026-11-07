// Date helpers for the shared watched-date control (movies + episodes).
//
// A partial date (just a month, or just a year) is stored as a representative
// mid-point timestamp — the 1st of July for a year, the 15th for a month — plus
// a precision flag, so sorting and the timeline still work; the unspecified
// parts are dropped when the date is shown.

export type DatePrecision = 'day' | 'month' | 'year'

/** Map (year, month, day) — with 0 meaning "unspecified" — to a representative
 *  noon timestamp + precision. Local time, so there's no UTC day-shift. */
export function partsToWatched(
  year: number,
  month: number,
  day: number,
): { ms: number; precision: DatePrecision } {
  if (!month) return { ms: new Date(year, 6, 1, 12).getTime(), precision: 'year' } // Jul 1
  if (!day) return { ms: new Date(year, month - 1, 15, 12).getTime(), precision: 'month' } // 15th
  const maxDay = new Date(year, month, 0).getDate() // clamp e.g. Feb 31 → 28/29
  return { ms: new Date(year, month - 1, Math.min(day, maxDay), 12).getTime(), precision: 'day' }
}

/** Inverse of partsToWatched — split a stored timestamp back into fields. */
export function watchedToParts(
  ms: number,
  precision: DatePrecision,
): { year: number; month: number; day: number } {
  const d = new Date(ms)
  return {
    year: d.getFullYear(),
    month: precision === 'year' ? 0 : d.getMonth() + 1,
    day: precision === 'day' ? d.getDate() : 0,
  }
}

/** Human-readable watched date, dropping the parts that weren't specified. */
export function formatWatched(ms: number, precision: DatePrecision): string {
  const d = new Date(ms)
  if (precision === 'year') return String(d.getFullYear())
  if (precision === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  return d.toLocaleDateString()
}

/** YYYY-MM-DD (local parts) for a native <input type="date">. */
export function localDateValue(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Today's date as YYYY-MM-DD in the viewer's LOCAL time zone. Air dates are local
 * calendar dates, so comparing them against `new Date().toISOString()` (which is
 * UTC) misclassifies them in the evening for time zones behind UTC — tonight's
 * not-yet-aired episode looks "aired" once UTC has rolled over to tomorrow. Always
 * compare air dates against this, never the UTC slice.
 */
export function todayLocal(): string {
  return localDateValue(Date.now())
}

/**
 * The LOCAL calendar date (YYYY-MM-DD) of an ISO datetime, or null if absent /
 * unparseable. Sports carry a precise UTC instant from ESPN; its local date is the
 * day the viewer means by the game — a 7pm game is "today" even though in UTC the
 * instant has already rolled into tomorrow. Slicing the ISO string instead would
 * show (and classify) such a game on the wrong day.
 */
export function localDateOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : localDateValue(ms)
}
