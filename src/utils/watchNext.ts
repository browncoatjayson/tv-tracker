import type { TrackedItem } from '../data/types'

/** A "watch next" suggestion: the next unwatched aired episode of a show. */
export interface WatchNextCandidate {
  item: TrackedItem
  season: number
  episode: number
  epName?: string
}

/**
 * Weighted-random pick from the candidates, slightly favouring the viewer's
 * most-watched genres, favourite services, and favourite actors. `excludeIds`
 * drops shows already suggested (so re-rolling gives something new). Returns null
 * when nothing is eligible.
 *
 * `rand` is injectable for tests; defaults to Math.random.
 */
export function pickWatchNext(
  candidates: WatchNextCandidate[],
  opts: {
    /** Genre name (lowercased) -> how many watching shows carry it. */
    genreFreq: Map<string, number>
    /** Favourite service values (lowercased). */
    favServices: string[]
    /** Favourite actor names (lowercased). */
    favPeople: string[]
    excludeIds: Set<string>
    rand?: () => number
  },
): WatchNextCandidate | null {
  const pool = candidates.filter((c) => !opts.excludeIds.has(c.item.id))
  if (pool.length === 0) return null
  const rand = opts.rand ?? Math.random

  const weightOf = (c: WatchNextCandidate): number => {
    let w = 1
    // Genre affinity: sum how often the show's genres appear across what you're
    // watching, capped so it nudges rather than dominates.
    const g = (c.item.genres ?? []).reduce(
      (sum, name) => sum + (opts.genreFreq.get(name.toLowerCase()) ?? 0),
      0,
    )
    w += Math.min(g * 0.25, 2)
    // A flat nudge for a favourite service or a favourite actor in the cast.
    const providers = (c.item.providers ?? []).map((p) => p.toLowerCase())
    if (opts.favServices.some((f) => providers.some((p) => p.includes(f)))) w += 1.5
    const cast = (c.item.cast ?? []).map((a) => a.toLowerCase())
    if (opts.favPeople.some((n) => cast.includes(n))) w += 1.5
    return w
  }

  const weights = pool.map(weightOf)
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}
