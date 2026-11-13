import { db } from './db'
import { applyProfileData, getProfileData } from './profileImages'
import type { CustomList, ProfileData, Tombstone } from './types'

// ---------------------------------------------------------------------------
// "Extras" = the data kept OUT of the core backup: custom lists (with their
// base64 images) + profile customization (avatar/backdrop). On Drive these sync
// as their own file (tvtracker-extras.json), so routine core syncs stay small;
// the manual backup embeds the same payload so a downloaded file is complete.
//
// This module owns the shared build / apply / merge of that payload so the Drive
// sync and the manual export/import behave identically. Merge is deterministic:
// lists are last-write-wins by updatedAt (with tombstones for deletes), and the
// profile is last-write-wins by its own updatedAt.
// ---------------------------------------------------------------------------

type Mode = 'merge' | 'replace'

export interface ExtrasPayload {
  lists: CustomList[]
  listTombstones: Tombstone[]
  profile: ProfileData
}

/** Read the current extras out of the local DB + profile storage. */
export async function buildExtrasPayload(): Promise<ExtrasPayload> {
  const [lists, listTombstones] = await Promise.all([
    db.lists.toArray(),
    db.listTombstones.toArray(),
  ])
  return { lists, listTombstones, profile: getProfileData() }
}

/**
 * Write an extras payload into the local DB. `replace` wipes lists/tombstones
 * first (used for the already-merged Drive result and a replace import); `merge`
 * upserts. Either way, tombstones are honored (a list deleted at/after its last
 * update is dropped), and the profile is taken when it's newer (merge) or always
 * (replace).
 */
export async function applyExtrasPayload(p: ExtrasPayload, mode: Mode): Promise<void> {
  await db.transaction('rw', db.lists, db.listTombstones, async () => {
    if (mode === 'replace') {
      await Promise.all([db.lists.clear(), db.listTombstones.clear()])
    }
    if (p.lists.length) await db.lists.bulkPut(p.lists)
    if (p.listTombstones.length) await db.listTombstones.bulkPut(p.listTombstones)
    // Drop any list whose newest state is at/before its deletion marker.
    for (const t of p.listTombstones) {
      const l = await db.lists.get(t.id)
      if (l && l.updatedAt <= t.deletedAt) await db.lists.delete(t.id)
    }
  })
  if (mode === 'replace' || p.profile.updatedAt > getProfileData().updatedAt) {
    applyProfileData(p.profile)
  }
}

/** Merge two extras payloads with no loss — deterministic regardless of order. */
export function mergeExtrasPayload(a: ExtrasPayload, b: ExtrasPayload): ExtrasPayload {
  // Latest deletion time per list id.
  const tomb = new Map<string, number>()
  for (const t of [...a.listTombstones, ...b.listTombstones]) {
    const prev = tomb.get(t.id)
    if (prev === undefined || t.deletedAt > prev) tomb.set(t.id, t.deletedAt)
  }
  // Lists: last-write-wins by updatedAt, keyed by id.
  const lists = new Map<string, CustomList>()
  for (const l of [...a.lists, ...b.lists]) {
    const prev = lists.get(l.id)
    if (!prev || l.updatedAt >= prev.updatedAt) lists.set(l.id, l)
  }
  // A list deleted at/after its last update is dropped; one re-created after the
  // delete (newer updatedAt) wins and clears that now-stale tombstone.
  for (const [id, l] of [...lists]) {
    const del = tomb.get(id)
    if (del === undefined) continue
    if (l.updatedAt > del) tomb.delete(id)
    else lists.delete(id)
  }
  // Profile: last-write-wins by its own timestamp.
  const profile = a.profile.updatedAt >= b.profile.updatedAt ? a.profile : b.profile
  return {
    lists: [...lists.values()],
    listTombstones: [...tomb.entries()].map(([id, deletedAt]) => ({ id, deletedAt })),
    profile,
  }
}

// --- Drive file wrapper (tvtracker-extras.json) ------------------------------
export const EXTRAS_VERSION = 1 as const

export interface ExtrasFile extends ExtrasPayload {
  app: 'tv-tracker-extras'
  version: number
  exportedAt: number
}

export function toExtrasFile(p: ExtrasPayload): ExtrasFile {
  return { app: 'tv-tracker-extras', version: EXTRAS_VERSION, exportedAt: Date.now(), ...p }
}

export function isExtrasFile(v: unknown): v is ExtrasFile {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return o.app === 'tv-tracker-extras' && Array.isArray(o.lists)
}
