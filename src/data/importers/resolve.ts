import { findByExternalId } from '../../api/tmdb'
import type { ImportItem, ResolvedImportItem } from './types'

export interface ResolveProgress {
  done: number
  total: number
}

export interface ResolveOutcome {
  resolved: ResolvedImportItem[]
  unmatched: ImportItem[]
}

/** Resolve one item's external id(s) to a TMDB match, or null if none found. */
async function resolveOne(item: ImportItem): Promise<ResolvedImportItem | null> {
  const tmdbMediaType = item.mediaType === 'show' ? 'tv' : 'movie'

  // Prefer IMDb (movies), then TheTVDB (shows). Try both before giving up.
  const attempts: { source: 'imdb_id' | 'tvdb_id'; id: string | number }[] = []
  if (item.imdbId) attempts.push({ source: 'imdb_id', id: item.imdbId })
  if (item.tvdbId) attempts.push({ source: 'tvdb_id', id: item.tvdbId })

  for (const attempt of attempts) {
    try {
      const hit = await findByExternalId(attempt.source, attempt.id, tmdbMediaType)
      if (hit) {
        return {
          ...item,
          tmdbId: hit.tmdbId,
          posterPath: hit.posterPath,
          year: hit.year,
          // Keep TV Time's IMDb id if we had one; otherwise leave it to backfill.
          imdbId: item.imdbId,
        }
      }
    } catch {
      // Network/HTTP error for this id — fall through to the next attempt.
    }
  }
  return null
}

/**
 * Resolve every item to a TMDB id, a few at a time to stay friendly to the API.
 * Reports progress as it goes and separates out anything that couldn't be matched.
 */
export async function resolveTmdbIds(
  items: ImportItem[],
  onProgress?: (p: ResolveProgress) => void,
  concurrency = 5,
): Promise<ResolveOutcome> {
  const resolved: ResolvedImportItem[] = []
  const unmatched: ImportItem[] = []
  let done = 0
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++]
      const result = await resolveOne(item)
      if (result) resolved.push(result)
      else unmatched.push(item)
      done += 1
      onProgress?.({ done, total: items.length })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return { resolved, unmatched }
}
