import { db } from './db'
import type { EpisodeState, TrackedItem, Tombstone, WatchEvent } from './types'

// ---------------------------------------------------------------------------
// JSON backup / restore. This is the always-available safety net (and the same
// shape we'll sync to Google Drive in Phase 5). Keep `version` bumped whenever
// the shape changes so future imports can migrate old files.
// ---------------------------------------------------------------------------

// v2 adds `tombstones` (delete markers). v1 files still import — tombstones
// default to [] — so this bump is backward compatible.
export const BACKUP_VERSION = 2 as const

export interface BackupData {
  app: 'tv-tracker'
  version: number
  exportedAt: number
  trackedItems: TrackedItem[]
  watchEvents: WatchEvent[]
  episodeStates: EpisodeState[]
  /** Delete markers so removals propagate on sync (absent in v1 backups). */
  tombstones?: Tombstone[]
}

/** Read the entire user dataset out of IndexedDB. */
export async function buildBackup(): Promise<BackupData> {
  const [trackedItems, watchEvents, episodeStates, tombstones] = await Promise.all([
    db.trackedItems.toArray(),
    db.watchEvents.toArray(),
    db.episodeStates.toArray(),
    db.tombstones.toArray(),
  ])
  return {
    app: 'tv-tracker',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    trackedItems,
    watchEvents,
    episodeStates,
    tombstones,
  }
}

/** localStorage key recording when the user last exported a backup (for stats). */
export const LAST_EXPORT_KEY = 'tvtracker.lastExport'

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
  try {
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()))
  } catch {
    // ignore storage errors
  }
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

/** Write a (already-parsed) backup into the local DB. */
export async function applyBackup(data: BackupData, mode: ImportMode): Promise<void> {
  const tombstones = data.tombstones ?? []
  await db.transaction(
    'rw',
    db.trackedItems,
    db.watchEvents,
    db.episodeStates,
    db.tombstones,
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.trackedItems.clear(),
          db.watchEvents.clear(),
          db.episodeStates.clear(),
          db.tombstones.clear(),
        ])
      }
      // `bulkPut` upserts by primary key — safe for both modes.
      await db.trackedItems.bulkPut(data.trackedItems)
      await db.episodeStates.bulkPut(data.episodeStates)
      // Watch events use auto-increment ids; drop them so the local log assigns
      // fresh ones (the append-only log only ever grows).
      const events =
        mode === 'merge' ? data.watchEvents.map(({ id: _id, ...rest }) => rest) : data.watchEvents
      await db.watchEvents.bulkPut(events)
      await db.tombstones.bulkPut(tombstones)

      // Apply deletions: a tombstone at/after an item's last update removes it and
      // its history. (On a sync-replace the merged data already excludes these, so
      // this just makes file-merge imports honor deletions too.)
      for (const t of tombstones) {
        const it = await db.trackedItems.get(t.id)
        if (it && (it.updatedAt ?? 0) <= t.deletedAt) {
          await db.trackedItems.delete(t.id)
          await db.watchEvents.where('itemId').equals(t.id).delete()
          await db.episodeStates.where('itemId').equals(t.id).delete()
        }
      }
    },
  )
}

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

  await applyBackup(parsed, mode)

  return {
    items: parsed.trackedItems.length,
    events: parsed.watchEvents.length,
    episodes: parsed.episodeStates.length,
  }
}

// --- Merge (for cross-device sync, Phase 5) ----------------------------------

/** Stable, content-based signature so re-syncing the same watch event is idempotent. */
function eventSignature(e: WatchEvent): string {
  return `${e.itemId}|${e.episodeId}|${e.watchedAt}|${e.isRewatch}`
}

/**
 * Merge two backups into one, with no data loss:
 *  - trackedItems & episodeStates: last-write-wins by `updatedAt` (keyed by id).
 *  - watchEvents: union by content signature (append-only; duplicates collapsed).
 *  - tombstones: an item deleted at/after its last update is dropped (and its
 *    episodes/events pruned); a later re-add (newer updatedAt) wins and clears
 *    the tombstone. This stops a removed title being resurrected from the other
 *    device's stale copy.
 * The result is deterministic regardless of argument order, so both devices
 * converge on the same dataset.
 */
export function mergeBackups(a: BackupData, b: BackupData): BackupData {
  // Latest deletion time per id across both sides.
  const tombstones = new Map<string, number>()
  for (const t of [...(a.tombstones ?? []), ...(b.tombstones ?? [])]) {
    const prev = tombstones.get(t.id)
    if (prev === undefined || t.deletedAt > prev) tombstones.set(t.id, t.deletedAt)
  }

  const items = new Map<string, TrackedItem>()
  for (const it of [...a.trackedItems, ...b.trackedItems]) {
    const prev = items.get(it.id)
    if (!prev || (it.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) items.set(it.id, it)
  }

  // Drop items whose newest state predates (or equals) a deletion; keep an item
  // that was re-added after the delete, and clear that now-stale tombstone.
  for (const [id, it] of [...items]) {
    const del = tombstones.get(id)
    if (del === undefined) continue
    if ((it.updatedAt ?? 0) > del) tombstones.delete(id)
    else items.delete(id)
  }
  const isDeleted = (id: string) => !items.has(id) && tombstones.has(id)

  const episodes = new Map<string, EpisodeState>()
  for (const ep of [...a.episodeStates, ...b.episodeStates]) {
    if (isDeleted(ep.itemId)) continue
    const prev = episodes.get(ep.id)
    const ts = (e: EpisodeState) => e.updatedAt ?? e.watchedAt ?? 0
    if (!prev || ts(ep) >= ts(prev)) episodes.set(ep.id, ep)
  }

  const events = new Map<string, WatchEvent>()
  for (const ev of [...a.watchEvents, ...b.watchEvents]) {
    if (isDeleted(ev.itemId)) continue
    const { id: _id, ...rest } = ev
    events.set(eventSignature(ev), rest)
  }

  return {
    app: 'tv-tracker',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    trackedItems: [...items.values()],
    episodeStates: [...episodes.values()],
    watchEvents: [...events.values()],
    tombstones: [...tombstones.entries()].map(([id, deletedAt]) => ({ id, deletedAt })),
  }
}
