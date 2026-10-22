import { hasAired } from '../api/tmdb'

// Time-of-day aware helpers built on the precise TVmaze airstamp (full datetime
// with timezone). Without an airstamp we fall back to the date-only comparison.

/** Whether an episode has aired. Prefers the exact air time, so an episode airing
 *  later today counts as not-yet-aired instead of already out. */
export function hasAiredByTime(airDate: string | null | undefined, airstamp?: string): boolean {
  return airstamp ? Date.now() >= Date.parse(airstamp) : hasAired(airDate ?? null)
}

/** Whether the airstamp falls on the viewer's local calendar date (today). */
export function airsToday(airstamp: string | undefined): boolean {
  if (!airstamp) return false
  const d = new Date(airstamp)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/** Compact local air time, e.g. "7:00p" / "11:30a". Undefined if unparseable. */
export function compactAirTime(airstamp: string | undefined): string | undefined {
  if (!airstamp) return undefined
  const d = new Date(airstamp)
  if (Number.isNaN(d.getTime())) return undefined
  let h = d.getHours()
  const suffix = h >= 12 ? 'p' : 'a'
  h = h % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}${suffix}`
}

/** When an upcoming episode airs: "today at 7:00p" (precise time) or the date. */
export function airTimeOrDate(airDate: string | null | undefined, airstamp?: string): string {
  if (airsToday(airstamp)) {
    const t = compactAirTime(airstamp)
    if (t) return `today at ${t}`
  }
  return airDate ?? 'TBA'
}
