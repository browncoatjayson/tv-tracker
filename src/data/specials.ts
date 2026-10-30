import type { TmdbEpisode, TmdbSeasonSummary } from '../api/tmdb'

// ---------------------------------------------------------------------------
// Season-0 ("Specials") classification.
//
// TMDB dumps everything into season 0 — narrative specials (Christmas specials,
// anniversary episodes, canon minisodes) alongside extras (behind-the-scenes,
// trailers, 1-minute prequels, concert films). We separate them by a cheap,
// data-free signal: a *narrative* special has a credited Director, an *extra*
// usually doesn't. The season endpoint already returns per-episode `crew`, so
// this costs no extra requests. It's ~90% accurate (see the project notes); a
// show whose specials simply lack crew data would classify as all-extras, so we
// guard against that by keeping everything inline when nothing looks narrative.
// ---------------------------------------------------------------------------

/** A season-0 special is "narrative" (vs an extra/clip) when it has a director. */
export function isNarrativeSpecial(ep: TmdbEpisode): boolean {
  return (ep.crew ?? []).some((c) => c.job === 'Director')
}

/**
 * Split season-0 episodes into narrative specials — bucketed by the regular
 * season they aired *after* (0 = before season 1), each bucket air-date sorted —
 * and extras. `regular` must be the regular seasons (number > 0), sorted ascending.
 */
export function classifySpecials(
  regular: TmdbSeasonSummary[],
  specialEps: TmdbEpisode[],
): { groups: Map<number, number[]>; undated: number[]; extras: number[] } {
  let narrative = specialEps.filter(isNarrativeSpecial)
  let extraEps = specialEps.filter((e) => !isNarrativeSpecial(e))
  // Guard: no director data at all → keep every special inline rather than
  // hiding them all in Extras.
  if (narrative.length === 0) {
    narrative = specialEps
    extraEps = []
  }

  const dateOf = new Map<number, string | null>()
  for (const e of specialEps) dateOf.set(e.episode_number, e.air_date)

  const groups = new Map<number, number[]>()
  const undated: number[] = []
  for (const ep of narrative) {
    if (!ep.air_date) {
      undated.push(ep.episode_number)
      continue
    }
    let after = 0
    for (const s of regular) if (s.air_date && s.air_date <= ep.air_date) after = s.season_number
    const list = groups.get(after)
    if (list) list.push(ep.episode_number)
    else groups.set(after, [ep.episode_number])
  }

  const byDate = (a: number, b: number) => (dateOf.get(a) ?? '').localeCompare(dateOf.get(b) ?? '')
  for (const [k, v] of groups) groups.set(k, [...v].sort(byDate))
  undated.sort((a, b) => a - b)
  const extras = extraEps.map((e) => e.episode_number).sort((a, b) => a - b)
  return { groups, undated, extras }
}

export interface BrowseEntry {
  season: number
  episode: number
}

/**
 * The linear browse order for Prev/Next: every regular-season episode with the
 * narrative specials interleaved by air date between seasons. Extras are left
 * out (they're their own island). Regular episodes are enumerated 1..episode_count
 * (no per-season fetch needed); specials come from the loaded season-0 episodes.
 */
export function buildBrowseSequence(
  seasons: TmdbSeasonSummary[],
  specialEps: TmdbEpisode[] | undefined,
): BrowseEntry[] {
  const regular = seasons
    .filter((s) => s.season_number > 0 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number)
  const { groups, undated } =
    specialEps && specialEps.length
      ? classifySpecials(regular, specialEps)
      : { groups: new Map<number, number[]>(), undated: [] as number[] }

  const seq: BrowseEntry[] = []
  const pushSpecials = (nums?: number[]) => {
    for (const n of nums ?? []) seq.push({ season: 0, episode: n })
  }
  pushSpecials(groups.get(0)) // specials before season 1
  for (const s of regular) {
    for (let e = 1; e <= s.episode_count; e++) seq.push({ season: s.season_number, episode: e })
    pushSpecials(groups.get(s.season_number))
  }
  pushSpecials(undated)
  return seq
}
