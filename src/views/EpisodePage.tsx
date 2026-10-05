import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { db, episodeKey } from '../data/db'
import {
  getEpisodeDetails,
  getEpisodeImages,
  getEpisodeImdbId,
  hasAired,
  imageUrl,
  watchNames,
} from '../api/tmdb'
import { getTvDetailsCached } from '../data/episodeCache'
import { hasTraktClientId, resolveTraktId } from '../api/trakt'
import { markEpisode, setEpisodeRating, setEpisodeWatchedDate } from '../data/library'
import ExternalLinks from '../components/ExternalLinks'
import { WherePills } from '../components/DetailHero'
import CastRow from '../components/CastRow'
import RatingStars from '../components/RatingStars'
import Reviews from '../components/Reviews'

const HOUR = 1000 * 60 * 60

function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function EpisodePage() {
  const { id = '', season = '', episode = '' } = useParams()
  const itemId = decodeURIComponent(id)
  const tmdbId = Number(itemId.split(':')[1])
  const seasonNum = Number(season)
  const episodeNum = Number(episode)
  const valid =
    itemId.startsWith('show:') &&
    Number.isFinite(tmdbId) &&
    Number.isFinite(seasonNum) &&
    Number.isFinite(episodeNum)

  const [editingRating, setEditingRating] = useState(false)

  const epQuery = useQuery({
    queryKey: ['episode', tmdbId, seasonNum, episodeNum],
    queryFn: () => getEpisodeDetails(tmdbId, seasonNum, episodeNum),
    enabled: valid,
    staleTime: HOUR,
  })
  const ep = epQuery.data

  const show = useQuery({
    queryKey: ['tv', tmdbId],
    queryFn: () => getTvDetailsCached(itemId, tmdbId),
    enabled: valid,
    staleTime: HOUR,
  })
  const epImdb = useQuery({
    queryKey: ['episode-imdb', tmdbId, seasonNum, episodeNum],
    queryFn: () => getEpisodeImdbId(tmdbId, seasonNum, episodeNum),
    enabled: valid,
    staleTime: Infinity,
  })
  const traktRef = useQuery({
    queryKey: ['trakt-ref', 'show', tmdbId],
    queryFn: () => resolveTraktId('show', tmdbId),
    enabled: valid && hasTraktClientId(),
    staleTime: Infinity,
  })
  const epImages = useQuery({
    queryKey: ['episode-images', tmdbId, seasonNum, episodeNum],
    queryFn: () => getEpisodeImages(tmdbId, seasonNum, episodeNum),
    enabled: valid,
    staleTime: HOUR,
  })

  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])
  const epState = useLiveQuery(
    () => db.episodeStates.get(episodeKey(itemId, seasonNum, episodeNum)).then((r) => r ?? null),
    [itemId, seasonNum, episodeNum],
  )
  const inLibrary = !!item

  if (!valid) {
    return (
      <div className="placeholder">
        <p>Unknown episode.</p>
        <Link to="/library">← Back to Library</Link>
      </div>
    )
  }
  if (epQuery.isLoading) return <p className="muted">Loading episode…</p>
  if (epQuery.isError || !ep) {
    return (
      <div className="placeholder">
        <p className="badge badge--warn">
          {epQuery.error instanceof Error ? epQuery.error.message : 'Could not load this episode.'}
        </p>
        <Link to={`/item/${encodeURIComponent(itemId)}`}>← Back to show</Link>
      </div>
    )
  }

  const showTitle = item?.title ?? show.data?.name ?? 'Show'
  const showBackdrop = imageUrl(show.data?.backdrop_path ?? undefined, 'w1280')
  const still = imageUrl(ep.still_path ?? undefined, 'w500')
  const aired = hasAired(ep.air_date)
  const watched = !!epState?.watched
  const average =
    typeof ep.vote_average === 'number' && ep.vote_average > 0 ? `★ ${ep.vote_average.toFixed(1)} / 10` : '—'
  const cast = ep.credits?.cast ?? []
  const guests = ep.credits?.guest_stars ?? ep.guest_stars ?? []
  const providers = show.data ? watchNames(show.data) : []
  const gallery = (epImages.data ?? []).slice(0, 10)

  const links = {
    imdb: epImdb.data ? `https://www.imdb.com/title/${epImdb.data}/` : undefined,
    tmdb: `https://www.themoviedb.org/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}`,
    trakt: traktRef.data?.slug
      ? `https://trakt.tv/shows/${traktRef.data.slug}/seasons/${seasonNum}/episodes/${episodeNum}`
      : undefined,
  }

  const directors = (ep.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name)
  const writers = (ep.crew ?? [])
    .filter((c) => c.job === 'Writer' || c.department === 'Writing')
    .map((c) => c.name)
  const facts: { label: string; value: string }[] = []
  if (directors.length) facts.push({ label: 'Directed by', value: [...new Set(directors)].join(', ') })
  if (writers.length) facts.push({ label: 'Written by', value: [...new Set(writers)].join(', ') })
  if (ep.air_date) facts.push({ label: aired ? 'Aired' : 'Airs', value: ep.air_date })
  if (ep.runtime) facts.push({ label: 'Runtime', value: `${ep.runtime} min` })
  if (guests.length) facts.push({ label: 'Guest stars', value: String(guests.length) })

  return (
    <div className="show-detail episode-page">
      <section className="hero episode-hero">
        {showBackdrop && <img className="hero__backdrop" src={showBackdrop} alt="" />}
        <div className="hero__overlay" />
        <div className="hero__topbar">
          <Link className="back-link" to={`/item/${encodeURIComponent(itemId)}`}>
            ← {showTitle}
          </Link>
          <ExternalLinks {...links} />
        </div>
        <div className="hero__body">
          {still ? (
            <img className="episode-hero__still" src={still} alt="" loading="lazy" />
          ) : (
            <div className="episode-hero__still episode-hero__still--ph">📺</div>
          )}
          <div className="hero__meta">
            <h2 className="hero__title">
              <span className="episode-page__num">
                S{ep.season_number}E{ep.episode_number}
              </span>{' '}
              {ep.name}
            </h2>
            <div className="genre-badges">
              <span className="genre-badge">{aired ? 'Aired' : 'Airs'}</span>
              {ep.air_date && <span className="genre-badge">{ep.air_date}</span>}
              {ep.runtime ? <span className="genre-badge">{ep.runtime} min</span> : null}
            </div>
            <div className="hero__tags">
              <span>Episode</span>
              <WherePills providers={providers} />
            </div>
            {ep.overview && <p className="hero__overview">{ep.overview}</p>}
          </div>
        </div>
      </section>

      {cast.length > 0 ? (
        <CastRow
          title="Cast"
          leadLabel="Main cast"
          people={cast}
          extra={guests}
          extraLabel="Guest stars"
        />
      ) : (
        guests.length > 0 && <CastRow title="Cast" people={guests} />
      )}

      <section className="section">
        <h3 className="section-title">Ratings &amp; extras</h3>
        <div className="ratings-row">
          <div className="rating-col">
            <span className="rating-col__label">Your rating</span>
            {!inLibrary ? (
              <span className="muted">Add the show to rate</span>
            ) : epState?.userRating !== undefined && !editingRating ? (
              <span className="rating-value">
                ★ {epState.userRating}/10{' '}
                <button className="link-btn" onClick={() => setEditingRating(true)}>
                  revise
                </button>
              </span>
            ) : (
              <RatingStars
                value={epState?.userRating}
                onPick={(n) => {
                  void setEpisodeRating(itemId, seasonNum, episodeNum, n)
                  setEditingRating(false)
                }}
                onClear={
                  epState?.userRating !== undefined
                    ? () => {
                        void setEpisodeRating(itemId, seasonNum, episodeNum, undefined)
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

      {inLibrary && (
        <section className="episode-watch">
          <button
            className="btn"
            disabled={!aired}
            onClick={() => void markEpisode(itemId, seasonNum, episodeNum, !watched)}
          >
            {watched ? '✓ Watched' : 'Mark as watched'}
          </button>
          {watched && (
            <label className="episode__watched">
              <span className="muted">Watched on</span>
              <input
                type="date"
                value={epState?.watchedAt ? localDate(epState.watchedAt) : ''}
                onChange={(e) => {
                  if (!e.target.value) return
                  void setEpisodeWatchedDate(
                    itemId,
                    seasonNum,
                    episodeNum,
                    new Date(`${e.target.value}T12:00:00`).getTime(),
                  )
                }}
              />
            </label>
          )}
        </section>
      )}

      <Reviews target={{ mediaType: 'show', tmdbId, season: seasonNum, episode: episodeNum }} poweredBy />
    </div>
  )
}
