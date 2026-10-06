import { useState } from 'react'
import { Link } from 'react-router-dom'
import { imageUrl, type TmdbRecommendation } from '../api/tmdb'

/** A collapsible poster grid of "you might also like" titles, linking to their
 *  preview detail pages. `mediaType` is the parent title's type and seeds the
 *  link when a recommendation doesn't carry its own. */
export default function Recommendations({
  recs,
  mediaType,
}: {
  recs: TmdbRecommendation[]
  mediaType: 'tv' | 'movie'
}) {
  const [open, setOpen] = useState(false)
  const items = recs.filter((r) => r.poster_path).slice(0, 18)
  if (items.length === 0) return null
  return (
    <details className="reviews reviews--recs" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="reviews__summary">
        <span>You might also like</span>
        <span className="reviews__powered">Powered by TMDB</span>
      </summary>
      <div className="reviews__body">
        <div className="poster-grid">
          {items.map((r) => {
            const mt = r.media_type ?? mediaType
            const key = `${mt === 'movie' ? 'movie' : 'show'}:${r.id}`
            return (
              <Link key={r.id} to={`/item/${encodeURIComponent(key)}`} className="poster-card">
                <img
                  className="poster-card__img"
                  src={imageUrl(r.poster_path ?? undefined, 'w185')}
                  alt=""
                  loading="lazy"
                />
                <span className="poster-card__title">{r.title ?? r.name ?? ''}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </details>
  )
}
