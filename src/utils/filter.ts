// Shared parsing + matching for the filter boxes (Library, Upcoming, Search).
// Supports free text plus `genre:` and `service:` tokens, comma-separated, e.g.
//   "crime, genre:drama, service:hbo"

export interface ParsedQuery {
  text: string
  genres: string[]
  services: string[]
}

export function parseQuery(raw: string): ParsedQuery {
  const text: string[] = []
  const genres: string[] = []
  const services: string[] = []
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(genre|service):(.+)$/i)
    if (m) (m[1].toLowerCase() === 'genre' ? genres : services).push(m[2].trim().toLowerCase())
    else text.push(part.toLowerCase())
  }
  return { text: text.join(' ').trim(), genres, services }
}

export interface FilterTarget {
  title?: string
  /** Extra text also matched by the free-text part (e.g. an episode name). */
  extraText?: string
  genres?: string[]
  providers?: string[]
}

export function matchesFilter(target: FilterTarget, q: ParsedQuery): boolean {
  if (q.text) {
    const hay = `${target.title ?? ''} ${target.extraText ?? ''}`.toLowerCase()
    if (!hay.includes(q.text)) return false
  }
  for (const g of q.genres) {
    if (!(target.genres ?? []).some((x) => x.toLowerCase().includes(g))) return false
  }
  for (const s of q.services) {
    if (!(target.providers ?? []).some((x) => x.toLowerCase().includes(s))) return false
  }
  return true
}
