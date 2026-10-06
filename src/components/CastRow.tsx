import { useState } from 'react'
import { Link } from 'react-router-dom'
import { imageUrl } from '../api/tmdb'
import SectionDivider from './SectionDivider'

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
 * (e.g. guest stars) in the same flow, each introduced by a one-card-wide
 * divider that shows its count and a Hide toggle to collapse it.
 */
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
  // Collapse a labelled group when its Hide box is checked (session-local).
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const toggle = (key: string, v: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (v) next.add(key)
      else next.delete(key)
      return next
    })

  const hasExtra = !!extra && extra.length > 0
  if (people.length === 0 && !hasExtra) return null
  const leadHidden = hidden.has('lead')
  const extraHidden = hidden.has('extra')
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      <div className="cast-wrap">
        {leadLabel && people.length > 0 && (
          <SectionDivider
            className="section-divider--cast"
            label={leadLabel}
            count={people.length}
            countNoun="Actor"
            hidden={leadHidden}
            onToggleHide={(v) => toggle('lead', v)}
          />
        )}
        {!leadHidden && people.map((c, i) => <Card key={`c-${i}`} c={c} keyPrefix="c" />)}
        {people.length > 0 && hasExtra && extraLabel && (
          <SectionDivider
            className="section-divider--cast"
            label={extraLabel}
            count={extra.length}
            countNoun="Actor"
            hidden={extraHidden}
            onToggleHide={(v) => toggle('extra', v)}
          />
        )}
        {!extraHidden && extra?.map((c, i) => <Card key={`g-${i}`} c={c} keyPrefix="g" />)}
      </div>
    </section>
  )
}
