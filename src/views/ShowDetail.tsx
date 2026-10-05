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
  hasAired,
  imageUrl,
  isEndedStatus,
  runtimeOf,
  watchNames,
  type TmdbSeasonSummary,
} from '../api/tmdb'
import { getSeasonEpisodesCached, getTvDetailsCached } from '../data/episodeCache'
import { hasTraktClientId, resolveTraktId } from '../api/trakt'
import { addItem, markEpisode, removeItem, setItemMeta, setRating, setStatus } from '../data/library'
import type { EpisodeState, TrackedItem, WatchStatus } from '../data/types'
import DetailHero, { WherePills } from '../components/DetailHero'
import CastRow from '../components/CastRow'
import RatingStars from '../components/RatingStars'
import Reviews from '../components/Reviews'

const HOUR = 1000 * 60 * 60
const STATUSES: WatchStatus[] = ['watchlist', 'watching', 'completed', 'dropped']

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

/** The season holding the first unwatched episode (so you resume where you left
 *  off); the last season once everything's watched. */
function pickDefaultSeason(seasons: TmdbSeasonSummary[], stateMap: Map<string, EpisodeState>): number | null {
  const regular = seasons.filter((s) => s.season_number > 0)
  for (const s of regular) {
    let watched = 0
    for (const st of stateMap.values()) if (st.season === s.season_number && st.watched) watched++
    if (watched < s.episode_count) return s.season_number
  }
  return regular[regular.length - 1]?.season_number ?? seasons[0]?.season_number ?? null
}

export default function ShowDetail({ itemId, tmdbId }: { itemId: string; tmdbId: number }) {
  const navigate = useNavigate()
  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])
  const [editingRating, setEditingRating] = useState(false)

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
  const images = useQuery({
    queryKey: ['images', 'tv', tmdbId],
    queryFn: () => getImages('tv', tmdbId),
    staleTime: HOUR,
  })

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
        providers: watchNames(d),
        cast: castNames(d),
        runtime: runtimeOf(d),
        ended: isEndedStatus(d.status),
        episodeCount: d.number_of_episodes,
        tmdbRating: d.vote_average,
      })
    }
  }, [item?.id, d])

  const seasons = useMemo(() => sortSeasons(d?.seasons ?? []), [d])
  // Default to the season with the first unwatched episode; the user's pick wins.
  const [picked, setPicked] = useState<number | null>(null)
  const season = picked ?? pickDefaultSeason(seasons, stateMap)

  const episodesQuery = useQuery({
    queryKey: ['season', tmdbId, season],
    queryFn: () => getSeasonEpisodesCached(itemId, tmdbId, season as number),
    enabled: season !== null,
    staleTime: HOUR,
  })

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
  const gallery = (images.data ?? []).slice(0, 10)

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

  const stub: TrackedItem = { id: itemId, tmdbId, mediaType: 'show', title, status: 'watchlist', addedAt: 0, updatedAt: 0 }
  const activeItem = item ?? stub

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

      {readOnly ? (
        <button
          className="btn show-detail__add"
          onClick={() => void addItem({ tmdbId, mediaType: 'show', title, posterPath: poster, year: firstYear ? Number(firstYear) : undefined })}
        >
          + Add to library
        </button>
      ) : (
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
      )}

      <CastRow title="Cast" people={cast} />

      {seasons.length > 0 && (
        <section className="section">
          <h3 className="section-title">Episodes</h3>
          <div className="hscroll season-tabs">
            {seasons.map((s) => {
              const pct = s.vote_average ? Math.round(s.vote_average * 10) : 0
              return (
                <button
                  key={s.season_number}
                  className={`season-tab${s.season_number === season ? ' season-tab--on' : ''}`}
                  onClick={() => setPicked(s.season_number)}
                >
                  {seasonLabel(s)}
                  {pct > 0 && <span className="season-tab__rating"> ★{pct}%</span>}
                </button>
              )
            })}
          </div>

          {episodesQuery.isLoading && <p className="muted">Loading episodes…</p>}
          <div className="hscroll episode-row">
            {(episodesQuery.data ?? []).map((ep) => {
              const key = `${ep.season_number}:${ep.episode_number}`
              const watched = !!stateMap.get(key)?.watched
              const aired = hasAired(ep.air_date)
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
                      {ep.overview || (aired ? 'No summary yet.' : `Airs ${ep.air_date ?? 'soon'}.`)}
                    </p>
                    {!readOnly && (
                      <label
                        className="ep-card__watched"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={watched}
                          disabled={!aired}
                          onChange={(e) =>
                            void markEpisode(item.id, ep.season_number, ep.episode_number, e.target.checked)
                          }
                        />
                        {watched ? 'Watched' : aired ? 'Mark watched' : 'Unaired'}
                      </label>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="section">
        <h3 className="section-title">Ratings &amp; extras</h3>
        <div className="ratings-row">
          <div className="rating-col">
            <span className="rating-col__label">Your rating</span>
            {readOnly ? (
              <span className="muted">Add to library to rate</span>
            ) : item.userRating !== undefined && !editingRating ? (
              <span className="rating-value">
                ★ {item.userRating}/10{' '}
                <button className="link-btn" onClick={() => setEditingRating(true)}>
                  revise
                </button>
              </span>
            ) : (
              <RatingStars
                value={item?.userRating}
                onPick={(n) => {
                  void setRating(activeItem.id, n)
                  setEditingRating(false)
                }}
                onClear={
                  item?.userRating !== undefined
                    ? () => {
                        void setRating(item.id, undefined)
                        setEditingRating(false)
                      }
                    : undefined
                }
              />
            )}
          </div>
          <div className="rating-col">
            <span className="rating-col__label">Average</span>
            <span className="rating-value">{average}</span>
          </div>
        </div>

        {gallery.length > 0 && (
          <div className="gallery">
            {gallery.map((img) => (
              <a
                key={img.file_path}
                href={imageUrl(img.file_path, 'original')}
                target="_blank"
                rel="noopener noreferrer"
                className="gallery__item"
              >
                <img src={imageUrl(img.file_path, 'w300')} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        )}

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

      <Reviews target={{ mediaType: 'show', tmdbId }} poweredBy />

      {item && (
        <button
          className="btn btn--danger"
          onClick={() => {
            if (confirm(`Remove "${item.title}" and its watch history?`)) {
              void removeItem(item.id)
            }
          }}
        >
          Remove from library
        </button>
      )}
    </div>
  )
}
