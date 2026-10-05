import { fetchWatchedHistory, recordTraktSync } from '../api/trakt'
import { parseTrakt } from './importers/trakt'
import { resolveTmdbIds, type ResolveProgress } from './importers/resolve'
import { applyImport, type ImportSummary } from './importers/build'

export interface TraktSyncResult extends ImportSummary {
  unmatched: number
}

/**
 * Pull the signed-in user's Trakt watch history into the local library, matching
 * titles to TMDB and merging (no duplicates — same engine as the file import and
 * Drive sync). Reports TMDB-matching progress.
 */
export async function syncTraktHistory(
  onProgress?: (p: ResolveProgress) => void,
): Promise<TraktSyncResult> {
  const entries = await fetchWatchedHistory()
  const items = parseTrakt(entries)
  const { resolved, unmatched } = await resolveTmdbIds(items, onProgress)
  const summary = await applyImport(resolved, 'merge')
  recordTraktSync()
  return { ...summary, unmatched: unmatched.length }
}
