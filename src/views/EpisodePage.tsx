import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { db, episodeKey } from '../data/db'
import { getEpisodeDetails, hasAired, imageUrl, type TmdbCredit } from '../api/tmdb'
import { getTvDetailsCached } from '../data/episodeCache'
import { setEpisodeRating } from '../data/library'
import RatingStars from '../components/RatingStars'
import Reviews from '../components/Reviews'

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
    staleTime: 1000 * 60 * 60,
  })
  const ep = epQuery.data

  // Show title + "is it in the library" (rating is only enabled once added).
  const show = useQuery({
    queryKey: ['tv', tmdbId],
    queryFn: () => getTvDetailsCached(itemId, tmdbId),
    enabled: valid,
    staleTime: 1000 * 60 * 60,
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
  const still = imageUrl(ep.still_path ?? undefined, 'w500')
  const aired = hasAired(ep.air_date)
  const average =
    typeof ep.vote_average === 'number' && ep.vote_average > 0
      ? `★ ${ep.vote_average.toFixed(1)}/10`
      : '—'
  const guests = ep.credits?.guest_stars ?? ep.guest_stars ?? []
  const cast = ep.credits?.cast ?? []

  return (
    <div className="detail episode-page">
      <Link className="back-link" to={`/item/${encodeURIComponent(itemId)}`}>
        ← {showTitle}
      </Link>

      <h2 className="detail__title episode-page__title">
        <span className="muted episode-page__num">
          S{ep.season_number}E{ep.episode_number}
        </span>{' '}
        {ep.name}
      </h2>
      <p className="muted">
        {aired ? 'Aired' : 'Airs'}
        {ep.air_date ? ` · ${ep.air_date}` : ''}
        {ep.runtime ? ` · ${ep.runtime} min` : ''}
      </p>

      {still && <img className="episode-page__still" src={still} alt="" loading="lazy" />}

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

      {ep.overview ? (
        <p className="detail__overview">{ep.overview}</p>
      ) : (
        <p className="detail__overview muted">No description available.</p>
      )}

      {guests.length > 0 && <CreditList title="Guest stars" people={guests} />}
      {cast.length > 0 && <CreditList title="Cast" people={cast} />}

      <Reviews target={{ mediaType: 'show', tmdbId, season: seasonNum, episode: episodeNum }} />
    </div>
  )
}

/** A grid of cast/guest members: photo, name (links to actor search), character. */
function CreditList({ title, people }: { title: string; people: TmdbCredit[] }) {
  return (
    <section className="credits">
      <h3 className="section-title">{title}</h3>
      <ul className="credits__grid">
        {people.slice(0, 20).map((p, i) => {
          const photo = imageUrl(p.profile_path ?? undefined, 'w185')
          return (
            <li key={`${p.name}-${i}`} className="credit">
              <Link
                className="credit__link"
                to={`/search?q=${encodeURIComponent(`actor:${p.name}`)}`}
              >
                {photo ? (
                  <img className="credit__photo" src={photo} alt="" loading="lazy" />
                ) : (
                  <span className="credit__photo credit__photo--placeholder">👤</span>
                )}
                <span className="credit__name">{p.name}</span>
                {p.character && <span className="credit__char muted">{p.character}</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
