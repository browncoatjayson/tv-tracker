import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../data/db'
import { hasAired, imageUrl, languageKind } from '../api/tmdb'
import { leagueByKey } from '../api/espn'
import { sportAirState } from '../data/sports'
import { getTvmazeEpisodesByImdb } from '../api/tvmaze'
import { airsToday, compactAirTime, hasAiredByTime } from '../utils/airTime'
import { markEpisode, seenState, toggleFavorite } from '../data/library'
import type { CachedEpisode, CustomList, EpisodeState, TrackedItem, WatchStatus } from '../data/types'
import { matchesFilter, parseQuery } from '../utils/filter'
import { WATCH_NEXT_LINK, useWatchNextFav } from '../data/watchNext'
import ListCollage from '../components/ListCollage'
import WatchNextPoster from '../components/WatchNextCard'
import { usePersistentFilter } from '../hooks/usePersistentFilter'
import { useCachedAirstamps } from '../hooks/useShowAirstamps'
import { useTrackedItems } from '../hooks/useTrackedItems'
import FilterBar from '../components/FilterBar'
import SectionDivider from '../components/SectionDivider'
import WelcomeScreen from '../components/WelcomeScreen'

// Session flag (resets on reload = a fresh launch): once the welcome is dismissed
// we don't re-pop it when navigating back to an (still-empty) Library.
let welcomeSeen = false

const STATUS_ORDER: WatchStatus[] = ['watching', 'watchlist', 'completed', 'dropped']
const STATUS_LABEL: Record<WatchStatus, string> = {
  watching: 'Watching',
  watchlist: 'Watchlist',
  completed: 'Completed',
  dropped: 'Dropped',
}

type SortKey = 'title' | 'premiere' | 'lastEpisode' | 'rating'
const SORT_LABEL: Record<SortKey, string> = {
  title: 'Title (A–Z)',
  premiere: 'Premiere date (newest)',
  lastEpisode: 'Last episode date (newest)',
  rating: 'Rating (highest)',
}

/** One rendered group of titles (a status, or Favorites). */
interface Section {
  key: string
  label: string
  items: TrackedItem[]
  /** Watching shows get the "next episode" strip (full view only). */
  watching?: boolean
  /** For a mixed section (Favorites), only items this returns true for get the
   *  next-episode strip — so a favorited show/team you're Watching shows its next
   *  episode while favorited movies / finished shows stay plain. Omitted = all. */
  showNextCard?: (item: TrackedItem) => boolean
  /** Gets a "Hide" toggle in the full view so you can tuck it away (In Hiatus,
   *  Completed, Dropped). */
  collapsible?: boolean
  /** Extra cards shown before the items (Favorites: the Watch Next shortcut and
   *  favorited lists, which aren't TrackedItems). Full view / collapsed view. */
  leadingCards?: ReactNode[]
  leadingChips?: ReactNode[]
  /** Count of the leading cards, added to the section's header total. */
  leadingCount?: number
}

/** Placeholder emoji for a title (sports use their league icon). */
function mediaEmoji(i: TrackedItem): string {
  if (i.mediaType === 'sport') return leagueByKey(i.sport?.league)?.emoji ?? '🏅'
  return i.mediaType === 'movie' ? '🎬' : '📺'
}

/** Card image: a team logo (full URL) for sports, else the TMDB poster. */
function cardImg(i: TrackedItem, size?: string): string | undefined {
  return i.mediaType === 'sport' ? i.sport?.logo : imageUrl(i.posterPath, size)
}

/** The poster artwork for a library card. Sports show the team logo over a faint
 *  league-emoji watermark (like the detail hero) so two teams you follow in
 *  different sports read apart at a glance; everything else is its TMDB poster. */
function CardArt({ item }: { item: TrackedItem }) {
  const src = cardImg(item)
  if (item.mediaType === 'sport') {
    const emoji = leagueByKey(item.sport?.league)?.emoji ?? '🏅'
    return (
      <div className="poster-card__img sport-poster">
        <span className="sport-poster__mark" aria-hidden="true">
          {emoji}
        </span>
        {src ? (
          <img className="sport-poster__logo" src={src} alt="" loading="lazy" />
        ) : (
          <span className="sport-poster__logo sport-poster__logo--ph">{emoji}</span>
        )}
      </div>
    )
  }
  return src ? (
    <img className="poster-card__img" src={src} alt="" loading="lazy" />
  ) : (
    <div className="poster-card__img poster-card__img--placeholder">{mediaEmoji(item)}</div>
  )
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

const HIDDEN_KEY = 'tvtracker.libraryHidden'

/** Section keys the user has collapsed. Dropped is hidden by default (until the
 *  user has saved a preference of their own). */
function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    // ignore
  }
  return new Set(['dropped'])
}

