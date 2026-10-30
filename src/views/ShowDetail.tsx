import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../data/db'
import {
  castNames,
  genreNames,
  getImages,
  getImdbId,
  getRecommendations,
  getVideos,
  imageUrl,
  isEndedStatus,
  runtimeOf,
  watchNames,
  type TmdbEpisode,
  type TmdbSeasonSummary,
} from '../api/tmdb'
import { getShowAkas } from '../api/tvmaze'
import { getSeasonEpisodesCached, getTvDetailsCached } from '../data/episodeCache'
import { classifySpecials } from '../data/specials'
import { hasTraktClientId, resolveTraktId } from '../api/trakt'
import {
  addItem,
  markEpisode,
  removeItem,
  setEpisodeWatchCount,
  setItemMeta,
  setRating,
  setStatus,
} from '../data/library'
import type { EpisodeState, WatchStatus } from '../data/types'
import DetailHero, { WherePills } from '../components/DetailHero'
import CastRow from '../components/CastRow'
import RatingRow from '../components/RatingRow'
import Reviews from '../components/Reviews'
import Gallery from '../components/Gallery'
import Recommendations from '../components/Recommendations'
import Related from '../components/Related'
import { markWatchedWithCatchUp } from '../utils/watchActions'
import { appConfirm } from '../utils/confirm'
import { airTimeOrDate, hasAiredByTime } from '../utils/airTime'
import { useShowAirstamps } from '../hooks/useShowAirstamps'

const HOUR = 1000 * 60 * 60
const STATUSES: WatchStatus[] = ['watchlist', 'watching', 'completed', 'dropped']

/** A tab in the episode browser: a regular season, or a group of specials. */
interface SeasonTab {
  id: string
  label: string
  /** TMDB season number this tab's episodes live under (0 for specials). */
  seasonNumber: number
  episodeCount: number
  /** Specials groups only: which season-0 episode numbers this tab shows. */
  episodeNumbers?: Set<number>
  /** Average rating 0–10 for the season (for the season-rating pill). */
  rating?: number
}

function seasonLabel(s: TmdbSeasonSummary): string {
  return s.season_number === 0 ? 'Specials' : s.name || `Season ${s.season_number}`
}

/**
 * Build the episode-browser tabs. Regular seasons in order; the Specials season
 * (0) is split by each special's air date and inserted between the seasons it
 * aired between, so between-season specials (Doctor Who, Euphoria, Invincible…)
 * are watchable in order instead of lumped after everything. Until the specials'
 * episodes (and thus their dates) have loaded, they appear as one tab at the end.
 */
function buildSeasonTabs(
  seasons: TmdbSeasonSummary[],
  specialEps: TmdbEpisode[] | undefined,
): SeasonTab[] {
  const withEps = seasons.filter((s) => s.episode_count > 0)
  const regular = withEps
    .filter((s) => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number)
  const specials = withEps.find((s) => s.season_number === 0)
  const regularTabs: SeasonTab[] = regular.map((s) => ({
    id: `s${s.season_number}`,
    label: seasonLabel(s),
    seasonNumber: s.season_number,
    episodeCount: s.episode_count,
    rating: s.vote_average,
  }))
  if (!specials) return regularTabs

  const spTab = (key: string, label: string, eps: number[]): SeasonTab => ({
    id: `sp-${key}`,
    label,
    seasonNumber: 0,
    episodeCount: eps.length,
    episodeNumbers: new Set(eps),
    rating: specials.vote_average,
  })
  // Before the specials' dates are known, keep a single Specials tab at the end.
  if (!specialEps || specialEps.length === 0) {
    return [
      ...regularTabs,
      { id: 'sp', label: 'Specials', seasonNumber: 0, episodeCount: specials.episode_count, rating: specials.vote_average },
    ]
  }
  // Narrative specials (have a director) are interleaved by air date; extras
  // (clips, trailers, behind-the-scenes) go to a single "Extras" tab at the end.
  const { groups, undated, extras } = classifySpecials(regular, specialEps)
  const out: SeasonTab[] = []
  if (groups.has(0)) out.push(spTab('0', 'Specials', groups.get(0)!)) // before season 1
  for (const t of regularTabs) {
    out.push(t)
    const g = groups.get(t.seasonNumber)
    if (g) out.push(spTab(String(t.seasonNumber), 'Specials', g))
  }
  if (undated.length) out.push(spTab('x', 'Specials', undated)) // undated specials go last
  if (extras.length) out.push(spTab('extras', 'Extras', extras))
  return out
}

