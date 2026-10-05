import { useQueries } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../data/db'
import { getMovieDetails, imageUrl } from '../api/tmdb'
import { getSeasonEpisodesCached, getTvDetailsCached } from '../data/episodeCache'
import type { MediaType } from '../data/types'

const HOUR = 1000 * 60 * 60
const DAY_MS = 86400000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface DayEntry {
  itemId: string
  title: string
  posterPath?: string
  label: string
  mediaType: MediaType
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The month grid. The month nav lives in the Upcoming controls row (lifted up),
    so the List/Calendar toggle keeps its place; `anchor` is the 1st of that month. */
export default function UpcomingCalendar({ anchor }: { anchor: Date }) {
  const navigate = useNavigate()
  const today = new Date()

  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const monthStart = dateStr(new Date(year, month, 1))
  const monthEnd = dateStr(new Date(year, month + 1, 0))
  const monthStartMs = new Date(`${monthStart}T00:00:00`).getTime()
  const monthEndMs = new Date(`${monthEnd}T23:59:59`).getTime()

  const items = useLiveQuery(() => db.trackedItems.toArray())
  const tracked = (items ?? []).filter((i) => i.status !== 'dropped')
  const shows = tracked.filter((i) => i.mediaType === 'show')
  const movies = tracked.filter((i) => i.mediaType === 'movie')

  // 1) Show details (cached) — gives season air dates to decide what to fetch.
  const detailQueries = useQueries({
    queries: shows.map((s) => ({
      queryKey: ['tv', s.tmdbId],
      queryFn: () => getTvDetailsCached(s.id, s.tmdbId),
      staleTime: HOUR,
    })),
  })

  // 2) Only fetch seasons whose air window overlaps the viewed month.
  const seasonsToFetch: { itemId: string; tmdbId: number; season: number; title: string; posterPath?: string }[] = []
  shows.forEach((s, i) => {
    const details = detailQueries[i]?.data
    if (!details) return
    for (const se of details.seasons) {
      if (se.season_number <= 0 || se.episode_count <= 0 || !se.air_date) continue
      const start = new Date(`${se.air_date}T00:00:00`).getTime()
      // Rough end: assume at most weekly cadence, plus a buffer.
      const end = start + (se.episode_count * 7 + 21) * DAY_MS
      if (end >= monthStartMs && start <= monthEndMs) {
        seasonsToFetch.push({ itemId: s.id, tmdbId: s.tmdbId, season: se.season_number, title: s.title, posterPath: s.posterPath })
      }
    }
  })

  const seasonQueries = useQueries({
    queries: seasonsToFetch.map((x) => ({
      queryKey: ['season', x.tmdbId, x.season],
      queryFn: () => getSeasonEpisodesCached(x.itemId, x.tmdbId, x.season),
      staleTime: HOUR,
    })),
  })

  // 3) Movies: only those whose stored year matches the viewed year (cheap prune).
  const movieShortlist = movies.filter((m) => m.year === year)
  const movieQueries = useQueries({
    queries: movieShortlist.map((m) => ({
      queryKey: ['movie', m.tmdbId],
      queryFn: () => getMovieDetails(m.tmdbId),
      staleTime: HOUR,
    })),
  })

  // Build date -> entries.
  const byDate = new Map<string, DayEntry[]>()
  const add = (date: string, entry: DayEntry) => {
    if (date < monthStart || date > monthEnd) return
    const arr = byDate.get(date) ?? []
    arr.push(entry)
    byDate.set(date, arr)
  }
  seasonsToFetch.forEach((x, i) => {
    for (const ep of seasonQueries[i]?.data ?? []) {
      if (ep.air_date) {
        add(ep.air_date, {
          itemId: x.itemId,
          title: x.title,
          posterPath: x.posterPath,
          label: `S${ep.season_number}E${ep.episode_number}`,
          mediaType: 'show',
        })
      }
    }
  })
  movieShortlist.forEach((m, i) => {
    const rel = movieQueries[i]?.data?.release_date
    if (rel) add(rel, { itemId: m.id, title: m.title, posterPath: m.posterPath, label: 'Release', mediaType: 'movie' })
  })

  const loading =
    detailQueries.some((q) => q.isLoading) ||
    seasonQueries.some((q) => q.isLoading) ||
    movieQueries.some((q) => q.isLoading)

  // Build the 6-week grid starting on the Sunday on/before the 1st.
  const gridStart = new Date(year, month, 1)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())
  const days: Date[] = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
  const todayStr = dateStr(today)

  return (
    <div className="calendar">
      {loading && <div className="muted calendar__loading">Loading…</div>}

      <div className="calendar__weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar__weekday">
            {w}
          </div>
        ))}
      </div>

      <div className="calendar__grid">
        {days.map((d) => {
          const ds = dateStr(d)
          const inMonth = d.getMonth() === month
          const entries = byDate.get(ds) ?? []
          const crowded = entries.length > 3
          return (
            <div
              key={ds}
              className={`cal-day${inMonth ? '' : ' cal-day--muted'}${ds === todayStr ? ' cal-day--today' : ''}`}
            >
              <div className="cal-day__num">{d.getDate()}</div>
              {crowded ? (
                <div className="cal-day__stack-wrap">
                  <div className="cal-stack">
                    {entries.slice(0, 4).map((e, idx) => (
                      <Poster key={idx} entry={e} onClick={() => navigate(`/item/${encodeURIComponent(e.itemId)}`)} stacked />
                    ))}
                  </div>
                  <div className="cal-day__count">{entries.length} episodes</div>
                </div>
              ) : (
                entries.map((e, idx) => (
                  <button
                    key={idx}
                    className="cal-entry"
                    title={`${e.title} · ${e.label}`}
                    onClick={() => navigate(`/item/${encodeURIComponent(e.itemId)}`)}
                  >
                    <Poster entry={e} />
                    <span className="cal-entry__label">{e.label}</span>
                  </button>
                ))
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Poster({
  entry,
  onClick,
  stacked,
}: {
  entry: DayEntry
  onClick?: () => void
  stacked?: boolean
}) {
  const url = imageUrl(entry.posterPath, 'w92')
  const cls = `cal-poster${stacked ? ' cal-poster--stacked' : ''}`
  const content = url ? (
    <img className={cls} src={url} alt="" loading="lazy" />
  ) : (
    <span className={`${cls} cal-poster--placeholder`}>{entry.mediaType === 'movie' ? '🎬' : '📺'}</span>
  )
  if (stacked && onClick) {
    return (
      <button className="cal-stack__btn" title={`${entry.title} · ${entry.label}`} onClick={onClick}>
        {content}
      </button>
    )
  }
  return content
}
