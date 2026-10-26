// Shared parsing + matching for the filter boxes (Library, Upcoming, Search).
// Supports free text plus `genre:` and `service:` tokens, comma-separated, e.g.
//   "crime, genre:drama, service:hbo"

export interface LengthConstraint {
  op: '<' | '>' | '<=' | '>=' | '='
  value: number
}

export interface ParsedQuery {
  text: string
  genres: string[]
  services: string[]
  actors: string[]
  /** Movie franchise names to match (e.g. "halloween"). */
  series: string[]
  /** Sports team names to match (e.g. "nebraska") — only affects sport items. */
  teams: string[]
  /** Normalized media types to keep: 'movie', 'show', and/or 'sport'. */
  types: ('movie' | 'show' | 'sport')[]
  /** Show airing status to keep: 'ended' and/or 'ongoing'. */
  ended: ('ended' | 'ongoing')[]
  /** Release state to keep: 'aired' (already out) and/or 'upcoming' (future). */
  released: ('aired' | 'upcoming')[]
  /** Runtime (minutes) constraints, e.g. {op:'<', value:30}. */
  lengths: LengthConstraint[]
  /** Minimum TMDB rating (0–10) to keep, e.g. 5 keeps ★5 and up. */
  rating?: number
}

function normalizeType(v: string): 'movie' | 'show' | 'sport' | null {
  const t = v.toLowerCase()
  if (t === 'movie' || t === 'film') return 'movie'
  if (t === 'tv' || t === 'show' || t === 'series') return 'show'
  if (t === 'sport' || t === 'sports') return 'sport'
  return null
}

export function parseQuery(raw: string): ParsedQuery {
  const text: string[] = []
  const genres: string[] = []
  const services: string[] = []
  const actors: string[] = []
  const series: string[] = []
  const teams: string[] = []
  const types: ('movie' | 'show' | 'sport')[] = []
  const ended: ('ended' | 'ongoing')[] = []
  const released: ('aired' | 'upcoming')[] = []
  const lengths: LengthConstraint[] = []
  let rating: number | undefined
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(genre|service|actor|series|team|type|status|released|length|rating):(.+)$/i)
    if (!m) {
      text.push(part.toLowerCase())
      continue
    }
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'genre') genres.push(val.toLowerCase())
    else if (key === 'service') services.push(val.toLowerCase())
    else if (key === 'actor') actors.push(val.toLowerCase())
    else if (key === 'series') series.push(val.toLowerCase())
    else if (key === 'team') teams.push(val.toLowerCase())
    else if (key === 'type') {
      const t = normalizeType(val)
      if (t) types.push(t)
    } else if (key === 'status') {
      const v = val.toLowerCase()
      if (v === 'ended' || v === 'cancelled' || v === 'canceled') ended.push('ended')
      else if (v === 'ongoing' || v === 'returning' || v === 'airing') ended.push('ongoing')
    } else if (key === 'released') {
      const v = val.toLowerCase()
      if (v === 'aired' || v === 'released' || v === 'out') released.push('aired')
      else if (v === 'upcoming' || v === 'unaired' || v === 'unreleased') released.push('upcoming')
    } else if (key === 'length') {
      // length: optional operator + number of minutes.
      const lm = val.match(/^(<=|>=|<|>|=)?\s*(\d+)$/)
      if (lm) lengths.push({ op: (lm[1] as LengthConstraint['op']) || '=', value: Number(lm[2]) })
    } else {
      // rating: minimum TMDB score (1–10); accepts a decimal like 7.5.
      const n = Number(val)
      if (Number.isFinite(n) && n > 0) rating = Math.min(10, n)
    }
  }
  return {
    text: text.join(' ').trim(),
    genres,
    services,
    actors,
    series,
    teams,
    types,
    ended,
    released,
    lengths,
    rating,
  }
}

export interface FilterTarget {
  title?: string
  /** Extra text also matched by the free-text part (e.g. an episode name). */
  extraText?: string
  genres?: string[]
  providers?: string[]
  cast?: string[]
  /** Movie franchise / collection name (for the series: filter). */
  series?: string
  /** Sports team name (for the team: filter). */
  team?: string
  mediaType?: 'movie' | 'show' | 'sport'
  ended?: boolean
  /** Single-state release flag (episodes, movies, search results): has it aired /
   *  released as of today? Undefined = unknown → never filtered out. */
  aired?: boolean
  /** Multi-state release flags (a show title can be both, e.g. mid-run): which of
   *  'aired' / 'upcoming' apply. Takes precedence over `aired` when provided.
   *  Undefined = unknown → never filtered out. */
  releasedStates?: ('aired' | 'upcoming')[]
  runtime?: number
  /** TMDB average score 0–10 (for the rating: filter). Undefined = unknown. */
  rating?: number
}

/** The release states a target belongs to, or undefined if unknown. */
function releasedStatesOf(t: FilterTarget): ('aired' | 'upcoming')[] | undefined {
  if (t.releasedStates) return t.releasedStates
  if (t.aired === true) return ['aired']
  if (t.aired === false) return ['upcoming']
  return undefined
}

function runtimeSatisfies(runtime: number, c: LengthConstraint): boolean {
  switch (c.op) {
    case '<':
      return runtime < c.value
    case '>':
      return runtime > c.value
    case '<=':
      return runtime <= c.value
    case '>=':
      return runtime >= c.value
    default:
      return runtime === c.value
  }
}

export function matchesFilter(target: FilterTarget, q: ParsedQuery): boolean {
  if (q.text) {
    const hay = `${target.title ?? ''} ${target.extraText ?? ''}`.toLowerCase()
    if (!hay.includes(q.text)) return false
  }
  if (q.types.length && (!target.mediaType || !q.types.includes(target.mediaType))) return false
  if (q.ended.length) {
    if (target.ended === undefined) return false
    if (!q.ended.includes(target.ended ? 'ended' : 'ongoing')) return false
  }
  // Released state: both selected (or none) = no restriction. A title must belong
  // to the kept state — a mid-run show counts as both 'aired' and 'upcoming', so
  // it survives either. Unknown (undefined) is never hidden.
  if (q.released.length === 1) {
    const states = releasedStatesOf(target)
    if (states && !states.includes(q.released[0])) return false
  }
  for (const l of q.lengths) {
    if (target.runtime === undefined || !runtimeSatisfies(target.runtime, l)) return false
  }
  // Minimum rating: an unknown rating can't be confirmed at/above, so it's hidden.
  if (q.rating !== undefined && (target.rating === undefined || target.rating < q.rating)) {
    return false
  }
  for (const g of q.genres) {
    if (!(target.genres ?? []).some((x) => x.toLowerCase().includes(g))) return false
  }
  for (const s of q.services) {
    if (!(target.providers ?? []).some((x) => x.toLowerCase().includes(s))) return false
  }
  for (const a of q.actors) {
    if (!(target.cast ?? []).some((x) => x.toLowerCase().includes(a))) return false
  }
  for (const s of q.series) {
    if (!(target.series ?? '').toLowerCase().includes(s)) return false
  }
  // Team: only applies to sporting events — a team filter excludes non-sport items.
  if (q.teams.length) {
    if (target.mediaType !== 'sport') return false
    for (const t of q.teams) {
      if (!(target.team ?? '').toLowerCase().includes(t)) return false
    }
  }
  return true
}
