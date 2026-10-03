import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { db } from '../data/db'
import {
  genreNames,
  getImdbId,
  getMovieDetails,
  imageUrl,
  watchNames,
  whereToWatch,
  type WatchInfo,
} from '../api/tmdb'
import { getTvDetailsCached } from '../data/episodeCache'
import { removeItem, setItemMeta, setRating, setStatus } from '../data/library'
import type { WatchStatus } from '../data/types'
import ShowEpisodes from '../components/ShowEpisodes'
import MovieWatch from '../components/MovieWatch'

const STATUSES: WatchStatus[] = ['watchlist', 'watching', 'completed', 'dropped']

export default function ItemDetail() {
  const { id = '' } = useParams()
  const itemId = decodeURIComponent(id)
  // Normalize "not found" to null so we can tell it apart from useLiveQuery's
  // own "still loading" undefined.
  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])

  // Backfill a missing IMDb id (e.g. shows imported from TV Time, which only had
  // a TVDB id). Written without bumping updatedAt so it doesn't churn sync.
  useEffect(() => {
    if (!item || item.imdbId) return
    const source = item.mediaType === 'show' ? 'tv' : 'movie'
    getImdbId(source, item.tmdbId)
      .then((imdb) => {
        if (imdb) void db.trackedItems.update(item.id, { imdbId: imdb })
      })
      .catch(() => {})
  }, [item?.id, item?.imdbId])

  // "Where to watch" (networks + streaming) — shares the cached details query.
  const detailsQuery = useQuery<WatchInfo>({
    queryKey: [item?.mediaType === 'movie' ? 'movie' : 'tv', item?.tmdbId],
    queryFn: () =>
      item!.mediaType === 'movie'
        ? getMovieDetails(item!.tmdbId)
        : getTvDetailsCached(item!.id, item!.tmdbId),
    enabled: !!item,
    staleTime: 1000 * 60 * 60,
  })
  const where = detailsQuery.data ? whereToWatch(detailsQuery.data) : undefined
  const [editingRating, setEditingRating] = useState(false)

  // Backfill filterable metadata (genres, providers) for the Library filter.
  useEffect(() => {
    const d = detailsQuery.data
    if (item && d) {
      void setItemMeta(item.id, { genres: genreNames(d), providers: watchNames(d) })
    }
  }, [item?.id, detailsQuery.data])

  if (item === undefined) return <p className="muted">Loading…</p>
  if (item === null) {
    return (
      <div className="placeholder">
        <p>That title isn’t in your library.</p>
        <Link to="/library">← Back to Library</Link>
      </div>
    )
  }

  const imdbUrl = item.imdbId ? `https://www.imdb.com/title/${item.imdbId}/` : undefined

  return (
    <div className="detail">
      <div className="detail__header">
        {imageUrl(item.posterPath, 'w185') ? (
          <img className="detail__poster" src={imageUrl(item.posterPath, 'w185')} alt="" />
        ) : (
          <div className="detail__poster detail__poster--placeholder">
            {item.mediaType === 'movie' ? '🎬' : '📺'}
          </div>
        )}
        <div>
          <h2 className="detail__title">
            {item.title} {item.year && <span className="muted">({item.year})</span>}
          </h2>
          <p className="muted">{item.mediaType === 'movie' ? 'Movie' : 'TV Show'}</p>
          {imdbUrl && (
            <a href={imdbUrl} target="_blank" rel="noopener noreferrer" className="link-out">
              View on IMDb ↗
            </a>
          )}
          {where && <p className="muted detail__where">{where}</p>}
          {detailsQuery.data?.genres && detailsQuery.data.genres.length > 0 && (
            <div className="genre-badges">
              {detailsQuery.data.genres.map((g) => (
                <span key={g.name} className="genre-badge">
                  {g.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {detailsQuery.data?.overview && (
        <p className="detail__overview muted">{detailsQuery.data.overview}</p>
      )}

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
          <span className="rating-value">
            {typeof detailsQuery.data?.vote_average === 'number' &&
            detailsQuery.data.vote_average > 0
              ? `★ ${detailsQuery.data.vote_average.toFixed(1)}/10`
              : '—'}
          </span>
        </div>
      </div>

      {/* Media-specific tracking: episodes for shows, watch log for movies. */}
      {item.mediaType === 'show' ? (
        <ShowEpisodes item={item} />
      ) : (
        <MovieWatch item={item} />
      )}

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
    </div>
  )
}

/** A clickable 1–10 star row (IMDb-style), with hover preview and optional clear. */
function RatingStars({
  value,
  onPick,
  onClear,
}: {
  value?: number
  onPick: (n: number) => void
  onClear?: () => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  return (
    <div className="stars-wrap">
      <div className="stars" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className="star-btn"
            aria-label={`Rate ${n} of 10`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onPick(n)}
          >
            {n <= shown ? '★' : '☆'}
          </button>
        ))}
      </div>
      {onClear && (
        <button type="button" className="link-btn" onClick={onClear}>
          clear
        </button>
      )}
    </div>
  )
}
