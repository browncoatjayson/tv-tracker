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
  return (await epsRes.json()) as TvmazeEpisode[]
}

/** Format an ISO airstamp as a local time, e.g. "9:00 PM". */
export function formatAirTime(airstamp: string | undefined): string | undefined {
  if (!airstamp) return undefined
  const d = new Date(airstamp)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
