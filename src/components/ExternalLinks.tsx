/** The IMDb / TMDB / Trakt / ESPN link pills shown at the top-right of a detail hero. */
export default function ExternalLinks({
  imdb,
  tmdb,
  trakt,
  espn,
}: {
  imdb?: string
  tmdb?: string
  trakt?: string
  espn?: string
}) {
  return (
    <div className="hero__links">
      {imdb && <Pill href={imdb} label="IMDb" />}
      {tmdb && <Pill href={tmdb} label="TMDB" />}
      {trakt && <Pill href={trakt} label="Trakt" />}
      {espn && <Pill href={espn} label="ESPN" />}
    </div>
  )
}

function Pill({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ext-link"
      title={`Open on ${label}`}
    >
      {label} ↗
    </a>
  )
}
