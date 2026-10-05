import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import ExternalLinks from './ExternalLinks'

/** Shared hero banner for the Show and Movie detail pages. */
export default function DetailHero({
  backdrop,
  poster,
  placeholder,
  title,
  yearText,
  genres,
  tags,
  overview,
  links,
}: {
  backdrop?: string
  poster?: string
  placeholder: string
  title: string
  yearText?: string
  genres?: string[]
  /** Status / type / where-to-watch row under the genres. */
  tags?: ReactNode
  overview?: string
  links: { imdb?: string; tmdb?: string; trakt?: string }
}) {
  return (
    <section className="hero">
      {backdrop && <img className="hero__backdrop" src={backdrop} alt="" />}
      <div className="hero__overlay" />
      <ExternalLinks {...links} />
      <div className="hero__body">
        {poster ? (
          <img className="hero__poster" src={poster} alt="" />
        ) : (
          <div className="hero__poster hero__poster--ph">{placeholder}</div>
        )}
        <div className="hero__meta">
          <h2 className="hero__title">
            {title || '…'} {yearText && <span className="hero__years">{yearText}</span>}
          </h2>
          {genres && genres.length > 0 && (
            <div className="genre-badges">
              {genres.map((g) => (
                <Link key={g} to={`/search?q=${encodeURIComponent(`genre:${g}`)}`} className="genre-badge">
                  {g}
                </Link>
              ))}
            </div>
          )}
          {tags && <div className="hero__tags">{tags}</div>}
          {overview && <p className="hero__overview">{overview}</p>}
        </div>
      </div>
    </section>
  )
}

/** Small pills for the hero tags row (type + where-to-watch services). */
export function WherePills({ providers }: { providers: string[] }) {
  return (
    <>
      {providers.slice(0, 3).map((p) => (
        <span key={p} className="where-pill">
          {p}
        </span>
      ))}
    </>
  )
}
