import { useEffect, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useSearchParams } from 'react-router-dom'
import {
  discover,
  getCreditEpisodes,
  getGenreMap,
  getImdbId,
  getMovieDetails,
  getPersonCredits,
  getRecommendations,
  getSeriesByName,
  getTitleBrief,
  getTrending,
  getTvDetails,
  getWatchProviders,
  hasTmdbToken,
  imageUrl,
  isEndedStatus,
  languageKind,
  runtimeOf,
  searchMulti,
  searchPerson,
  watchNames,
  type CreditEpisode,
  type TmdbMediaResult,
  type TmdbRecommendation,
} from '../api/tmdb'
import { db, itemKey } from '../data/db'
import { addItem, seenState } from '../data/library'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { usePersistentFilter } from '../hooks/usePersistentFilter'
import { matchesFilter, parseQuery } from '../utils/filter'
import { hasDiscoverFilters, newReleasesParams, planDiscover, resolveProviderIds } from '../utils/discover'
import { useFavoritePeople } from '../data/favorites'
import { useFavoriteServices } from '../data/services'
import {
  ESPN_LEAGUES,
  espnGameUrl,
  getEspnScoreboard,
  leaguesForKeys,
  searchEspnTeams,
  type EspnScoreGame,
  type EspnTeamHit,
} from '../api/espn'
import { getUniverseByName } from '../api/wikidata'
import { addSportTeam, sportItemId } from '../data/sports'
import { useEnabledLeagues } from '../data/sportPrefs'
import FilterBar from '../components/FilterBar'
import Recommendations from '../components/Recommendations'
import type { MediaType } from '../data/types'

const HOUR = 1000 * 60 * 60
// Results are revealed a page at a time so an actor's credits only poll TMDB
// (for guest-appearance episodes) as far down the list as you actually look.
const PAGE = 12

/** TMDB uses 'tv'; our domain uses 'show'. */
function toMediaType(r: TmdbMediaResult): MediaType {
  return r.media_type === 'tv' ? 'show' : 'movie'
}

function resultTitle(r: TmdbMediaResult): string {
  return r.title || r.name || 'Untitled'
}

function resultYear(r: TmdbMediaResult): number | undefined {
  const date = r.release_date || r.first_air_date
  const year = date ? Number(date.slice(0, 4)) : NaN
  return Number.isFinite(year) ? year : undefined
}

/** Whether a result has been released/aired (true), is still upcoming (false),
 *  or has no known date (undefined — so the Released filter leaves it alone). */
function releaseState(r: TmdbMediaResult): boolean | undefined {
  const date = r.release_date || r.first_air_date
  if (!date) return undefined
  return date.slice(0, 10) <= new Date().toISOString().slice(0, 10)
}

