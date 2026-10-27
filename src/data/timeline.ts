import { imageUrl } from '../api/tmdb'
import { badgeById } from './badges'
import { leagueByKey } from '../api/espn'
import type { EarnedBadge, EpisodeState, TrackedItem } from './types'

// ---------------------------------------------------------------------------
// Watch timeline: fold everything with a date — watched episodes, sport games,
// movies, and earned badges — into day-bucketed entries the Timeline view
// renders as an agenda calendar or a flat list.
//
// Dates are bucketed to a LOCAL calendar day. A movie whose watch date is only
// known to a month or year (movieWatchedPrecision) lands on the LAST day of that
// period, so "watched sometime in 2024" sorts to the end of 2024 rather than
// floating to an arbitrary mid-point.
// ---------------------------------------------------------------------------

export type TimelineKind = 'episode' | 'game' | 'movie' | 'badge'

export interface TimelineEntry {
  /** Stable unique key. */
  key: string
  /** Bucketed local day, YYYY-MM-DD. */
  date: string
  kind: TimelineKind
  /** Tracked-item id (for the link); absent for badges. */
  itemId?: string
  title: string
  subtitle?: string
  /** Poster / team logo url, when there is one. */
  poster?: string
  /** Emoji shown in place of a poster (badges, or a media fallback). */
  emoji?: string
  /** The moment used for display ("earned on", exact time) — original timestamp. */
  at: number
  /** True when the day is approximate (month/year precision). */
  vague?: boolean
  /** Badge id, for re-showing its toast. */
  badgeId?: string
  // Intra-day ordering helpers.
  sortTitle: string
  season?: number
  episode?: number
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local YYYY-MM-DD for a timestamp. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Bucket a (ms, precision) watch date to the last day of its period (local). */
function bucketDay(ms: number, precision: 'day' | 'month' | 'year'): string {
  const d = new Date(ms)
  if (precision === 'year') return `${d.getFullYear()}-12-31`
  if (precision === 'month') {
    const lastDom = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(lastDom)}`
  }
  return localDay(ms)
}

function posterFor(it: TrackedItem): { poster?: string; emoji?: string } {
  if (it.mediaType === 'sport') {
    return { poster: it.sport?.logo, emoji: leagueByKey(it.sport?.league)?.emoji ?? '🏅' }
  }
  const poster = imageUrl(it.posterPath, 'w185')
  return { poster, emoji: it.mediaType === 'movie' ? '🎬' : '📺' }
}

/**
 * Build the full set of timeline entries.
 * @param episodeNames episodeKey → episode/game name (from the episode cache).
 */
export function buildTimeline(
  items: TrackedItem[],
  states: EpisodeState[],
  badges: EarnedBadge[],
  episodeNames: Map<string, string>,
): TimelineEntry[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const entries: TimelineEntry[] = []

  // Watched episodes + sport games.
  for (const s of states) {
    if (!s.watched || !s.watchedAt) continue
    const it = byId.get(s.itemId)
    if (!it) continue
    const isSport = it.mediaType === 'sport'
    const name = episodeNames.get(s.id)
    const art = posterFor(it)
    entries.push({
      key: `ep:${s.id}`,
      date: localDay(s.watchedAt),
      kind: isSport ? 'game' : 'episode',
      itemId: it.id,
      title: it.title,
      subtitle: isSport
        ? (name ?? `Game ${s.episode}`)
        : `S${s.season}E${s.episode}${name ? ` · ${name}` : ''}`,
      poster: art.poster,
      emoji: art.emoji,
      at: s.watchedAt,
      sortTitle: it.title.toLowerCase(),
      season: s.season,
      episode: s.episode,
    })
  }

  // Movies (single recorded watch date, with precision).
  for (const it of items) {
    if (it.mediaType !== 'movie' || !it.movieWatchedAt) continue
    const precision = it.movieWatchedPrecision ?? 'day'
    const art = posterFor(it)
    entries.push({
      key: `mv:${it.id}`,
      date: bucketDay(it.movieWatchedAt, precision),
      kind: 'movie',
      itemId: it.id,
      title: it.title,
      subtitle: 'Movie',
      poster: art.poster,
      emoji: art.emoji,
      at: it.movieWatchedAt,
      vague: precision !== 'day',
      sortTitle: it.title.toLowerCase(),
    })
  }

  // Earned badges.
  for (const b of badges) {
    const def = badgeById(b.id)
    if (!def) continue
    entries.push({
      key: `bd:${b.id}`,
      date: localDay(b.earnedAt),
      kind: 'badge',
      title: def.name,
      subtitle: def.description,
      emoji: def.emoji,
      at: b.earnedAt,
      badgeId: b.id,
      sortTitle: def.name.toLowerCase(),
    })
  }

  return entries
}

/** Order within a single day: watched items first (by title, then episode),
 *  earned badges last. */
export function compareInDay(a: TimelineEntry, b: TimelineEntry): number {
  const ab = a.kind === 'badge' ? 1 : 0
  const bb = b.kind === 'badge' ? 1 : 0
  if (ab !== bb) return ab - bb
  if (a.sortTitle !== b.sortTitle) return a.sortTitle < b.sortTitle ? -1 : 1
  return (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)
}

/** Group entries by day, each day's entries sorted by {@link compareInDay}. */
export function groupByDay(entries: TimelineEntry[]): Map<string, TimelineEntry[]> {
  const map = new Map<string, TimelineEntry[]>()
  for (const e of entries) {
    const arr = map.get(e.date) ?? []
    arr.push(e)
    map.set(e.date, arr)
  }
  for (const arr of map.values()) arr.sort(compareInDay)
  return map
}
