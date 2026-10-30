import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { getGoogleProfile } from './driveSync'
import { LAST_EXPORT_KEY } from './exportImport'
import { isNotifyEnabled } from './notifications'
import { DEFAULT_LEAGUE_KEYS, getEnabledLeagues } from './sportPrefs'
import { getFlag } from './appFlags'
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
  episodesRated: number
  showsRated: number
  moviesRated: number
  titlesRated: number
  titlesTracked: number
  /** Non-removed starred actors. */
  favoritePeople: number
  /** Non-removed favorite streaming services. */
  favoriteServices: number
  /** Favorited (starred) titles of any kind. */
  favoriteTitles: number
  /** Favorited (starred) shows. */
  favoriteShows: number
  /** Most favorited titles sharing one franchise / Related group. */
  franchiseFavs: number
  /** Enabled sport leagues beyond the two that ship on by default. */
  extraLeagues: number
  notificationsEnabled: boolean
  /** Running as an installed PWA (standalone display mode). */
  isPwa: boolean
  /** Dismissed the first-run Welcome screen. */
  welcomed: boolean
  openedStats: boolean
  openedTimeline: boolean
  searched: boolean
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

// The catalogue. Order here is the display order on the Stats page (sections
// appear in the order their first badge does).
export const BADGES: BadgeDef[] = [
  // --- App ---------------------------------------------------------------
  // Awarded explicitly when a restore repopulates an empty library (see
  // WelcomeScreen), not from a context snapshot — so it celebrates every
  // restore, even right after a cache wipe when the badge watcher primes silently.
  { id: 'welcome-back', name: 'Welcome Back!', description: 'Restore your library by syncing or importing into an empty app.', emoji: '👋', group: 'App', earned: () => false },
  { id: 'app-welcomed', name: 'Are You New Here?', description: 'Open the app for the first time, or favorite any title.', emoji: '🆕', group: 'App', earned: (c) => c.welcomed || c.favoriteTitles >= 1 },
  { id: 'notify-on', name: 'In The Know', description: 'Turn on airing-soon notifications.', emoji: '🔔', group: 'App', earned: (c) => c.notificationsEnabled },
  { id: 'stats-open', name: "It's Full of Stars", description: 'Open your Stats page.', emoji: '✨', group: 'App', earned: (c) => c.openedStats },
  { id: 'timeline-open', name: 'Dear Diary…', description: 'Open your Timeline.', emoji: '📔', group: 'App', earned: (c) => c.openedTimeline },
  { id: 'searched', name: "They're All Here", description: 'Run your first search.', emoji: '🔍', group: 'App', earned: (c) => c.searched },
  { id: 'fav-service-1', name: 'Your Choice', description: 'Pick at least one favorite service.', emoji: '📡', group: 'App', earned: (c) => c.favoriteServices >= 1 },
  { id: 'league-1', name: 'Sportsball', description: 'Enable a sports league beyond the defaults.', emoji: '🏈', group: 'App', earned: (c) => c.extraLeagues >= 1 },
  { id: 'pwa', name: 'Locked and Loaded', description: 'Launch the installed app (PWA).', emoji: '🚀', group: 'App', earned: (c) => c.isPwa },

  // --- TV Watch ----------------------------------------------------------
  { id: 'ep-1', name: 'First Episode', description: 'Watch your first episode.', emoji: '▶️', group: 'TV Watch', earned: (c) => c.episodesWatched >= 1 },
  { id: 'ep-50', name: 'Settled In', description: 'Watch 50 episodes.', emoji: '📺', group: 'TV Watch', earned: (c) => c.episodesWatched >= 50 },
  { id: 'ep-250', name: 'Binge Watcher', description: 'Watch 250 episodes.', emoji: '🍿', group: 'TV Watch', earned: (c) => c.episodesWatched >= 250 },
  { id: 'ep-1000', name: 'Marathoner', description: 'Watch 1,000 episodes.', emoji: '🏅', group: 'TV Watch', earned: (c) => c.episodesWatched >= 1000 },
  { id: 'ep-5000', name: 'TV Buff', description: 'Watch 5,000 episodes.', emoji: '🧐', group: 'TV Watch', earned: (c) => c.episodesWatched >= 5000 },
  { id: 'ep-10000', name: 'Screen Addict', description: 'Watch 10,000 episodes.', emoji: '🤯', group: 'TV Watch', earned: (c) => c.episodesWatched >= 10000 },
  { id: 'ep-20000', name: 'Telephile', description: 'Watch 20,000 episodes.', emoji: '👑', group: 'TV Watch', earned: (c) => c.episodesWatched >= 20000 },

  // --- Movie Watch -------------------------------------------------------
  { id: 'mv-1', name: 'First Feature', description: 'Watch your first movie.', emoji: '🎬', group: 'Movie Watch', earned: (c) => c.moviesWatched >= 1 },
  { id: 'mv-25', name: 'Film Buff', description: 'Watch 25 movies.', emoji: '🎞️', group: 'Movie Watch', earned: (c) => c.moviesWatched >= 25 },
  { id: 'mv-100', name: 'Movie Lover', description: 'Watch 100 movies.', emoji: '❤️', group: 'Movie Watch', earned: (c) => c.moviesWatched >= 100 },
  { id: 'mv-500', name: 'Media Buff', description: 'Watch 500 movies.', emoji: '🎟️', group: 'Movie Watch', earned: (c) => c.moviesWatched >= 500 },
  { id: 'mv-1000', name: 'Cinephile', description: 'Watch 1,000 movies.', emoji: '🎖️', group: 'Movie Watch', earned: (c) => c.moviesWatched >= 1000 },

  // --- Game Watch --------------------------------------------------------
  { id: 'game-1', name: 'Game On', description: 'Mark your first game watched.', emoji: '🏟️', group: 'Game Watch', earned: (c) => c.gamesWatched >= 1 },
  { id: 'game-25', name: 'Superfan', description: 'Watch 25 games.', emoji: '📣', group: 'Game Watch', earned: (c) => c.gamesWatched >= 25 },
  { id: 'game-100', name: 'Sports Enthusiast', description: 'Watch 100 games.', emoji: '🙌', group: 'Game Watch', earned: (c) => c.gamesWatched >= 100 },
  { id: 'game-500', name: 'Sports Fan', description: 'Watch 500 games.', emoji: '🎽', group: 'Game Watch', earned: (c) => c.gamesWatched >= 500 },
  { id: 'game-1000', name: 'Armchair Quarterback', description: 'Watch 1,000 games.', emoji: '🪑', group: 'Game Watch', earned: (c) => c.gamesWatched >= 1000 },

  // --- Collector ---------------------------------------------------------
  { id: 'collector-25', name: 'Collector', description: 'Track 25 titles.', emoji: '📚', group: 'Collector', earned: (c) => c.titlesTracked >= 25 },
  { id: 'collector-100', name: 'Archivist', description: 'Track 100 titles.', emoji: '🗄️', group: 'Collector', earned: (c) => c.titlesTracked >= 100 },
  { id: 'collector-250', name: 'Enthusiast', description: 'Track 250 titles.', emoji: '📦', group: 'Collector', earned: (c) => c.titlesTracked >= 250 },
  { id: 'collector-1000', name: 'Curator', description: 'Track 1,000 titles.', emoji: '🏛️', group: 'Collector', earned: (c) => c.titlesTracked >= 1000 },

  // --- Critic ------------------------------------------------------------
  { id: 'couch-reviewer', name: 'Couch Reviewer', description: 'Rate a show.', emoji: '🛋️', group: 'Critic', earned: (c) => c.showsRated >= 1 },
  { id: 'movie-critic', name: 'Movie Critic', description: 'Rate a movie.', emoji: '🎥', group: 'Critic', earned: (c) => c.moviesRated >= 1 },
  { id: 'ep-rated', name: 'Impression', description: 'Rate an episode.', emoji: '⭐', group: 'Critic', earned: (c) => c.episodesRated >= 1 },
  { id: 'top-critic', name: 'Top Critic', description: 'Rate 25 titles.', emoji: '🏆', group: 'Critic', earned: (c) => c.titlesRated >= 25 },
  { id: 'rated-50', name: 'Commentator', description: 'Rate 50 titles.', emoji: '🗒️', group: 'Critic', earned: (c) => c.titlesRated >= 50 },
  { id: 'rated-100', name: 'Analyst', description: 'Rate 100 titles.', emoji: '📈', group: 'Critic', earned: (c) => c.titlesRated >= 100 },
  { id: 'rated-250', name: 'Connoisseur', description: 'Rate 250 titles.', emoji: '🧐', group: 'Critic', earned: (c) => c.titlesRated >= 250 },
  { id: 'rated-1000', name: 'Authority', description: 'Rate 1,000 titles.', emoji: '🎓', group: 'Critic', earned: (c) => c.titlesRated >= 1000 },

  // --- Favorites ---------------------------------------------------------
  { id: 'fav-actor-1', name: "You're a Star", description: 'Favorite an actor.', emoji: '🌟', group: 'Favorites', earned: (c) => c.favoritePeople >= 1 },
  { id: 'fav-actor-10', name: 'Star Struck', description: 'Favorite 10 actors.', emoji: '🤩', group: 'Favorites', earned: (c) => c.favoritePeople >= 10 },
  { id: 'fav-actor-50', name: 'Paparazzi', description: 'Favorite 50 actors.', emoji: '📸', group: 'Favorites', earned: (c) => c.favoritePeople >= 50 },
  { id: 'fav-show-1', name: "I'm a Fan", description: 'Favorite a show.', emoji: '💖', group: 'Favorites', earned: (c) => c.favoriteShows >= 1 },
  { id: 'fav-show-5', name: 'Fandom', description: 'Favorite 5 shows.', emoji: '🎉', group: 'Favorites', earned: (c) => c.favoriteShows >= 5 },
  { id: 'franchise', name: 'Franchise', description: 'Favorite 3+ titles from one Related group.', emoji: '🧩', group: 'Favorites', earned: (c) => c.franchiseFavs >= 3 },

  // --- Connected ---------------------------------------------------------
  { id: 'backup', name: 'Safekeeper', description: 'Export a backup.', emoji: '💾', group: 'Connected', earned: (c) => c.hasExported },
  { id: 'google', name: 'Signed In', description: 'Link your Google account.', emoji: '🔗', group: 'Connected', earned: (c) => c.googleLinked },
  { id: 'cloud', name: 'In the Cloud', description: 'Sync to Google Drive.', emoji: '☁️', group: 'Connected', earned: (c) => c.hasSynced },
  { id: 'traktr', name: "Trakt'r", description: 'Connect your Trakt account.', emoji: '🎟️', group: 'Connected', earned: (c) => c.traktLinked },
]

