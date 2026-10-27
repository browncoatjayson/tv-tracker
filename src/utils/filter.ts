// Shared parsing + matching for the filter boxes (Library, Upcoming, Search).
// Supports free text plus `genre:` and `service:` tokens, comma-separated, e.g.
//   "crime, genre:drama, service:hbo"

export interface LengthConstraint {
  op: '<' | '>' | '<=' | '>=' | '='
  value: number
}

/** Year comparison: '=' in that year, '~' in that decade, '<' before, '>' after. */
export interface YearConstraint {
  op: '=' | '~' | '<' | '>'
  value: number
}

export interface ParsedQuery {
  text: string
  genres: string[]
  /** Genres to exclude (a `genre:-x` token) — a title with any of these is hidden. */
  genresExclude: string[]
  services: string[]
  /** Services to exclude (a `service:-x` token). */
  servicesExclude: string[]
  actors: string[]
  /** Movie franchise names to match (e.g. "halloween"). */
  series: string[]
  /** Sports team names to match (e.g. "nebraska") — only affects sport items. */
  teams: string[]
  /** Sport league keys/labels to match (e.g. "cfb", "nfl") — only affects sport
   *  items. Each value is a league key or a case-insensitive label fragment. */
  games: string[]
  /** Sport leagues to exclude (a `game:-x` token). */
  gamesExclude: string[]
  /** Normalized media types to keep: 'movie', 'show', and/or 'sport'. */
  types: ('movie' | 'show' | 'sport')[]
  /** Media types to exclude (a `type:-x` token). */
  typesExclude: ('movie' | 'show' | 'sport')[]
  /** Show airing status to keep: 'ended' and/or 'ongoing'. */
  ended: ('ended' | 'ongoing')[]
  /** Release state to keep: 'aired' (already out) and/or 'upcoming' (future). */
  released: ('aired' | 'upcoming')[]
  /** Watch state to keep: 'watched' and/or 'unwatched'. Any selection also
   *  excludes dropped titles. */
  seen: ('watched' | 'unwatched')[]
  /** Original language to keep: 'english' and/or 'foreign'. */
  languages: ('english' | 'foreign')[]
  /** Runtime (minutes) constraints, e.g. {op:'<', value:30}. */
  lengths: LengthConstraint[]
  /** Release-year constraints, e.g. {op:'~', value:2010} (the 2010s). */
  years: YearConstraint[]
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
  const genresExclude: string[] = []
  const services: string[] = []
  const servicesExclude: string[] = []
  const actors: string[] = []
  const series: string[] = []
  const teams: string[] = []
  const games: string[] = []
  const gamesExclude: string[] = []
  const types: ('movie' | 'show' | 'sport')[] = []
  const typesExclude: ('movie' | 'show' | 'sport')[] = []
  const ended: ('ended' | 'ongoing')[] = []
  const released: ('aired' | 'upcoming')[] = []
  const seen: ('watched' | 'unwatched')[] = []
  const languages: ('english' | 'foreign')[] = []
  const lengths: LengthConstraint[] = []
  const years: YearConstraint[] = []
  let rating: number | undefined
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(
      /^(genre|service|actor|series|team|game|type|status|released|seen|language|lang|length|year|rating):(.+)$/i,
    )
    if (!m) {
      text.push(part.toLowerCase())
      continue
    }
    const key = m[1].toLowerCase()
    let val = m[2].trim()
    // The multi-value filters support a leading "-" to exclude (a "not" search).
    let negate = false
    if ((key === 'genre' || key === 'service' || key === 'game' || key === 'type') && val.startsWith('-')) {
      negate = true
      val = val.slice(1).trim()
    }
    if (key === 'genre') (negate ? genresExclude : genres).push(val.toLowerCase())
    else if (key === 'service') (negate ? servicesExclude : services).push(val.toLowerCase())
    else if (key === 'actor') actors.push(val.toLowerCase())
    else if (key === 'series') series.push(val.toLowerCase())
    else if (key === 'team') teams.push(val.toLowerCase())
    else if (key === 'game') (negate ? gamesExclude : games).push(val.toLowerCase())
    else if (key === 'type') {
      const t = normalizeType(val)
      if (t) (negate ? typesExclude : types).push(t)
    } else if (key === 'status') {
      const v = val.toLowerCase()
      if (v === 'ended' || v === 'cancelled' || v === 'canceled') ended.push('ended')
      else if (v === 'ongoing' || v === 'returning' || v === 'airing') ended.push('ongoing')
    } else if (key === 'released') {
      const v = val.toLowerCase()
      if (v === 'aired' || v === 'released' || v === 'out') released.push('aired')
      else if (v === 'upcoming' || v === 'unaired' || v === 'unreleased') released.push('upcoming')
    } else if (key === 'seen') {
      const v = val.toLowerCase()
      if (v === 'watched' || v === 'seen') seen.push('watched')
      else if (v === 'unwatched' || v === 'unseen') seen.push('unwatched')
    } else if (key === 'language' || key === 'lang') {
      const v = val.toLowerCase()
      if (v === 'english' || v === 'en') languages.push('english')
      else if (v === 'foreign' || v === 'non-english') languages.push('foreign')
      // subtitled/dubbed aren't available from the data, so unknown values are ignored.
    } else if (key === 'length') {
      // length: optional operator + number of minutes.
      const lm = val.match(/^(<=|>=|<|>|=)?\s*(\d+)$/)
      if (lm) lengths.push({ op: (lm[1] as LengthConstraint['op']) || '=', value: Number(lm[2]) })
    } else if (key === 'year') {
      // year: optional operator (< before, > after, ~ decade) + a 4-digit year.
      const ym = val.match(/^(<|>|=|~)?\s*(\d{1,4})$/)
      if (ym) years.push({ op: (ym[1] as YearConstraint['op']) || '=', value: Number(ym[2]) })
    } else {
      // rating: minimum TMDB score (1–10); accepts a decimal like 7.5.
      const n = Number(val)
      if (Number.isFinite(n) && n > 0) rating = Math.min(10, n)
    }
  }
  return {
    text: text.join(' ').trim(),
    genres,
    genresExclude,
    services,
    servicesExclude,
    actors,
    series,
    teams,
    games,
    gamesExclude,
    types,
    typesExclude,
    ended,
    released,
    seen,
    languages,
    lengths,
    years,
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
  /** Wikidata shared-universe name (also matched by series:, across media). */
  universe?: string
  /** Sports team name (for the team: filter). */
  team?: string
  /** Sport league key (e.g. "cfb") — for the game: league filter. */
  league?: string
  /** Sport league display label (e.g. "College Football") — matched by game:. */
  leagueLabel?: string
  mediaType?: 'movie' | 'show' | 'sport'
  /** Watch state for the seen: filter. Undefined = unknown (never confirmable). */
  seen?: 'watched' | 'unwatched' | 'dropped'
  /** Original-language kind for the language: filter. Undefined = unknown. */
  language?: 'english' | 'foreign'
  /** Release / first-air year, for the year: filter. Undefined = unknown. */
  year?: number
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

function yearSatisfies(year: number, c: YearConstraint): boolean {
  switch (c.op) {
    case '<':
      return year < c.value
    case '>':
      return year > c.value
    case '~':
      return Math.floor(year / 10) === Math.floor(c.value / 10)
    default:
      return year === c.value
  }
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
  if (q.typesExclude.length && target.mediaType && q.typesExclude.includes(target.mediaType)) {
    return false
  }
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
  // Seen: any selection excludes dropped. One pick restricts to that state; both
  // selected keeps everything that isn't dropped. Unknown state can't be kept.
  if (q.seen.length) {
    if (target.seen === undefined || target.seen === 'dropped') return false
    if (q.seen.length === 1 && target.seen !== q.seen[0]) return false
  }
  // Language: one pick restricts; both/none = no restriction. Unknown is hidden.
  if (q.languages.length === 1) {
    if (target.language === undefined || target.language !== q.languages[0]) return false
  }
  for (const l of q.lengths) {
    if (target.runtime === undefined || !runtimeSatisfies(target.runtime, l)) return false
  }
  for (const y of q.years) {
    if (target.year === undefined || !yearSatisfies(target.year, y)) return false
  }
  // Minimum rating: an unknown rating can't be confirmed at/above, so it's hidden.
  if (q.rating !== undefined && (target.rating === undefined || target.rating < q.rating)) {
    return false
  }
  for (const g of q.genres) {
    if (!(target.genres ?? []).some((x) => x.toLowerCase().includes(g))) return false
  }
  // Excluded genres: a title carrying any of them is hidden (unknown genres can't
  // be confirmed to carry one, so they're left in).
  for (const g of q.genresExclude) {
    if ((target.genres ?? []).some((x) => x.toLowerCase().includes(g))) return false
  }
  for (const s of q.services) {
    if (!(target.providers ?? []).some((x) => x.toLowerCase().includes(s))) return false
  }
  for (const s of q.servicesExclude) {
    if ((target.providers ?? []).some((x) => x.toLowerCase().includes(s))) return false
  }
  for (const a of q.actors) {
    if (!(target.cast ?? []).some((x) => x.toLowerCase().includes(a))) return false
  }
  for (const s of q.series) {
    // Matches the TMDB collection OR the Wikidata shared universe (cross-media).
    const series = (target.series ?? '').toLowerCase()
    const universe = (target.universe ?? '').toLowerCase()
    if (!series.includes(s) && !universe.includes(s)) return false
  }
  // Team: only applies to sporting events — a team filter excludes non-sport items.
  if (q.teams.length) {
    if (target.mediaType !== 'sport') return false
    for (const t of q.teams) {
      if (!(target.team ?? '').toLowerCase().includes(t)) return false
    }
  }
  // Game (league): sport items only. A value matches the league key exactly or
  // the label as a substring (so "game:cfb" and "game:college football" both work).
  if (q.games.length) {
    if (target.mediaType !== 'sport') return false
    const key = (target.league ?? '').toLowerCase()
    const label = (target.leagueLabel ?? '').toLowerCase()
    if (!q.games.some((g) => g === key || (!!label && label.includes(g)))) return false
  }
  // Excluded leagues only affect sport items (a movie isn't hidden by game:-cfb).
  if (q.gamesExclude.length && target.mediaType === 'sport') {
    const key = (target.league ?? '').toLowerCase()
    const label = (target.leagueLabel ?? '').toLowerCase()
    if (q.gamesExclude.some((g) => g === key || (!!label && label.includes(g)))) return false
  }
  return true
}
