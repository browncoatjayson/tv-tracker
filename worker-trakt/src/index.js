// ---------------------------------------------------------------------------
// Trakt proxy worker. The app's public Trakt read calls (TMDB->Trakt id lookup
// and episode air times) used to go straight to api.trakt.tv with custom headers
// (trakt-api-key / trakt-api-version), which forces a CORS *preflight* on every
// request — doubling the request count and, under the indexer's burst, surfacing
// Trakt's 429s as opaque browser "CORS errors".
//
// This worker fixes that the same way the TMDB proxy does: the client calls it
// with a simple GET (no custom headers, no preflight), and the key/version are
// added here, server-side. Responses are cached at Cloudflare's edge (shared
// across every visitor), so repeat lookups hit Trakt far less often — which also
// eases Trakt's shared-key rate limit. And a 429 from here is returned WITH CORS
// headers, so the client can retry it cleanly instead of seeing a CORS failure.
//
// Scope is locked down: GET only, CORS restricted to your app's origins, and only
// the public read path prefixes the app uses are forwarded — never the authed
// endpoints (sign-in, history, posting, comments), which stay direct from the
// client so no user token ever passes through this shared-cache proxy.
// ---------------------------------------------------------------------------

const TRAKT = 'https://api.trakt.tv'

// First path segment must be one of these public read endpoints. (Authed calls —
// /oauth, /users, /sync, /comments writes — are never sent here by the client.)
const ALLOWED = new Set(['search', 'shows', 'movies'])

const MIN = 60
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// How long the edge may serve a cached copy, by endpoint volatility.
function ttlFor(pathname) {
  // The TMDB->Trakt id mapping is effectively immutable.
  if (pathname.startsWith('/search/')) return 7 * DAY
  // Season/episode air times: stable once aired, may shift for unaired episodes.
  return DAY
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
    if (!env.TRAKT_CLIENT_ID) return json({ error: 'server not configured' }, 500, cors)

    const url = new URL(req.url)
    const first = url.pathname.split('/').filter(Boolean)[0]
    if (!first || !ALLOWED.has(first)) return json({ error: 'not allowed' }, 403, cors)

    // Forward the path + query to Trakt verbatim (host is fixed, so this can only
    // ever reach api.trakt.tv). The api key/version are added here, never shipped.
    const upstream = new URL(TRAKT + url.pathname + url.search)

    // Shared edge cache, keyed on the upstream URL only (origin-independent) so
    // every app origin shares one cached copy. CORS is added per-request below.
    const cacheKey = new Request(upstream.toString(), { method: 'GET' })
    const cache = caches.default
    let cached = await cache.match(cacheKey)
    // Surfaced as X-Cache below so a warm pass can be verified from the client.
    // NOTE: caches.default is a no-op on *.workers.dev — this only ever reports
    // HIT when the worker runs on a custom domain / route in a zone you own.
    const cacheHit = !!cached

    if (!cached) {
      let upstreamRes
      try {
        upstreamRes = await fetch(upstream, {
          headers: {
            'trakt-api-key': env.TRAKT_CLIENT_ID,
            'trakt-api-version': '2',
            accept: 'application/json',
            // Trakt is itself behind Cloudflare, whose firewall 403-challenges
            // requests with no User-Agent — and a Worker subrequest sends none by
            // default. A descriptive UA clears the challenge. (Verified: no UA →
            // 403 "Attention Required"; any non-empty UA → 200.)
            'User-Agent': 'tvtracker/1.0 (+https://tvtracker.alteriorfantasy.com)',
          },
          cf: { cacheTtl: 0, cacheEverything: false },
        })
      } catch (e) {
        return json({ error: 'upstream fetch failed', detail: String(e) }, 502, cors)
      }
      // Stream the body through instead of buffering (a show with many seasons can
      // be large). Only cache successful responses; errors (incl. 429) pass through
      // uncached, so the client's retry logic can take over.
      const headers = new Headers({
        'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json',
        'Cache-Control': upstreamRes.ok ? `public, max-age=${ttlFor(url.pathname)}` : 'no-store',
      })
      // Pass Trakt's Retry-After through on a 429 so the client can honour it.
      const retryAfter = upstreamRes.headers.get('Retry-After')
      if (retryAfter) headers.set('Retry-After', retryAfter)
      cached = new Response(upstreamRes.body, { status: upstreamRes.status, headers })
      // clone() tees the stream, so caching doesn't block sending the response.
      if (upstreamRes.ok) ctx.waitUntil(cache.put(cacheKey, cached.clone()))
    }

    // Re-emit with this request's CORS headers (not stored in the shared entry).
    const out = new Response(cached.body, cached)
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
    out.headers.set('Access-Control-Expose-Headers', 'Retry-After, X-Cache')
    out.headers.set('X-Cache', cacheHit ? 'HIT' : 'MISS')
    // Only Cloudflare's edge cache (populated above) should persist responses —
    // never the browser's partitioned HTTP cache, which can replay stale/partial
    // cross-site entries without ever reaching the worker.
    out.headers.set('Cache-Control', 'no-store')
    return out
  },
}
