import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { getGoogleProfile } from './driveSync'
import { LAST_EXPORT_KEY } from './exportImport'
import type { EarnedBadge, EpisodeState, TrackedItem, WatchEvent } from './types'

// ---------------------------------------------------------------------------
// Gamification badges. A badge is a named milestone the user can earn once by
// hitting some condition (watch N episodes, rate a movie, link an account, …).
// Earned badges live in their own Dexie table (synced with the rest of the
// backup) and are append-only — once earned, a badge stays even if you later
// delete the titles that earned it.
//
// The design is declarative: every badge is a pure `earned(context)` predicate
// over a small snapshot of the user's data + account flags. A single watcher
// (useBadgeWatcher) recomputes the context on any change, awards newly-met
// badges, and fires the confetti toast — so adding a badge is just one entry
// here, no wiring at the action sites.
// ---------------------------------------------------------------------------

/** The snapshot every badge predicate is evaluated against. */
export interface BadgeContext {
  episodesWatched: number
  moviesWatched: number
  gamesWatched: number
  showsRated: number
  moviesRated: number
  titlesRated: number
  titlesTracked: number
  hasExported: boolean
  googleLinked: boolean
  hasSynced: boolean
  traktLinked: boolean
}

export interface BadgeDef {
  id: string
  name: string
  description: string
  emoji: string
  /** Section heading on the Stats page. */
  group: string
  earned: (c: BadgeContext) => boolean
}

// The catalogue. Order here is the display order on the Stats page.
export const BADGES: BadgeDef[] = [
  // --- Watching ----------------------------------------------------------
  { id: 'ep-1', name: 'First Episode', description: 'Watch your first episode.', emoji: '▶️', group: 'Watching', earned: (c) => c.episodesWatched >= 1 },
  { id: 'ep-50', name: 'Settled In', description: 'Watch 50 episodes.', emoji: '📺', group: 'Watching', earned: (c) => c.episodesWatched >= 50 },
  { id: 'ep-250', name: 'Binge Watcher', description: 'Watch 250 episodes.', emoji: '🍿', group: 'Watching', earned: (c) => c.episodesWatched >= 250 },
  { id: 'ep-1000', name: 'Marathoner', description: 'Watch 1,000 episodes.', emoji: '🏅', group: 'Watching', earned: (c) => c.episodesWatched >= 1000 },
  { id: 'mv-1', name: 'First Feature', description: 'Watch your first movie.', emoji: '🎬', group: 'Watching', earned: (c) => c.moviesWatched >= 1 },
  { id: 'mv-25', name: 'Film Buff', description: 'Watch 25 movies.', emoji: '🎞️', group: 'Watching', earned: (c) => c.moviesWatched >= 25 },
  { id: 'game-1', name: 'Game On', description: 'Mark your first game watched.', emoji: '🏟️', group: 'Watching', earned: (c) => c.gamesWatched >= 1 },
  { id: 'game-25', name: 'Superfan', description: 'Watch 25 games.', emoji: '📣', group: 'Watching', earned: (c) => c.gamesWatched >= 25 },

  // --- Critic ------------------------------------------------------------
  { id: 'couch-reviewer', name: 'Couch Reviewer', description: 'Rate a show.', emoji: '🛋️', group: 'Critic', earned: (c) => c.showsRated >= 1 },
  { id: 'movie-critic', name: 'Movie Critic', description: 'Rate a movie.', emoji: '🎥', group: 'Critic', earned: (c) => c.moviesRated >= 1 },
  { id: 'top-critic', name: 'Top Critic', description: 'Rate 25 titles.', emoji: '🏆', group: 'Critic', earned: (c) => c.titlesRated >= 25 },

  // --- Collector ---------------------------------------------------------
  { id: 'collector-25', name: 'Collector', description: 'Track 25 titles.', emoji: '📚', group: 'Collector', earned: (c) => c.titlesTracked >= 25 },
  { id: 'collector-100', name: 'Archivist', description: 'Track 100 titles.', emoji: '🗄️', group: 'Collector', earned: (c) => c.titlesTracked >= 100 },

  // --- Connected ---------------------------------------------------------
  { id: 'backup', name: 'Safekeeper', description: 'Export a backup.', emoji: '💾', group: 'Connected', earned: (c) => c.hasExported },
  { id: 'google', name: 'Signed In', description: 'Link your Google account.', emoji: '🔗', group: 'Connected', earned: (c) => c.googleLinked },
  { id: 'cloud', name: 'In the Cloud', description: 'Sync to Google Drive.', emoji: '☁️', group: 'Connected', earned: (c) => c.hasSynced },
  { id: 'traktr', name: "Trakt'r", description: 'Connect your Trakt account.', emoji: '🎟️', group: 'Connected', earned: (c) => c.traktLinked },
  // Awarded explicitly when a restore repopulates an empty library (see
  // WelcomeScreen), not from a context snapshot — so it celebrates every
  // restore, even right after a cache wipe when the badge watcher primes silently.
  { id: 'welcome-back', name: 'Welcome Back!', description: 'Restore your library by syncing or importing into an empty app.', emoji: '👋', group: 'Connected', earned: () => false },
]

