import { Link } from 'react-router-dom'
import { imageUrl } from '../api/tmdb'

export interface CastMember {
  name: string
  character?: string
  profile_path?: string | null
}

function Card({ c, keyPrefix }: { c: CastMember; keyPrefix: string }) {
  const photo = imageUrl(c.profile_path ?? undefined, 'w185')
  return (
    <Link
      key={`${keyPrefix}-${c.name}`}
      to={`/search?q=${encodeURIComponent(`actor:${c.name}`)}`}
      className="cast-card"
    >
      {photo ? (
        <img className="cast-card__photo" src={photo} alt="" loading="lazy" />
      ) : (
        <span className="cast-card__photo cast-card__photo--ph">👤</span>
      )}
      {c.character && <span className="cast-card__char">{c.character}</span>}
      <span className="cast-card__name">{c.name}</span>
    </Link>
  )
}

/**
 * A wrapping grid of cast cards. Optionally continues with a second group
 * (e.g. guest stars) in the same flow, marked by an inline divider — so cast
 * and guests read as one section rather than two separate rows.
 */
function Divider({ label }: { label: string }) {
  return (
    <div className="cast-divider" role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  )
}

export default function CastRow({
  title,
  people,
  leadLabel,
  extra,
  extraLabel,
}: {
  title: string
  people: CastMember[]
  /** Inline marker shown before the first actor (e.g. "Main cast"). */
  leadLabel?: string
  extra?: CastMember[]
  extraLabel?: string
}) {
  const hasExtra = !!extra && extra.length > 0
  if (people.length === 0 && !hasExtra) return null
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      <div className="cast-wrap">
        {leadLabel && people.length > 0 && <Divider label={leadLabel} />}
        {people.map((c, i) => (
          <Card key={`c-${i}`} c={c} keyPrefix="c" />
        ))}
        {people.length > 0 && hasExtra && extraLabel && <Divider label={extraLabel} />}
        {extra?.map((c, i) => (
          <Card key={`g-${i}`} c={c} keyPrefix="g" />
        ))}
      </div>
    </section>
  )
}
