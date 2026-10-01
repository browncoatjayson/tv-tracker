import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getSeasonEpisodes,
  getTvDetails,
  hasAired,
  type TmdbSeasonSummary,
} from '../api/tmdb'
import { db } from '../data/db'
import { markEpisode } from '../data/library'
import type { TrackedItem } from '../data/types'

// Order seasons ascending, but push "Specials" (season 0) to the end.
function sortSeasons(seasons: TmdbSeasonSummary[]): TmdbSeasonSummary[] {
  return [...seasons]
    .filter((s) => s.episode_count > 0)
    .sort((a, b) => {
      if (a.season_number === 0) return 1
      if (b.season_number === 0) return -1
      return a.season_number - b.season_number
    })
}

function seasonLabel(s: TmdbSeasonSummary): string {
  return s.season_number === 0 ? 'Specials' : s.name || `Season ${s.season_number}`
}

/**
 * Decide which season to auto-expand:
 *  - If you've watched episodes, expand the season you're resuming: the highest
 *    season with any watched episode, or the next season if that one is finished.
 *  - If you've watched nothing, fall back to the season of the next upcoming
 *    episode (so returning shows surface "what's next"), or nothing for an ended
 *    show you haven't started.
 * Uses only watched counts + season episode counts, so it needs no extra fetches.
 */
function pickExpandSeason(
  seasons: TmdbSeasonSummary[],
  watchedPerSeason: Map<number, number>,
  nextUpcomingSeason: number | null,
): number | null {
  const regular = seasons.filter((s) => s.season_number > 0) // ignore Specials
  const watched = regular.filter((s) => (watchedPerSeason.get(s.season_number) ?? 0) > 0)

  if (watched.length === 0) return nextUpcomingSeason

  const current = watched[watched.length - 1] // highest season with progress
  const watchedInCurrent = watchedPerSeason.get(current.season_number) ?? 0
  if (watchedInCurrent < current.episode_count) {
    return current.season_number // partway through this season
  }
  // Current season finished — move to the next season, if there is one.
  const next = regular.find((s) => s.season_number > current.season_number)
  return next ? next.season_number : nextUpcomingSeason
}

export default function ShowEpisodes({ item }: { item: TrackedItem }) {
  const {
    data: details,
    isLoading,
    isError,
    error,
  } = useQuery({ queryKey: ['tv', item.tmdbId], queryFn: () => getTvDetails(item.tmdbId) })

  // Watched state for every episode of this show, keyed "season:episode".
  // `states` is undefined until the first read resolves.
  const states = useLiveQuery(
    () => db.episodeStates.where('itemId').equals(item.id).toArray(),
    [item.id],
  )
  const watchedMap = new Map<string, boolean>()
  const watchedPerSeason = new Map<number, number>()
  let watchedCount = 0
  for (const s of states ?? []) {
    watchedMap.set(`${s.season}:${s.episode}`, s.watched)
    if (s.watched) {
      watchedCount += 1
      watchedPerSeason.set(s.season, (watchedPerSeason.get(s.season) ?? 0) + 1)
    }
  }

  // Auto-expand + scroll-to happen once, after BOTH the show details and the
  // initial watched state have loaded (so the resume calculation is correct).
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [scrollTarget, setScrollTarget] = useState<number | null>(null)
  const didAutoExpand = useRef(false)
  useEffect(() => {
    if (didAutoExpand.current || !details || states === undefined) return
    didAutoExpand.current = true
    const target = pickExpandSeason(
      sortSeasons(details.seasons),
      watchedPerSeason,
      details.next_episode_to_air?.season_number ?? null,
    )
    if (target != null) {
      setExpanded(new Set([target]))
      setScrollTarget(target)
    }
    // watchedPerSeason is derived from `states`; depending on `states` is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, states])

  if (isLoading) return <p className="muted">Loading episodes…</p>
  if (isError) {
    return (
      <p className="badge badge--warn">
        {error instanceof Error ? error.message : 'Could not load episodes.'}
      </p>
    )
  }
  if (!details) return null

  const seasons = sortSeasons(details.seasons)

  function toggle(seasonNumber: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(seasonNumber)) next.delete(seasonNumber)
      else next.add(seasonNumber)
      return next
    })
  }

  return (
    <section className="episodes">
      <div className="episodes__progress">
        <strong>{watchedCount}</strong> / {details.number_of_episodes} episodes watched
      </div>

      {seasons.map((season) => (
        <SeasonSection
          key={season.season_number}
          item={item}
          season={season}
          isOpen={expanded.has(season.season_number)}
          onToggle={() => toggle(season.season_number)}
          watchedMap={watchedMap}
          scrollIntoViewOnLoad={season.season_number === scrollTarget}
        />
      ))}
    </section>
  )
}

