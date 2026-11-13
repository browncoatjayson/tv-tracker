import { db, itemKey } from '../db'
import { resolveTmdbIds } from './resolve'
import type { ImportItem, ResolvedImportItem } from './types'
import type { CustomList, ListItem, MediaType } from '../types'

// ---------------------------------------------------------------------------
// Import TV Time custom Lists (lists.json in the export zip) into our own lists
// table. A TV Time list is { name, description, shows[], movies[] }, where each
// member carries TheTVDB/IMDb ids — the same external ids the library importer
// resolves to TMDB. We reuse that resolver (seeded with the already-resolved
// library items, so shared titles don't re-hit TMDB), then build a CustomList.
// ---------------------------------------------------------------------------

export interface ParsedTvTimeList {
  name: string
  description?: string
  items: ImportItem[]
}

function cleanImdb(v: unknown): string | undefined {
  return typeof v === 'string' && v && v !== '-1' ? v : undefined
}
function cleanTvdb(v: unknown): number | undefined {
  return typeof v === 'number' && v > 0 ? v : undefined
}

interface RawMember {
  id?: { imdb?: unknown; tvdb?: unknown }
  title?: unknown
}
interface RawList {
  name?: unknown
  description?: unknown
  shows?: unknown
  movies?: unknown
}

/** Parse TV Time's lists.json (an array of lists) into name/description + members. */
export function parseTvTimeLists(json: unknown): ParsedTvTimeList[] {
  if (!Array.isArray(json)) return []
  const out: ParsedTvTimeList[] = []
  for (const raw of json as RawList[]) {
    if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) continue
    const items: ImportItem[] = []
    const take = (arr: unknown, mediaType: MediaType): void => {
      if (!Array.isArray(arr)) return
      for (const m of arr as RawMember[]) {
        if (!m || typeof m.title !== 'string' || !m.title) continue
        const imdbId = cleanImdb(m.id?.imdb)
        const tvdbId = cleanTvdb(m.id?.tvdb)
        if (!imdbId && !tvdbId) continue // nothing to resolve a TMDB id from
        items.push({ mediaType, title: m.title, imdbId, tvdbId, status: 'watchlist' })
      }
    }
    take(raw.shows, 'show')
    take(raw.movies, 'movie')
    out.push({
      name: raw.name.trim(),
      description:
        typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : undefined,
      items,
    })
  }
  return out
}

/** Read lists.json out of a TV Time export zip and parse it (empty if absent). */
export async function parseTvTimeListsFromZip(file: File | Blob): Promise<ParsedTvTimeList[]> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  const listsFile = zip.file('lists.json')
  if (!listsFile) return []
  try {
    return parseTvTimeLists(JSON.parse(await listsFile.async('string')))
  } catch {
    return []
  }
}

/** Find an already-resolved item by EITHER external id. A member carrying both
 *  imdb + tvdb must still match when the seed indexed that title under only one
 *  of them (e.g. its IMDb id was blank in shows.json but present in the list). */
function lookup(
  byExt: Map<string, ResolvedImportItem>,
  it: { imdbId?: string; tvdbId?: number },
): ResolvedImportItem | undefined {
  return (
    (it.imdbId ? byExt.get(`imdb:${it.imdbId}`) : undefined) ??
    (it.tvdbId ? byExt.get(`tvdb:${it.tvdbId}`) : undefined)
  )
}

/** Normalize a title for a loose library match: lowercase, drop a leading "the",
 *  reduce to alphanumerics. "The Originals" and "Originals" both → "originals". */
function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Build CustomLists from parsed TV Time lists and write them to the lists table.
 * `seed` are library items already resolved by the same import, reused so we
 * don't re-resolve titles the library import just matched. Returns how many lists
 * were written. Replace clears existing lists first; merge skips same-name lists.
 */
export async function importTvTimeLists(
  lists: ParsedTvTimeList[],
  mode: 'merge' | 'replace',
  seed: ResolvedImportItem[] = [],
): Promise<number> {
  if (lists.length === 0) return 0

  const byExt = new Map<string, ResolvedImportItem>()
  const byTitle = new Map<string, ResolvedImportItem>()
  const index = (r: ResolvedImportItem): void => {
    if (r.imdbId) byExt.set(`imdb:${r.imdbId}`, r)
    if (r.tvdbId) byExt.set(`tvdb:${r.tvdbId}`, r)
    const nt = normTitle(r.title)
    const tk = `${r.mediaType}:${nt}`
    if (nt && !byTitle.has(tk)) byTitle.set(tk, r) // first match wins
  }
  seed.forEach(index)

  // Resolve a member by external id, falling back to a normalized-title match
  // against the library (TV Time can list a show under a different, unresolvable
  // TVDB id than shows.json uses, yet it's the same title you already track).
  const resolveMember = (it: ImportItem): ResolvedImportItem | undefined =>
    lookup(byExt, it) ?? byTitle.get(`${it.mediaType}:${normTitle(it.title)}`)

  // Resolve any members still unknown (by id or title) in one batched TMDB pass.
  const need: ImportItem[] = []
  const needKeys = new Set<string>()
  for (const l of lists) {
    for (const it of l.items) {
      if (resolveMember(it)) continue
      const sig = `${it.imdbId ?? ''}|${it.tvdbId ?? ''}|${normTitle(it.title)}`
      if (needKeys.has(sig)) continue
      needKeys.add(sig)
      need.push(it)
    }
  }
  if (need.length) {
    const { resolved } = await resolveTmdbIds(need)
    resolved.forEach(index)
  }

  const now = Date.now()
  const records: CustomList[] = lists.map((l) => {
    const seen = new Set<string>()
    const items: ListItem[] = []
    for (const it of l.items) {
      const r = resolveMember(it)
      if (!r) continue // couldn't match to TMDB — leave it out of the list
      const id = itemKey(r.mediaType, r.tmdbId)
      if (seen.has(id)) continue
      seen.add(id)
      items.push({ id, mediaType: r.mediaType, title: r.title, poster: r.posterPath, addedAt: now })
    }
    return {
      id: crypto.randomUUID(),
      name: l.name,
      description: l.description,
      items,
      createdAt: now,
      updatedAt: now,
    }
  })

  if (mode === 'replace') {
    await db.lists.clear()
    await db.lists.bulkPut(records)
    return records.length
  }
  // Merge: don't duplicate or clobber a list that already has this name.
  const existing = new Set((await db.lists.toArray()).map((l) => l.name.toLowerCase()))
  const toAdd = records.filter((r) => !existing.has(r.name.toLowerCase()))
  if (toAdd.length) await db.lists.bulkPut(toAdd)
  return toAdd.length
}
