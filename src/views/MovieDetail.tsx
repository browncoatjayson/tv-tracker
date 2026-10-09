import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import {
  castNames,
  genreNames,
  getImages,
  getImdbId,
  getMovieDetails,
  getRecommendations,
  getVideos,
  imageUrl,
  runtimeOf,
  watchNames,
} from '../api/tmdb'
import { hasTraktClientId, resolveTraktId } from '../api/trakt'
import { addItem, removeItem, setItemMeta, setRating, setStatus } from '../data/library'
import type { WatchStatus } from '../data/types'
import DetailHero, { WherePills } from '../components/DetailHero'
import CastRow from '../components/CastRow'
import MovieWatch from '../components/MovieWatch'
import RatingStars from '../components/RatingStars'
import Reviews from '../components/Reviews'
import Gallery from '../components/Gallery'
import Recommendations from '../components/Recommendations'
import { appConfirm } from '../utils/confirm'

const HOUR = 1000 * 60 * 60
const STATUSES: WatchStatus[] = ['watchlist', 'watching', 'completed', 'dropped']

export default function MovieDetail({ itemId, tmdbId }: { itemId: string; tmdbId: number }) {
  const item = useLiveQuery(() => db.trackedItems.get(itemId).then((r) => r ?? null), [itemId])
  const [editingRating, setEditingRating] = useState(false)

  const detailsQuery = useQuery({
    queryKey: ['movie', tmdbId],
    queryFn: () => getMovieDetails(tmdbId),
    staleTime: HOUR,
  })
  const d = detailsQuery.data

  const traktRef = useQuery({
    queryKey: ['trakt-ref', 'movie', tmdbId],
    queryFn: () => resolveTraktId('movie', tmdbId),
    enabled: hasTraktClientId(),
    staleTime: Infinity,
  })
  const images = useQuery({
    queryKey: ['images', 'movie', tmdbId],
    queryFn: () => getImages('movie', tmdbId),
    staleTime: HOUR,
  })
  const videos = useQuery({
    queryKey: ['videos', 'movie', tmdbId],
    queryFn: () => getVideos('movie', tmdbId),
    staleTime: HOUR,
  })
  const recommendations = useQuery({
    queryKey: ['recommendations', 'movie', tmdbId],
    queryFn: () => getRecommendations('movie', tmdbId),
    staleTime: HOUR,
  })

  useEffect(() => {
    if (!item || item.imdbId) return
    getImdbId('movie', item.tmdbId)
      .then((imdb) => {
        if (imdb) void db.trackedItems.update(item.id, { imdbId: imdb })
      })
      .catch(() => {})
  }, [item?.id, item?.imdbId])
  useEffect(() => {
    if (item && d) {
      const release = d.release_date
      const todayStr = new Date().toISOString().slice(0, 10)
      void setItemMeta(item.id, {
        genres: genreNames(d),
        providers: watchNames(d),
        cast: castNames(d),
        runtime: runtimeOf(d),
        tmdbRating: d.vote_average,
        // Released movies sort by their release date; unreleased sort to the end.
        lastAirDate: release && release <= todayStr ? release : undefined,
      })
    }
  }, [item?.id, d])

  if (detailsQuery.isError && !d) {
    return (
      <div className="placeholder">
        <p className="badge badge--warn">Couldn’t load this movie.</p>
      </div>
    )
  }
  if (!d) return <p className="muted">Loading…</p>

  const readOnly = !item
  const title = item?.title ?? d.title ?? ''
  const year = item?.year ?? (d.release_date ? Number(d.release_date.slice(0, 4)) || undefined : undefined)
  const poster = item?.posterPath ?? d.poster_path ?? undefined
  const average =
    typeof d.vote_average === 'number' && d.vote_average > 0 ? `★ ${d.vote_average.toFixed(1)} / 10` : '—'
  const providers = watchNames(d)

  const links = {
    imdb: item?.imdbId ? `https://www.imdb.com/title/${item.imdbId}/` : undefined,
    tmdb: `https://www.themoviedb.org/movie/${tmdbId}`,
    trakt: traktRef.data?.slug ? `https://trakt.tv/movies/${traktRef.data.slug}` : undefined,
  }

  const cast = (d.credits?.cast ?? []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999)).slice(0, 20)

  const facts: { label: string; value: string }[] = []
  if (d.release_date) facts.push({ label: 'Released', value: d.release_date })
  const rt = runtimeOf(d)
  if (rt) facts.push({ label: 'Runtime', value: `${rt} min` })
  if (d.status) facts.push({ label: 'Status', value: d.status })

  return (
    <div className="show-detail">
      <DetailHero
        backdrop={imageUrl(d.backdrop_path ?? undefined, 'w1280')}
        poster={imageUrl(poster, 'w342')}
        placeholder="🎬"
        title={title}
        yearText={year ? `(${year})` : undefined}
        genres={(d.genres ?? []).map((g) => g.name)}
        tags={
          <>
            <span>Movie</span>
            <WherePills providers={providers} />
          </>
        }
        overview={d.overview || undefined}
        links={links}
      />

      {readOnly ? (
        <button
          className="btn show-detail__add"
          onClick={() => void addItem({ tmdbId, mediaType: 'movie', title, posterPath: poster, year })}
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
                  if (item) void setRating(item.id, n)
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

      {item && <MovieWatch item={item} />}

      <Reviews target={{ mediaType: 'movie', tmdbId }} poweredBy />

      <Recommendations recs={recommendations.data ?? []} mediaType="movie" />

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
