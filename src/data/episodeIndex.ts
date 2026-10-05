import { useSyncExternalStore } from 'react'
import {
  castNames,
  genreNames,
  getMovieDetails,
  isEndedStatus,
  runtimeOf,
  watchNames,
} from '../api/tmdb'
import { db } from './db'
import { getSeasonEpisodesCached, getTvDetailsCached } from './episodeCache'
import { setItemMeta } from './library'
import type { TrackedItem } from './types'

// ---------------------------------------------------------------------------
// Background episode indexer. Walks every tracked show and caches its episode
// names/dates so Library search covers full back-catalogs. Runs as a module-level
// singleton (survives route changes), is gentle on the API, and resumes: shows
// already fully cached are skipped, and completion is remembered across sessions.
// ---------------------------------------------------------------------------

const DONE_KEY = 'tvtracker.indexedShows'

function loadDone(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}
function saveDone(s: Set<string>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...s]))
  } catch {
    // ignore
  }
}

export interface IndexState {
  status: 'idle' | 'running' | 'done'
  done: number
  total: number
}

/** Whether a title is missing the backfilled stats fields (tmdbRating, and for
 *  shows episodeCount). Used to decide what the indexer should (re)process. */
function missesStatsFields(i: TrackedItem): boolean {
  if (i.tmdbRating === undefined) return true
  return i.mediaType === 'show' ? i.episodeCount == null : false
}

/**
 * Whether a title should still prompt a (re)index for complete stats. Excludes
 * dropped titles (the normal indexer skips them, so they'd nag forever) and ones
 * already flagged as unfetchable — a manual rebuild retries both.
 */
export function itemNeedsIndex(i: TrackedItem): boolean {
  if (i.status === 'dropped' || i.indexFailed) return false
  return missesStatsFields(i)
}

let state: IndexState = { status: 'idle', done: 0, total: 0 }
const subscribers = new Set<() => void>()

function setState(next: IndexState): void {
  state = next
  subscribers.forEach((fn) => fn())
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

export function useIndexProgress(): IndexState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/** Index one title: backfill genres/providers, and (for shows) cache episodes. */
async function indexItem(item: TrackedItem): Promise<void> {
  if (item.mediaType === 'movie') {
    const details = await getMovieDetails(item.tmdbId)
    await setItemMeta(item.id, {
      genres: genreNames(details),
      providers: watchNames(details),
      cast: castNames(details),
      runtime: runtimeOf(details),
      tmdbRating: details.vote_average,
    })
    return
  }
  const details = await getTvDetailsCached(item.id, item.tmdbId)
  let runtime = runtimeOf(details)
  await setItemMeta(item.id, {
    genres: genreNames(details),
    providers: watchNames(details),
    cast: castNames(details),
    ended: isEndedStatus(details.status),
    runtime,
    episodeCount: details.number_of_episodes,
    tmdbRating: details.vote_average,
  })
  // Dropped shows (only reached on a full rebuild) get their stats metadata but
  // skip the per-season episode caching — episode search isn't needed for them.
  if (item.status === 'dropped') return
  for (const season of details.seasons) {
    if (season.episode_count <= 0) continue
    const have = await db.episodeCache
      .where('[itemId+season]')
      .equals([item.id, season.season_number])
      .count()
    if (have >= season.episode_count) continue // already cached
    const episodes = await getSeasonEpisodesCached(item.id, item.tmdbId, season.season_number)
    // Shows often lack episode_run_time; fall back to a real episode's runtime —
    // but only from a regular season (specials can be minisodes/recaps).
    if (runtime === undefined && season.season_number > 0) {
      const r = episodes.find((e) => e.runtime && e.runtime > 0)?.runtime
      if (r) {
        runtime = r
        await setItemMeta(item.id, { runtime })
      }
    }
  }
}

let running = false

/**
 * Start (or resume) indexing. Safe to call repeatedly; no-ops while running.
 * `full` is a manual rebuild: it also includes dropped titles and retries ones
 * that previously failed to fetch (otherwise both are left alone so they don't
 * nag or waste API calls on every background run).
 */
export async function startIndexing(
  opts: { full?: boolean; concurrency?: number } = {},
): Promise<void> {
  const { full = false, concurrency = 3 } = opts
  if (running) return
  running = true
  try {
    const done = loadDone()
    const allItems = await db.trackedItems.toArray()
    const all = full ? allItems : allItems.filter((i) => i.status !== 'dropped')
    // Reprocess titles missing stats fields even if they're in the done-set (e.g.
    // indexed by an older app version). Skip known failures unless this is a full
    // rebuild, so they don't retry every background pass.
    const todo = all.filter((i) => {
      if (i.indexFailed && !full) return false
      return !done.has(i.id) || missesStatsFields(i)
    })

    if (todo.length === 0) {
      setState({ status: 'done', done: all.length, total: all.length })
      return
    }

    let doneCount = all.length - todo.length
    setState({ status: 'running', done: doneCount, total: all.length })

    let cursor = 0
    const worker = async () => {
      while (cursor < todo.length) {
        const item = todo[cursor++]
        try {
          await indexItem(item)
          done.add(item.id)
          saveDone(done)
          // Clear a stale failure flag now that it succeeded.
          if (item.indexFailed) {
            try {
              await db.trackedItems.update(item.id, { indexFailed: false })
            } catch {
              // ignore
            }
          }
        } catch {
          // TMDB couldn't fetch it — flag so it stops prompting (a full rebuild
          // clears this and tries again). Left out of `done`.
          try {
            await db.trackedItems.update(item.id, { indexFailed: true })
          } catch {
            // ignore
          }
        }
        doneCount += 1
        setState({ status: 'running', done: doneCount, total: all.length })
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))
    setState({ status: 'done', done: all.length, total: all.length })
  } finally {
    running = false
  }
}
