import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { scheduleAutoSync } from './autoSync'
import { setItemMeta } from './library'
import { getWikidataId } from '../api/tmdb'
import { getMovieEditions, getMovieSoundtrackMbids } from '../api/wikidata'
import { getSoundtrackTracks } from '../api/musicbrainz'
import type { MovieEdition, MusicTrack, TitleMeta } from './types'

// ---------------------------------------------------------------------------
// Cached title metadata (editions, and later music). Fetched once from a slow or
// rate-limited source and stored so the title isn't re-queried on every view.
// Keyed by the item id for movies/shows (`movie:603`) and by a composite key for
// episodes. Derived sections carry a `fetchedAt` (even for an empty result, so
// "nothing found" isn't re-fetched); a Refresh clears it to force a re-pull.
// Everything here syncs inside the extras payload (see data/extras.ts).
// ---------------------------------------------------------------------------

/** Meta key for a single episode's music, etc. */
export function episodeMetaKey(itemId: string, season: number, episode: number): string {
  return `episode:${itemId}:${season}:${episode}`
}

export async function getTitleMeta(id: string): Promise<TitleMeta | undefined> {
  return db.titleMeta.get(id)
}

/** Live-read a title's cached metadata (null until loaded / when absent). */
export function useTitleMeta(id: string | undefined): TitleMeta | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.titleMeta.get(id)) ?? null) : null), [id])
}

/** Upsert a patch onto a title's meta record (creates it if absent). */
async function patchMeta(id: string, patch: Partial<TitleMeta>): Promise<void> {
  const existing = await db.titleMeta.get(id)
  await db.titleMeta.put({ id, ...existing, ...patch })
  scheduleAutoSync()
}

// De-duplicate concurrent fetches for the same key (e.g. React StrictMode's
// double-invoked effects, or two views of a title at once) so a rate-limited
// source like MusicBrainz isn't hit twice for one request.
const inFlight = new Map<string, Promise<void>>()
function dedupe(key: string, run: () => Promise<void>): Promise<void> {
  const existing = inFlight.get(key)
  if (existing) return existing
  const p = run().finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

/**
 * Fetch a movie's alternate editions from Wikidata and cache them. No-op when
 * already cached unless `force` (the Refresh button). A network/Wikidata failure
 * is swallowed WITHOUT writing a cache, so a later view or refresh retries rather
 * than being stuck on a false "no editions".
 */
export async function fetchMovieEditions(
  itemId: string,
  tmdbId: number,
  opts: { force?: boolean } = {},
): Promise<void> {
  return dedupe(`editions:${itemId}${opts.force ? ':force' : ''}`, async () => {
    const existing = await db.titleMeta.get(itemId)
    if (!opts.force && existing?.editionsFetchedAt) return
    let editions: MovieEdition[]
    try {
      const qid = await getWikidataId('movie', tmdbId)
      const raw = qid ? await getMovieEditions(qid) : []
      editions = raw
        // An "edition" that is really the same TMDB movie isn't a separate version.
        .filter((e) => e.tmdbId !== tmdbId)
        .map((e) => ({
          id: e.wikidataId,
          label: e.label,
          year: e.year,
          runtimeMin: e.runtimeMin,
          tmdbId: e.tmdbId,
          wikidataId: e.wikidataId,
          source: 'wikidata' as const,
        }))
    } catch {
      return // leave the cache untouched; retry next time
    }
    await patchMeta(itemId, { editions, editionsFetchedAt: Date.now() })
    // Index the edition labels onto the item so free-text Library search finds the
    // base movie by an edition name (e.g. "Once Upon a Deadpool" → Deadpool 2).
    await setItemMeta(itemId, { aliases: editions.map((e) => e.label) })
  })
}

/**
 * Fetch a movie's soundtrack songs (MusicBrainz, via the film's Wikidata
 * "soundtrack release" link) and cache them. No-op when already cached unless
 * `force`. An empty result IS cached (musicFetchedAt set) so "no soundtrack
 * information" doesn't re-query; a network/API failure is swallowed WITHOUT
 * writing, so a later view or Refresh retries.
 */
export async function fetchMovieMusic(
  itemId: string,
  tmdbId: number,
  opts: { force?: boolean } = {},
): Promise<void> {
  return dedupe(`music:${itemId}${opts.force ? ':force' : ''}`, async () => {
    const existing = await db.titleMeta.get(itemId)
    if (!opts.force && existing?.musicFetchedAt) return
    let music: MusicTrack[]
    try {
      const qid = await getWikidataId('movie', tmdbId)
      const mbids = qid ? await getMovieSoundtrackMbids(qid) : []
      const tracks = mbids.length ? await getSoundtrackTracks(mbids[0]) : []
      music = tracks.map((t) => ({
        title: t.title,
        artist: t.artist,
        source: 'musicbrainz' as const,
      }))
    } catch {
      return // leave the cache untouched; retry next time
    }
    await patchMeta(itemId, { music, musicFetchedAt: Date.now() })
  })
}

/** Mark an alternate edition seen / unseen (the theatrical edition is the movie's
 *  own watched state, tracked on the item — not here). */
export async function setEditionSeen(
  itemId: string,
  editionId: string,
  seen: boolean,
): Promise<void> {
  const existing = await db.titleMeta.get(itemId)
  const current = new Set(existing?.editionsSeen ?? [])
  if (seen) current.add(editionId)
  else current.delete(editionId)
  await patchMeta(itemId, { editionsSeen: [...current], seenUpdatedAt: Date.now() })
}