export default function Search() {
  const [input, setInput] = usePersistentFilter('tvtracker.filter.search')
  const query = useDebouncedValue(input, 350)
  const [addingId, setAddingId] = useState<number | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const [loadingMore, setLoadingMore] = useState(false)
  // Filter-only "discover" browse (no title typed): run on demand via the play
  // button / Enter. `discoverRun` holds the query that was last run.
  const [discoverRun, setDiscoverRun] = useState('')
  const [discoverPages, setDiscoverPages] = useState(1)
  const [discoverVisible, setDiscoverVisible] = useState(PAGE)
  // Today (YYYY-MM-DD), computed once — lazy init keeps Date out of render.
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  // Prefill from a ?q= link (e.g. the cast links on the detail page).
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const q = searchParams.get('q')
    if (q !== null) setInput(q)
  }, [searchParams])

  // A new query collapses the list back to the first page.
  useEffect(() => {
    setVisibleCount(PAGE)
  }, [query])

  // Live set of ids already in the library, so results can show "in library".
  const trackedIds = useLiveQuery(() => db.trackedItems.toCollection().primaryKeys(), [])
  const trackedSet = new Set(trackedIds ?? [])

  // The free-text part drives the TMDB search; the tokens filter / redirect it.
  const parsed = parseQuery(query)
  const searchText = parsed.text
  const actorName = parsed.actors[0] // actor: switches to person-credit search
  const seriesName = parsed.series[0] // series: shows a movie franchise
  const teamName = parsed.teams[0] // team: switches to ESPN sports-team search

  const enabledLeagues = useEnabledLeagues()

  // Sports mode: a team: or game: token, or the Sports type selected. Searches
  // ESPN instead of TMDB, and replaces the usual TMDB sections.
  const sportMode =
    !actorName &&
    !seriesName &&
    (parsed.teams.length > 0 ||
      parsed.games.length > 0 ||
      (parsed.types.length === 1 && parsed.types[0] === 'sport'))
  // A game: filter (with no specific team typed) browses those leagues' games;
  // otherwise sport mode finds teams to add.
  const gameBrowse = sportMode && parsed.games.length > 0 && !teamName
  // The enabled leagues the game: filter resolves to (by key or label). Empty
  // when no game: token is set.
  const gameLeagueKeys = ESPN_LEAGUES.filter(
    (l) =>
      enabledLeagues.includes(l.key) &&
      parsed.games.some((g) => g === l.key || l.label.toLowerCase().includes(g)),
  ).map((l) => l.key)
  // Team search honors the game: filter — a league picked there limits which
  // leagues are searched (so "Nebraska" + College Football excludes volleyball).
  const teamSearchKeys = parsed.games.length ? gameLeagueKeys : enabledLeagues
  const sportQuery = teamName ?? searchText
  const sportSearch = useQuery({
    queryKey: ['espn-team-search', sportQuery, teamSearchKeys.join(',')],
    queryFn: () => searchEspnTeams(sportQuery, teamSearchKeys),
    enabled: sportMode && !gameBrowse && sportQuery.length >= 2,
    staleTime: HOUR,
  })

  // Game browse: pull each selected league's current scoreboard. The released:
  // filter keeps aired / upcoming.
  const browseLeagues = gameBrowse ? leaguesForKeys(gameLeagueKeys) : []
  const scoreboardQueries = useQueries({
    queries: browseLeagues.map((l) => ({
      queryKey: ['espn-scoreboard', l.key],
      queryFn: () => getEspnScoreboard(l.key),
      staleTime: HOUR,
    })),
  })
  const browseGames: EspnScoreGame[] = []
  if (gameBrowse) {
    for (const q of scoreboardQueries) {
      for (const g of q.data ?? []) {
        const aired = g.completed || g.date.slice(0, 10) < today
        // released: filter (single pick restricts; both/none = all).
        if (parsed.released.length === 1) {
          if (parsed.released[0] === 'aired' && !aired) continue
          if (parsed.released[0] === 'upcoming' && aired) continue
        }
        // Free text filters by either team's name.
        if (searchText) {
          const hay = `${g.name} ${g.home?.name ?? ''} ${g.away?.name ?? ''}`.toLowerCase()
          if (!hay.includes(searchText)) continue
        }
        browseGames.push(g)
      }
    }
    browseGames.sort((a, b) => a.date.localeCompare(b.date))
  }
  const browseFetching = gameBrowse && scoreboardQueries.some((q) => q.isFetching)

  // Filter-only browse: tokens but no free text / actor / series / team. Runs only
  // once the user hits the play button (or Enter), since it's a heavier query.
  const filterOnly =
    !sportMode && !searchText && !actorName && !seriesName && hasDiscoverFilters(parsed)
  const discoverActive = filterOnly && discoverRun === query && query.length > 0
  const runDiscover = () => setDiscoverRun(query)
  // A fresh run (new filters) starts over at page 1 / first dozen.
  useEffect(() => {
    setDiscoverPages(1)
    setDiscoverVisible(PAGE)
  }, [discoverRun])

  const textQuery = useQuery({
    queryKey: ['search', searchText],
    queryFn: () => searchMulti(searchText),
    enabled: hasTmdbToken() && !actorName && !seriesName && searchText.length > 0,
  })
  const actorQuery = useQuery({
    queryKey: ['actor', actorName],
    queryFn: async () => {
      const personId = await searchPerson(actorName)
      return personId ? getPersonCredits(personId) : []
    },
    enabled: hasTmdbToken() && !!actorName && !seriesName,
  })
  const seriesQuery = useQuery({
    queryKey: ['series-search', seriesName],
    queryFn: async (): Promise<TmdbMediaResult[]> => {
      const parts = await getSeriesByName(seriesName)
      const results: TmdbMediaResult[] = parts.map((p) => ({
        id: p.id,
        media_type: 'movie',
        title: p.title,
        poster_path: p.poster_path,
        release_date: p.release_date ?? undefined,
      }))
      // Broaden with Wikidata shared-universe siblings (brings in TV + any films
      // outside the TMDB collection — e.g. the Chucky series for Child's Play).
      const seen = new Set(results.map((r) => `movie:${r.id}`))
      const extras = (await getUniverseByName(seriesName)).filter(
        (m) => !seen.has(`${m.mediaType}:${m.tmdbId}`),
      )
      const briefs = await Promise.all(
        extras.map((m) => getTitleBrief(m.mediaType === 'show' ? 'tv' : 'movie', m.tmdbId)),
      )
      extras.forEach((m, i) => {
        const b = briefs[i]
        if (!b) return
        const year = b.year ? String(b.year) : undefined
        results.push(
          m.mediaType === 'show'
            ? { id: m.tmdbId, media_type: 'tv', name: b.title, poster_path: b.posterPath ?? null, first_air_date: year }
            : { id: m.tmdbId, media_type: 'movie', title: b.title, poster_path: b.posterPath ?? null, release_date: year },
        )
      })
      return results
    },
    enabled: hasTmdbToken() && !!seriesName,
    staleTime: HOUR,
  })

  const active = seriesName ? seriesQuery : actorName ? actorQuery : textQuery
  const allResults = active.data
  const isFetching = active.isFetching
  const isError = active.isError
  const error = active.error

  // Genre id -> name maps (so genre: tokens can match search results).
  const { data: genreMap } = useQuery({
    queryKey: ['genres'],
    queryFn: getGenreMap,
    staleTime: Infinity,
    enabled: hasTmdbToken(),
  })
  const resultGenres = (r: TmdbMediaResult): string[] => {
    const map = r.media_type === 'tv' ? genreMap?.tv : genreMap?.movie
    return (r.genre_ids ?? []).map((id) => map?.[id]).filter((n): n is string => Boolean(n))
  }

  // --- Top 10 this week -------------------------------------------------------
  // Shown below the results. A Top list is hidden when its type is filtered out
  // (e.g. type:movie hides Top Shows). Only the shown lists are fetched.
  const showMoviesTop = parsed.types.length === 0 || parsed.types.includes('movie')
  const showShowsTop = parsed.types.length === 0 || parsed.types.includes('show')
  const SIX_HOURS = HOUR * 6
  const trendingMovies = useQuery({
    queryKey: ['trending', 'movie'],
    queryFn: () => getTrending('movie'),
    staleTime: SIX_HOURS,
    enabled: hasTmdbToken() && showMoviesTop,
  })
  const trendingShows = useQuery({
    queryKey: ['trending', 'tv'],
    queryFn: () => getTrending('tv'),
    staleTime: SIX_HOURS,
    enabled: hasTmdbToken() && showShowsTop,
  })

  // Favorite services drive the "New on Your Services" row (recent releases now
  // streaming on them). Needs the provider id maps, fetched below.
  const favServices = useFavoriteServices()
  const newStreamingOn = favServices.length > 0

  // --- Recommended for you ----------------------------------------------------
  // Aggregate TMDB "recommendations" from the titles you've rated highly, tally
  // them (weighted by your rating), drop anything already tracked, and surface
  // the most-recommended. It needs a few ratings to be meaningful, so it stays
  // hidden until then — the Top 10 lists cover the cold start.
  const libraryItems = useLiveQuery(() => db.trackedItems.toArray(), [])
  // Watch state for the seen: filter — a tracked result uses its status, an
  // untracked one counts as unwatched (you haven't seen it).
  const statusById = new Map((libraryItems ?? []).map((i) => [i.id, i.status]))
  const seenFor = (r: TmdbMediaResult): 'watched' | 'unwatched' | 'dropped' => {
    const st = statusById.get(itemKey(toMediaType(r), r.id))
    return st ? seenState(st) : 'unwatched'
  }
  const ratedCount = (libraryItems ?? []).filter((i) => i.userRating !== undefined).length
  const recSeeds = (libraryItems ?? [])
    .filter((i) => (i.userRating ?? 0) >= 6)
    .sort((a, b) => (b.userRating ?? 0) - (a.userRating ?? 0))
    .slice(0, 8)
  const recommendOn = ratedCount >= 3 && recSeeds.length >= 1
  const recSeedQueries = useQueries({
    queries: recSeeds.map((s) => {
      const apiType = s.mediaType === 'show' ? 'tv' : 'movie'
      return {
        queryKey: ['recommendations', apiType, s.tmdbId],
        queryFn: () => getRecommendations(apiType, s.tmdbId),
        staleTime: SIX_HOURS,
        enabled: hasTmdbToken() && recommendOn,
      }
    }),
  })
  const recommendedForYou: TmdbRecommendation[] = []
  if (recommendOn) {
    const scored = new Map<string, { rec: TmdbRecommendation; score: number }>()
    recSeedQueries.forEach((q, i) => {
      const weight = recSeeds[i].userRating ?? 6
      for (const r of q.data ?? []) {
        if (!r.poster_path) continue
        const mt = r.media_type ?? (recSeeds[i].mediaType === 'show' ? 'tv' : 'movie')
        // Respect the page's type filter (same as the Top 10 lists).
        if (mt === 'movie' && !showMoviesTop) continue
        if (mt === 'tv' && !showShowsTop) continue
        // Skip anything already in the library.
        if (trackedSet.has(itemKey(mt === 'tv' ? 'show' : 'movie', r.id))) continue
        const key = `${mt}:${r.id}`
        const prev = scored.get(key)
        if (prev) prev.score += weight
        else scored.set(key, { rec: { ...r, media_type: mt }, score: weight })
      }
    })
    recommendedForYou.push(
      ...[...scored.values()].sort((a, b) => b.score - a.score).map((e) => e.rec),
    )
  }
  const hasRecommended = recommendOn && recommendedForYou.length > 0

  // --- Starring your favorites ------------------------------------------------
  // Titles featuring your starred actors that you haven't finished (completed)
  // or abandoned (dropped). Hidden while searching a specific actor — that view
  // already shows that actor's titles. Sorted by rating.
  const favoritePeople = useFavoritePeople()
  const starringOn = !actorName && (favoritePeople?.length ?? 0) > 0
  const favoriteCreditQueries = useQueries({
    queries: (starringOn ? (favoritePeople ?? []) : []).map((p) => ({
      queryKey: ['person-credits', p.id],
      queryFn: () => getPersonCredits(p.id),
      staleTime: SIX_HOURS,
      enabled: hasTmdbToken() && starringOn,
    })),
  })
  const starringForYou: TmdbMediaResult[] = []
  if (starringOn) {
    const excluded = new Set(
      (libraryItems ?? [])
        .filter((i) => i.status === 'completed' || i.status === 'dropped')
        .map((i) => i.id),
    )
    const seen = new Set<string>()
    for (const q of favoriteCreditQueries) {
      for (const r of q.data ?? []) {
        if (!r.poster_path) continue
        // Skip obscure credits (featurettes, making-ofs, self-appearances) that
        // rank high only because a handful of votes inflate their average.
        if ((r.vote_count ?? 0) < 50) continue
        const mt = r.media_type
        if (mt === 'movie' && !showMoviesTop) continue
        if (mt === 'tv' && !showShowsTop) continue
        if (excluded.has(itemKey(mt === 'tv' ? 'show' : 'movie', r.id))) continue
        const key = `${mt}:${r.id}`
        if (seen.has(key)) continue
        seen.add(key)
        starringForYou.push(r)
      }
    }
    starringForYou.sort((a, b) => (b.vote_average ?? -Infinity) - (a.vote_average ?? -Infinity))
  }
  const hasStarring = starringOn && starringForYou.length > 0

  // --- Filter-only discover ---------------------------------------------------
  // Provider lists (service name -> id) are only needed when a service filter is
  // part of the run, and are cached indefinitely.
  const parsedRun = parseQuery(discoverRun)
  const needProviders = discoverActive && parsedRun.services.length > 0
  const { data: movieProviders } = useQuery({
    queryKey: ['providers', 'movie'],
    queryFn: () => getWatchProviders('movie'),
    staleTime: Infinity,
    enabled: hasTmdbToken() && (needProviders || newStreamingOn),
  })
  const { data: tvProviders } = useQuery({
    queryKey: ['providers', 'tv'],
    queryFn: () => getWatchProviders('tv'),
    staleTime: Infinity,
    enabled: hasTmdbToken() && (needProviders || newStreamingOn),
  })
  // Hold off planning until the maps a run needs are loaded.
  const discoverReady =
    discoverActive &&
    !!genreMap &&
    (parsedRun.services.length === 0 || (!!movieProviders && !!tvProviders))
  const discoverPlans = discoverReady
    ? planDiscover(parsedRun, genreMap, {
        movie: movieProviders ?? [],
        tv: tvProviders ?? [],
      })
    : []
  // One query per (media type × page). Discover returns 20/page already sorted;
  // we fetch only as many pages as the user has paged into.
  const pageList = Array.from({ length: discoverPages }, (_, i) => i + 1)
  const discoverQueries = useQueries({
    queries: discoverPlans.flatMap((pl) =>
      pageList.map((pg) => ({
        queryKey: ['discover', pl.mediaType, discoverRun, pg],
        queryFn: () => discover(pl.mediaType, pl.params, pg),
        staleTime: HOUR,
      })),
    ),
  })
  // Merge the types, dedupe, and sort by the active key (rating or popularity).
  const discoverMerged: TmdbMediaResult[] = []
  if (discoverActive) {
    const seen = new Set<string>()
    for (const q of discoverQueries) {
      for (const r of q.data?.results ?? []) {
        const k = `${r.media_type}:${r.id}`
        if (seen.has(k)) continue
        // Language ("Foreign") and Seen can't be discover params, so apply them
        // here against each result's language / your watch state.
        if (parsedRun.languages.length === 1 && languageKind(r.original_language) !== parsedRun.languages[0]) {
          continue
        }
        if (parsedRun.seen.length) {
          const s = seenFor(r)
          if (s === 'dropped' || (parsedRun.seen.length === 1 && s !== parsedRun.seen[0])) continue
        }
        seen.add(k)
        discoverMerged.push(r)
      }
    }
    discoverMerged.sort(
      parsedRun.rating !== undefined
        ? (a, b) => (b.vote_average ?? -Infinity) - (a.vote_average ?? -Infinity)
        : (a, b) => (b.popularity ?? -Infinity) - (a.popularity ?? -Infinity),
    )
  }
  const discoverTotalPages = discoverQueries.reduce(
    (max, q) => Math.max(max, q.data?.total_pages ?? 0),
    0,
  )
  const discoverFetching = discoverActive && discoverQueries.some((q) => q.isFetching)
  const discoverErrored = discoverActive && discoverQueries.some((q) => q.isError)

  // --- New on Your Services ---------------------------------------------------
  // Recent releases now streaming on your favorite services (type filter applied).
  const favKey = favServices.join(',')
  const nowMovieIds =
    newStreamingOn && showMoviesTop && movieProviders
      ? resolveProviderIds(favServices, movieProviders)
      : []
  const nowTvIds =
    newStreamingOn && showShowsTop && tvProviders
      ? resolveProviderIds(favServices, tvProviders)
      : []
  const nowStreamingQueries = useQueries({
    queries: [
      ...(nowMovieIds.length
        ? [
            {
              queryKey: ['now-streaming', 'movie', favKey],
              queryFn: () => discover('movie', newReleasesParams('movie', nowMovieIds), 1),
              staleTime: SIX_HOURS,
            },
          ]
        : []),
      ...(nowTvIds.length
        ? [
            {
              queryKey: ['now-streaming', 'tv', favKey],
              queryFn: () => discover('tv', newReleasesParams('tv', nowTvIds), 1),
              staleTime: SIX_HOURS,
            },
          ]
        : []),
    ],
  })
  const nowStreaming: TmdbMediaResult[] = []
  if (newStreamingOn) {
    const seen = new Set<string>()
    for (const q of nowStreamingQueries) {
      for (const r of q.data?.results ?? []) {
        if (!r.poster_path) continue
        const key = `${r.media_type}:${r.id}`
        if (seen.has(key)) continue
        seen.add(key)
        nowStreaming.push(r)
      }
    }
    nowStreaming.sort((a, b) => (b.popularity ?? -Infinity) - (a.popularity ?? -Infinity))
  }
  const hasNowStreaming = newStreamingOn && nowStreaming.length > 0

  // service:, length:, and status: filtering need per-result details, so fetch
  // them for the shown results — but only when one of those tokens is in use.
  const needDetails =
    parsed.services.length > 0 ||
    parsed.servicesExclude.length > 0 ||
    parsed.lengths.length > 0 ||
    parsed.ended.length > 0
  const detailQueries = useQueries({
    queries: (allResults ?? []).map((r) => ({
      queryKey: [r.media_type === 'tv' ? 'tv' : 'movie', r.id],
      queryFn: () => (r.media_type === 'tv' ? getTvDetails(r.id) : getMovieDetails(r.id)),
      enabled: needDetails,
      staleTime: HOUR,
    })),
  })

  const filtered = (allResults ?? []).filter((r, i) => {
    const d = needDetails ? detailQueries[i]?.data : undefined
    const providers =
      parsed.services.length || parsed.servicesExclude.length ? (d ? watchNames(d) : []) : []
    const runtime = parsed.lengths.length ? (d ? runtimeOf(d) : undefined) : undefined
    const ended =
      parsed.ended.length && r.media_type === 'tv'
        ? d
          ? isEndedStatus(d.status)
          : undefined
        : undefined
    // In actor mode, the free text filters the actor's credits by title; in text
    // mode TMDB already handled the text, and the actor filter doesn't apply here.
    return matchesFilter(
      {
        title: resultTitle(r),
        genres: resultGenres(r),
        providers,
        runtime,
        ended,
        aired: releaseState(r),
        mediaType: toMediaType(r),
        seen: seenFor(r),
        language: languageKind(r.original_language),
        year: resultYear(r),
        rating: r.vote_average,
      },
      { ...parsed, actors: [], series: [], text: actorName || seriesName ? parsed.text : '' },
    )
  })

  // With a rating filter active, surface the best-scored results first.
  const searchResults =
    parsed.rating !== undefined
      ? [...filtered].sort(
          (a, b) =>
            (b.vote_average ?? -Infinity) - (a.vote_average ?? -Infinity) ||
            resultTitle(a).localeCompare(resultTitle(b)),
        )
      : filtered

  // Discover (filter-only) and text/actor/series search feed the same list.
  const results = discoverActive ? discoverMerged : searchResults
  const visibleResults = results.slice(0, discoverActive ? discoverVisible : visibleCount)
  const hasMore = discoverActive
    ? discoverVisible < discoverMerged.length || discoverPages < discoverTotalPages
    : results.length > visibleResults.length

  // In actor mode, pull each shown TV credit's specific episodes so guest /
  // recurring appearances can be listed. TMDB returns episodes only for guests;
  // series regulars come back empty (so no appearances strip). Scoped to the
  // visible page — this is person-per-show data TMDB keeps only in the credit
  // detail, so it can't come from our local index even for library titles.
  const creditSource = actorName ? visibleResults : []
  const creditQueries = useQueries({
    queries: creditSource.map((r) => ({
      queryKey: ['credit-eps', r.credit_id],
      queryFn: () => getCreditEpisodes(r.credit_id as string),
      enabled: r.media_type === 'tv' && !!r.credit_id,
      staleTime: HOUR,
    })),
  })
  const creditEpsByCreditId = new Map<string, CreditEpisode[]>()
  creditSource.forEach((r, i) => {
    const data = creditQueries[i]?.data
    if (r.credit_id && data) creditEpsByCreditId.set(r.credit_id, data)
  })

  // Reveal the next page after a brief beat, so the new rows' credit lookups
  // don't all fire the instant the button is pressed.
  function showMore() {
    if (discoverActive) {
      // Fetch another page of each type only when we're about to run past what's
      // already loaded; otherwise just reveal more of what we have.
      const next = discoverVisible + PAGE
      if (next > discoverMerged.length && discoverPages < discoverTotalPages) {
        setDiscoverPages((p) => p + 1)
      }
      setDiscoverVisible(next)
      return
    }
    setLoadingMore(true)
    window.setTimeout(() => {
      setVisibleCount((n) => n + PAGE)
      setLoadingMore(false)
    }, 300)
  }

  async function handleAdd(r: TmdbMediaResult) {
    setAddingId(r.id)
    try {
      // Fetch the IMDb id so the detail page's IMDb link works; don't fail the
      // add if that lookup errors.
      const imdbId = await getImdbId(r.media_type, r.id).catch(() => undefined)
      await addItem({
        tmdbId: r.id,
        mediaType: toMediaType(r),
        title: resultTitle(r),
        imdbId,
        posterPath: r.poster_path ?? undefined,
        year: resultYear(r),
        status: 'watchlist',
      })
    } finally {
      setAddingId(null)
    }
  }

  if (!hasTmdbToken()) {
    return (
      <div className="placeholder">
        <h2>Search</h2>
        <p className="badge badge--warn">
          TMDB token not set — add VITE_TMDB_TOKEN to .env (local) or the repo secret (deploy).
        </p>
      </div>
    )
  }

  return (
    <div className="search">
      <FilterBar
        value={input}
        onChange={setInput}
        placeholder="Search for a title, or filter and press ▶"
        autoFocus
        sportsOptIn
        onSubmit={() => filterOnly && runDiscover()}
      >
        {filterOnly && (
          <button
            type="button"
            className="run-btn"
            title="Run filter search"
            aria-label="Run filter search"
            onClick={runDiscover}
            disabled={discoverActive && discoverFetching}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        )}
      </FilterBar>

      {gameBrowse ? (
        <SportGameResults games={browseGames} fetching={browseFetching} noLeagues={browseLeagues.length === 0} />
      ) : sportMode ? (
        <SportTeamResults
          query={sportQuery}
          hits={sportSearch.data ?? []}
          fetching={sportSearch.isFetching}
          trackedSet={trackedSet}
        />
      ) : (
       <>
      {(isFetching || discoverFetching) && <p className="muted">Searching…</p>}
      {isError && (
        <p className="badge badge--warn">
          {error instanceof Error ? error.message : 'Search failed.'}
        </p>
      )}
      {discoverErrored && <p className="badge badge--warn">Couldn’t load those results.</p>}
      {filterOnly && !discoverActive && (
        <p className="muted">Press ▶ to browse everything matching these filters.</p>
      )}
      {results.length === 0 && (searchText || seriesName) && !isFetching && (
        <p className="muted">No results for “{seriesName ? `series: ${seriesName}` : searchText}”.</p>
      )}
      {discoverActive && !discoverFetching && results.length === 0 && (
        <p className="muted">No titles match those filters.</p>
      )}

      <ul className="result-list">
        {visibleResults.map((r) => {
          const id = itemKey(toMediaType(r), r.id)
          const added = trackedSet.has(id)
          const poster = imageUrl(r.poster_path ?? undefined, 'w92')
          const inner = (
            <>
              {poster ? (
                <img className="result-row__poster" src={poster} alt="" loading="lazy" />
              ) : (
                <div className="result-row__poster result-row__poster--placeholder">
                  {r.media_type === 'movie' ? '🎬' : '📺'}
                </div>
              )}
              <div className="result-row__info">
                <span className="result-row__title">
                  {resultTitle(r)}
                  {resultYear(r) && <span className="muted"> ({resultYear(r)})</span>}
                </span>
                <span className="type-badge">{r.media_type === 'tv' ? 'TV' : 'Movie'}</span>
                {r.overview && <span className="muted result-row__overview">{r.overview}</span>}
              </div>
            </>
          )
          // Guest/recurring appearances (actor mode, TV only) — series regulars
          // come back with no episodes, so this strip is skipped for main cast.
          const appearances =
            actorName && r.media_type === 'tv' && r.credit_id
              ? creditEpsByCreditId.get(r.credit_id) ?? []
              : []
          return (
            <li key={`${r.media_type}:${r.id}`} className="result-item">
              <div className="result-row">
                {/* Tiles always link to the detail page — a preview before adding,
                    the full tracking view once in the library. */}
                <Link to={`/item/${encodeURIComponent(id)}`} className="result-row__link">
                  {inner}
                </Link>
                <button
                  className="btn btn--small"
                  disabled={added || addingId === r.id}
                  onClick={() => void handleAdd(r)}
                >
                  {added ? '✓ In library' : addingId === r.id ? 'Adding…' : 'Add'}
                </button>
              </div>
              {appearances.length > 0 && (
                <div className="appearances">
                  <span className="appearances__label">Appearances</span>
                  <span className="appearances__eps">
                    {appearances.map((ep, i) => (
                      <span key={`${ep.season_number}:${ep.episode_number}`}>
                        {i > 0 && <span className="appearances__sep">, </span>}
                        <Link
                          className="appearances__ep"
                          to={`/item/${encodeURIComponent(id)}/episode/${ep.season_number}/${ep.episode_number}`}
                          title={ep.name || undefined}
                        >
                          S{String(ep.season_number).padStart(2, '0')}E
                          {String(ep.episode_number).padStart(2, '0')}
                        </Link>
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <div className="show-more">
          <button
            className="btn btn--ghost"
            onClick={showMore}
            disabled={loadingMore || discoverFetching}
          >
            {discoverActive
              ? discoverFetching
                ? 'Loading…'
                : 'Show more'
              : loadingMore
                ? 'Loading…'
                : `Show more (${results.length - visibleResults.length})`}
          </button>
        </div>
      )}

      {(hasRecommended || hasStarring || hasNowStreaming || showMoviesTop || showShowsTop) && (
        <section className="search__top">
          {hasRecommended && (
            <Recommendations
              recs={recommendedForYou}
              mediaType="movie"
              title="Recommended for You"
              limit={12}
              defaultOpen
            />
          )}
          {hasStarring && (
            <Recommendations
              recs={starringForYou}
              mediaType="movie"
              title="Starring Your Favorites"
              limit={12}
              defaultOpen
            />
          )}
          {hasNowStreaming && (
            <Recommendations
              recs={nowStreaming}
              mediaType="movie"
              title="Now Streaming"
              limit={12}
              defaultOpen
            />
          )}
          {showMoviesTop && (
            <Recommendations
              recs={trendingMovies.data ?? []}
              mediaType="movie"
              title="Top 10 Movies This Week"
              limit={10}
              defaultOpen
            />
          )}
          {showShowsTop && (
            <Recommendations
              recs={trendingShows.data ?? []}
              mediaType="tv"
              title="Top 10 Shows This Week"
              limit={10}
              defaultOpen
            />
          )}
        </section>
      )}
       </>
      )}
    </div>
  )
}

/** Sports mode: ESPN team hits (one per supported league for each matched school),
 *  linking to the team's detail page with an Add button. */
function SportTeamResults({
  query,
  hits,
  fetching,
  trackedSet,
}: {
  query: string
  hits: EspnTeamHit[]
  fetching: boolean
  trackedSet: Set<string>
}) {
  const [addingId, setAddingId] = useState<string | null>(null)
  if (query.length < 2) {
    return <p className="muted">Type a team name to find a team (e.g. Nebraska).</p>
  }
  return (
    <>
      {fetching && <p className="muted">Searching teams…</p>}
      {!fetching && hits.length === 0 && <p className="muted">No teams found for “{query}”.</p>}
      <ul className="result-list">
        {hits.map((h) => {
          const id = sportItemId(h.leagueKey, h.teamId)
          const added = trackedSet.has(id)
          const addKey = `${h.leagueKey}:${h.teamId}`
          return (
            <li key={addKey} className="result-item">
              <div className="result-row">
                <Link to={`/item/${encodeURIComponent(id)}`} className="result-row__link">
                  {h.logo ? (
                    <img className="result-row__poster" src={h.logo} alt="" loading="lazy" />
                  ) : (
                    <div className="result-row__poster result-row__poster--placeholder">
                      {h.leagueEmoji}
                    </div>
                  )}
                  <div className="result-row__info">
                    <span className="result-row__title">{h.teamName}</span>
                    <span className="type-badge">
                      {h.leagueEmoji} {h.leagueLabel}
                    </span>
                  </div>
                </Link>
                <button
                  className="btn btn--small"
                  disabled={added || addingId === addKey}
                  onClick={() => {
                    setAddingId(addKey)
                    void addSportTeam({
                      league: h.leagueKey,
                      teamId: h.teamId,
                      teamName: h.teamName,
                      logo: h.logo,
                    }).finally(() => setAddingId(null))
                  }}
                >
                  {added ? '✓ In library' : addingId === addKey ? 'Adding…' : 'Add'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** Game browse (game: filter): a league's current scoreboard, each game linking
 *  to its ESPN page. Informational — teams are what get tracked, not games. */
function SportGameResults({
  games,
  fetching,
  noLeagues,
}: {
  games: EspnScoreGame[]
  fetching: boolean
  noLeagues: boolean
}) {
  if (noLeagues) {
    return (
      <p className="muted">
        None of those leagues are enabled. Turn them on in Settings → Sports, then try again.
      </p>
    )
  }
  const leagueEmoji = (key: string) => ESPN_LEAGUES.find((l) => l.key === key)?.emoji ?? '🏅'
  return (
    <>
      {fetching && <p className="muted">Loading games…</p>}
      {!fetching && games.length === 0 && (
        <p className="muted">No games match those filters right now.</p>
      )}
      <ul className="result-list">
        {games.map((g) => {
          const url = espnGameUrl(g.leagueKey, g.id, g.date)
          const when = g.date.slice(0, 10)
          const aired = g.completed
          const score = aired && g.away?.score != null && g.home?.score != null
            ? ` · ${g.away.abbrev ?? 'Away'} ${g.away.score}–${g.home.score} ${g.home.abbrev ?? 'Home'}`
            : ''
          return (
            <li key={`${g.leagueKey}:${g.id}`} className="result-item">
              <div className="result-row">
                <a
                  className="result-row__link"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="result-row__poster result-row__poster--placeholder">
                    {leagueEmoji(g.leagueKey)}
                  </div>
                  <div className="result-row__info">
                    <span className="result-row__title">
                      {g.away?.name ?? 'Away'} <span className="muted">at</span> {g.home?.name ?? 'Home'}
                    </span>
                    <span className="type-badge">
                      {aired ? 'Final' : 'Upcoming'} · {when}
                      {g.week ? ` · ${g.week}` : ''}
                      {score}
                    </span>
                  </div>
                </a>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
