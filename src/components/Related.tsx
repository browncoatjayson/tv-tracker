import { useState } from 'react'
import { Link } from 'react-router-dom'
import { imageUrl, type TmdbCollectionPart } from '../api/tmdb'

/** The film franchise (TMDB collection), in release order, styled like the
 *  "You might also like" section. The current title is highlighted in place (and
 *  not a link). The series name links to a Search for the whole franchise. */
export default function Related({
  seriesName,
  parts,
  currentId,
}: {
  seriesName: string
  parts: TmdbCollectionPart[]
  currentId: number
}) {
  const [open, setOpen] = useState(false)
  const items = parts.filter((p) => p.poster_path)
  if (items.length < 2) return null
  return (
    <details
      className="reviews reviews--recs"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="reviews__summary">
        <span>
          Related ·{' '}
          <Link
            className="related__series"
            to={`/search?q=${encodeURIComponent(`series:${seriesName}`)}`}
            onClick={(e) => e.stopPropagation()}
          >
            {seriesName}
          </Link>
        </span>
        <span className="reviews__powered">Powered by TMDB</span>
      </summary>
      <div className="reviews__body">
        <div className="poster-grid">
          {items.map((p) => {
            const label = (
              <>
                <img
                  className="poster-card__img"
                  src={imageUrl(p.poster_path ?? undefined, 'w185')}
                  alt=""
                  loading="lazy"
                />
                <span className="poster-card__title">
                  {p.title}
                  {p.release_date ? <span className="muted"> ({p.release_date.slice(0, 4)})</span> : null}
                </span>
              </>
            )
            return p.id === currentId ? (
              <div key={p.id} className="poster-card poster-card--current" aria-current="page">
                {label}
              </div>
            ) : (
              <Link
                key={p.id}
                to={`/item/${encodeURIComponent(`movie:${p.id}`)}`}
                className="poster-card"
              >
                {label}
              </Link>
            )
          })}
        </div>
      </div>
    </details>
  )
}
