// ---------------------------------------------------------------------------
// ESPN "hidden" API client (keyless, CORS-friendly). Powers sports tracking:
// finding a team, listing its games for a season, and browsing a league's
// scoreboard. ESPN reuses the same team id across a *college* school's sports
// (e.g. Nebraska = 158 for football, volleyball, basketball and baseball), so
// one search hit covers every supported college league; pro teams belong to a
// single league and are matched by ESPN's own league slug.
//
// This API is unofficial and undocumented — isolated here so a shape change only
// touches one file, and every call fails soft (returns [] / throws a plain Error).
// ---------------------------------------------------------------------------

const SITE = 'https://site.api.espn.com/apis/site/v2/sports'
const SEARCH = 'https://site.web.api.espn.com/apis/search/v2'

export interface EspnLeague {
  /** Our short key, stored on the tracked item (e.g. "cfb"). */
  key: string
  /** ESPN API path parts. */
  sport: string
  league: string
  label: string
  emoji: string
  /** Broad sport grouping for the Settings list (e.g. "Football", "Soccer"). */
  group: string
  /** College schools share one team id across their sports; pro teams don't. */
  scope: 'college' | 'pro'
  /** ESPN's `defaultLeagueSlug` for a pro team in this league (how a search hit
   *  maps to us). College leagues match on the "college" slug test instead. */
  espnSlug: string
  /** What espn.com publishes for this league on the web:
   *  'clubhouse' — per-team and per-game pages (football, basketball, …);
   *  'scoreboard' — only a dated scoreboard (women's volleyball has no team or
   *  game pages, so a team/game link to one 404s — fall back to the scoreboard).
   *  Soccer (sport === 'soccer') has its own /soccer/ web scheme, handled below. */
  webPages: 'clubhouse' | 'scoreboard'
}

// Supported leagues. College football + women's college volleyball ship enabled
// by default (see data/sportPrefs); the rest are opt-in from Settings.
export const ESPN_LEAGUES: EspnLeague[] = [
  // Football
  { key: 'cfb', sport: 'football', league: 'college-football', label: 'College Football', emoji: '🏈', group: 'Football', scope: 'college', espnSlug: 'college-football', webPages: 'clubhouse' },
  { key: 'nfl', sport: 'football', league: 'nfl', label: 'NFL', emoji: '🏈', group: 'Football', scope: 'pro', espnSlug: 'nfl', webPages: 'clubhouse' },
  // Basketball
  { key: 'mcbb', sport: 'basketball', league: 'mens-college-basketball', label: "Men's College Basketball", emoji: '🏀', group: 'Basketball', scope: 'college', espnSlug: 'mens-college-basketball', webPages: 'clubhouse' },
  { key: 'wcbb', sport: 'basketball', league: 'womens-college-basketball', label: "Women's College Basketball", emoji: '🏀', group: 'Basketball', scope: 'college', espnSlug: 'womens-college-basketball', webPages: 'clubhouse' },
  { key: 'nba', sport: 'basketball', league: 'nba', label: 'NBA', emoji: '🏀', group: 'Basketball', scope: 'pro', espnSlug: 'nba', webPages: 'clubhouse' },
  { key: 'wnba', sport: 'basketball', league: 'wnba', label: 'WNBA', emoji: '🏀', group: 'Basketball', scope: 'pro', espnSlug: 'wnba', webPages: 'clubhouse' },
  // Baseball
  { key: 'cbase', sport: 'baseball', league: 'college-baseball', label: 'College Baseball', emoji: '⚾', group: 'Baseball', scope: 'college', espnSlug: 'college-baseball', webPages: 'clubhouse' },
  { key: 'mlb', sport: 'baseball', league: 'mlb', label: 'MLB', emoji: '⚾', group: 'Baseball', scope: 'pro', espnSlug: 'mlb', webPages: 'clubhouse' },
  // Volleyball
  { key: 'wcvb', sport: 'volleyball', league: 'womens-college-volleyball', label: 'Women’s College Volleyball', emoji: '🏐', group: 'Volleyball', scope: 'college', espnSlug: 'womens-college-volleyball', webPages: 'scoreboard' },
  // Soccer (pro + European). Uses the /soccer/ web scheme (see url helpers).
  { key: 'mls', sport: 'soccer', league: 'usa.1', label: 'MLS', emoji: '⚽', group: 'Soccer', scope: 'pro', espnSlug: 'usa.1', webPages: 'clubhouse' },
  { key: 'epl', sport: 'soccer', league: 'eng.1', label: 'Premier League', emoji: '⚽', group: 'Soccer', scope: 'pro', espnSlug: 'eng.1', webPages: 'clubhouse' },
  { key: 'laliga', sport: 'soccer', league: 'esp.1', label: 'La Liga', emoji: '⚽', group: 'Soccer', scope: 'pro', espnSlug: 'esp.1', webPages: 'clubhouse' },
  { key: 'bundesliga', sport: 'soccer', league: 'ger.1', label: 'Bundesliga', emoji: '⚽', group: 'Soccer', scope: 'pro', espnSlug: 'ger.1', webPages: 'clubhouse' },
  { key: 'seriea', sport: 'soccer', league: 'ita.1', label: 'Serie A', emoji: '⚽', group: 'Soccer', scope: 'pro', espnSlug: 'ita.1', webPages: 'clubhouse' },
  { key: 'ligue1', sport: 'soccer', league: 'fra.1', label: 'Ligue 1', emoji: '⚽', group: 'Soccer', scope: 'pro', espnSlug: 'fra.1', webPages: 'clubhouse' },
  { key: 'ucl', sport: 'soccer', league: 'uefa.champions', label: 'Champions League', emoji: '⚽', group: 'Soccer', scope: 'pro', espnSlug: 'uefa.champions', webPages: 'clubhouse' },
]

