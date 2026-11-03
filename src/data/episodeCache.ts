import { getSeasonEpisodes, getTvDetails, type TmdbEpisode, type TmdbTvDetails } from '../api/tmdb'
import { getTraktEpisodeTimes } from '../api/trakt'
import { db, episodeKey } from './db'
import type { CachedEpisode } from './types'

/**
 * Fetch show details and opportunistically cache the next/last episode names, so
 * a freshly-added show's upcoming episode is searchable before a full index runs.
 */
/**
 * TMDB has no air *time*, so when re-caching episode rows from TMDB, keep any
 * precise airstamp already stored (from Trakt) rather than clobbering it with
 * undefined. Mutates the rows in place.
 */
async function preserveAirstamps(rows: CachedEpisode[]): Promise<void> {
  if (rows.length === 0) return
  const existing = await db.episodeCache.bulkGet(rows.map((r) => r.id))
  rows.forEach((r, i) => {
    const prev = existing[i]?.airstamp
    if (prev && r.airstamp == null) r.airstamp = prev
  })
}

export async function getTvDetailsCached(itemId: string, tmdbId: number): Promise<TmdbTvDetails> {
  const details = await getTvDetails(tmdbId)
  const rows: CachedEpisode[] = []
  for (const ep of [details.next_episode_to_air, details.last_episode_to_air]) {
    if (ep?.name) {
      rows.push({
        id: episodeKey(itemId, ep.season_number, ep.episode_number),
        itemId,
        season: ep.season_number,
        episode: ep.episode_number,
        name: ep.name,
        airDate: ep.air_date,
      })
    }
  }
  if (rows.length) {
    try {
      await preserveAirstamps(rows)
      await db.episodeCache.bulkPut(rows)
    } catch {
      // best-effort
    }
  }
  return details
}

/**
 * Fetch a season's episodes from TMDB and store their names + air dates in the
 * local episode cache (used by Library episode search and the Upcoming calendar).
 * Returns the episodes so callers can use them directly as a query result.
 */
export async function getSeasonEpisodesCached(
  itemId: string,
  tmdbId: number,
  season: number,
): Promise<TmdbEpisode[]> {
  const episodes = await getSeasonEpisodes(tmdbId, season)
  const rows: CachedEpisode[] = episodes.map((e) => ({
    id: episodeKey(itemId, e.season_number, e.episode_number),
    itemId,
    season: e.season_number,
    episode: e.episode_number,
    name: e.name,
    airDate: e.air_date,
  }))
  try {
    await preserveAirstamps(rows)
    await db.episodeCache.bulkPut(rows)
  } catch {
    // Caching is best-effort; ignore storage failures.
  }
  return episodes
}

/**
 * Fetch this show's precise air times from Trakt and store them on the already-
 * cached episode rows (preferred over TVmaze for streaming shows). One Trakt
 * request for the whole show. Best-effort and a no-op when Trakt isn't
 * configured or has no times — callers still have the TVmaze fallback.
 */
export async function cacheTraktAirstamps(itemId: string, tmdbId: number): Promise<void> {
  try {
    const times = await getTraktEpisodeTimes(tmdbId)
    if (times.size === 0) return
    const rows = await db.episodeCache.where('itemId').equals(itemId).toArray()
    const updated = rows
      .map((r) => ({ row: r, stamp: times.get(`${r.season}:${r.episode}`) }))
      .filter((x) => x.stamp && x.stamp !== x.row.airstamp)
      .map((x) => ({ ...x.row, airstamp: x.stamp }))
    if (updated.length) await db.episodeCache.bulkPut(updated)
  } catch {
    // Best-effort; the TVmaze airstamp remains the fallback.
  }
}

/** Upsert one episode's precise air time (used to fill the viewed episode on the
 *  Episode page, bundled with its Trakt comment lookup). Best-effort. */
export async function cacheEpisodeAirstamp(ep: CachedEpisode): Promise<void> {
  try {
    const existing = await db.episodeCache.get(ep.id)
    if (existing?.airstamp === ep.airstamp) return
    await db.episodeCache.put({ ...existing, ...ep })
  } catch {
    // ignore storage errors
  }
}