export function badgeById(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id)
}

/** The set of badge ids currently met by `ctx`. */
export function evaluateBadges(ctx: BadgeContext): Set<string> {
  return new Set(BADGES.filter((b) => b.earned(ctx)).map((b) => b.id))
}

const SYNC_KEY = 'tvtracker.lastSynced'

/** Build the evaluation snapshot from the raw tables + account flags. Counting
 *  mirrors the Stats page (games are sport "episodes", counted apart from TV). */
export function buildBadgeContext(
  items: TrackedItem[],
  states: EpisodeState[],
  events: WatchEvent[],
  traktLinked: boolean,
): BadgeContext {
  const byId = new Map(items.map((i) => [i.id, i]))
  const isSport = (itemId: string) => byId.get(itemId)?.mediaType === 'sport'

  const watched = states.filter((s) => s.watched)
  const episodesWatched = watched.filter((s) => !isSport(s.itemId)).length
  const gamesWatched = watched.filter((s) => isSport(s.itemId)).length

  const movieItems = new Set<string>()
  for (const e of events) {
    if (e.episodeId === null && byId.has(e.itemId)) movieItems.add(e.itemId)
  }

  const rated = items.filter((i) => typeof i.userRating === 'number')
  const showsRated = rated.filter((i) => i.mediaType === 'show').length
  const moviesRated = rated.filter((i) => i.mediaType === 'movie').length

  let hasExported = false
  let hasSynced = false
  try {
    hasExported = !!localStorage.getItem(LAST_EXPORT_KEY)
    hasSynced = !!localStorage.getItem(SYNC_KEY)
  } catch {
    // ignore storage access errors
  }

  return {
    episodesWatched,
    moviesWatched: movieItems.size,
    gamesWatched,
    showsRated,
    moviesRated,
    titlesRated: rated.length,
    titlesTracked: items.length,
    hasExported,
    googleLinked: !!getGoogleProfile(),
    hasSynced,
    traktLinked,
  }
}

/** Record newly-earned badges (idempotent — primary key is the badge id). */
export async function awardBadges(ids: string[]): Promise<void> {
  if (!ids.length) return
  const now = Date.now()
  await db.badges.bulkPut(ids.map((id) => ({ id, earnedAt: now })))
}

/** Live list of earned badges (undefined until the first read resolves). */
export function useEarnedBadges(): EarnedBadge[] | undefined {
  return useLiveQuery(() => db.badges.toArray(), [])
}

/** Nudge the badge watcher to re-check after an action that only touches
 *  localStorage (export / sync), which Dexie live queries don't observe. */
export function notifyBadgeCheck(): void {
  try {
    window.dispatchEvent(new Event('tvtracker:badgecheck'))
  } catch {
    // ignore (non-browser env)
  }
}
