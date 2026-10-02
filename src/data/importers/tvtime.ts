import type { WatchStatus } from '../types'
import type { ImportItem } from './types'

// ---------------------------------------------------------------------------
// Parser for a TV Time data export (a .zip of JSON/CSV files).
// We use movies.json + shows.json, which together contain everything (the
// watchlist.csv in the export is just a flattened duplicate of those two).
// ---------------------------------------------------------------------------

// TV Time show status -> our status. Unknown values fall back to watchlist.
const STATUS_MAP: Record<string, WatchStatus> = {
  up_to_date: 'completed',
  continuing: 'watching',
  not_started_yet: 'watchlist',
  watch_later: 'watchlist',
  stopped: 'dropped',
}

/** Parse a TV Time timestamp. Handles ISO ("...Z") and "YYYY-MM-DD HH:MM:SS" (UTC). */
function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined
  // Space-separated form has no timezone; TV Time stores these as UTC.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : undefined
}

/** A usable id is a non-empty value that isn't TV Time's "-1" placeholder. */
function cleanId(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  return s && s !== '-1' ? s : undefined
}

interface TvTimeMovie {
  id?: { tvdb?: number; imdb?: string }
  title?: string
  watched_at?: string
  is_watched?: boolean
}

interface TvTimeShow {
  id?: { tvdb?: number; imdb?: string }
  title?: string
  status?: string
  seasons?: {
    number: number
    episodes?: { number: number; special?: boolean; is_watched?: boolean; watched_at?: string }[]
  }[]
}

/** Build ImportItems from the parsed movies.json and shows.json arrays. */
export function parseTvTime(movies: unknown, shows: unknown): ImportItem[] {
  const items: ImportItem[] = []

  if (Array.isArray(movies)) {
    for (const m of movies as TvTimeMovie[]) {
      if (!m.title) continue
      items.push({
        mediaType: 'movie',
        title: m.title,
        imdbId: cleanId(m.id?.imdb),
        tvdbId: m.id?.tvdb,
        status: m.is_watched ? 'completed' : 'watchlist',
        movieWatchedAt: m.is_watched ? parseDate(m.watched_at) : undefined,
      })
    }
  }

  if (Array.isArray(shows)) {
    for (const s of shows as TvTimeShow[]) {
      if (!s.title) continue
      const watchedEpisodes: ImportItem['watchedEpisodes'] = []
      for (const season of s.seasons ?? []) {
        for (const ep of season.episodes ?? []) {
          if (ep.is_watched) {
            watchedEpisodes.push({
              season: season.number,
              episode: ep.number,
              watchedAt: parseDate(ep.watched_at),
            })
          }
        }
      }
      items.push({
        mediaType: 'show',
        title: s.title,
        imdbId: cleanId(s.id?.imdb),
        tvdbId: s.id?.tvdb,
        status: STATUS_MAP[s.status ?? ''] ?? 'watchlist',
        watchedEpisodes,
      })
    }
  }

  return items
}

/** Read movies.json + shows.json out of a TV Time export zip and parse them. */
export async function parseTvTimeZip(file: File | Blob): Promise<ImportItem[]> {
  // Loaded on demand so the ~100 KB zip library stays out of the main bundle.
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  const moviesFile = zip.file('movies.json')
  const showsFile = zip.file('shows.json')
  if (!moviesFile && !showsFile) {
    throw new Error('This doesn’t look like a TV Time export (no movies.json or shows.json).')
  }
  const [moviesText, showsText] = await Promise.all([
    moviesFile ? moviesFile.async('string') : Promise.resolve('[]'),
    showsFile ? showsFile.async('string') : Promise.resolve('[]'),
  ])
  return parseTvTime(JSON.parse(moviesText), JSON.parse(showsText))
}