export function leagueByKey(key: string | undefined): EspnLeague | undefined {
  return ESPN_LEAGUES.find((l) => l.key === key)
}

/** The leagues for a set of keys, in registry (display) order. */
export function leaguesForKeys(keys: string[]): EspnLeague[] {
  const set = new Set(keys)
  return ESPN_LEAGUES.filter((l) => set.has(l.key))
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ESPN request failed (${res.status})`)
  return (await res.json()) as T
}

export interface EspnTeamHit {
  /** ESPN team id (school id, shared across a college's sports). */
  teamId: string
  teamName: string
  leagueKey: string
  leagueLabel: string
  leagueEmoji: string
  logo?: string
}

interface SearchContent {
  uid?: string
  displayName?: string
  defaultLeagueSlug?: string
  image?: { default?: string }
}
interface SearchResponse {
  results?: { type?: string; contents?: SearchContent[] }[]
}

/**
 * Find teams by name, limited to the leagues the user has enabled. College
 * schools (one shared team id) are offered for every enabled college league;
 * pro/soccer teams are matched by ESPN's league slug and offered for their own
 * league only.
 */
export async function searchEspnTeams(
  query: string,
  enabledKeys: string[],
): Promise<EspnTeamHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const enabled = leaguesForKeys(enabledKeys)
  if (enabled.length === 0) return []
  const collegeEnabled = enabled.filter((l) => l.scope === 'college')
  const proBySlug = new Map(enabled.filter((l) => l.scope === 'pro').map((l) => [l.espnSlug, l]))

  const data = await fetchJson<SearchResponse>(`${SEARCH}?limit=30&query=${encodeURIComponent(q)}`)
  const contents = data.results?.find((r) => r.type === 'team')?.contents ?? []

  const hits: EspnTeamHit[] = []
  const seen = new Set<string>() // teamId per league, to dedupe
  // Distinct college schools, keyed by team id (fanned out across leagues below).
  const schools = new Map<string, { teamId: string; teamName: string; logo?: string }>()

  for (const c of contents) {
    const slug = c.defaultLeagueSlug ?? ''
    const m = c.uid?.match(/t:(\d+)/)
    if (!m) continue
    const teamId = m[1]
    if (/college/i.test(slug)) {
      if (collegeEnabled.length && !schools.has(teamId)) {
        schools.set(teamId, { teamId, teamName: c.displayName ?? 'Unknown', logo: c.image?.default })
      }
      continue
    }
    const lg = proBySlug.get(slug)
    if (!lg) continue
    const key = `${lg.key}:${teamId}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({
      teamId,
      teamName: c.displayName ?? 'Unknown',
      leagueKey: lg.key,
      leagueLabel: lg.label,
      leagueEmoji: lg.emoji,
      logo: c.image?.default,
    })
  }

  // Fan each matched college school across every enabled college league.
  for (const s of schools.values()) {
    for (const lg of collegeEnabled) {
      hits.push({
        teamId: s.teamId,
        teamName: s.teamName,
        leagueKey: lg.key,
        leagueLabel: lg.label,
        leagueEmoji: lg.emoji,
        logo: s.logo,
      })
    }
  }
  return hits
}

