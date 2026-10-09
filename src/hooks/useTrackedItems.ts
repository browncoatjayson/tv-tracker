import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import type { TrackedItem } from '../data/types'

const RECOVERED_KEY = 'tvtracker.liveQueryRecovered'

/**
 * `db.trackedItems` as a live query, with a self-heal for a Dexie glitch: now and
 * then (after a service-worker update, a sync, or the IndexedDB connection being
 * closed) a live query resolves to an empty array even though the data is still on
 * disk — the Library/Upcoming pages then look empty until the app is reopened.
 *
 * When the live query reports empty, we verify against the database directly. If
 * rows are actually there (or the read throws, i.e. the connection dropped), we
 * reload once to re-establish the subscription. A genuinely empty library reads
 * zero and never reloads. The once-flag (cleared on any successful non-empty read)
 * prevents a reload loop.
 */
export function useTrackedItems(): TrackedItem[] | undefined {
  const items = useLiveQuery(() => db.trackedItems.toArray())
  const checking = useRef(false)

  useEffect(() => {
    if (items === undefined) return
    if (items.length > 0) {
      // Healthy read — allow a future recovery if another glitch occurs.
      try {
        sessionStorage.removeItem(RECOVERED_KEY)
      } catch {
        // ignore
      }
      return
    }
    if (checking.current) return
    checking.current = true
    let cancelled = false
    ;(async () => {
      let actual = 0
      try {
        actual = await db.trackedItems.count()
      } catch {
        actual = -1 // connection closed/errored — reopening fixes it
      }
      checking.current = false
      if (cancelled || actual === 0) return // genuinely empty: nothing to recover
      let already = false
      try {
        already = sessionStorage.getItem(RECOVERED_KEY) === '1'
        sessionStorage.setItem(RECOVERED_KEY, '1')
      } catch {
        // ignore
      }
      if (!already) location.reload()
    })()
    return () => {
      cancelled = true
    }
  }, [items])

  return items
}
