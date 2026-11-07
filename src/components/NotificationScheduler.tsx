import { useEffect, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import { getTvmazeEpisodesByImdb } from '../api/tvmaze'
import { getEspnRaceSchedule, getEspnTeamSchedule, leagueByKey } from '../api/espn'
import {
  buildNotifyGroups,
  isNotifyEnabled,
  notifyPermission,
  syncNotifications,
  type AiringEntry,
} from '../data/notifications'
import { pushConfigured, registerPush } from '../data/push'
import { useCachedAirstamps } from '../hooks/useShowAirstamps'
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

  // Sports: a tracked team's games carry ESPN kickoff times. Fetch the current
  // season's schedule live (like TVmaze above) so a notification fires for an
  // upcoming game even if the team's detail page hasn't been opened recently.
  const sportTeams = (items ?? []).filter(
    (i) => i.status === 'watching' && i.mediaType === 'sport' && i.sport?.league,
  )
  const sportSeason = new Date().getFullYear()
  const sportSchedules = useQueries({
    queries: enabled
      ? sportTeams.map((s) => {
          const lg = leagueByKey(s.sport?.league)
          return {
            queryKey: ['espn-notify', s.sport?.league, s.sport?.teamId, sportSeason],
            queryFn: () =>
              lg?.kind === 'races'
                ? getEspnRaceSchedule(s.sport!.league, sportSeason)
                : getEspnTeamSchedule(s.sport!.league, s.sport!.teamId as string, sportSeason),
            enabled: !!lg,
            staleTime: 6 * 60 * 60 * 1000,
          }
        })
      : [],
  })
  const states = useLiveQuery<EpisodeState[]>(
    () => (enabled ? db.episodeStates.toArray() : Promise.resolve([])),
    [enabled],
  )

  // Prefer precise Trakt times (cached on the episode rows) over TVmaze — TVmaze
  // fills a noon-UTC placeholder for streaming shows, which would fire ~hours early.
  const cachedStamp = useCachedAirstamps(shows.map((s) => s.id))

  const seen = new Set(
    (states ?? [])
      .filter((s) => s.watched || s.skipped)
      .map((s) => `${s.itemId}:${s.season}:${s.episode}`),
  )
  const entries: AiringEntry[] = []
  shows.forEach((s, i) => {
    for (const e of tvmaze[i]?.data ?? []) {
      if (e.season === 0) continue
      const airstamp = cachedStamp(s.id, e.season, e.number) ?? e.airstamp
      if (!airstamp) continue
      if (seen.has(`${s.id}:${e.season}:${e.number}`)) continue
      entries.push({
        showTitle: s.title,
        season: e.season,
        episode: e.number,
        epName: e.name,
        airstamp,
      })
    }
  })

  // Games: the schedule is date-ordered, so game N is index N (matching how the
  // cache/episodeStates number them — see cacheSportGames), which keeps the
  // watched/skipped `seen` check aligned.
  sportTeams.forEach((s, i) => {
    const games = sportSchedules[i]?.data?.games ?? []
    games.forEach((g, gi) => {
      if (!g.date) return
      const epNo = gi + 1
      if (seen.has(`${s.id}:${sportSeason}:${epNo}`)) return
      entries.push({
        showTitle: s.title,
        season: sportSeason,
        episode: epNo,
        epName: g.name,
        airstamp: g.date,
        kind: 'game',
      })
    })
  })

  const ready =
    enabled &&
    items !== undefined &&
    states !== undefined &&
    !tvmaze.some((q) => q.isLoading) &&
    !sportSchedules.some((q) => q.isLoading)
  // Signature so the effect only re-syncs when the upcoming set actually changes.
  const sig = entries
    .map((e) => `${e.showTitle}:${e.season}:${e.episode}:${e.airstamp}`)
    .sort()
    .join('|')

  useEffect(() => {
    if (!ready) return
    const groups = buildNotifyGroups(entries)
    // With a push backend: hand the schedule to the Worker (fires when closed).
    // Otherwise: in-app timers (only while the app is open).
    if (pushConfigured()) void registerPush(groups)
    else void syncNotifications(groups)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sig])

  return null
}
