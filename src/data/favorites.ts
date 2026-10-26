import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { FavoritePerson } from './types'

/** Star or un-star an actor. Un-starring keeps a soft-deleted record so the
 *  change still propagates on sync (merge is last-write-wins by updatedAt). */
export async function setFavoritePerson(
  person: { id: number; name: string; profilePath?: string | null },
  on: boolean,
): Promise<void> {
  const now = Date.now()
  const existing = await db.favoritePeople.get(person.id)
  await db.favoritePeople.put({
    id: person.id,
    name: person.name,
    profilePath: person.profilePath ?? existing?.profilePath ?? null,
    favoritedAt: existing?.favoritedAt ?? now,
    updatedAt: now,
    removed: !on,
  })
}

/** Live list of starred actors (soft-deleted ones excluded), newest first. */
export function useFavoritePeople(): FavoritePerson[] | undefined {
  return useLiveQuery(
    () =>
      db.favoritePeople
        .filter((p) => !p.removed)
        .toArray()
        .then((rows) => rows.sort((a, b) => b.favoritedAt - a.favoritedAt)),
    [],
  )
}

/** Live set of starred actor ids, for quick "is this one starred?" checks. */
export function useFavoritePersonIds(): Set<number> {
  const people = useLiveQuery(
    () => db.favoritePeople.filter((p) => !p.removed).toArray(),
    [],
  )
  return new Set((people ?? []).map((p) => p.id))
}
