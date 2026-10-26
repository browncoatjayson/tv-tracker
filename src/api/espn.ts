// ---------------------------------------------------------------------------
// ESPN "hidden" API client (keyless, CORS-friendly). Powers sports tracking:
// finding a team and listing its games for a season. ESPN reuses the same team
// id across a school's sports (e.g. Nebraska = 158 for football and volleyball),
// so one search hit covers every supported league.
//
// This API is unofficial and undocumented — isolated here so a shape change only
// touches one file, and every call fails soft (returns [] / throws a plain Error).
// ---------------------------------------------------------------------------

const SITE = 'https://site.api.espn.com/apis/site/v2/sports'
const SEARCH = 'https://site.web.api.espn.com/apis/search/v2'

export interface EspnLeague {
  /** Our short key, stored on the tracked item (e.g. "cfb"). */
  key: string
  /** ESPN path parts (shared by the API and the espn.com web section). */
  sport: string
  league: string
  label: string
  emoji: string
  /** What espn.com publishes for this league on the web:
   *  'clubhouse' — per-team and per-game pages (football, basketball, …);
   *  'scoreboard' — only a dated scoreboard (women's volleyball has no team or
   *  game pages, so a team/game link to one 404s — fall back to the scoreboard). */
  webPages: 'clubhouse' | 'scoreboard'
}

// Supported leagues (college football + women's college volleyball to start).
export const ESPN_LEAGUES: EspnLeague[] = [
  {
    key: 'cfb',
    sport: 'football',
    league: 'college-football',
    label: 'College Football',
    emoji: '🏈',
    webPages: 'clubhouse',
  },
  {
    key: 'wcvb',
    sport: 'volleyball',
    league: 'womens-college-volleyball',
    label: 'College Volleyball',
    emoji: '🏐',
    webPages: 'scoreboard',
  },
]

export function leagueByKey(key: string | undefined): EspnLeague | undefined {
  return ESPN_LEAGUES.find((l) => l.key === key)
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ESPN request failed (${res.status})`)
  return (await res.json()) as T
}

export interface EspnTeamHit {
  /** ESPN team id (school id, shared across that school's sports). */
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

/** Find college teams by name. Each matched school is offered for every
 *  supported league (ESPN search doesn't surface volleyball directly, but the
 *  school's team id works across sports). */
export async function searchEspnTeams(query: string): Promise<EspnTeamHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const data = await fetchJson<SearchResponse>(`${SEARCH}?limit=30&query=${encodeURIComponent(q)}`)
  const contents = data.results?.find((r) => r.type === 'team')?.contents ?? []
  // Distinct college schools, keyed by team id.
  const schools = new Map<string, { teamId: string; teamName: string; logo?: string }>()
  for (const c of contents) {
    if (!/college/i.test(c.defaultLeagueSlug ?? '')) continue // scope: college only
    const m = c.uid?.match(/t:(\d+)/)
    if (!m) continue
    const teamId = m[1]
    if (!schools.has(teamId)) {
      schools.set(teamId, {
        teamId,
        teamName: c.displayName ?? 'Unknown',
        logo: c.image?.default,
      })
    }
  }
  const hits: EspnTeamHit[] = []
  for (const s of schools.values()) {
    for (const lg of ESPN_LEAGUES) {
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

interface ScheduleResponse {
  team?: { displayName?: string; logos?: { href: string }[] }
  requestedSeason?: { year?: number }
  season?: { year?: number }
  events?: {
    id: string
    name?: string
    shortName?: string
    date: string
    week?: { text?: string }
    competitions?: {
      status?: { type?: { completed?: boolean } }
      competitors?: {
        homeAway?: string
        winner?: boolean
        curatedRank?: { current?: number }
        team?: { id?: string; displayName?: string; logos?: { href: string }[] }
        score?: { value?: number; displayValue?: string }
        record?: { type?: string; displayValue?: string }[]
      }[]
    }[]
  }[]
}

/** Deterministic college-team logo by ESPN id (the schedule often omits logos). */
function ncaaLogo(id: string | undefined): string | undefined {
  return id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png` : undefined
}

/** Link to a team on espn.com — its clubhouse where the league has one, else the
 *  league scoreboard (volleyball has no team pages). */
export function espnTeamUrl(leagueKey: string, teamId: string): string | undefined {
  const lg = leagueByKey(leagueKey)
  if (!lg) return undefined
  return lg.webPages === 'clubhouse'
    ? `https://www.espn.com/${lg.league}/team/_/id/${teamId}`
    : `https://www.espn.com/${lg.league}/scoreboard`
}

/** Link to a single game on espn.com — its recap/box score where the league has
 *  game pages, else that day's scoreboard (volleyball has no game pages; the slug
 *  is optional for clubhouse leagues — ESPN resolves the game from its id). */
export function espnGameUrl(
  leagueKey: string,
  gameId: string,
  date?: string,
): string | undefined {
  const lg = leagueByKey(leagueKey)
  if (!lg) return undefined
  if (lg.webPages === 'clubhouse') {
    return `https://www.espn.com/${lg.league}/game/_/gameId/${gameId}`
  }
  const ymd = date ? date.slice(0, 10).replace(/-/g, '') : ''
  return ymd
    ? `https://www.espn.com/${lg.league}/scoreboard/_/date/${ymd}`
    : `https://www.espn.com/${lg.league}/scoreboard`
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
  const games: EspnGame[] = (data.events ?? []).map((e) => {
    const comp = e.competitions?.[0]
    const completed = comp?.status?.type?.completed ?? false
    let result: EspnGame['result']
    const competitors = comp?.competitors ?? []
    const us = competitors.find((c) => c.team?.id === teamId)
    const them = competitors.find((c) => c.team?.id !== teamId)
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
            logo: them.team?.logos?.[0]?.href ?? ncaaLogo(them.team?.id),
            record: them.record?.find((r) => r.type === 'total')?.displayValue,
          }
        : undefined,
      teamRank: rank != null && rank >= 1 && rank <= 25 ? rank : undefined,
      result,
    }
  })
  games.sort((a, b) => a.date.localeCompare(b.date))
  return {
    teamName: data.team?.displayName ?? '',
    // The schedule's team object often omits logos, but ESPN serves a stable
    // logo by team id (college teams live under /ncaa/).
    logo: data.team?.logos?.[0]?.href ?? `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`,
    season: data.requestedSeason?.year ?? season,
    games,
  }
}

/** Recent seasons to offer in the season picker (current year back `count-1`). */
export function recentSeasons(count = 6): number[] {
  const now = new Date().getFullYear()
  return Array.from({ length: count }, (_, i) => now - i)
}