export interface EspnGame {
  /** ESPN event id. */
  id: string
  /** Short label, e.g. "UTEP @ NEB". */
  name: string
  /** Full label, e.g. "UTEP Miners at Nebraska Cornhuskers". */
  fullName: string
  /** ISO datetime. */
  date: string
  /** True once the game has finished. */
  completed: boolean
  /** e.g. "Week 1" (football) — may be absent. */
  week?: string
  /** The tracked team's side (home/away) — drives "vs"/"at". */
  homeAway?: 'home' | 'away'
  /** The opposing team (name, logo, record going into the game). */
  opponent?: { name: string; logo?: string; record?: string }
  /** The tracked team's AP/CFP rank entering this game (1–25, if ranked). */
  teamRank?: number
  /** Final score from the tracked team's perspective, if available. */
  result?: { us: number; them: number; won: boolean }
}

export interface EspnSchedule {
  teamName: string
  logo?: string
  season: number
  games: EspnGame[]
}

interface Competitor {
  homeAway?: string
  winner?: boolean
  curatedRank?: { current?: number }
  team?: { id?: string; displayName?: string; abbreviation?: string; logos?: { href: string }[] }
  score?: { value?: number; displayValue?: string }
  record?: { type?: string; displayValue?: string }[]
}
interface EspnEvent {
  id: string
  name?: string
  shortName?: string
  date: string
  week?: { text?: string }
  competitions?: {
    status?: { type?: { completed?: boolean } }
    competitors?: Competitor[]
  }[]
}
interface ScheduleResponse {
  team?: { displayName?: string; logos?: { href: string }[] }
  requestedSeason?: { year?: number }
  season?: { year?: number }
  events?: EspnEvent[]
}

/** Deterministic logo fallback by ESPN id, for the leagues whose logos are
 *  id-addressed (college → /ncaa/, soccer → /soccer/). Pro leagues address
 *  logos by abbreviation, so they rely on the logo ESPN returns inline. */
function fallbackLogo(lg: EspnLeague, id: string | undefined): string | undefined {
  if (!id) return undefined
  if (lg.scope === 'college') return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`
  if (lg.sport === 'soccer') return `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`
  return undefined
}

/** Link to a team on espn.com — its clubhouse where the league has one, the
 *  /soccer/ team page for soccer, else the league scoreboard (volleyball has no
 *  team pages). */
export function espnTeamUrl(leagueKey: string, teamId: string): string | undefined {
  const lg = leagueByKey(leagueKey)
  if (!lg) return undefined
  if (lg.sport === 'soccer') return `https://www.espn.com/soccer/team/_/id/${teamId}`
  return lg.webPages === 'clubhouse'
    ? `https://www.espn.com/${lg.league}/team/_/id/${teamId}`
    : `https://www.espn.com/${lg.league}/scoreboard`
}

/** Link to a single game on espn.com — its recap/box score where the league has
 *  game pages, the /soccer/ match page for soccer, else that day's scoreboard
 *  (volleyball has no game pages; the slug is optional for clubhouse leagues —
 *  ESPN resolves the game from its id). */
export function espnGameUrl(
  leagueKey: string,
  gameId: string,
  date?: string,
): string | undefined {
  const lg = leagueByKey(leagueKey)
  if (!lg) return undefined
  if (lg.sport === 'soccer') return `https://www.espn.com/soccer/match/_/gameId/${gameId}`
  if (lg.webPages === 'clubhouse') {
    return `https://www.espn.com/${lg.league}/game/_/gameId/${gameId}`
  }
  const ymd = date ? date.slice(0, 10).replace(/-/g, '') : ''
  return ymd
    ? `https://www.espn.com/${lg.league}/scoreboard/_/date/${ymd}`
    : `https://www.espn.com/${lg.league}/scoreboard`
}

