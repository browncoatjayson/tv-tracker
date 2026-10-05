import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { db } from '../data/db'
import {
  castNames,
  genreNames,
  getImdbId,
  getMovieDetails,
  imageUrl,
  isEndedStatus,
  runtimeOf,
  watchNames,
  whereToWatch,
  type WatchInfo,
} from '../api/tmdb'
import { getTvDetailsCached } from '../data/episodeCache'
import { addItem, removeItem, setItemMeta, setRating, setStatus } from '../data/library'
import type { MediaType, TrackedItem, WatchStatus } from '../data/types'
import ShowEpisodes from '../components/ShowEpisodes'
import MovieWatch from '../components/MovieWatch'
import RatingStars from '../components/RatingStars'
import Reviews from '../components/Reviews'

const STATUSES: WatchStatus[] = ['watchlist', 'watching', 'completed', 'dropped']

export default function ItemDetail() {
  const { id = '' } = useParams()
  const itemId = decodeURIComponent(id)
  const [mediaPart, tmdbPart] = itemId.split(':')
  const mediaType: MediaType = mediaPart === 'movie' ? 'movie' : 'show'
  const tmdbId = Number(tmdbPart)
  const validId = Number.isFinite(tmdbId) && tmdbId > 0

  // null = not in library (preview mode); undefined = still loading from Dexie.
  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])
  const [editingRating, setEditingRating] = useState(false)

  // Details come from TMDB regardless of library membership (powers preview).
  const detailsQuery = useQuery<WatchInfo>({
    queryKey: [mediaType === 'movie' ? 'movie' : 'tv', tmdbId],
    queryFn: () =>
      mediaType === 'movie' ? getMovieDetails(tmdbId) : getTvDetailsCached(itemId, tmdbId),
    enabled: validId,
    staleTime: 1000 * 60 * 60,
  })
  const d = detailsQuery.data

  // Backfill a missing IMDb id for library items (imports lack it).
  useEffect(() => {
    if (!item || item.imdbId) return
    getImdbId(item.mediaType === 'show' ? 'tv' : 'movie', item.tmdbId)
      .then((imdb) => {
        if (imdb) void db.trackedItems.update(item.id, { imdbId: imdb })
      })
      .catch(() => {})
  }, [item?.id, item?.imdbId])

  // Backfill filterable metadata + stats fields for library items once details arrive.
  useEffect(() => {
    if (item && d) {
      void setItemMeta(item.id, {
        genres: genreNames(d),
        providers: watchNames(d),
        cast: castNames(d),
        runtime: runtimeOf(d),
        ended: item.mediaType === 'show' ? isEndedStatus(d.status) : undefined,
        episodeCount: item.mediaType === 'show' ? d.number_of_episodes : undefined,
        tmdbRating: d.vote_average,
      })
    }
  }, [item?.id, d])

  if (!validId) {
    return (
      <div className="placeholder">
        <p>Unknown title.</p>
        <Link to="/library">← Back to Library</Link>
      </div>
    )
  }
  if (item === undefined && !d) return <p className="muted">Loading…</p>

  const title = item?.title ?? d?.name ?? d?.title ?? ''
  const dateStr = d?.first_air_date || d?.release_date
  const year = item?.year ?? (dateStr ? Number(dateStr.slice(0, 4)) || undefined : undefined)
  const poster = item?.posterPath ?? d?.poster_path ?? undefined
  const imdbUrl = item?.imdbId ? `https://www.imdb.com/title/${item.imdbId}/` : undefined
  const where = d ? whereToWatch(d) : undefined
  const average =
    typeof d?.vote_average === 'number' && d.vote_average > 0
      ? `★ ${d.vote_average.toFixed(1)}/10`
      : '—'

  const stubItem: TrackedItem = {
    id: itemId,
    tmdbId,
    mediaType,
    title,
    status: 'watchlist',
    addedAt: 0,
    updatedAt: 0,
  }

  return (
    <div className="detail">
      <div className="detail__header">
        {imageUrl(poster, 'w185') ? (
          <img className="detail__poster" src={imageUrl(poster, 'w185')} alt="" />
        ) : (
          <div className="detail__poster detail__poster--placeholder">
            {mediaType === 'movie' ? '🎬' : '📺'}
          </div>
        )}
        <div>
          <h2 className="detail__title">
            {title || '…'} {year && <span className="muted">({year})</span>}
          </h2>
          <p className="muted">
            {mediaType === 'movie' ? 'Movie' : 'TV Show'}
            {mediaType === 'show' && d?.status && (
              <> · {isEndedStatus(d.status) ? 'Ended' : 'Ongoing'}</>
            )}
          </p>
          {imdbUrl && (
            <a href={imdbUrl} target="_blank" rel="noopener noreferrer" className="link-out">
              View on IMDb ↗
            </a>
          )}
          {where && <p className="muted detail__where">{where}</p>}
          {d?.genres && d.genres.length > 0 && (
            <div className="genre-badges">
              {d.genres.map((g) => (
                <span key={g.name} className="genre-badge">
                  {g.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {d?.overview && <p className="detail__overview muted">{d.overview}</p>}

      {d && castNames(d, 8).length > 0 && (
        <p className="detail__cast muted">
          Cast:{' '}
          {castNames(d, 8).map((name, i) => (
            <span key={name}>
              {i > 0 && ', '}
              <Link to={`/search?q=${encodeURIComponent(`actor:${name}`)}`}>{name}</Link>
            </span>
          ))}
        </p>
      )}

      {item ? (
        <>
          <label className="field">
            <span>Status</span>
            <select
              value={item.status}
              onChange={(e) => setStatus(item.id, e.target.value as WatchStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div className="ratings-row">
            <div className="rating-col">
              <span className="rating-col__label">Your rating</span>
              {item.userRating !== undefined && !editingRating ? (
                <span className="rating-value">
                  ★ {item.userRating}/10{' '}
                  <button className="link-btn" onClick={() => setEditingRating(true)}>
                    revise
                  </button>
                </span>
              ) : (
                <RatingStars
                  value={item.userRating}
                  onPick={(n) => {
                    void setRating(item.id, n)
                    setEditingRating(false)
                  }}
                  onClear={
                    item.userRating !== undefined
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

          {item.mediaType === 'show' ? <ShowEpisodes item={item} /> : <MovieWatch item={item} />}

          <Reviews target={{ mediaType, tmdbId }} />

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
        </>
      ) : (
        <>
          <div className="ratings-row">
            <div className="rating-col">
              <span className="rating-col__label">Average</span>
              <span className="rating-value">{average}</span>
            </div>
          </div>
          <button className="btn" onClick={() => void addItem({ tmdbId, mediaType, title, posterPath: poster, year })}>
            + Add to library
          </button>
          {mediaType === 'show' && <ShowEpisodes item={stubItem} readOnly />}

          <Reviews target={{ mediaType, tmdbId }} />
        </>
      )}
    </div>
  )
}