export function badgeById(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id)
}

/** The set of badge ids currently met by `ctx`. */
export function evaluateBadges(ctx: BadgeContext): Set<string> {
  return new Set(BADGES.filter((b) => b.earned(ctx)).map((b) => b.id))
}

const SYNC_KEY = 'tvtracker.lastSynced'

/** True when the app is running as an installed PWA (standalone window). */
function isStandalone(): boolean {
  try {
    return (
      !!window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

/** Extra counts the predicates need that don't come from the three core tables. */
export interface BadgeCounts {
  favoritePeople: number
  favoriteServices: number
}

/** Build the evaluation snapshot from the raw tables + account flags. Counting
 *  mirrors the Stats page (games are sport "episodes", counted apart from TV). */
export function buildBadgeContext(
  items: TrackedItem[],
  states: EpisodeState[],
  events: WatchEvent[],
  traktLinked: boolean,
  counts: BadgeCounts,
): BadgeContext {
  const byId = new Map(items.map((i) => [i.id, i]))
  const isSport = (itemId: string) => byId.get(itemId)?.mediaType === 'sport'

  const watched = states.filter((s) => s.watched)
  const episodesWatched = watched.filter((s) => !isSport(s.itemId)).length
  const gamesWatched = watched.filter((s) => isSport(s.itemId)).length
  const episodesRated = states.filter((s) => typeof s.userRating === 'number').length

  const movieItems = new Set<string>()
  for (const e of events) {
    if (e.episodeId === null && byId.has(e.itemId)) movieItems.add(e.itemId)
  }

  const rated = items.filter((i) => typeof i.userRating === 'number')
  const showsRated = rated.filter((i) => i.mediaType === 'show').length
  const moviesRated = rated.filter((i) => i.mediaType === 'movie').length

  const favoriteItems = items.filter((i) => i.favorite)
  const favoriteShows = favoriteItems.filter((i) => i.mediaType === 'show').length

  // "Franchise": the most favorited titles sharing one Related group. We key by
  // the Wikidata universe, falling back to the TMDB collection (series), both of
  // which the detail page backfills onto the item.
  const favByFranchise = new Map<string, number>()
  for (const i of favoriteItems) {
    const key = i.universe ?? i.series
    if (!key) continue
    favByFranchise.set(key, (favByFranchise.get(key) ?? 0) + 1)
  }
  const franchiseFavs = favByFranchise.size ? Math.max(...favByFranchise.values()) : 0

  // Leagues the user turned on beyond the two that ship enabled.
  const extraLeagues = getEnabledLeagues().filter((k) => !DEFAULT_LEAGUE_KEYS.includes(k)).length

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
    episodesRated,
    showsRated,
    moviesRated,
    titlesRated: rated.length,
    titlesTracked: items.length,
    favoritePeople: counts.favoritePeople,
    favoriteServices: counts.favoriteServices,
    favoriteTitles: favoriteItems.length,
    favoriteShows,
    franchiseFavs,
    extraLeagues,
    notificationsEnabled: isNotifyEnabled(),
    isPwa: isStandalone(),
    welcomed: getFlag('welcomed'),
    openedStats: getFlag('openedStats'),
    openedTimeline: getFlag('openedTimeline'),
    searched: getFlag('searched'),
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
