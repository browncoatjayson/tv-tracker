import { useEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../data/db'
import {
  castNames,
  genreNames,
  getMovieDetails,
  imageUrl,
  isEndedStatus,
  runtimeOf,
  watchNames,
  whereToWatch,
} from '../api/tmdb'
import { formatAirTime, getTvmazeEpisodesByImdb } from '../api/tvmaze'
import { getTvDetailsCached } from '../data/episodeCache'
import { matchesFilter, parseQuery } from '../utils/filter'
import { usePersistentFilter } from '../hooks/usePersistentFilter'
import { markMovieWatched } from '../data/library'
import { markWatchedWithCatchUp } from '../utils/watchActions'
import { useTrackedItems } from '../hooks/useTrackedItems'
import type { MediaType } from '../data/types'
import FilterBar from '../components/FilterBar'
import UpcomingCalendar from '../components/UpcomingCalendar'

interface FeedEntry {
  itemId: string
  title: string
  mediaType: MediaType
  date: string // YYYY-MM-DD
  detail: string
  posterPath?: string
  /** Network / streaming service(s), e.g. "CBS / Paramount+". */
  where?: string
  /** Local air time (from TVmaze), e.g. "9:00 PM". */
  time?: string
  /** For genre/service/actor/status/length filtering. */
  genres?: string[]
  providers?: string[]
  cast?: string[]
  ended?: boolean
  runtime?: number
  // Present on aired entries, so the inline "mark watched" control knows what to log.
  season?: number
  episode?: number
}

const HOUR = 1000 * 60 * 60
const AIRED_WINDOW_DAYS = 30

const BUCKET_ORDER = ['This week', 'Next week', 'This month', 'Later'] as const
type Bucket = (typeof BUCKET_ORDER)[number]

function bucketFor(date: string): Bucket {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const then = new Date(`${date}T00:00:00`)
  const days = Math.round((then.getTime() - now.getTime()) / 86400000)
  if (days <= 7) return 'This week'
  if (days <= 14) return 'Next week'
  if (days <= 31) return 'This month'
  return 'Later'
}

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(undefined, opts)
}