/** The tab holding the first unwatched episode (resume where you left off); the
 *  last tab once everything's watched. */
function pickDefaultTab(tabs: SeasonTab[], stateMap: Map<string, EpisodeState>): string | null {
  for (const t of tabs) {
    let watched = 0
    if (t.episodeNumbers) {
      for (const ep of t.episodeNumbers) if (stateMap.get(`0:${ep}`)?.watched) watched++
    } else {
      for (const st of stateMap.values()) if (st.season === t.seasonNumber && st.watched) watched++
    }
    if (watched < t.episodeCount) return t.id
  }
  return tabs[tabs.length - 1]?.id ?? null
}

export default function ShowDetail({ itemId, tmdbId }: { itemId: string; tmdbId: number }) {
  const navigate = useNavigate()
  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])
  // While true, episode checks track a fresh pass (so you can tick them off as
  // you rewatch) instead of just showing "ever watched".
  const [rewatching, setRewatching] = useState(false)

  const detailsQuery = useQuery({
    queryKey: ['tv', tmdbId],
    queryFn: () => getTvDetailsCached(itemId, tmdbId),
    staleTime: HOUR,
  })
  const d = detailsQuery.data

  const states = useLiveQuery<EpisodeState[]>(
    () => db.episodeStates.where('itemId').equals(itemId).toArray(),
    [itemId],
  )
  const stateMap = new Map<string, EpisodeState>()
  for (const s of states ?? []) stateMap.set(`${s.season}:${s.episode}`, s)

  const traktRef = useQuery({
    queryKey: ['trakt-ref', 'show', tmdbId],
    queryFn: () => resolveTraktId('show', tmdbId),
    enabled: hasTraktClientId(),
    staleTime: Infinity,
  })
  // Backdrops, videos, and recommendations load as separate, non-blocking queries
  // so a large payload can't fail the whole page (kept out of the details call).
  const images = useQuery({
    queryKey: ['images', 'tv', tmdbId],
    queryFn: () => getImages('tv', tmdbId),
    staleTime: HOUR,
  })
  const videos = useQuery({
    queryKey: ['videos', 'tv', tmdbId],
    queryFn: () => getVideos('tv', tmdbId),
    staleTime: HOUR,
  })
  const recommendations = useQuery({
    queryKey: ['recommendations', 'tv', tmdbId],
    queryFn: () => getRecommendations('tv', tmdbId),
    staleTime: HOUR,
  })
  const akas = useQuery({
    queryKey: ['akas', item?.imdbId],
    queryFn: () => getShowAkas(item!.imdbId!),
    enabled: !!item?.imdbId,
    staleTime: HOUR,
  })
  // Precise air times so an episode airing later today reads as upcoming.
  const airstampOf = useShowAirstamps(item?.imdbId)

  useEffect(() => {
    if (!item || item.imdbId) return
    getImdbId('tv', item.tmdbId)
      .then((imdb) => {
        if (imdb) void db.trackedItems.update(item.id, { imdbId: imdb })
      })
      .catch(() => {})
  }, [item?.id, item?.imdbId])
  useEffect(() => {
    if (item && d) {
      void setItemMeta(item.id, {
        genres: genreNames(d),
        language: d.original_language,
        providers: watchNames(d),
        cast: castNames(d),
        runtime: runtimeOf(d),
        ended: isEndedStatus(d.status),
        episodeCount: d.number_of_episodes,
        tmdbRating: d.vote_average,
        // Last aired episode date — drives the Library "last episode" sort.
        lastAirDate: d.last_episode_to_air?.air_date ?? undefined,
        // Next upcoming episode — powers the Released:upcoming filter.
        nextAirDate: d.next_episode_to_air?.air_date ?? undefined,
      })
    }
  }, [item?.id, d])

  // Auto-complete an ended show once every episode is watched. (watchlist ->
  // watching is handled in the data layer whenever any episode is marked.)
  useEffect(() => {
    if (!item || !d || item.status === 'dropped' || item.status === 'completed') return
    const total = d.number_of_episodes ?? 0
    const watched = (states ?? []).filter((s) => s.watched).length
    if (total > 0 && watched >= total && isEndedStatus(d.status)) {
      void setStatus(item.id, 'completed')
    }
  }, [item?.id, item?.status, d, states])

  // Load the specials (season 0) episodes up front when the show has any, so we
  // know their air dates and can slot them between the right seasons.
  const hasSpecials = useMemo(
    () => (d?.seasons ?? []).some((s) => s.season_number === 0 && s.episode_count > 0),
    [d],
  )
  const specialsQuery = useQuery({
    queryKey: ['season', tmdbId, 0],
    queryFn: () => getSeasonEpisodesCached(itemId, tmdbId, 0),
    enabled: hasSpecials,
    staleTime: HOUR,
  })
  const tabs = useMemo(
    () => buildSeasonTabs(d?.seasons ?? [], specialsQuery.data),
    [d, specialsQuery.data],
  )

  // Default to the tab with the first unwatched episode; the user's pick wins.
  const [picked, setPicked] = useState<string | null>(null)
  const activeTabId = picked ?? pickDefaultTab(tabs, stateMap)
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const season = activeTab?.seasonNumber ?? null

  const episodesQuery = useQuery({
    queryKey: ['season', tmdbId, season],
    queryFn: () => getSeasonEpisodesCached(itemId, tmdbId, season as number),
    enabled: season !== null,
    staleTime: HOUR,
  })
  // A specials tab shows only its slice of the season-0 episodes, in air-date
  // order (so the cards match the Prev/Next browse order).
  const visibleEpisodes = useMemo(() => {
    const eps = episodesQuery.data ?? []
    if (!activeTab?.episodeNumbers) return eps
    return eps
      .filter((e) => activeTab.episodeNumbers!.has(e.episode_number))
      .sort((a, b) => (a.air_date ?? '').localeCompare(b.air_date ?? ''))
  }, [episodesQuery.data, activeTab])

  if (detailsQuery.isError && !d) {
    return (
      <div className="placeholder">
        <p className="badge badge--warn">Couldn’t load this show.</p>
        <Link to="/library">← Back to Library</Link>
      </div>
    )
  }
  if (!d) return <p className="muted">Loading…</p>

  const readOnly = !item
  const title = item?.title ?? d.name ?? ''
  const poster = item?.posterPath ?? d.poster_path ?? undefined
  const ended = isEndedStatus(d.status)
  const firstYear = d.first_air_date?.slice(0, 4) || (item?.year ? String(item.year) : '')
  const lastYear = d.last_air_date?.slice(0, 4) || ''
  const years = firstYear
    ? ended
      ? lastYear && lastYear !== firstYear
        ? `${firstYear} – ${lastYear}`
        : firstYear
      : `${firstYear} – present`
    : ''
  const average =
    typeof d.vote_average === 'number' && d.vote_average > 0 ? `★ ${d.vote_average.toFixed(1)} / 10` : '—'
  const providers = watchNames(d)

  const links = {
    imdb: item?.imdbId ? `https://www.imdb.com/title/${item.imdbId}/` : undefined,
    tmdb: `https://www.themoviedb.org/tv/${tmdbId}`,
    trakt: traktRef.data?.slug ? `https://trakt.tv/shows/${traktRef.data.slug}` : undefined,
  }

  const cast = (d.credits?.cast ?? []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).slice(0, 20)

  const facts: { label: string; value: string }[] = []
  if (d.created_by?.length) facts.push({ label: 'Created by', value: d.created_by.map((c) => c.name).join(', ') })
  if (d.first_air_date) facts.push({ label: 'Premiered', value: d.first_air_date })
  if (ended && d.last_air_date) facts.push({ label: 'Ended', value: d.last_air_date })
  facts.push({
    label: 'Episodes',
    value: `${d.number_of_episodes} across ${d.number_of_seasons} season${d.number_of_seasons === 1 ? '' : 's'}`,
  })
  const rt = runtimeOf(d)
  if (rt) facts.push({ label: 'Runtime', value: `~${rt} min / episode` })
  if (d.status) facts.push({ label: 'Status', value: d.status })
  if (akas.data?.length) facts.push({ label: 'Also known as', value: akas.data.slice(0, 8).join(' · ') })

  // Rewatch-pass bookkeeping: watchCount tracks how many times each episode was
  // seen, so a fully-watched show can be rewatched without losing history.
  let watchedCount = 0
  let minWatchCount = Infinity
  let lastWatchedAt = 0
  for (const s of states ?? []) {
    if (!s.watched) continue
    watchedCount += 1
    const c = s.watchCount ?? 1
    if (c < minWatchCount) minWatchCount = c
    if (s.watchedAt && s.watchedAt > lastWatchedAt) lastWatchedAt = s.watchedAt
  }
  const totalEpisodes = d.number_of_episodes ?? 0
  const fullyWatched = totalEpisodes > 0 && watchedCount >= totalEpisodes
  const completedPasses = fullyWatched && minWatchCount !== Infinity ? minWatchCount : 0

  const seasonRatingPct = activeTab?.rating ? Math.round(activeTab.rating * 10) : 0

  // Mark the selected season's aired episodes watched for the current pass.
  async function markSeasonWatched() {
    if (!item) return
    for (const ep of visibleEpisodes) {
      if (!hasAiredByTime(ep.air_date, airstampOf(ep.season_number, ep.episode_number))) continue
      const st = stateMap.get(`${ep.season_number}:${ep.episode_number}`)
      const wc = st?.watchCount ?? (st?.watched ? 1 : 0)
      await setEpisodeWatchCount(
        item.id,
        ep.season_number,
        ep.episode_number,
        Math.max(wc, completedPasses + 1),
      )
    }
  }

  return (
    <div className="show-detail">
      <DetailHero
        backdrop={imageUrl(d.backdrop_path ?? undefined, 'w1280')}
        poster={imageUrl(poster, 'w342')}
        placeholder="📺"
        title={title}
        yearText={years ? `(${years})` : undefined}
        genres={(d.genres ?? []).map((g) => g.name)}
        tags={
          <>
            <span className="hero__status">{ended ? 'Ended' : d.status === 'Returning Series' ? 'Ongoing' : d.status}</span>
            <span className="hero__sep">·</span>
            <span>TV Show</span>
            <WherePills providers={providers} />
          </>
        }
        overview={d.overview || undefined}
        links={links}
      />

      <section className="detail-actions">
        <div className="detail-actions__controls">
          {readOnly ? (
            <button
              className="btn show-detail__add"
              onClick={() => void addItem({ tmdbId, mediaType: 'show', title, posterPath: poster, year: firstYear ? Number(firstYear) : undefined })}
            >
              + Add to library
            </button>
          ) : (
            <>
              <label className="field show-detail__status">
                <span>Status</span>
                <select value={item.status} onChange={(e) => setStatus(item.id, e.target.value as WatchStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              {fullyWatched &&
                (rewatching ? (
                  <span className="badge badge--ok show-detail__rewatching">
                    Rewatching · pass {completedPasses + 1}
                    <button className="link-btn" onClick={() => setRewatching(false)}>
                      done
                    </button>
                  </span>
                ) : (
                  <button className="btn btn--small btn--ghost" onClick={() => setRewatching(true)}>
                    ↻ Start a rewatch
                  </button>
                ))}
            </>
          )}
        </div>
        <RatingRow
          userRating={item?.userRating}
          average={average}
          canRate={!readOnly}
          onPick={(n) => item && void setRating(item.id, n)}
          onClear={() => item && void setRating(item.id, undefined)}
        />
      </section>

      <CastRow title="Cast" people={cast} />

      {tabs.length > 0 && (
        <section className="section">
          <h3 className="section-title">Episodes</h3>
          {completedPasses >= 1 && (
            <p className="muted episodes__rewatch">
              Watched {completedPasses} {completedPasses === 1 ? 'time' : 'times'}
              {lastWatchedAt > 0 && <> · last on {new Date(lastWatchedAt).toLocaleDateString()}</>}
            </p>
          )}
          <div className="hscroll season-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`season-tab${t.id === activeTabId ? ' season-tab--on' : ''}`}
                onClick={() => setPicked(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {(seasonRatingPct > 0 || !readOnly) && (
            <div className="season-bar">
              {seasonRatingPct > 0 && (
                <span className="season-bar__rating">★ {seasonRatingPct}% season rating</span>
              )}
              {!readOnly && (
                <button className="btn btn--small btn--ghost" onClick={() => void markSeasonWatched()}>
                  Mark aired episodes watched
                </button>
              )}
            </div>
          )}

          {episodesQuery.isLoading && <p className="muted">Loading episodes…</p>}
          <div className="hscroll episode-row">
            {visibleEpisodes.map((ep) => {
              const key = `${ep.season_number}:${ep.episode_number}`
              const st = stateMap.get(key)
              const wc = st?.watchCount ?? (st?.watched ? 1 : 0)
              const everWatched = wc > 0
              const inCurrentPass = wc > completedPasses
              const checked = rewatching ? inCurrentPass : everWatched
              const airstamp = airstampOf(ep.season_number, ep.episode_number)
              const aired = hasAiredByTime(ep.air_date, airstamp)
              const still = imageUrl(ep.still_path ?? undefined, 'w300')
              const go = () =>
                navigate(`/item/${encodeURIComponent(itemId)}/episode/${ep.season_number}/${ep.episode_number}`)
              return (
                <div
                  key={ep.episode_number}
                  className="ep-card"
                  role="button"
                  tabIndex={0}
                  onClick={go}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      go()
                    }
                  }}
                >
                  {still ? (
                    <img className="ep-card__still" src={still} alt="" loading="lazy" />
                  ) : (
                    <div className="ep-card__still ep-card__still--ph">📺</div>
                  )}
                  <div className="ep-card__body">
                    <span className="ep-card__code">
                      S{String(ep.season_number).padStart(2, '0')}E{String(ep.episode_number).padStart(2, '0')}
                      {ep.name ? ` • ${ep.name}` : ''}
                    </span>
                    <p className="ep-card__summary muted">
                      {ep.overview || 'No synopsis yet.'}
                    </p>
                    {!aired ? (
                      <span className="ep-card__upcoming">Airs · {airTimeOrDate(ep.air_date, airstamp)}</span>
                    ) : (
                      !readOnly && (
                        <label
                          className="ep-card__watched"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              if (rewatching) {
                                void setEpisodeWatchCount(
                                  item.id,
                                  ep.season_number,
                                  ep.episode_number,
                                  inCurrentPass ? completedPasses : completedPasses + 1,
                                )
                              } else if (everWatched) {
                                void markEpisode(item.id, ep.season_number, ep.episode_number, false)
                              } else {
                                void markWatchedWithCatchUp(item.id, ep.season_number, ep.episode_number)
                              }
                            }}
                          />
                          {checked ? 'Watched' : 'Mark watched'}
                        </label>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="section">
        <h3 className="section-title">Extras</h3>
        <Gallery videos={videos.data ?? []} images={images.data ?? []} />

        {facts.length > 0 && (
          <details className="facts">
            <summary className="facts__summary">Fun facts</summary>
            <dl className="meta-list facts__list">
              {facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </section>

      <Related itemId={item?.id} mediaType="show" tmdbId={tmdbId} />

      <Reviews target={{ mediaType: 'show', tmdbId }} poweredBy />

      <Recommendations recs={recommendations.data ?? []} mediaType="tv" />

      {item && (
        <button
          className="btn btn--danger"
          onClick={() =>
            void appConfirm(`Remove "${item.title}" and its watch history?`, {
              confirmLabel: 'Remove',
              cancelLabel: 'Cancel',
            }).then((ok) => {
              if (ok) void removeItem(item.id)
            })
          }
        >
          Remove from library
        </button>
      )}
    </div>
  )
}
