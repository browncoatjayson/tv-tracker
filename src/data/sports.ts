import { db, episodeKey } from './db'
import { markEpisode } from './library'
import { appConfirm } from '../utils/confirm'
import { localDateOfIso, todayLocal } from '../utils/watchedDate'
import type { CachedEpisode, TrackedItem } from './types'
import type { EspnGame } from '../api/espn'

/** The tracked-item id for a sports team in a league (season-agnostic — games
 *  across seasons live under it, keyed by season = year). */
export function sportItemId(league: string, teamId: string): string {
  return `sport:${league}-${teamId}`
}

/**
 * Classify a game's air status from ESPN's `completed` flag and its date.
 *  - 'aired'    — ESPN marked it finished (has a result, watchable).
 *  - 'upcoming' — not finished and the date is still ahead.
 *  - 'unaired'  — not finished but the date has passed. ESPN sometimes leaves a
 *    game `completed: false` long after it should have aired (postponed, or just
 *    stale data); treating that as "upcoming" shows a nonsensical "Airs · <past
 *    date>", so it gets its own state and is skipped when finding the next game.
 *  `completed` is undefined for TV episodes / pre-existing cache rows → fall back
 *  to a date-only check so they behave as before.
 */
export type SportAirState = 'aired' | 'upcoming' | 'unaired'
export function sportAirState(
  airDate: string | null | undefined,
  completed: boolean | undefined,
): SportAirState {
  // A full ISO instant (from ESPN) is compared by the actual moment; a date-only
  // string (a cached game's local date) is compared by local calendar day. Slicing
  // a UTC instant to its date would read a 7pm game as "tomorrow" in US zones.
  const past = !!airDate && (airDate.includes('T')
    ? Date.parse(airDate) < Date.now()
    : airDate.slice(0, 10) < todayLocal())
  if (completed === true) return 'aired'
  if (completed === false) return past ? 'unaired' : 'upcoming'
  return past ? 'aired' : 'upcoming' // unknown flag: classify by date alone
}

/** Parse a sport item id back into its league key and team id. */
export function parseSportId(itemId: string): { league: string; teamId: string } | null {
  const m = itemId.match(/^sport:([^-]+)-(.+)$/)
  return m ? { league: m[1], teamId: m[2] } : null
}

/** Start tracking a team (or return the existing one). */
export async function addSportTeam(input: {
  league: string
  teamId: string
  teamName: string
  logo?: string
}): Promise<TrackedItem> {
  const id = sportItemId(input.league, input.teamId)
  const existing = await db.trackedItems.get(id)
  if (existing) return existing

  const now = Date.now()
  const item: TrackedItem = {
    id,
    tmdbId: Number(input.teamId) || 0,
    mediaType: 'sport',
    title: input.teamName,
    status: 'watchlist',
    sport: {
      league: input.league,
      teamId: input.teamId,
      teamName: input.teamName,
      logo: input.logo,
    },
    addedAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.trackedItems, db.tombstones, async () => {
    await db.trackedItems.add(item)
    await db.tombstones.delete(id)
  })
  return item
}

/** Mirror a season's games into the episode cache so the Library (next-game
 *  strip, counts) and the Upcoming calendar can see them. Game number is the
 *  date-ordered index within the season. */
export async function cacheSportGames(
  itemId: string,
  season: number,
  games: EspnGame[],
): Promise<void> {
  const rows: CachedEpisode[] = games.map((g, i) => ({
    id: episodeKey(itemId, season, i + 1),
    itemId,
    season,
    episode: i + 1,
    name: g.name,
    // ESPN's event date is a full ISO *UTC* instant, so the game's calendar date
    // is its LOCAL date — a 7pm game sits on the next day in UTC. Slicing the ISO
    // string would store (and then show/sort) it a day late in US time zones.
    airDate: localDateOfIso(g.date),
    // Keep the full instant as the precise airstamp — same field TV shows use —
    // for the start time on game cards, the Upcoming feed, and notifications.
    airstamp: g.date || undefined,
    completed: g.completed,
  }))
  if (!rows.length) return
  await db.episodeCache.bulkPut(rows)
  await refreshSportDates(itemId)
}

/** Recompute a team's last-played / next-game dates from all cached games, so it
 *  sorts alongside shows in the Library ("Last episode date") and the Upcoming
 *  feed. Not an updatedAt-bumping change (same as the metadata backfill). */
export async function refreshSportDates(itemId: string): Promise<void> {
  const today = todayLocal()
  const games = await db.episodeCache.where('itemId').equals(itemId).toArray()
  let last: string | undefined
  let next: string | undefined
  for (const g of games) {
    if (!g.airDate) continue
    if (g.airDate <= today) {
      if (!last || g.airDate > last) last = g.airDate
    } else if (!next || g.airDate < next) {
      next = g.airDate
    }
  }
  await db.trackedItems.update(itemId, { lastAirDate: last, nextAirDate: next })
}

/**
 * Mark a game watched, then offer to mark earlier *played* games of the same
 * season too (sports catch-up — the TMDB version doesn't apply to ESPN ids).
 */
export async function markGameWithCatchUp(
  itemId: string,
  season: number,
  episode: number,
): Promise<void> {
  await markEpisode(itemId, season, episode, true)
  const today = todayLocal()
  const [cached, states] = await Promise.all([
    db.episodeCache.where('[itemId+season]').equals([itemId, season]).toArray(),
    db.episodeStates.where('itemId').equals(itemId).toArray(),
  ])
  const watched = new Set(states.filter((s) => s.watched).map((s) => `${s.season}:${s.episode}`))
  const previous = cached.filter(
    (e) =>
      e.episode < episode &&
      e.airDate &&
      e.airDate <= today &&
      !watched.has(`${e.season}:${e.episode}`),
  )
  if (previous.length === 0) return
  const ok = await appConfirm(
    `Mark ${previous.length} earlier ${previous.length === 1 ? 'game' : 'games'} as watched too?`,
  )
  if (!ok) return
  for (const p of previous) await markEpisode(itemId, p.season, p.episode, true)
}
