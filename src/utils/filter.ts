// Shared parsing + matching for the filter boxes (Library, Upcoming, Search).
// Supports free text plus `genre:` and `service:` tokens, comma-separated, e.g.
//   "crime, genre:drama, service:hbo"

export interface ParsedQuery {
  text: string
  genres: string[]
  services: string[]
  actors: string[]
  /** Normalized media types to keep: 'movie' and/or 'show'. */
  types: ('movie' | 'show')[]
}

function normalizeType(v: string): 'movie' | 'show' | null {
  const t = v.toLowerCase()
  if (t === 'movie' || t === 'film') return 'movie'
  if (t === 'tv' || t === 'show' || t === 'series') return 'show'
  return null
}

export function parseQuery(raw: string): ParsedQuery {
  const text: string[] = []
  const genres: string[] = []
  const services: string[] = []
  const actors: string[] = []
  const types: ('movie' | 'show')[] = []
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(genre|service|actor|type):(.+)$/i)
    if (!m) {
      text.push(part.toLowerCase())
      continue
    }
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'genre') genres.push(val.toLowerCase())
    else if (key === 'service') services.push(val.toLowerCase())
    else if (key === 'actor') actors.push(val.toLowerCase())
    else {
      const t = normalizeType(val)
      if (t) types.push(t)
    }
  }
  return { text: text.join(' ').trim(), genres, services, actors, types }
}

export interface FilterTarget {
  title?: string
  /** Extra text also matched by the free-text part (e.g. an episode name). */
  extraText?: string
  genres?: string[]
  providers?: string[]
  cast?: string[]
  mediaType?: 'movie' | 'show'
}

export function matchesFilter(target: FilterTarget, q: ParsedQuery): boolean {
  if (q.text) {
    const hay = `${target.title ?? ''} ${target.extraText ?? ''}`.toLowerCase()
    if (!hay.includes(q.text)) return false
  }
  if (q.types.length && (!target.mediaType || !q.types.includes(target.mediaType))) return false
  for (const g of q.genres) {
    if (!(target.genres ?? []).some((x) => x.toLowerCase().includes(g))) return false
  }
  for (const s of q.services) {
    if (!(target.providers ?? []).some((x) => x.toLowerCase().includes(s))) return false
  }
  for (const a of q.actors) {
    if (!(target.cast ?? []).some((x) => x.toLowerCase().includes(a))) return false
  }
  return true
}