function SeasonSection({
  item,
  season,
  isOpen,
  onToggle,
  watchedMap,
  scrollIntoViewOnLoad,
}: {
  item: TrackedItem
  season: TmdbSeasonSummary
  isOpen: boolean
  onToggle: () => void
  watchedMap: Map<string, boolean>
  scrollIntoViewOnLoad: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Episodes are fetched lazily — only once the season is first opened.
  const { data: episodes, isLoading } = useQuery({
    queryKey: ['season', item.tmdbId, season.season_number],
    queryFn: () => getSeasonEpisodes(item.tmdbId, season.season_number),
    enabled: isOpen,
  })

  // Scroll this season into view only AFTER its episodes have rendered, so the
  // layout has settled and we land in the right place (fixes the short-scroll).
  const didScroll = useRef(false)
  useEffect(() => {
    if (scrollIntoViewOnLoad && isOpen && episodes && !didScroll.current) {
      didScroll.current = true
      rootRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [scrollIntoViewOnLoad, isOpen, episodes])

  const watchedInSeason = (episodes ?? []).filter(
    (ep) => watchedMap.get(`${ep.season_number}:${ep.episode_number}`),
  ).length

  async function markSeasonWatched() {
    if (!episodes) return
    for (const ep of episodes) {
      if (hasAired(ep.air_date)) {
        await markEpisode(item.id, ep.season_number, ep.episode_number, true)
      }
    }
  }

  return (
    <div className="season" ref={rootRef}>
      <button className="season__header" onClick={onToggle} aria-expanded={isOpen}>
        <span className="season__chevron" aria-hidden="true">
          {isOpen ? '▾' : '▸'}
        </span>
        <span className="season__name">{seasonLabel(season)}</span>
        <span className="season__meta muted">
          {episodes ? `${watchedInSeason}/${episodes.length}` : `${season.episode_count} eps`}
        </span>
      </button>

      {isOpen && (
        <div className="season__body">
          {isLoading && <p className="muted">Loading…</p>}
          {episodes && (
            <>
              <button className="btn btn--small btn--ghost" onClick={() => void markSeasonWatched()}>
                Mark aired episodes watched
              </button>
              <ul className="episode-list">
                {episodes.map((ep) => {
                  const aired = hasAired(ep.air_date)
                  const watched = watchedMap.get(`${ep.season_number}:${ep.episode_number}`) ?? false
                  return (
                    <li key={ep.episode_number} className="episode">
                      <label className="episode__label">
                        <input
                          type="checkbox"
                          checked={watched}
                          disabled={!aired}
                          onChange={(e) =>
                            void markEpisode(
                              item.id,
                              ep.season_number,
                              ep.episode_number,
                              e.target.checked,
                            )
                          }
                        />
                        <span className="episode__num">
                          S{ep.season_number}E{ep.episode_number}
                        </span>
                        <span className="episode__title">{ep.name}</span>
                      </label>
                      {aired ? (
                        <span className="episode__date muted">{ep.air_date}</span>
                      ) : (
                        <span className="episode__upcoming">
                          {ep.air_date ? `Upcoming · ${ep.air_date}` : 'TBA'}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