/** Which release states a title belongs to (for the Released filter). A show can
 *  be both — aired episodes (lastAirDate) plus upcoming ones (future nextAirDate).
 *  Returns undefined when nothing is known yet, so the filter leaves it alone. */
function titleReleasedStates(i: TrackedItem): ('aired' | 'upcoming')[] | undefined {
  const today = new Date().toISOString().slice(0, 10)
  const states: ('aired' | 'upcoming')[] = []
  if (i.lastAirDate) states.push('aired')
  if (i.nextAirDate && i.nextAirDate > today) states.push('upcoming')
  return states.length ? states : undefined
}

/** Compact label for a not-yet-aired next episode: "at 7:00p" when it airs later
 *  today (keeping the episode code readable), otherwise the plain date. */
function formatNextAir(airDate: string | null, airstamp?: string): string {
  if (airsToday(airstamp)) {
    const t = compactAirTime(airstamp)
    if (t) return `at ${t}`
  }
  return airDate ?? 'TBA'
}

function comparator(sort: SortKey): (a: TrackedItem, b: TrackedItem) => number {
  switch (sort) {
    case 'premiere':
      // Newest first; items without a year sort last.
      return (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.title.localeCompare(b.title)
    case 'lastEpisode': {
      // Sort by the last *aired* episode date (shows) / release date (movies),
      // newest first. Titles with nothing aired yet (unaired shows, unreleased
      // movies, or not-yet-indexed) have no date and sort to the end, alphabetically.
      return (a, b) => {
        const ka = a.lastAirDate ?? ''
        const kb = b.lastAirDate ?? ''
        if (ka && kb) return kb.localeCompare(ka) || a.title.localeCompare(b.title)
        if (ka) return -1
        if (kb) return 1
        return a.title.localeCompare(b.title)
      }
    }
    case 'rating':
      // Highest TMDB rating first; unrated titles sort to the end, alphabetically.
      return (a, b) =>
        (b.tmdbRating ?? -Infinity) - (a.tmdbRating ?? -Infinity) || a.title.localeCompare(b.title)
    default:
      return (a, b) => a.title.localeCompare(b.title)
  }
}

export default function Library() {
  const items = useTrackedItems()
  // Favorited custom lists + the "Watch Next" shortcut — surfaced as extra cards
  // at the top of the Favorites section (browse mode only).
  const favLists = useLiveQuery(
    () =>
      db.lists
        .filter((l) => !!l.favorite)
        .toArray()
        .then((rows) => rows.sort((a, b) => b.updatedAt - a.updatedAt)),
    [],
  )
  const watchNextFav = useWatchNextFav()
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => welcomeSeen)
  const dismissWelcome = () => {
    welcomeSeen = true
    setWelcomeDismissed(true)
  }
  const [query, setQuery] = usePersistentFilter('tvtracker.filter.library')
  const [sort, setSort] = useState<SortKey>(() => {
    try {
      const v = localStorage.getItem('tvtracker.librarySort')
      if (v === 'title' || v === 'premiere' || v === 'lastEpisode' || v === 'rating') return v
    } catch {
      // ignore
    }
    return 'title'
  })
  // Compact "collapsed" layout, and which groups are tucked away.
  const [collapsed, setCollapsed] = useState(() => readFlag('tvtracker.libraryCollapsed'))
  const [hidden, setHidden] = useState<Set<string>>(readHidden)
  // "Now" captured once per mount (stable across renders; plenty fresh for the
  // 14-day hiatus window) — avoids calling Date impurely during render.
  const [now] = useState(() => Date.now())
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const toggleHidden = (key: string, v: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (v) next.add(key)
      else next.delete(key)
      return next
    })
  useEffect(() => {
    try {
      localStorage.setItem('tvtracker.librarySort', sort)
    } catch {
      // ignore
    }
  }, [sort])
  useEffect(() => {
    try {
      localStorage.setItem('tvtracker.libraryCollapsed', collapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [collapsed])
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]))
    } catch {
      // ignore
    }
  }, [hidden])

  // Episode-name matches from the local cache (populated as shows are viewed /
  // the calendar loads). Coverage grows with use; shows never opened won't match.
  const episodeMatches = useLiveQuery<CachedEpisode[]>(() => {
    const qq = parseQuery(query).text
    if (qq.length < 2) return Promise.resolve([] as CachedEpisode[])
    return db.episodeCache.filter((e) => e.name.toLowerCase().includes(qq)).toArray()
  }, [query])

  // For the Watching section's "next episode" card: cached episodes + watched
  // state for the shows currently being watched (scoped, so it stays light).
  const watchingIds = (items ?? [])
    .filter(
      (i) => i.status === 'watching' && (i.mediaType === 'show' || i.mediaType === 'sport'),
    )
    .map((i) => i.id)
  // Sport items cache games across every season the user has browsed, but the
  // Library card should only reflect the current/upcoming season — so a team
  // whose current season is fully watched surfaces its next game, not a stale
  // unwatched game left over from a past season.
  const sportIds = new Set(
    (items ?? []).filter((i) => i.mediaType === 'sport').map((i) => i.id),
  )
  const watchingKey = watchingIds.join('|')
  const watchingEpisodes = useLiveQuery<CachedEpisode[]>(
    () =>
      watchingIds.length
        ? db.episodeCache.where('itemId').anyOf(watchingIds).toArray()
        : Promise.resolve([] as CachedEpisode[]),
    [watchingKey],
  )
  const watchingStates = useLiveQuery<EpisodeState[]>(
    () =>
      watchingIds.length
        ? db.episodeStates.where('itemId').anyOf(watchingIds).toArray()
        : Promise.resolve([] as EpisodeState[]),
    [watchingKey],
  )
  // Precise air times (from TVmaze) for the watching shows, so the next-episode
  // strip can tell "airs later today" from "already aired". Matched by IMDb id,
  // keyed per item by "season:episode". Cached 24h and shared with Upcoming.
  const watchingImdb = (items ?? []).filter(
    (i) => i.status === 'watching' && i.mediaType === 'show' && i.imdbId,
  )
  const tvmazeResults = useQueries({
    queries: watchingImdb.map((s) => ({
      queryKey: ['tvmaze', s.imdbId],
      queryFn: () => getTvmazeEpisodesByImdb(s.imdbId as string),
      staleTime: 1000 * 60 * 60 * 24,
    })),
  })
  const airstampByItem = new Map<string, Map<string, string>>()
  watchingImdb.forEach((s, i) => {
    const eps = tvmazeResults[i]?.data
    if (!eps) return
    const m = new Map<string, string>()
    for (const e of eps) if (e.airstamp) m.set(`${e.season}:${e.number}`, e.airstamp)
    airstampByItem.set(s.id, m)
  })
  // Prefer precise Trakt times cached on the episode rows over TVmaze (which
  // fills a noon-UTC placeholder for streaming shows).
  const cachedStamp = useCachedAirstamps(watchingImdb.map((s) => s.id))
  const airstampOf = (itemId: string, season: number, episode: number): string | undefined =>
    cachedStamp(itemId, season, episode) ?? airstampByItem.get(itemId)?.get(`${season}:${episode}`)

  const watchedEpKeys = new Set(
    (watchingStates ?? []).filter((s) => s.watched).map((s) => `${s.itemId}:${s.season}:${s.episode}`),
  )
  const epByItem = new Map<string, CachedEpisode[]>()
  for (const e of watchingEpisodes ?? []) {
    if (e.season === 0) continue // skip specials
    const arr = epByItem.get(e.itemId) ?? []
    arr.push(e)
    epByItem.set(e.itemId, arr)
  }
  const sortedEps = (itemId: string): CachedEpisode[] => {
    const eps = (epByItem.get(itemId) ?? [])
      .slice()
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
    // For a team, restrict to its latest cached season (year) only.
    if (sportIds.has(itemId) && eps.length) {
      const latest = eps[eps.length - 1].season
      return eps.filter((e) => e.season === latest)
    }
    return eps
  }
  // A sport game ESPN left uncompleted after its date passed can't be watched and
  // isn't really upcoming, so it shouldn't become the "next game" card.
  const isUnairedSportAnomaly = (itemId: string, e: CachedEpisode): boolean =>
    sportIds.has(itemId) && sportAirState(e.airDate, e.completed) === 'unaired'
  const nextUnwatched = (itemId: string): CachedEpisode | null =>
    sortedEps(itemId).find(
      (e) =>
        !watchedEpKeys.has(`${e.itemId}:${e.season}:${e.episode}`) &&
        !isUnairedSportAnomaly(itemId, e),
    ) ?? null
  // The next episode still to air — used when filtering to upcoming, so the card
  // answers "when's it back?" instead of pointing at an already-aired episode.
  // (Past-dated sport anomalies are already excluded: their date has passed.)
  const nextUpcoming = (itemId: string): CachedEpisode | null =>
    sortedEps(itemId).find((e) => !hasAired(e.airDate)) ?? null

  // "In hiatus": a returning show you're fully caught up on (every aired episode
  // watched or skipped) AND with no new episode airing soon — i.e. the season's
  // over and you're waiting. A show whose next episode is imminent is still
  // actively airing, so it stays in Watching even when you're momentarily caught
  // up. (Needs cached episodes, so an un-indexed show stays in Watching.)
  const HIATUS_SOON_MS = 14 * 24 * 60 * 60 * 1000
  const seenEpKeys = new Set(
    (watchingStates ?? [])
      .filter((s) => s.watched || s.skipped)
      .map((s) => `${s.itemId}:${s.season}:${s.episode}`),
  )
  const isHiatus = (i: TrackedItem): boolean => {
    if (i.mediaType !== 'show' || i.ended !== false) return false
    const eps = sortedEps(i.id)
    if (eps.length === 0) return false
    const caughtUp = !eps.some(
      (e) =>
        !seenEpKeys.has(`${e.itemId}:${e.season}:${e.episode}`) &&
        hasAiredByTime(e.airDate, airstampOf(i.id, e.season, e.episode)),
    )
    if (!caughtUp) return false
    // An episode airing within the next couple of weeks = actively in-season.
    const upcoming = nextUpcoming(i.id)?.airDate ?? undefined
    const scheduled = i.nextAirDate && i.nextAirDate >= today ? i.nextAirDate : undefined
    const next = upcoming ?? scheduled
    if (next && Date.parse(next) - now <= HIATUS_SOON_MS) return false
    return true
  }
  const hiatusIds = new Set((items ?? []).filter(isHiatus).map((i) => i.id))

  if (items === undefined) return <p className="muted">Loading…</p>

  if (items.length === 0) {
    // Welcome takes over an empty library on launch; once dismissed, the plain
    // empty-state hint shows beneath it.
    if (!welcomeDismissed) return <WelcomeScreen onClose={dismissWelcome} />
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

  const sorted = [...items].sort(comparator(sort))
  const parsed = parseQuery(query)
  const searching = query.trim().length > 0

  // When filtering to upcoming-only, the watching card points at the next episode
  // still to air (not the next unwatched one, which may already be out).
  const upcomingOnly = parsed.released.length === 1 && parsed.released[0] === 'upcoming'
  const pickNextEp = upcomingOnly ? nextUpcoming : nextUnwatched

  // Fallback for the Watching card: a show kept out of Hiatus because its next
  // episode is coming soon (nextAirDate) but not yet in the episode cache would
  // otherwise read "Nothing scheduled". Surface that known air date instead, so
  // the card agrees with the hiatus logic (both already consider nextAirDate).
  const scheduledAir = (i: TrackedItem): string | undefined =>
    i.mediaType === 'show' && i.nextAirDate && i.nextAirDate >= today ? i.nextAirDate : undefined

  // When searching, keep only titles matching the query/filters; otherwise all.
  const matched = searching
    ? sorted.filter((i) =>
        matchesFilter(
          {
            title: i.title,
            genres: i.genres,
            providers: i.providers,
            cast: i.cast,
            mediaType: i.mediaType,
            ended: i.ended,
            seen: seenState(i.status),
            language: languageKind(i.language),
            year: i.year,
            series: i.series,
            universe: i.universe,
            team: i.sport?.teamName,
            league: i.sport?.league,
            leagueLabel: leagueByKey(i.sport?.league)?.label,
            // A title can be both: a mid-run show has aired episodes (lastAirDate)
            // AND upcoming ones (nextAirDate). Unknown (not indexed) → undefined.
            releasedStates: titleReleasedStates(i),
            hiatus: hiatusIds.has(i.id),
            runtime: i.runtime,
            rating: i.tmdbRating,
          },
          parsed,
        ),
      )
    : sorted

  // Keep the status groups in both modes so results stay in context. Favorites
  // get their own section only when browsing (not mixed into search results).
  // Favorited lists + the Watch Next shortcut lead the Favorites section (browse
  // mode only — they aren't TrackedItems and aren't mixed into search results).
  const specialFavCards: ReactNode[] = []
  const specialFavChips: ReactNode[] = []
  if (!searching) {
    if (watchNextFav) {
      specialFavCards.push(
        <li key="__wn" className="poster-cell">
          <Link
            to={WATCH_NEXT_LINK}
            className="poster-card"
            title="Watch Next — shuffle a suggestion"
          >
            <WatchNextPoster className="poster-card__img" />
            <span className="poster-card__title">Watch Next</span>
          </Link>
        </li>,
      )
      specialFavChips.push(
        <Link key="__wn" to={WATCH_NEXT_LINK} className="lib-chip" title="Watch Next">
          <WatchNextPoster className="lib-chip__img" />
          <span className="lib-chip__title">Watch Next</span>
        </Link>,
      )
    }
    for (const list of favLists ?? []) {
      specialFavCards.push(<FavListCard key={list.id} list={list} />)
      specialFavChips.push(<FavListChip key={list.id} list={list} />)
    }
  }
  const specialFavCount = specialFavCards.length

  const sections: Section[] = []
  if (!searching) {
    const favs = matched.filter((i) => i.favorite)
    if (favs.length > 0 || specialFavCount > 0)
      sections.push({
        key: 'fav',
        label: '★ Favorites',
        items: favs,
        // Favorites is a mixed section; render it like Watching but show the
        // next-episode strip only for a favorited show/team you're Watching.
        watching: true,
        showNextCard: (i) =>
          (i.mediaType === 'show' || i.mediaType === 'sport') && i.status === 'watching',
        leadingCards: specialFavCards,
        leadingChips: specialFavChips,
        leadingCount: specialFavCount,
      })
  }
  for (const status of STATUS_ORDER) {
    const group = matched.filter((i) => i.status === status && (searching || !i.favorite))
    if (group.length === 0) continue
    if (status === 'watching') {
      // Pull caught-up returning shows out of Watching into their own "In Hiatus"
      // section (right after Watching) to declutter the list of things to watch.
      const active = group.filter((i) => !hiatusIds.has(i.id))
      const paused = group.filter((i) => hiatusIds.has(i.id))
      if (active.length > 0) {
        sections.push({ key: 'watching', label: 'Watching', items: active, watching: true })
      }
      if (paused.length > 0) {
        sections.push({
          key: 'hiatus',
          label: 'In Hiatus',
          items: paused,
          watching: true,
          collapsible: true,
        })
      }
      continue
    }
    sections.push({
      key: status,
      label: STATUS_LABEL[status],
      items: group,
      collapsible: status === 'completed' || status === 'dropped',
    })
  }

  // Episode-name matches, one row per episode (only for shows not already matched
  // by title, and still respecting any genre/service/actor/type filter).
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const titleIds = new Set(matched.map((i) => i.id))
  const episodeHits = searching
    ? (episodeMatches ?? [])
        .filter((e) => {
          const it = itemsById.get(e.itemId)
          if (!it || titleIds.has(e.itemId)) return false
          return matchesFilter(
            {
              genres: it.genres,
              providers: it.providers,
              cast: it.cast,
              mediaType: 'show',
              ended: it.ended,
              aired: hasAired(e.airDate),
              runtime: it.runtime,
              rating: it.tmdbRating,
            },
            { ...parsed, text: '' },
          )
        })
        .sort(
          (a, b) => a.itemId.localeCompare(b.itemId) || a.season - b.season || a.episode - b.episode,
        )
        .slice(0, 40)
    : []

  const noMatches = searching && sections.length === 0 && episodeHits.length === 0

  return (
    <div className="library">
      <FilterBar value={query} onChange={setQuery} placeholder="Search for a title" hiatusFilter>
        <ViewToggle collapsed={collapsed} onChange={setCollapsed} />
        <SortMenu sort={sort} onChange={setSort} />
      </FilterBar>

      {noMatches && <p className="muted">No matches for “{query}”.</p>}

      {!noMatches &&
        (collapsed ? (
          <CollapsedList sections={sections} hidden={hidden} onToggleHidden={toggleHidden} />
        ) : (
          sections.map((sec) => (
            <FullSection
              key={sec.key}
              sec={sec}
              hidden={hidden.has(sec.key)}
              onToggleHidden={toggleHidden}
              pickNextEp={pickNextEp}
              scheduledAir={scheduledAir}
              airstampOf={airstampOf}
            />
          ))
        ))}

      {episodeHits.length > 0 && (
        <section className="library__section">
          <h2 className="section-title">
            Episode matches <span className="count">{episodeHits.length}</span>
          </h2>
          <ul className="result-list">
            {episodeHits.map((e) => {
              const item = itemsById.get(e.itemId) as TrackedItem
              const aired = hasAired(e.airDate)
              return (
                <li key={e.id} className="result-row">
                  <Link to={`/item/${encodeURIComponent(item.id)}`} className="result-row__link">
                    {imageUrl(item.posterPath, 'w92') ? (
                      <img
                        className="result-row__poster"
                        src={imageUrl(item.posterPath, 'w92')}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="result-row__poster result-row__poster--placeholder">📺</div>
                    )}
                    <div className="result-row__info">
                      <span className="result-row__title">{item.title}</span>
                      <span className="muted upcoming__detail">
                        S{e.season}E{e.episode} · {e.name}
                      </span>
                    </div>
                    {aired ? (
                      <span className="upcoming__date">{e.airDate}</span>
                    ) : (
                      <span className="episode__upcoming">
                        {e.airDate ? `Upcoming · ${e.airDate}` : 'Upcoming'}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

/** A full-size status group: header (+ Hide toggle for Dropped) and a poster grid. */
function FullSection({
  sec,
  hidden,
  onToggleHidden,
  pickNextEp,
  scheduledAir,
  airstampOf,
}: {
  sec: Section
  hidden: boolean
  onToggleHidden: (key: string, v: boolean) => void
  pickNextEp: (id: string) => CachedEpisode | null
  scheduledAir: (i: TrackedItem) => string | undefined
  airstampOf: (itemId: string, season: number, episode: number) => string | undefined
}) {
  // In the full view, collapsible sections (In Hiatus, Completed, Dropped) can be
  // hidden behind a "Hide" toggle.
  const isHidden = !!sec.collapsible && hidden
  const total = sec.items.length + (sec.leadingCount ?? 0)
  return (
    <section className="library__section">
      <h2 className={`section-title${sec.collapsible ? ' section-title--row' : ''}`}>
        {sec.label} <span className="count">{total}</span>
        {sec.collapsible && (
          <label className="lib-hide">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => onToggleHidden(sec.key, e.target.checked)}
            />
            Hide
          </label>
        )}
      </h2>
      {isHidden ? (
        <p className="muted lib-hidden-note">{total} hidden</p>
      ) : sec.watching ? (
        <WatchingGrid
          items={sec.items}
          pickNextEp={pickNextEp}
          scheduledAir={scheduledAir}
          airstampOf={airstampOf}
          showNextCard={sec.showNextCard}
          leading={sec.leadingCards}
        />
      ) : (
        <PosterGrid items={sec.items} leading={sec.leadingCards} />
      )}
    </section>
  )
}

/** Compact layout: every group flows in one wrapping list, each introduced by a
 *  one-card-wide divider with its count and a Hide toggle (mirrors the Cast row). */
function CollapsedList({
  sections,
  hidden,
  onToggleHidden,
}: {
  sections: Section[]
  hidden: Set<string>
  onToggleHidden: (key: string, v: boolean) => void
}) {
  return (
    <div className="lib-collapsed">
      {sections.map((sec) => {
        const isHidden = hidden.has(sec.key)
        return (
          <Fragment key={sec.key}>
            <SectionDivider
              className="section-divider--lib"
              label={sec.label}
              count={sec.items.length + (sec.leadingCount ?? 0)}
              countNoun="Title"
              hidden={isHidden}
              onToggleHide={(v) => onToggleHidden(sec.key, v)}
            />
            {!isHidden && sec.leadingChips}
            {!isHidden && sec.items.map((item) => <LibChip key={item.id} item={item} />)}
          </Fragment>
        )
      })}
    </div>
  )
}

/** A small poster + title card for the collapsed view. */
function LibChip({ item }: { item: TrackedItem }) {
  const poster = cardImg(item, 'w92')
  const isSport = item.mediaType === 'sport'
  return (
    <Link to={`/item/${encodeURIComponent(item.id)}`} className="lib-chip" title={item.title}>
      {poster ? (
        <img
          className={`lib-chip__img${isSport ? ' lib-chip__img--logo' : ''}`}
          src={poster}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="lib-chip__img lib-chip__img--ph">{mediaEmoji(item)}</div>
      )}
      <span className="lib-chip__title">{item.title}</span>
    </Link>
  )
}

/** A favorited custom list as a full-view poster card (links to the list page). */
function FavListCard({ list }: { list: CustomList }) {
  return (
    <li className="poster-cell">
      <Link to={`/list/${list.id}`} className="poster-card" title={list.name}>
        {list.poster ? (
          <img className="poster-card__img" src={list.poster} alt="" loading="lazy" />
        ) : (
          <ListCollage items={list.items} className="poster-card__img" />
        )}
        <span className="poster-card__title">{list.name}</span>
      </Link>
    </li>
  )
}

/** A favorited custom list as a compact collapsed-view chip. */
function FavListChip({ list }: { list: CustomList }) {
  return (
    <Link to={`/list/${list.id}`} className="lib-chip" title={list.name}>
      {list.poster ? (
        <img className="lib-chip__img" src={list.poster} alt="" loading="lazy" />
      ) : (
        <ListCollage items={list.items} className="lib-chip__img" />
      )}
      <span className="lib-chip__title">{list.name}</span>
    </Link>
  )
}

/** Toggle between the full poster grid and the compact collapsed view. */
function ViewToggle({ collapsed, onChange }: { collapsed: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`sort-btn${collapsed ? ' filter-btn--active' : ''}`}
      aria-pressed={collapsed}
      title={collapsed ? 'Full view' : 'Collapsed view'}
      aria-label={collapsed ? 'Switch to full view' : 'Switch to collapsed view'}
      onClick={() => onChange(!collapsed)}
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
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    </button>
  )
}

/** Icon-only sort control: an up/down-arrows button that opens a small menu. */
function SortMenu({ sort, onChange }: { sort: SortKey; onChange: (s: SortKey) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="sort" ref={ref}>
      <button
        type="button"
        className="sort-btn"
        aria-label="Sort"
        aria-expanded={open}
        title="Sort"
        onClick={() => setOpen((o) => !o)}
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
          <path d="M8 3v18" />
          <path d="M4 7l4-4 4 4" />
          <path d="M16 21V3" />
          <path d="M12 17l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="sort-menu" role="menu">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={sort === k}
              className={`sort-menu__item${sort === k ? ' sort-menu__item--on' : ''}`}
              onClick={() => {
                onChange(k)
                setOpen(false)
              }}
            >
              {SORT_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PosterGrid({ items, leading }: { items: TrackedItem[]; leading?: ReactNode }) {
  return (
    <ul className="poster-grid">
      {leading}
      {items.map((item) => (
        <li key={item.id} className="poster-cell">
          <Link
            to={`/item/${encodeURIComponent(item.id)}`}
            className="poster-card"
            title={item.title}
          >
            <CardArt item={item} />
            <span className="poster-card__title">{item.title}</span>
            {item.userRating !== undefined && (
              <span className="poster-card__rating">★ {item.userRating}</span>
            )}
          </Link>
          <button
            className={`fav-star${item.favorite ? ' fav-star--on' : ''}`}
            title={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            aria-label={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={() => void toggleFavorite(item.id, !item.favorite)}
          >
            {item.favorite ? '★' : '☆'}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Watching section: each show card gets a "next unwatched episode" strip. */
function WatchingGrid({
  items,
  pickNextEp,
  scheduledAir,
  airstampOf,
  showNextCard,
  leading,
}: {
  items: TrackedItem[]
  pickNextEp: (id: string) => CachedEpisode | null
  scheduledAir: (i: TrackedItem) => string | undefined
  airstampOf: (itemId: string, season: number, episode: number) => string | undefined
  /** Which items get the next-episode strip. Omitted = every item (the Watching
   *  and Hiatus sections); Favorites passes a predicate so only watching shows/
   *  teams show it. */
  showNextCard?: (item: TrackedItem) => boolean
  /** Extra cards rendered before the items (Favorites' lists + Watch Next). */
  leading?: ReactNode
}) {
  return (
    <ul className="poster-grid">
      {leading}
      {items.map((item) => {
        const wantsCard = showNextCard ? showNextCard(item) : true
        const next =
          wantsCard && (item.mediaType === 'show' || item.mediaType === 'sport')
            ? pickNextEp(item.id)
            : null
        // No cached next episode? Fall back to a known upcoming air date (a show
        // kept active by nextAirDate) rather than "Nothing scheduled".
        const scheduled = next ? undefined : scheduledAir(item)
        const to = `/item/${encodeURIComponent(item.id)}`
        return (
          <li key={item.id} className="poster-cell watching-cell">
            <Link to={to} className="watching-art" aria-label={item.title} title={item.title}>
              <CardArt item={item} />
            </Link>
            <button
              className={`fav-star${item.favorite ? ' fav-star--on' : ''}`}
              title={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
              aria-label={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
              onClick={() => void toggleFavorite(item.id, !item.favorite)}
            >
              {item.favorite ? '★' : '☆'}
            </button>
            {/* Next-episode card tucked behind the poster, then the title. In the
                Watching/Hiatus sections every item gets it (even "Nothing
                scheduled") so cards stay the same height; Favorites shows it only
                for a watching show/team, so other favorites render just the
                poster. */}
            {wantsCard &&
              (next ? (
                <NextEpCard
                  item={item}
                  ep={next}
                  airstamp={airstampOf(item.id, next.season, next.episode)}
                />
              ) : scheduled ? (
                <div className="next-ep">
                  <span className="next-ep__label">Next episode</span>
                  <span className="next-ep__date">{formatNextAir(scheduled)}</span>
                </div>
              ) : (
                <div className="next-ep next-ep--empty">
                  <span className="next-ep__label">Nothing scheduled</span>
                </div>
              ))}
            <Link to={to} className="poster-card__title watching-title" title={item.title}>
              {item.title}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function NextEpCard({
  item,
  ep,
  airstamp,
}: {
  item: TrackedItem
  ep: CachedEpisode
  airstamp?: string
}) {
  // For a sport, use ESPN's completed flag (a past-dated game ESPN never finished
  // is "unaired", not watchable); for a show, prefer the precise air time.
  const isSport = item.mediaType === 'sport'
  const sportState = isSport ? sportAirState(ep.airDate, ep.completed) : null
  const aired = isSport ? sportState === 'aired' : hasAiredByTime(ep.airDate, airstamp)
  const label =
    isSport
      ? ep.name || 'Next game'
      : `S${ep.season}E${ep.episode}${ep.name ? ` · ${ep.name}` : ''}`
  return (
    <div className="next-ep">
      <span className="next-ep__label" title={label}>
        {label}
      </span>
      {aired ? (
        <button
          className="next-ep__check"
          title="Mark watched"
          aria-label={`Mark S${ep.season}E${ep.episode} watched`}
          onClick={() => void markEpisode(item.id, ep.season, ep.episode, true)}
        >
          ✓
        </button>
      ) : sportState === 'unaired' ? (
        <span className="next-ep__date next-ep__date--unaired" title="ESPN hasn’t posted a result">
          Unaired · {ep.airDate}
        </span>
      ) : (
        <span className="next-ep__date">{formatNextAir(ep.airDate, airstamp)}</span>
      )}
    </div>
  )
}
