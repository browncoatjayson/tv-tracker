import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

// Shared streaming-service list (used by the filter bar, Settings, and the
// Search "Now Streaming" section). `value` is a case-insensitive substring
// matched against TMDB provider names (see matchesFilter / discover).
export interface Service {
  label: string
  value: string
}

export const SERVICES: Service[] = [
  { label: 'Netflix', value: 'netflix' },
  { label: 'Hulu', value: 'hulu' },
  { label: 'Max', value: 'max' },
  { label: 'Disney+', value: 'disney plus' },
  { label: 'Apple TV+', value: 'apple tv' },
  { label: 'Prime Video', value: 'prime video' },
  { label: 'Paramount+', value: 'paramount plus' },
  { label: 'Peacock', value: 'peacock' },
  { label: 'Crunchyroll', value: 'crunchyroll' },
]

/** Star or un-star a service. Un-starring keeps a soft-deleted record so the
 *  change propagates on sync (merge is last-write-wins by updatedAt). */
export async function toggleFavoriteService(value: string, on: boolean): Promise<void> {
  const now = Date.now()
  const existing = await db.favoriteServices.get(value)
  const label = SERVICES.find((s) => s.value === value)?.label ?? existing?.label ?? value
  await db.favoriteServices.put({
    id: value,
    label,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
    removed: !on,
  })
}

/** Live list of favorite service values (soft-deleted ones excluded). */
export function useFavoriteServices(): string[] {
  return (
    useLiveQuery(
      () =>
        db.favoriteServices
          .filter((s) => !s.removed)
          .toArray()
          .then((rows) => rows.map((r) => r.id)),
      [],
    ) ?? []
  )
}