/** Build a game from the tracked team's perspective (shared by schedule rows). */
function toTeamGame(lg: EspnLeague, teamId: string, e: EspnEvent): EspnGame {
  const comp = e.competitions?.[0]
  const completed = comp?.status?.type?.completed ?? false
  const competitors = comp?.competitors ?? []
  const us = competitors.find((c) => c.team?.id === teamId)
  const them = competitors.find((c) => c.team?.id !== teamId)
  let result: EspnGame['result']
  if (completed && us?.score?.value != null && them?.score?.value != null) {
    result = { us: us.score.value, them: them.score.value, won: us.winner ?? false }
  }
  const rank = us?.curatedRank?.current
  return {
    id: e.id,
    name: e.shortName ?? e.name ?? 'Game',
    fullName: e.name ?? e.shortName ?? 'Game',
    date: e.date,
    completed,
    week: e.week?.text,
    homeAway: us?.homeAway === 'home' || us?.homeAway === 'away' ? us.homeAway : undefined,
    opponent: them
      ? {
          name: them.team?.displayName ?? 'Opponent',
          logo: them.team?.logos?.[0]?.href ?? fallbackLogo(lg, them.team?.id),
          record: them.record?.find((r) => r.type === 'total')?.displayValue,
        }
      : undefined,
    teamRank: rank != null && rank >= 1 && rank <= 25 ? rank : undefined,
    result,
  }
}

/** A team's games for one season, oldest-first. */
export async function getEspnTeamSchedule(
  leagueKey: string,
  teamId: string,
  season: number,
): Promise<EspnSchedule> {
  const lg = leagueByKey(leagueKey)
  if (!lg) throw new Error(`Unknown league: ${leagueKey}`)
  const data = await fetchJson<ScheduleResponse>(
    `${SITE}/${lg.sport}/${lg.league}/teams/${teamId}/schedule?season=${season}`,
  )
  const events = data.events ?? []
  const games = events.map((e) => toTeamGame(lg, teamId, e))
  games.sort((a, b) => a.date.localeCompare(b.date))

  // The schedule's top-level team object usually omits logos; the tracked team
  // appears as a competitor in its own games, so borrow its logo from there,
  // then fall back to the id-addressed logo for leagues that have one.
  let teamLogo: string | undefined
  for (const e of events) {
    const me = e.competitions?.[0]?.competitors?.find((c) => c.team?.id === teamId)
    const href = me?.team?.logos?.[0]?.href
    if (href) {
      teamLogo = href
      break
    }
  }
  return {
    teamName: data.team?.displayName ?? '',
    logo: data.team?.logos?.[0]?.href ?? teamLogo ?? fallbackLogo(lg, teamId),
    season: data.requestedSeason?.year ?? season,
    games,
  }
}

export interface EspnScoreGame {
  id: string
  leagueKey: string
  date: string
  completed: boolean
  /** Short label, e.g. "DAL @ PHI". */
  name: string
  week?: string
  home?: { name: string; abbrev?: string; logo?: string; score?: number }
  away?: { name: string; abbrev?: string; logo?: string; score?: number }
}

interface ScoreboardResponse {
  events?: EspnEvent[]
}

function sideOf(lg: EspnLeague, c: Competitor | undefined): EspnScoreGame['home'] {
  if (!c) return undefined
  return {
    name: c.team?.displayName ?? c.team?.abbreviation ?? 'Team',
    abbrev: c.team?.abbreviation,
    logo: c.team?.logos?.[0]?.href ?? fallbackLogo(lg, c.team?.id),
    score: c.score?.value,
  }
}

/**
 * A league's current scoreboard (this week / today, as ESPN defines it). Used
 * by Search to browse games by league + released state — e.g. upcoming NFL
 * games this weekend. Games come back in date order.
 */
export async function getEspnScoreboard(leagueKey: string): Promise<EspnScoreGame[]> {
  const lg = leagueByKey(leagueKey)
  if (!lg) return []
  try {
    const data = await fetchJson<ScoreboardResponse>(`${SITE}/${lg.sport}/${lg.league}/scoreboard`)
    const games = (data.events ?? []).map((e): EspnScoreGame => {
      const comp = e.competitions?.[0]
      const cs = comp?.competitors ?? []
      const home = cs.find((c) => c.homeAway === 'home')
      const away = cs.find((c) => c.homeAway === 'away')
      return {
        id: e.id,
        leagueKey: lg.key,
        date: e.date,
        completed: comp?.status?.type?.completed ?? false,
        name: e.shortName ?? e.name ?? 'Game',
        week: e.week?.text,
        home: sideOf(lg, home),
        away: sideOf(lg, away),
      }
    })
    games.sort((a, b) => a.date.localeCompare(b.date))
    return games
  } catch {
    return []
  }
}

/** Recent seasons to offer in the season picker (current year back `count-1`). */
export function recentSeasons(count = 6): number[] {
  const now = new Date().getFullYear()
  return Array.from({ length: count }, (_, i) => now - i)
}
