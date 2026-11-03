import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTvmazeEpisodesByImdb } from '../api/tvmaze'
import { db } from '../data/db'
import type { CachedEpisode } from '../data/types'

const DAY = 1000 * 60 * 60 * 24

/**
 * Precise episode air times for a single show. Prefers Trakt times cached on the
 * episode rows (populated by the indexer and the Episode page — more reliable
 * for streaming shows than TVmaze), and falls back to TVmaze (matched by IMDb
 * id). Returns a lookup `(season, episode) => airstamp | undefined`.
 */
export function useShowAirstamps(
  itemId: string | undefined,
  imdbId: string | undefined,
): (season: number, episode: number) => string | undefined {
  // Preferred source: Trakt airstamps cached on the episode rows.
  const cached = useLiveQuery<CachedEpisode[]>(
    () =>
      itemId
        ? db.episodeCache.where('itemId').equals(itemId).toArray()
        : Promise.resolve([] as CachedEpisode[]),
    [itemId],
  )
  const traktMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of cached ?? []) if (e.airstamp) m.set(`${e.season}:${e.episode}`, e.airstamp)
    return m
  }, [cached])

  // Fallback source: TVmaze (one fetch per show, persisted for a day).
  const { data } = useQuery({
    queryKey: ['tvmaze', imdbId],
    queryFn: () => getTvmazeEpisodesByImdb(imdbId as string),
    enabled: !!imdbId,
    staleTime: DAY,
  })
  const tvmazeMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of data ?? []) if (e.airstamp) m.set(`${e.season}:${e.number}`, e.airstamp)
    return m
  }, [data])

  return (season, episode) => {
    const k = `${season}:${episode}`
    return traktMap.get(k) ?? tvmazeMap.get(k)
  }
}

/**
 * Cached Trakt airstamps for many shows at once (Upcoming, notifications), keyed
 * by item. Reads only the episode cache — no network — so it just augments the
 * TVmaze times those views already fetch. Returns `(itemId, season, episode) =>
 * airstamp | undefined`.
 */
export function useCachedAirstamps(
  itemIds: string[],
): (itemId: string, season: number, episode: number) => string | undefined {
  const key = itemIds.join(',')
  const rows = useLiveQuery<CachedEpisode[]>(
    () =>
      itemIds.length
        ? db.episodeCache.where('itemId').anyOf(itemIds).toArray()
        : Promise.resolve([] as CachedEpisode[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  const map = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of rows ?? []) if (e.airstamp) m.set(`${e.itemId}:${e.season}:${e.episode}`, e.airstamp)
    return m
  }, [rows])
  return (itemId, season, episode) => map.get(`${itemId}:${season}:${episode}`)
}
