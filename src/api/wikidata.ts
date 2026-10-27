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
}

interface SparqlBinding {
  [key: string]: { value: string } | undefined
}

async function runSparql(query: string): Promise<SparqlBinding[]> {
  const res = await fetchSoft(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  })
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

/**
 * The shared-universe franchise a TMDB title belongs to, with all its sibling
 * works that have a TMDB id (movies and shows alike). Returns null when the
 * title isn't in Wikidata, has no franchise, or the lookup fails.
 */
export async function getUniverse(
  mediaType: 'movie' | 'show',
  tmdbId: number,
): Promise<Universe | null> {
  const prop = mediaType === 'movie' ? 'P4947' : 'P4983'
  const query = `SELECT DISTINCT ?franchise ?franchiseLabel ?work ?workLabel ?tmdbM ?tmdbT WHERE {
    ?seed wdt:${prop} "${tmdbId}" .
    { ?seed (wdt:P179|wdt:P1080|wdt:P361) ?franchise. } UNION { ?franchise wdt:P527 ?seed. }
    { ?work (wdt:P179|wdt:P1080|wdt:P361) ?franchise. } UNION { ?franchise wdt:P527 ?work. }
    OPTIONAL { ?work wdt:P4947 ?tmdbM. }
    OPTIONAL { ?work wdt:P4983 ?tmdbT. }
    FILTER(BOUND(?tmdbM) || BOUND(?tmdbT))
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 200`
  try {
    const rows = await runSparql(query)
    // A title can belong to several franchises (e.g. a crossover); keep the one
    // with the most TMDB-linked works — that's the "main" shared universe.
    const groups = new Map<string, { name: string; members: Map<string, UniverseMember> }>()
    for (const row of rows) {
      const fid = row.franchise?.value
      if (!fid) continue
      const g = groups.get(fid) ?? { name: row.franchiseLabel?.value ?? 'Shared universe', members: new Map() }
      const m = memberOf(row)
      if (m) g.members.set(`${m.mediaType}:${m.tmdbId}`, m)
      groups.set(fid, g)
    }
    let best: { name: string; members: Map<string, UniverseMember> } | null = null
    for (const g of groups.values()) if (!best || g.members.size > best.members.size) best = g
    if (!best || best.members.size < 2) return null
    return { name: best.name, members: [...best.members.values()] }
  } catch {
    return null
  }
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
