import { useEffect, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { getTvmazeEpisodesByImdb } from '../api/tvmaze'
import {
  buildNotifyGroups,
  isNotifyEnabled,
  notifyPermission,
  syncNotifications,
  type AiringEntry,
} from '../data/notifications'
import type { EpisodeState } from '../data/types'

const DAY = 1000 * 60 * 60 * 24

/**
 * Headless: keeps the scheduled "airing soon" notifications in sync with the
 * watching shows' upcoming episodes. Mounted once (in Layout). Does nothing
 * unless notifications are enabled and permission is granted.
 */
export default function NotificationScheduler() {
  // Re-read the enabled flag / permission when the toggle fires its event.
  const [, bump] = useState(0)
  useEffect(() => {
    const h = () => bump((n) => n + 1)
    window.addEventListener('tvtracker:notify', h)
    return () => window.removeEventListener('tvtracker:notify', h)
  }, [])
  const enabled = isNotifyEnabled() && notifyPermission() === 'granted'

  const items = useLiveQuery(() => db.trackedItems.toArray())
  const shows = (items ?? []).filter(
    (i) => i.status === 'watching' && i.mediaType === 'show' && i.imdbId,
  )
  const tvmaze = useQueries({
    queries: enabled
      ? shows.map((s) => ({
          queryKey: ['tvmaze', s.imdbId],
          queryFn: () => getTvmazeEpisodesByImdb(s.imdbId as string),
          staleTime: DAY,
        }))
      : [],
  })
  const states = useLiveQuery<EpisodeState[]>(
    () => (enabled ? db.episodeStates.toArray() : Promise.resolve([])),
    [enabled],
  )

  const watched = new Set(
    (states ?? []).filter((s) => s.watched).map((s) => `${s.itemId}:${s.season}:${s.episode}`),
  )
  const entries: AiringEntry[] = []
  shows.forEach((s, i) => {
    for (const e of tvmaze[i]?.data ?? []) {
      if (!e.airstamp || e.season === 0) continue
      if (watched.has(`${s.id}:${e.season}:${e.number}`)) continue
      entries.push({
        showTitle: s.title,
        season: e.season,
        episode: e.number,
        epName: e.name,
        airstamp: e.airstamp,
      })
    }
  })

  const ready = enabled && items !== undefined && states !== undefined && !tvmaze.some((q) => q.isLoading)
  // Signature so the effect only re-syncs when the upcoming set actually changes.
  const sig = entries
    .map((e) => `${e.showTitle}:${e.season}:${e.episode}:${e.airstamp}`)
    .sort()
    .join('|')

  useEffect(() => {
    if (!ready) return
    void syncNotifications(buildNotifyGroups(entries))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sig])

  return null
}
