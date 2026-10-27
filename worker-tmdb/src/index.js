// ---------------------------------------------------------------------------
// TMDB proxy worker (keyless on the client). The app's TMDB "Read Access Token"
// used to be embedded in the public bundle; this worker holds it as a secret and
// adds it server-side, so it can't be extracted and reused on your account.
//
// It also makes TMDB use far more efficient: responses are cached at Cloudflare's
// edge (shared across every visitor), so the first request for an item hits TMDB
// and the rest are served from cache — you make a fraction of the API calls.
//
// Scope is locked down: GET only, CORS restricted to your app's origin, and only
// the handful of TMDB path prefixes the app actually uses are forwarded — so it
// can never be turned into an open proxy. Images are NOT proxied (they need no
// token and are served straight from image.tmdb.org by the client).
// ---------------------------------------------------------------------------

const TMDB = 'https://api.themoviedb.org/3'

// First path segment must be one of these (the endpoints the client calls).
const ALLOWED = new Set([
  'movie',
  'tv',
  'person',
  'search',
  'genre',
  'trending',
  'discover',
  'find',
  'credit',
  'collection',
  'watch', // /watch/providers/...
  'configuration',
])

const HOUR = 3600
const DAY = 24 * HOUR

// How long the edge may serve a cached copy, by endpoint volatility.
function ttlFor(pathname) {
  if (pathname.startsWith('/trending')) return 6 * HOUR
  if (
    pathname.startsWith('/genre') ||
    pathname.startsWith('/configuration') ||
    pathname.startsWith('/watch/providers')
  ) {
    return 7 * DAY
  }
  if (pathname.startsWith('/search') || pathname.startsWith('/discover')) return HOUR
  return DAY // details, credits, collections, episodes, etc.
}

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const ok = origin && (allowed.length === 0 || allowed.includes(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(env, req.headers.get('Origin'))
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors)
    if (!env.TMDB_TOKEN) return json({ error: 'server not configured' }, 500, cors)

    const url = new URL(req.url)
    const first = url.pathname.split('/').filter(Boolean)[0]
    if (!first || !ALLOWED.has(first)) return json({ error: 'not allowed' }, 403, cors)

    // Forward the path + query to TMDB verbatim (host is fixed, so this can only
    // ever reach api.themoviedb.org). The token is added here, never in the client.
    const upstream = new URL(TMDB + url.pathname + url.search)

    // Shared edge cache, keyed on the upstream URL only (origin-independent) so
    // every app origin shares one cached copy. CORS is added per-request below.
    const cacheKey = new Request(upstream.toString(), { method: 'GET' })
    const cache = caches.default
    let cached = await cache.match(cacheKey)

    if (!cached) {
      let upstreamRes
      try {
        upstreamRes = await fetch(upstream, {
          headers: { Authorization: `Bearer ${env.TMDB_TOKEN}`, accept: 'application/json' },
          cf: { cacheTtl: 0, cacheEverything: false },
        })
      } catch (e) {
        return json({ error: 'upstream fetch failed', detail: String(e) }, 502, cors)
      }
      // Stream the body through instead of buffering the whole response into
      // memory — buffering + cloning large responses (e.g. a show with many
      // seasons) can trip the Worker's CPU/memory limits and fail intermittently.
      const headers = new Headers({
        'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json',
        // Only cache successful responses; let errors pass through uncached.
        'Cache-Control': upstreamRes.ok ? `public, max-age=${ttlFor(url.pathname)}` : 'no-store',
      })
      cached = new Response(upstreamRes.body, { status: upstreamRes.status, headers })
      // clone() tees the stream, so caching doesn't block sending the response.
      if (upstreamRes.ok) ctx.waitUntil(cache.put(cacheKey, cached.clone()))
    }

    // Re-emit with this request's CORS headers (not stored in the shared entry).
    const out = new Response(cached.body, cached)
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
    // Only Cloudflare's edge cache (populated above) should persist responses —
    // never the browser. Chrome partitions its HTTP cache by top-level site, so a
    // stale/partial entry for the app's cross-site fetch was being replayed
    // without ever reaching the worker, breaking some shows. no-store stops that.
    out.headers.set('Cache-Control', 'no-store')
    return out
  },
}
