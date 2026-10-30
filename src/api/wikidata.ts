// ---------------------------------------------------------------------------
// Wikidata client (keyless, CORS-friendly) for "shared universe" linking.
//
// TMDB's own franchise data (belongs_to_collection) is movies-only, so it can't
// connect, say, the Chucky TV series to the Child's Play films. Wikidata models
// that with "part of the series" (P179) / "from narrative universe" (P1080) /
// "part of" (P361) pointing at a shared franchise entity, and tags most works
// with their TMDB movie (P4947) or TV (P4983) id — so we can hop TMDB →
// Wikidata → siblings → back to TMDB, across media.
//
// Those links are tagged inconsistently: within one franchise, some works point
// *out* at the franchise while others are only reached by the franchise's own
// "has parts" (P527) pointing back at them. So we walk the franchise in BOTH
// directions — otherwise the same franchise yields different members depending on
// which title you start from (e.g. only some Child's Play films would connect).
//
// Unofficial use of a public endpoint: every call fails soft (returns null/[]).
// ---------------------------------------------------------------------------

const SPARQL = 'https://query.wikidata.org/sparql'
const API = 'https://www.wikidata.org/w/api.php'

/** fetch that gives up after `ms` so a slow Wikidata can't hang a page. */
async function fetchSoft(url: string, init?: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface UniverseMember {
  tmdbId: number
  mediaType: 'movie' | 'show'
  title: string
}
export interface Universe {
  /** Franchise name, e.g. "Child's Play". */
  name: string
  members: UniverseMember[]
  /** True for a tight group under the cap (a phase / small franchise); false for a
   *  larger franchise shown as a last resort (so callers can prefer a collection). */
  narrow: boolean
}

interface SparqlBinding {
  [key: string]: { value: string } | undefined
}

async function runSparql(query: string, ms = 8000): Promise<SparqlBinding[]> {
  const res = await fetchSoft(
    `${SPARQL}?format=json&query=${encodeURIComponent(query)}`,
    { headers: { Accept: 'application/sparql-results+json' } },
    ms,
  )
  if (!res.ok) throw new Error(`Wikidata request failed (${res.status})`)
  const data = (await res.json()) as { results?: { bindings?: SparqlBinding[] } }
  return data.results?.bindings ?? []
}

/** Resolve a name to candidate Wikidata entity ids (fast; indexed search). */
async function searchEntities(name: string): Promise<string[]> {
  const url =
    `${API}?action=wbsearchentities&format=json&language=en&origin=*&limit=5` +
    `&search=${encodeURIComponent(name)}`
  const res = await fetchSoft(url)
  if (!res.ok) return []
  const data = (await res.json()) as { search?: { id: string }[] }
  return (data.search ?? []).map((s) => s.id)
}

function memberOf(row: SparqlBinding): UniverseMember | null {
  const title = row.workLabel?.value ?? ''
  const movie = row.tmdbM?.value
  const tv = row.tmdbT?.value
  if (movie) return { tmdbId: Number(movie), mediaType: 'movie', title }
  if (tv) return { tmdbId: Number(tv), mediaType: 'show', title }
  return null
}

// A title belongs to several nested groups at once — e.g. an MCU film is in
// "Marvel Cinematic Universe" (~58), "The Infinity Saga" (22), "…Phase One" (7)
// and "Avengers" (6). We prefer a *useful-sized* group: the largest under CAP
// (lands on "Phase One", "Star Wars", "Child's Play", "NCIS", "Scream" …). When
// nothing is under CAP, we fall back to the smallest franchise up to WIDE_CAP
// (so a big TV franchise like "Doctor Who"/"Star Trek"/"James Bond" still shows),
// noise-filtered and display-capped.
const UNIVERSE_CAP = 20
const WIDE_CAP = 60
const WIDE_SHOW = 24
// Franchise padding that isn't a watchable entry (behind-the-scenes, recap and
// companion shows) — trimmed from the wide fallback so it isn't all clutter.
const FRANCHISE_NOISE =
  /\b(confidential|declassified|unleashed|totally|aftershow|recap|documentary|bloopers?|outtakes?|insider)\b|behind the scenes|making of|years in the|alien files|\bextra\b/i

/**
 * The shared-universe franchise a TMDB title belongs to, with its sibling works
 * that have a TMDB id (movies and shows alike). Returns null when the title isn't
 * in Wikidata or the lookup fails.
 *
 * One query, via "part of the series" (P179), "from narrative universe" (P1080),
 * and "media franchise" (P8345 — how TV franchises like NCIS/Doctor Who/Star Trek
 * link their series). Deliberately NOT generic "part of" (P361), which drags in
 * thematic lists like "National Film Registry" (849 films); dropping it removes
 * that noise and keeps the query fast.
 */
export async function getUniverse(
  mediaType: 'movie' | 'show',
  tmdbId: number,
): Promise<Universe | null> {
  const prop = mediaType === 'movie' ? 'P4947' : 'P4983'
  const query = `SELECT ?f ?fLabel ?work ?workLabel ?tmdbM ?tmdbT WHERE {
    ?seed wdt:${prop} "${tmdbId}" .
    { ?seed (wdt:P179|wdt:P1080|wdt:P8345) ?f. } UNION { ?f wdt:P527 ?seed. }
    { ?work (wdt:P179|wdt:P1080|wdt:P8345) ?f. } UNION { ?f wdt:P527 ?work. }
    OPTIONAL { ?work wdt:P4947 ?tmdbM. }
    OPTIONAL { ?work wdt:P4983 ?tmdbT. }
    FILTER(BOUND(?tmdbM) || BOUND(?tmdbT))
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 500`
  // No try/catch: a timeout/network error must PROPAGATE so TanStack treats it as
  // an error (retries, refetches next visit) instead of caching a null "no
  // universe" for a day. Some big-franchise queries are slow cold (~15s) but fast
  // once Wikidata warms its own cache, so a later visit then succeeds. Only a
  // query that *succeeds* with no suitable group returns null.
  // Most titles answer in ~2–4s; a rare highly-connected entity is much slower
  // (and meanwhile falls back to the collection/keyword path).
  const rows = await runSparql(query, 10000)
  const groups = new Map<string, { name: string; members: Map<string, UniverseMember> }>()
  for (const row of rows) {
    const fid = row.f?.value
    if (!fid) continue
    const g = groups.get(fid) ?? {
      name: row.fLabel?.value ?? 'Shared universe',
      members: new Map<string, UniverseMember>(),
    }
    const m = memberOf(row)
    if (m) g.members.set(`${m.mediaType}:${m.tmdbId}`, m)
    groups.set(fid, g)
  }

  // Tier 1: the largest tight group (2..CAP-1) — a phase / small franchise.
  let narrow: { name: string; members: Map<string, UniverseMember> } | null = null
  // Tier 2: the smallest broad franchise (CAP..WIDE_CAP) — a last resort so a
  // big franchise still links its parts.
  let wide: { name: string; members: Map<string, UniverseMember> } | null = null
  for (const g of groups.values()) {
    const n = g.members.size
    if (n >= 2 && n < UNIVERSE_CAP) {
      if (!narrow || n > narrow.members.size) narrow = g
    } else if (n >= UNIVERSE_CAP && n <= WIDE_CAP) {
      if (!wide || n < wide.members.size) wide = g
    }
  }

  if (narrow) {
    return { name: narrow.name, members: [...narrow.members.values()], narrow: true }
  }
  if (wide) {
    const members = [...wide.members.values()]
      .filter((m) => !FRANCHISE_NOISE.test(m.title))
      .slice(0, WIDE_SHOW)
    if (members.length >= 2) return { name: wide.name, members, narrow: false }
  }
  return null
}

/** Members of a franchise looked up by its name (used to broaden a series:
 *  search to cross-media siblings). Resolves the name to entity ids via the
 *  search API first — a label scan in SPARQL is unindexed and times out. */
export async function getUniverseByName(name: string): Promise<UniverseMember[]> {
  try {
    const ids = await searchEntities(name.trim())
    if (!ids.length) return []
    const values = ids.map((id) => `wd:${id}`).join(' ')
    const query = `SELECT DISTINCT ?work ?workLabel ?tmdbM ?tmdbT WHERE {
      VALUES ?franchise { ${values} }
      { ?work (wdt:P179|wdt:P1080|wdt:P361) ?franchise. } UNION { ?franchise wdt:P527 ?work. }
      OPTIONAL { ?work wdt:P4947 ?tmdbM. }
      OPTIONAL { ?work wdt:P4983 ?tmdbT. }
      FILTER(BOUND(?tmdbM) || BOUND(?tmdbT))
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 100`
    const rows = await runSparql(query)
    const members = new Map<string, UniverseMember>()
    for (const row of rows) {
      const m = memberOf(row)
      if (m) members.set(`${m.mediaType}:${m.tmdbId}`, m)
    }
    return [...members.values()]
  } catch {
    return []
  }
}
