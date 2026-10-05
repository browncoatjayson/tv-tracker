import type { ImportItem } from './types'

// ---------------------------------------------------------------------------
// Parser for a Trakt history export (a JSON array of watch events). Each entry
// has a type ('episode' | 'movie') and carries TMDB ids directly, plus the
// season/episode numbers and the individual watched_at timestamp — so we keep
// full rewatch history and need no external-id lookup.
// ---------------------------------------------------------------------------

interface TraktIds {
  trakt?: number
  imdb?: string
  tvdb?: number
  tmdb?: number
}
interface TraktEntry {
  watched_at?: string
  type?: 'episode' | 'movie'
  episode?: { season: number; number: number; title?: string; ids?: TraktIds }
  show?: { title?: string; year?: number; ids?: TraktIds }
  movie?: { title?: string; year?: number; ids?: TraktIds }
}

function toMs(value?: string): number | undefined {
  if (!value) return undefined
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : undefined
}

function cleanImdb(v?: string): string | undefined {
  return v && v !== 'null' && v !== '-1' ? v : undefined
}

export function parseTrakt(data: unknown): ImportItem[] {
  if (!Array.isArray(data)) {
    throw new Error('This doesn’t look like a Trakt history file (expected a JSON array).')
  }
  const entries = data as TraktEntry[]

  const shows = new Map<
    number,
    {
      title: string
      imdb?: string
      eps: Map<string, { season: number; episode: number; ats: number[] }>
    }
  >()
  const movies = new Map<number, { title: string; imdb?: string; ats: number[] }>()

  for (const e of entries) {
    const at = toMs(e.watched_at)
    if (e.type === 'episode' && e.episode && e.show) {
      const tmdb = e.show.ids?.tmdb
      if (!tmdb) continue
      let s = shows.get(tmdb)
      if (!s) {
        s = { title: e.show.title ?? 'Untitled', imdb: cleanImdb(e.show.ids?.imdb), eps: new Map() }
        shows.set(tmdb, s)
      }
      const key = `${e.episode.season}:${e.episode.number}`
      let ep = s.eps.get(key)
      if (!ep) {
        ep = { season: e.episode.season, episode: e.episode.number, ats: [] }
        s.eps.set(key, ep)
      }
      if (at !== undefined) ep.ats.push(at)
    } else if (e.type === 'movie' && e.movie) {
      const tmdb = e.movie.ids?.tmdb
      if (!tmdb) continue
      let m = movies.get(tmdb)
      if (!m) {
        m = { title: e.movie.title ?? 'Untitled', imdb: cleanImdb(e.movie.ids?.imdb), ats: [] }
        movies.set(tmdb, m)
      }
      if (at !== undefined) m.ats.push(at)
    }
  }

  const items: ImportItem[] = []
  for (const [tmdbId, s] of shows) {
    items.push({
      mediaType: 'show',
      title: s.title,
      tmdbId,
      imdbId: s.imdb,
      // Status refines to "completed" on first view (ended + all watched).
      status: 'watching',
      watchedEpisodes: [...s.eps.values()].map((ep) => ({
        season: ep.season,
        episode: ep.episode,
        watchedAts: [...ep.ats].sort((a, b) => a - b),
      })),
    })
  }
  for (const [tmdbId, m] of movies) {
    items.push({
      mediaType: 'movie',
      title: m.title,
      tmdbId,
      imdbId: m.imdb,
      status: 'completed',
      movieWatchedAts: [...m.ats].sort((a, b) => a - b),
    })
  }
  return items
}

export async function parseTraktJson(file: File | Blob): Promise<ImportItem[]> {
  return parseTrakt(JSON.parse(await file.text()))
}