export default function Upcoming() {
  const items = useTrackedItems()
  const episodeStates = useLiveQuery(() => db.episodeStates.toArray())
  const watchEvents = useLiveQuery(() => db.watchEvents.toArray())

  // Everything except "dropped" — a revived "completed" show still surfaces here.
  const [view, setView] = useState<'list' | 'calendar'>(() => {
    try {
      return localStorage.getItem('tvtracker.upcomingView') === 'calendar' ? 'calendar' : 'list'
    } catch {
      return 'list'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('tvtracker.upcomingView', view)
    } catch {
      // ignore
    }
  }, [view])
  const [query, setQuery] = usePersistentFilter('tvtracker.filter.upcoming')
  // Calendar month anchor, lifted here so the month nav can share the controls row.
  const [calAnchor, setCalAnchor] = useState(() => {
    const t = new Date()
    return new Date(t.getFullYear(), t.getMonth(), 1)
  })

  const tracked = (items ?? []).filter((i) => i.status !== 'dropped')
  const shows = tracked.filter((i) => i.mediaType === 'show')
  const movies = tracked.filter((i) => i.mediaType === 'movie')

  const showResults = useQueries({
    queries: shows.map((s) => ({
      queryKey: ['tv', s.tmdbId],
      queryFn: () => getTvDetailsCached(s.id, s.tmdbId),
      staleTime: HOUR,
    })),
  })
  const movieResults = useQueries({
    queries: movies.map((m) => ({
      queryKey: ['movie', m.tmdbId],
      queryFn: () => getMovieDetails(m.tmdbId),
      staleTime: HOUR,
    })),
  })

  // Air times from TVmaze (TMDB has none) — matched by IMDb id, keyed by episode.
  const tvShows = shows.filter((s) => s.imdbId)
  const tvmazeResults = useQueries({
    queries: tvShows.map((s) => ({
      queryKey: ['tvmaze', s.imdbId],
      queryFn: () => getTvmazeEpisodesByImdb(s.imdbId as string),
      staleTime: 1000 * 60 * 60 * 24,
    })),
  })
  const airstampByImdb = new Map<string, Map<string, string>>()
  tvShows.forEach((s, i) => {
    const eps = tvmazeResults[i]?.data
    if (!eps) return
    const m = new Map<string, string>()
    for (const e of eps) if (e.airstamp) m.set(`${e.season}x${e.number}`, e.airstamp)
    airstampByImdb.set(s.imdbId as string, m)
  })
  const airTime = (imdbId: string | undefined, season: number, episode: number) =>
    formatAirTime(imdbId ? airstampByImdb.get(imdbId)?.get(`${season}x${episode}`) : undefined)

  // Watched lookups.
  const watchedEpisodes = new Set(
    (episodeStates ?? []).filter((s) => s.watched).map((s) => `${s.itemId}:${s.season}:${s.episode}`),
  )
  const watchedMovies = new Set(
    (watchEvents ?? []).filter((e) => e.episodeId === null).map((e) => e.itemId),
  )

  const today = new Date().toISOString().slice(0, 10)
  const windowStart = new Date(Date.now() - AIRED_WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10)
  const inAiredWindow = (date: string) => date >= windowStart && date <= today

  const upcoming: FeedEntry[] = []
  const aired: FeedEntry[] = []

  shows.forEach((s, i) => {
    const details = showResults[i]?.data
    if (!details) return
    const where = whereToWatch(details)
    const genres = genreNames(details)
    const providers = watchNames(details)
    const cast = castNames(details)
    const ended = isEndedStatus(details.status)
    const runtime = runtimeOf(details)
    const next = details.next_episode_to_air
    if (next?.air_date && next.air_date >= today) {
      upcoming.push({
        itemId: s.id,
        title: s.title,
        mediaType: 'show',
        date: next.air_date,
        detail: `S${next.season_number}E${next.episode_number}${next.name ? ` · ${next.name}` : ''}`,
        posterPath: s.posterPath,
        where,
        genres,
        providers,
        cast,
        ended,
        runtime,
        time: airTime(s.imdbId, next.season_number, next.episode_number),
      })
    }
    const last = details.last_episode_to_air
    if (
      last?.air_date &&
      inAiredWindow(last.air_date) &&
      !watchedEpisodes.has(`${s.id}:${last.season_number}:${last.episode_number}`)
    ) {
      aired.push({
        itemId: s.id,
        title: s.title,
        mediaType: 'show',
        date: last.air_date,
        detail: `S${last.season_number}E${last.episode_number}${last.name ? ` · ${last.name}` : ''}`,
        posterPath: s.posterPath,
        where,
        genres,
        providers,
        cast,
        ended,
        runtime,
        time: airTime(s.imdbId, last.season_number, last.episode_number),
        season: last.season_number,
        episode: last.episode_number,
      })
    }
  })

  movies.forEach((m, i) => {
    const md = movieResults[i]?.data
    const release = md?.release_date
    if (!release || !md) return
    const where = whereToWatch(md)
    const genres = genreNames(md)
    const providers = watchNames(md)
    const cast = castNames(md)
    const runtime = runtimeOf(md)
    if (release >= today) {
      upcoming.push({
        itemId: m.id,
        title: m.title,
        mediaType: 'movie',
        date: release,
        detail: 'Release',
        posterPath: m.posterPath,
        where,
        genres,
        providers,
        cast,
        runtime,
      })
    } else if (inAiredWindow(release) && !watchedMovies.has(m.id)) {
      aired.push({
        itemId: m.id,
        title: m.title,
        mediaType: 'movie',
        date: release,
        detail: 'Released',
        posterPath: m.posterPath,
        where,
        genres,
        providers,
        cast,
        runtime,
      })
    }
  })

  upcoming.sort((a, b) => a.date.localeCompare(b.date))
  aired.sort((a, b) => a.date.localeCompare(b.date)) // oldest first, newest nearest "This week"

  // Filter, scoped to this list. Supports name / episode name plus genre:/service:.
  // Our list isn't date-capped, so a match shows however far out it is.
  const parsed = parseQuery(query)
  const matches = (e: FeedEntry) =>
    matchesFilter(
      {
        title: e.title,
        extraText: e.detail,
        genres: e.genres,
        providers: e.providers,
        cast: e.cast,
        mediaType: e.mediaType,
        ended: e.ended,
        runtime: e.runtime,
      },
      parsed,
    )
  const airedF = aired.filter(matches)
  const upcomingF = upcoming.filter(matches)

  const upcomingBuckets = BUCKET_ORDER.map((bucket) => ({
    bucket,
    group: upcomingF.filter((e) => bucketFor(e.date) === bucket),
  })).filter((b) => b.group.length > 0)

  const dataReady =
    items !== undefined &&
    episodeStates !== undefined &&
    watchEvents !== undefined &&
    !showResults.some((r) => r.isLoading) &&
    !movieResults.some((r) => r.isLoading)

  // On first load, if there's a "Recently aired" section above, scroll so the
  // first upcoming group sits at the top — Recently aired is then a scroll up.
  const firstUpcomingRef = useRef<HTMLElement>(null)
  const didScroll = useRef(false)
  useEffect(() => {
    if (didScroll.current || !dataReady || query) return
    if (airedF.length > 0 && upcomingBuckets.length > 0 && firstUpcomingRef.current) {
      didScroll.current = true
      firstUpcomingRef.current.scrollIntoView({ block: 'start' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady])

  function markAiredWatched(e: FeedEntry) {
    if (e.mediaType === 'show' && e.season != null && e.episode != null) {
      void markWatchedWithCatchUp(e.itemId, e.season, e.episode)
    } else {
      void markMovieWatched(e.itemId)
    }
  }

  if (items !== undefined && tracked.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__emoji">🗓️</p>
        <h2>Nothing tracked yet</h2>
        <p className="muted">
          Add shows and movies from <Link to="/search">Search</Link> to see what’s coming up.
        </p>
      </div>
    )
  }

  const seg = (
    <div className="seg" role="tablist" aria-label="Upcoming view">
      <button
        className={`seg__btn${view === 'list' ? ' seg__btn--on' : ''}`}
        onClick={() => setView('list')}
        aria-label="List view"
        aria-pressed={view === 'list'}
        title="List"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 5l1.5 1.5L7 4" />
          <path d="M3 12l1.5 1.5L7 11" />
          <path d="M3 19l1.5 1.5L7 18" />
          <path d="M11 5h10" />
          <path d="M11 12h10" />
          <path d="M11 19h10" />
        </svg>
      </button>
      <button
        className={`seg__btn${view === 'calendar' ? ' seg__btn--on' : ''}`}
        onClick={() => setView('calendar')}
        aria-label="Calendar view"
        aria-pressed={view === 'calendar'}
        title="Calendar"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </svg>
      </button>
    </div>
  )
  const calYear = calAnchor.getFullYear()
  const calMonth = calAnchor.getMonth()
  const calMonthLabel = calAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const calShift = (delta: number) => setCalAnchor(new Date(calYear, calMonth + delta, 1))
  const calToday = () => {
    const t = new Date()
    setCalAnchor(new Date(t.getFullYear(), t.getMonth(), 1))
  }
  const calendarNav = (
    <div className="calendar__nav">
      <button
        className="btn btn--small btn--ghost"
        onClick={() => calShift(-1)}
        aria-label="Previous month"
      >
        ‹
      </button>
      <span className="calendar__month">{calMonthLabel}</span>
      <button className="btn btn--small btn--ghost" onClick={calToday}>
        Today
      </button>
      <button
        className="btn btn--small btn--ghost"
        onClick={() => calShift(1)}
        aria-label="Next month"
      >
        ›
      </button>
    </div>
  )
  const controls =
    view === 'list' ? (
      <FilterBar value={query} onChange={setQuery} placeholder="Search for a title">
        {seg}
      </FilterBar>
    ) : (
      <div className="upcoming__controls upcoming__controls--cal">
        {calendarNav}
        {seg}
      </div>
    )

  return (
    <div className="upcoming">
      {controls}

      {view === 'calendar' ? (
        <UpcomingCalendar anchor={calAnchor} />
      ) : !dataReady && upcoming.length === 0 && aired.length === 0 ? (
        <p className="muted">Checking for upcoming releases…</p>
      ) : upcoming.length === 0 && aired.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__emoji">✅</p>
          <h2>All caught up</h2>
          <p className="muted">No upcoming or recently aired titles to show.</p>
        </div>
      ) : airedF.length === 0 && upcomingBuckets.length === 0 ? (
        <p className="muted">No upcoming matches for “{query}”.</p>
      ) : (
        <>
          {airedF.length > 0 && (
            <section className="upcoming-aired">
              <h2 className="section-title">Recently aired</h2>
              <ul className="result-list">
                {airedF.map((e) => (
                  <li key={`aired:${e.itemId}:${e.date}`} className="result-row">
                    <Link to={`/item/${encodeURIComponent(e.itemId)}`} className="result-row__link">
                      <FeedPoster entry={e} />
                      <div className="result-row__info">
                        <span className="result-row__title">{e.title}</span>
                        <span className="muted upcoming__detail">{e.detail}</span>
                        {e.where && <span className="muted upcoming__where">{e.where}</span>}
                      </div>
                      <div className="upcoming__when">
                        <span className="upcoming__date">{formatDate(e.date)}</span>
                        {e.time && <span className="muted upcoming__time">{e.time}</span>}
                      </div>
                    </Link>
                    <button className="btn btn--small" title="Mark watched" onClick={() => markAiredWatched(e)}>
                      ✓
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {upcomingBuckets.map((b, idx) => (
            <section
              key={b.bucket}
              ref={idx === 0 ? firstUpcomingRef : undefined}
              className="upcoming-section"
            >
              <h2 className="section-title">{b.bucket}</h2>
              <ul className="result-list">
                {b.group.map((e) => (
                  <li key={`up:${e.itemId}:${e.date}`} className="result-row">
                    <Link to={`/item/${encodeURIComponent(e.itemId)}`} className="result-row__link">
                      <FeedPoster entry={e} />
                      <div className="result-row__info">
                        <span className="result-row__title">{e.title}</span>
                        <span className="muted upcoming__detail">{e.detail}</span>
                        {e.where && <span className="muted upcoming__where">{e.where}</span>}
                      </div>
                      <div className="upcoming__when">
                        <span className="upcoming__date">{formatDate(e.date)}</span>
                        {e.time && <span className="muted upcoming__time">{e.time}</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function FeedPoster({ entry }: { entry: FeedEntry }) {
  const poster = imageUrl(entry.posterPath, 'w92')
  return poster ? (
    <img className="result-row__poster" src={poster} alt="" loading="lazy" />
  ) : (
    <div className="result-row__poster result-row__poster--placeholder">
      {entry.mediaType === 'movie' ? '🎬' : '📺'}
    </div>
  )
}
