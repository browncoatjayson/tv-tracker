// ---------------------------------------------------------------------------
// TVmaze client — used only to fill in data TMDB lacks, chiefly episode air
// TIMES (TMDB stores air dates only). No API key required, and TVmaze allows
// cross-origin requests. Shows are matched by their IMDb id.
// ---------------------------------------------------------------------------

const BASE = 'https://api.tvmaze.com'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function tvmazeFetch(url: string, retries = 3): Promise<Response | null> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      if (attempt >= retries) throw err
      await sleep(Math.min(3000, 300 * 2 ** attempt))
      continue
    }
    if (res.status === 404) return null // no TVmaze match
    if (res.status === 429 && attempt < retries) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(3000, 300 * 2 ** attempt))
      continue
    }
    if (!res.ok) throw new Error(`TVmaze request failed (${res.status})`)
    return res
  }
}

export interface TvmazeEpisode {
  season: number
  number: number
  name?: string
  /** Full ISO datetime with timezone offset, e.g. "2026-10-04T21:00:00-04:00". */
  airstamp?: string
  /** Local air time, e.g. "21:00". Empty ("") when TVmaze doesn't know the time
   *  (common for streaming shows) — in which case `airstamp` is a noon-UTC
   *  placeholder we must not trust. */
  airtime?: string
}

/**
 * Fetch a show's episodes (with precise air timestamps) by IMDb id. Returns an
 * empty array if TVmaze has no match.
 */
export async function getTvmazeEpisodesByImdb(imdbId: string): Promise<TvmazeEpisode[]> {
  const lookup = await tvmazeFetch(`${BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`)
  if (!lookup) return []
  const show = (await lookup.json()) as { id: number }
  const epsRes = await tvmazeFetch(`${BASE}/shows/${show.id}/episodes`)
  if (!epsRes) return []
  const raw = (await epsRes.json()) as TvmazeEpisode[]
  // Keep ONLY the fields the app actually reads (season/number/name/airstamp).
  // TVmaze's raw episode objects also carry a summary (HTML), image URLs, _links,
  // rating, etc. — none of which we use, but all of which would otherwise be held
  // in memory and written to the persisted query cache, bloating it ~10x. Slimming
  // here keeps that cache small without changing any downstream behaviour.
  // (airtime is only consulted below to validate airstamp; it isn't retained.)
  return raw.map((e) => ({
    season: e.season,
    number: e.number,
    name: e.name,
    // When TVmaze has no release time (airtime empty), its airstamp is a noon-UTC
    // placeholder — drop it so callers fall back to Trakt or a date-only check
    // instead of showing/comparing a bogus time (e.g. a streaming drop at "6am").
    airstamp: e.airtime ? e.airstamp : undefined,
  }))
}

/**
 * Alternative titles (AKAs) for a show, by IMDb id. Returns de-duped names, or
 * an empty array if TVmaze has no match. TVmaze is TV-only (no movies).
 */
export async function getShowAkas(imdbId: string): Promise<string[]> {
  const lookup = await tvmazeFetch(`${BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`)
  if (!lookup) return []
  const show = (await lookup.json()) as { id: number; name?: string }
  const akasRes = await tvmazeFetch(`${BASE}/shows/${show.id}/akas`)
  if (!akasRes) return []
  const akas = (await akasRes.json()) as { name?: string }[]
  const seen = new Set<string>([(show.name ?? '').toLowerCase()])
  const names: string[] = []
  for (const a of akas) {
    const n = a.name?.trim()
    if (!n || seen.has(n.toLowerCase())) continue
    seen.add(n.toLowerCase())
    names.push(n)
  }
  return names
}

/** Format an ISO airstamp as a local time, e.g. "9:00 PM". */
export function formatAirTime(airstamp: string | undefined): string | undefined {
  if (!airstamp) return undefined
  const d = new Date(airstamp)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
