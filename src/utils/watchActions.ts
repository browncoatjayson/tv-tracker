import { hasAired } from '../api/tmdb'
import { db } from '../data/db'
import { getSeasonEpisodesCached, getTvDetailsCached } from '../data/episodeCache'
import { markEpisode } from '../data/library'
import type { CachedEpisode } from '../data/types'
import { appConfirm } from './confirm'

/** Parse the TMDB id out of an item id like "show:1396". */
function tmdbIdOf(itemId: string): number {
  return Number(itemId.split(':')[1])
}

/**
 * Mark an episode watched, then — if earlier *aired* episodes (in any season) are
 * still unwatched — offer to mark all of them too. Shared by the Show, Episode
 * and Upcoming views so "I just watched S2E5" can catch up everything before it.
 *
 * Resolves after the catch-up (or immediately when there's nothing earlier). The
 * season walk is best-effort: a details/episode fetch failure just skips the
 * offer, leaving the one episode marked. Specials (season 0) have no linear
 * predecessors, so they never prompt.
 */
export async function markWatchedWithCatchUp(
  itemId: string,
  season: number,
  episode: number,
): Promise<void> {
  await markEpisode(itemId, season, episode, true)
  if (season < 1) return

  const tmdbId = tmdbIdOf(itemId)
  if (!Number.isFinite(tmdbId)) return

  const previous: { season: number; episode: number }[] = []
  try {
    const states = await db.episodeStates.where('itemId').equals(itemId).toArray()
    const watched = new Set(states.filter((s) => s.watched).map((s) => `${s.season}:${s.episode}`))

    // The authoritative season list + per-season episode counts (so we can tell
    // when the local cache is missing episodes and needs a refetch).
    const details = await getTvDetailsCached(itemId, tmdbId)
    const cached = await db.episodeCache.where('itemId').equals(itemId).toArray()
    const cachedBySeason = new Map<number, CachedEpisode[]>()
    for (const e of cached) {
      const arr = cachedBySeason.get(e.season) ?? []
      arr.push(e)
      cachedBySeason.set(e.season, arr)
    }

    const seasons = (details.seasons ?? [])
      .filter((s) => s.season_number >= 1 && s.season_number <= season)
      .sort((a, b) => a.season_number - b.season_number)

    for (const s of seasons) {
      let eps = (cachedBySeason.get(s.season_number) ?? []).map((e) => ({
        season: e.season,
        episode: e.episode,
        airDate: e.airDate,
      }))
      // Refetch (and recache) a season whose local copy looks incomplete.
      if (eps.length < s.episode_count) {
        const fetched = await getSeasonEpisodesCached(itemId, tmdbId, s.season_number)
        eps = fetched.map((e) => ({
          season: e.season_number,
          episode: e.episode_number,
          airDate: e.air_date,
        }))
      }
      for (const e of eps) {
        const before = e.season < season || (e.season === season && e.episode < episode)
        if (!before || !hasAired(e.airDate)) continue
        if (watched.has(`${e.season}:${e.episode}`)) continue
        previous.push({ season: e.season, episode: e.episode })
      }
    }
  } catch {
    return // best-effort; the single episode stays marked
  }

  if (previous.length === 0) return
  const ok = await appConfirm(
    `Mark ${previous.length} earlier ${previous.length === 1 ? 'episode' : 'episodes'} as watched too?`,
  )
  if (!ok) return
  for (const p of previous) {
    await markEpisode(itemId, p.season, p.episode, true)
  }
}
