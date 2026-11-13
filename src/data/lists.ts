import { db } from './db'
import type { CustomList, ListItem, MediaType } from './types'

// ---------------------------------------------------------------------------
// Custom Lists — user-curated collections of titles (movies, shows, teams),
// TV Time-style. Stored in their own Dexie table (see db.ts v7), deliberately
// separate from the core backup so an uploaded banner never bloats routine
// syncs. Mutations bump `updatedAt` for last-write-wins when sync is added later.
//
// Reads are done directly in components with `useLiveQuery(() => db.lists...)`;
// this module owns the writes so the invariants (no dupes, updatedAt) live in one
// place.
// ---------------------------------------------------------------------------

/** A new title to add to a list (its id, type, and a display snapshot). */
export interface NewListItem {
  id: string
  mediaType: MediaType
  title: string
  poster?: string
}

function now(): number {
  return Date.now()
}

/** Create an empty list and return it (caller can then navigate to it). */
export async function createList(name = '', description = ''): Promise<CustomList> {
  const ts = now()
  const list: CustomList = {
    id: crypto.randomUUID(),
    name: name.trim() || 'New list',
    description: description.trim() || undefined,
    items: [],
    createdAt: ts,
    updatedAt: ts,
  }
  await db.lists.put(list)
  return list
}

export async function getList(id: string): Promise<CustomList | undefined> {
  return db.lists.get(id)
}

/** All lists, most recently updated first (for the Stats row). */
export async function getAllLists(): Promise<CustomList[]> {
  return db.lists.orderBy('updatedAt').reverse().toArray()
}

/**
 * Update a list's editable metadata. Pass only what changed. `banner: null`
 * clears the banner; omit `banner` to leave it untouched.
 */
export async function updateListMeta(
  id: string,
  patch: {
    name?: string
    description?: string
    banner?: string | null
    poster?: string | null
    favorite?: boolean
  },
): Promise<void> {
  const list = await db.lists.get(id)
  if (!list) return
  if (patch.name !== undefined) list.name = patch.name.trim() || 'New list'
  if (patch.description !== undefined) list.description = patch.description.trim() || undefined
  if (patch.banner !== undefined) list.banner = patch.banner ?? undefined
  if (patch.poster !== undefined) list.poster = patch.poster ?? undefined
  if (patch.favorite !== undefined) list.favorite = patch.favorite || undefined
  list.updatedAt = now()
  await db.lists.put(list)
}

export async function deleteList(id: string): Promise<void> {
  // Tombstone the deletion so a later sync removes it elsewhere instead of letting
  // another device's stale copy resurrect it.
  await db.transaction('rw', db.lists, db.listTombstones, async () => {
    await db.lists.delete(id)
    await db.listTombstones.put({ id, deletedAt: Date.now() })
  })
}

/** Add a title to a list (no-op if the list is gone or already contains it). */
export async function addToList(listId: string, item: NewListItem): Promise<void> {
  const list = await db.lists.get(listId)
  if (!list) return
  if (list.items.some((i) => i.id === item.id)) return
  const entry: ListItem = { ...item, addedAt: now() }
  list.items = [...list.items, entry]
  list.updatedAt = now()
  await db.lists.put(list)
}

/** Remove a title from a list by its id. */
export async function removeFromList(listId: string, itemId: string): Promise<void> {
  const list = await db.lists.get(listId)
  if (!list) return
  const items = list.items.filter((i) => i.id !== itemId)
  if (items.length === list.items.length) return
  list.items = items
  list.updatedAt = now()
  await db.lists.put(list)
}

/** Whether a list already contains a given title id (for the add-from-Search UI). */
export function listContains(list: CustomList | undefined, itemId: string): boolean {
  return !!list?.items.some((i) => i.id === itemId)
}
