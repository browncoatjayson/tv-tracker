import { useSyncExternalStore } from 'react'
import { db } from './db'
import { getSeasonEpisodesCached, getTvDetailsCached } from './episodeCache'

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

/** Cache all of one show's seasons that aren't already fully cached. */
async function indexShow(itemId: string, tmdbId: number): Promise<void> {
  const details = await getTvDetailsCached(itemId, tmdbId)
  for (const season of details.seasons) {
    if (season.episode_count <= 0) continue
    const have = await db.episodeCache
      .where('[itemId+season]')
      .equals([itemId, season.season_number])
      .count()
    if (have >= season.episode_count) continue // already cached
    await getSeasonEpisodesCached(itemId, tmdbId, season.season_number)
  }
}

let running = false

/** Start (or resume) indexing. Safe to call repeatedly; no-ops while running. */
export async function startIndexing(concurrency = 3): Promise<void> {
  if (running) return
  running = true
  try {
    const done = loadDone()
    const shows = (await db.trackedItems.toArray()).filter(
      (i) => i.mediaType === 'show' && i.status !== 'dropped',
    )
    const todo = shows.filter((s) => !done.has(s.id))

    if (todo.length === 0) {
      setState({ status: 'done', done: shows.length, total: shows.length })
      return
    }

    let doneCount = shows.length - todo.length
    setState({ status: 'running', done: doneCount, total: shows.length })

    let cursor = 0
    const worker = async () => {
      while (cursor < todo.length) {
        const s = todo[cursor++]
        try {
          await indexShow(s.id, s.tmdbId)
          done.add(s.id)
          saveDone(done)
        } catch {
          // Leave failed shows out of `done` so a later run retries them.
        }
        doneCount += 1
        setState({ status: 'running', done: doneCount, total: shows.length })
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))
    setState({ status: 'done', done: shows.length, total: shows.length })
  } finally {
    running = false
  }
}
