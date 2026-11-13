// ---------------------------------------------------------------------------
// Anonymous usage-stats worker for TV Tracker.
//
// TV Tracker is a backend-less PWA, so nothing server-side sees how many people
// use it. Google's OAuth metrics only count Drive sign-ins (and are unreliable
// for a browser token flow). This tiny worker gives honest counts WITHOUT
// collecting any personal data:
//
//  - The app sends a random, per-device "install id" (a UUID it generates once
//    and keeps in localStorage) at most once per day. No email, no account, no
//    IP is stored — just the opaque id.
//  - It's recorded two ways in KV:
//      install:<iid>        -> first-seen day   (lifetime unique installs)
//      active:<day>:<iid>   -> "1", ~100-day TTL (daily-active installs)
//  - GET /stats?key=<admin> returns aggregate counts (total installs + recent
//    daily-active) for the developer only — never exposed to the app.
//
// Nothing here identifies a person: the id is a random number tied to a browser
// profile, resettable by clearing site data.
// ---------------------------------------------------------------------------

const ACTIVE_TTL_SECONDS = 100 * 24 * 60 * 60 // keep daily-active keys ~100 days
const DAU_WINDOW_DAYS = 30 // how many recent days /stats reports

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const ok = origin && (allowed.length === 0 || allowed.includes(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

// Accept only a plausible UUID so junk/abuse can't bloat the namespace.
function validId(s) {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  )
}

// Count every key under a prefix, paging through KV's 1000-per-list limit.
async function countPrefix(kv, prefix) {
  let count = 0
  let cursor
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 })
    count += page.keys.length
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return count
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const cors = corsHeaders(env, req.headers.get('Origin'))

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (!env.STATS) return json({ error: 'KV not bound' }, 500, cors)

    // --- Developer-only aggregate read ------------------------------------
    if (req.method === 'GET' && url.pathname === '/stats') {
      const key = url.searchParams.get('key') || req.headers.get('X-Admin-Key')
      if (!env.STATS_ADMIN_KEY || key !== env.STATS_ADMIN_KEY) {
        return json({ error: 'unauthorized' }, 401, {})
      }
      const totalInstalls = await countPrefix(env.STATS, 'install:')
      const days = []
      const now = new Date()
      for (let i = 0; i < DAU_WINDOW_DAYS; i++) {
        const d = new Date(now)
        d.setUTCDate(now.getUTCDate() - i)
        const day = utcDay(d)
        days.push({ date: day, active: await countPrefix(env.STATS, `active:${day}:`) })
      }
      return json({ totalInstalls, days }, 200, {})
    }

    // --- Anonymous ping (from the app) ------------------------------------
    if (req.method === 'POST') {
      let body
      try {
        body = await req.json()
      } catch {
        return json({ error: 'bad body' }, 400, cors)
      }
      const iid = body?.iid
      if (!validId(iid)) return json({ error: 'bad id' }, 400, cors)

      const day = utcDay()
      // Dedupe so one device = one write per day: keeps us well under KV's free
      // write quota and makes the daily-active count exact.
      const activeKey = `active:${day}:${iid}`
      if (!(await env.STATS.get(activeKey))) {
        await env.STATS.put(activeKey, '1', { expirationTtl: ACTIVE_TTL_SECONDS })
      }
      // First-seen marker, no TTL — the lifetime unique-install count.
      const installKey = `install:${iid}`
      if (!(await env.STATS.get(installKey))) {
        await env.STATS.put(installKey, day)
      }
      return json({ ok: true }, 200, cors)
    }

    return json({ error: 'not found' }, 404, cors)
  },
}
