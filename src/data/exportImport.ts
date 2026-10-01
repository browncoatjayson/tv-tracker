import { db } from './db'
import type { EpisodeState, TrackedItem, WatchEvent } from './types'

// ---------------------------------------------------------------------------
// JSON backup / restore. This is the always-available safety net (and the same
// shape we'll sync to Google Drive in Phase 5). Keep `version` bumped whenever
// the shape changes so future imports can migrate old files.
// ---------------------------------------------------------------------------

export const BACKUP_VERSION = 1 as const

export interface BackupData {
  app: 'tv-tracker'
  version: typeof BACKUP_VERSION
  exportedAt: number
  trackedItems: TrackedItem[]
  watchEvents: WatchEvent[]
  episodeStates: EpisodeState[]
}

/** Read the entire user dataset out of IndexedDB. */
export async function buildBackup(): Promise<BackupData> {
  const [trackedItems, watchEvents, episodeStates] = await Promise.all([
    db.trackedItems.toArray(),
    db.watchEvents.toArray(),
    db.episodeStates.toArray(),
  ])
  return {
    app: 'tv-tracker',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    trackedItems,
    watchEvents,
    episodeStates,
  }
}

/** Trigger a browser download of the current backup as a .json file. */
export async function downloadBackup(): Promise<void> {
  const data = await buildBackup()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const date = new Date().toISOString().slice(0, 10)
  const a = document.createElement('a')
  a.href = url
  a.download = `tv-tracker-backup-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Validate that an unknown parsed object looks like a backup we can import. */
function isBackup(value: unknown): value is BackupData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.app === 'tv-tracker' &&
    typeof v.version === 'number' &&
    Array.isArray(v.trackedItems) &&
    Array.isArray(v.watchEvents) &&
    Array.isArray(v.episodeStates)
  )
}

export type ImportMode =
  /** Wipe existing data and load the backup wholesale. */
  | 'replace'
  /** Keep existing data; add/overwrite items from the backup by id. */
  | 'merge'

/** Parse and import a backup file's text. Returns counts for a confirmation message. */
export async function importBackup(
  json: string,
  mode: ImportMode,
): Promise<{ items: number; events: number; episodes: number }> {
  const parsed: unknown = JSON.parse(json)
  if (!isBackup(parsed)) {
    throw new Error('This file is not a valid TV Tracker backup.')
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app.')
  }

  await db.transaction('rw', db.trackedItems, db.watchEvents, db.episodeStates, async () => {
    if (mode === 'replace') {
      await Promise.all([
        db.trackedItems.clear(),
        db.watchEvents.clear(),
        db.episodeStates.clear(),
      ])
    }
    // `bulkPut` upserts by primary key — safe for both modes.
    await db.trackedItems.bulkPut(parsed.trackedItems)
    await db.episodeStates.bulkPut(parsed.episodeStates)
    // Watch events use auto-increment ids; on merge we drop the ids so the log
    // only ever grows (append-only) and we never clobber local history.
    const events = mode === 'merge'
      ? parsed.watchEvents.map(({ id: _id, ...rest }) => rest)
      : parsed.watchEvents
    await db.watchEvents.bulkPut(events)
  })

  return {
    items: parsed.trackedItems.length,
    events: parsed.watchEvents.length,
    episodes: parsed.episodeStates.length,
  }
}
