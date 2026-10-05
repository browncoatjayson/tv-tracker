import { episodeKey, itemKey } from '../db'
import {
  applyBackup,
  BACKUP_VERSION,
  buildBackup,
  mergeBackups,
  type BackupData,
  type ImportMode,
} from '../exportImport'
import type { EpisodeState, TrackedItem, WatchEvent } from '../types'
import type { ResolvedImportItem } from './types'

/** Turn resolved import items into our backup shape (titles, episodes, watch log). */
export function buildBackupFromImport(resolved: ResolvedImportItem[]): BackupData {
  const now = Date.now()
  const trackedItems: TrackedItem[] = []
  const episodeStates: EpisodeState[] = []
  const watchEvents: WatchEvent[] = []
  const seen = new Set<string>()

  for (const it of resolved) {
    const id = itemKey(it.mediaType, it.tmdbId)
    if (seen.has(id)) continue // same TMDB title listed twice — keep the first
    seen.add(id)

    // Movie watch timestamps (array form, falling back to the single field).
    const movieAts = (it.movieWatchedAts ?? (it.movieWatchedAt != null ? [it.movieWatchedAt] : []))
      .slice()
      .sort((a, b) => a - b)

    trackedItems.push({
      id,
      tmdbId: it.tmdbId,
      imdbId: it.imdbId,
      mediaType: it.mediaType,
      title: it.title,
      posterPath: it.posterPath,
      year: it.year,
      status: it.status,
      ...(it.mediaType === 'movie' && movieAts.length
        ? { movieWatchedAt: movieAts[movieAts.length - 1], movieWatchedPrecision: 'day' as const }
        : {}),
      addedAt: now,
      updatedAt: now,
    })

    if (it.mediaType === 'movie') {
      movieAts.forEach((at, i) => {
        watchEvents.push({ itemId: id, episodeId: null, watchedAt: at, isRewatch: i > 0 })
      })
    }

    if (it.mediaType === 'show') {
      for (const ep of it.watchedEpisodes ?? []) {
        const ats = (ep.watchedAts ?? (ep.watchedAt != null ? [ep.watchedAt] : [now]))
          .slice()
          .sort((a, b) => a - b)
        const last = ats[ats.length - 1] ?? now
        episodeStates.push({
          id: episodeKey(id, ep.season, ep.episode),
          itemId: id,
          season: ep.season,
          episode: ep.episode,
          watched: true,
          watchCount: ats.length,
          watchedAt: last,
          updatedAt: last,
        })
        ats.forEach((at, i) => {
          watchEvents.push({
            itemId: id,
            episodeId: `${ep.season}x${ep.episode}`,
            watchedAt: at,
            isRewatch: i > 0,
          })
        })
      }
    }
  }

  return {
    app: 'tv-tracker',
    version: BACKUP_VERSION,
    exportedAt: now,
    trackedItems,
    episodeStates,
    watchEvents,
  }
}

export interface ImportSummary {
  items: number
  episodes: number
  events: number
}

/** Write the resolved import into the local DB, honoring merge/replace. */
export async function applyImport(
  resolved: ResolvedImportItem[],
  mode: ImportMode,
): Promise<ImportSummary> {
  const incoming = buildBackupFromImport(resolved)
  if (mode === 'replace') {
    await applyBackup(incoming, 'replace')
  } else {
    // Merge with current data the same way sync does (idempotent, no dupes).
    const local = await buildBackup()
    await applyBackup(mergeBackups(local, incoming), 'replace')
  }
  return {
    items: incoming.trackedItems.length,
    episodes: incoming.episodeStates.length,
    events: incoming.watchEvents.length,
  }
}
