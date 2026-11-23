// ---------------------------------------------------------------------------
// Music proxy worker. One worker for every music-data source the app uses, routed
// by the first path segment:
//
//   /musicbrainz/release-group/<id>   -> https://musicbrainz.org/ws/2/release-group/<id>
//   /musicbrainz/release/<id>         -> https://musicbrainz.org/ws/2/release/<id>
//   (/tunefind/… and /whatsong/… slot in here later — see SOURCES)
//
// Why a proxy at all: MusicBrainz expects a descriptive User-Agent, which a
// browser CANNOT set (forbidden header), and it 503-throttles anonymous/browser
// requests hard — so direct client calls fail under any burst. Adding the header
// here, server-side, gets the normal rate allowance. The future keyed sources
// (Tunefind / WhatSong via RapidAPI) will also live here so their API keys never
// reach the client.
//
// Scope is locked down: GET only, CORS restricted to the app's origins, and each
// source whitelists exactly the endpoints the app uses.
//
// NOTE: caches.default (the shared edge cache) is a no-op on *.workers.dev — it
// only persists on a custom domain / route in a zone you own. So on workers.dev
// this stays per-client; the app's own titleMeta cache (synced across a user's
// devices) is what avoids re-querying. The caching code is kept so moving to a
// custom domain later turns on the shared cache with no change.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60

// Per-source config: upstream base, the endpoints we allow, the headers to add
// server-side, and how long a response may be edge-cached. `headers(env)` can read
// secrets (e.g. a RapidAPI key) for the keyed sources added later.
const SOURCES = {
  musicbrainz: {
    base: 'https://musicbrainz.org/ws/2',
    endpoints: new Set(['release-group', 'release']),
    headers: () => ({
      Accept: 'application/json',
      // The whole point of this proxy: a descriptive User-Agent the browser can't
      // send. Without it MusicBrainz 503-throttles; with it the normal allowance
      // applies.
      'User-Agent': 'tvtracker/1.0 (+https://tvtracker.alteriorfantasy.com)',
    }),
    ttl: 7 * DAY, // a soundtrack's tracklist is effectively immutable
  },
  // tunefind / whatsong: added here when those accounts land. Each gets its own
  // base, allowed endpoints, and headers() (which can pull a key from `env`).
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

    const url = new URL(req.url)
    const segs = url.pathname.split('/').filter(Boolean)
    const source = SOURCES[segs[0]]
    if (!source) return json({ error: 'unknown source' }, 403, cors)
    const endpoint = segs[1]
    if (!endpoint || !source.endpoints.has(endpoint)) return json({ error: 'not allowed' }, 403, cors)

    // Everything after the source segment is forwarded to that source's base, so
    // the host is fixed per source and can't be redirected.
    const rest = '/' + segs.slice(1).join('/')
    const upstream = new URL(source.base + rest + url.search)

    const cacheKey = new Request(upstream.toString(), { method: 'GET' })
    const cache = caches.default
    let cached = await cache.match(cacheKey)
    const cacheHit = !!cached

    if (!cached) {
      let upstreamRes
      try {
        upstreamRes = await fetch(upstream, {
          headers: source.headers(env),
          cf: { cacheTtl: 0, cacheEverything: false },
        })
      } catch (e) {
        return json({ error: 'upstream fetch failed', detail: String(e) }, 502, cors)
      }
      const headers = new Headers({
        'Content-Type': upstreamRes.headers.get('Content-Type') || 'application/json',
        'Cache-Control': upstreamRes.ok ? `public, max-age=${source.ttl}` : 'no-store',
      })
      const retryAfter = upstreamRes.headers.get('Retry-After')
      if (retryAfter) headers.set('Retry-After', retryAfter)
      cached = new Response(upstreamRes.body, { status: upstreamRes.status, headers })
      if (upstreamRes.ok) ctx.waitUntil(cache.put(cacheKey, cached.clone()))
    }

    const out = new Response(cached.body, cached)
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
    out.headers.set('Access-Control-Expose-Headers', 'Retry-After, X-Cache')
    out.headers.set('X-Cache', cacheHit ? 'HIT' : 'MISS')
    out.headers.set('Cache-Control', 'no-store')
    return out
  },
}
