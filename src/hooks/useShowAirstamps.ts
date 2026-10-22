import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTvmazeEpisodesByImdb } from '../api/tvmaze'

const DAY = 1000 * 60 * 60 * 24

/**
 * Precise episode air times (from TVmaze) for a single show, matched by IMDb id.
 * Returns a lookup `(season, episode) => airstamp | undefined`. No-op (always
 * undefined) when the show has no IMDb id yet or TVmaze has no match.
 */
export function useShowAirstamps(
  imdbId: string | undefined,
): (season: number, episode: number) => string | undefined {
  const { data } = useQuery({
    queryKey: ['tvmaze', imdbId],
    queryFn: () => getTvmazeEpisodesByImdb(imdbId as string),
    enabled: !!imdbId,
    staleTime: DAY,
  })
  const map = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of data ?? []) if (e.airstamp) m.set(`${e.season}:${e.number}`, e.airstamp)
    return m
  }, [data])
  return (season, episode) => map.get(`${season}:${episode}`)
}
