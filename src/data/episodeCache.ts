import { getSeasonEpisodes, getTvDetails, type TmdbEpisode, type TmdbTvDetails } from '../api/tmdb'
import { db, episodeKey } from './db'
import type { CachedEpisode } from './types'

/**
 * Fetch show details and opportunistically cache the next/last episode names, so
 * a freshly-added show's upcoming episode is searchable before a full index runs.
 */
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
    await db.episodeCache.bulkPut(rows)
  } catch {
    // Caching is best-effort; ignore storage failures.
  }
  return episodes
}
