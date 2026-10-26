// ---------------------------------------------------------------------------
// TV Tracker push Worker.
//
// The browser can't schedule a notification for when the PWA is closed, so this
// Worker does it. The app uploads its push subscription + the fire times of its
// upcoming "airing soon" notifications (POST /register). A cron (every 5 min)
// sends a payload-less Web Push to any device whose fire time has just arrived;
// the service worker then reads the notification content from local storage the
// app keeps in sync and shows it. Payload-less push = only VAPID signing here,
// no message encryption.
// ---------------------------------------------------------------------------

const te = new TextEncoder()

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function strToB64url(s) {
  return bytesToB64url(te.encode(s))
}

async function importVapidKey(publicB64, privateB64) {
  const pub = b64urlToBytes(publicB64) // 65 bytes: 0x04 || x(32) || y(32)
  const d = b64urlToBytes(privateB64) // 32 bytes
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(d),
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

async function vapidJwt(endpoint, env) {
  const aud = new URL(endpoint).origin
  const header = strToB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = strToB64url(
    JSON.stringify({
      aud,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: env.VAPID_SUBJECT || 'mailto:admin@example.com',
    }),
  )
  const unsigned = `${header}.${payload}`
  const key = await importVapidKey(env.VAPID_PUBLIC, env.VAPID_PRIVATE)
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned)),
  )
  return `${unsigned}.${bytesToB64url(sig)}`
}

/** Send a payload-less push (a "wake up and check" signal). Returns the status.
 *  Urgency:high asks the push service to deliver promptly even when the device is
 *  in Doze/battery-saver; the short TTL drops it rather than arriving long after
 *  the show has started. */
async function sendWake(subscription, env) {
  const jwt = await vapidJwt(subscription.endpoint, env)
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
      TTL: '1800',
      Urgency: 'high',
    },
  })
  return res.status
}

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
  }
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const DAY = 24 * 3600 * 1000

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const cors = corsHeaders(env, req.headers.get('Origin'))
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

    try {
      if (url.pathname === '/register' && req.method === 'POST') {
        const { id, subscription, fireAts } = await req.json()
        if (!id || !subscription || !subscription.endpoint) return json({ error: 'bad request' }, 400, cors)
        const prev = await env.SUBS.get(`sub:${id}`, 'json')
        const sent = (prev?.sent || []).filter((t) => t > Date.now() - DAY)
        await env.SUBS.put(
          `sub:${id}`,
          JSON.stringify({ subscription, fireAts: Array.isArray(fireAts) ? fireAts : [], sent }),
          { expirationTtl: 14 * 24 * 3600 },
        )
        return json({ ok: true }, 200, cors)
      }

      if (url.pathname === '/unregister' && req.method === 'POST') {
        const { id } = await req.json()
        if (id) await env.SUBS.delete(`sub:${id}`)
        return json({ ok: true }, 200, cors)
      }

      // Send an immediate test push (handy to verify the pipe end-to-end).
      if (url.pathname === '/test' && req.method === 'POST') {
        const { id } = await req.json()
        const rec = await env.SUBS.get(`sub:${id}`, 'json')
        if (!rec) return json({ error: 'not found' }, 404, cors)
        const status = await sendWake(rec.subscription, env)
        return json({ status }, 200, cors)
      }

      return json({ error: 'not found' }, 404, cors)
    } catch (e) {
      return json({ error: String(e) }, 500, cors)
    }
  },

  async scheduled(_event, env) {
    const now = Date.now()
    const list = await env.SUBS.list({ prefix: 'sub:' })
    console.log(`[cron] ${new Date(now).toISOString()} subs=${list.keys.length}`)
    for (const { name } of list.keys) {
      const rec = await env.SUBS.get(name, 'json')
      if (!rec) continue
      // Visibility: the next few upcoming fire times for this device.
      const soon = (rec.fireAts || [])
        .filter((t) => t > now - 3600_000 && t < now + 86_400_000)
        .map((t) => new Date(t).toISOString())
      console.log(`[cron] ${name} fireAts(±24h)=[${soon.join(', ')}]`)
      const sent = new Set(rec.sent || [])
      let changed = false
      let dead = false
      for (const fa of rec.fireAts || []) {
        // Fire if it just came due within the last cron window (6 min of grace),
        // and we haven't already pushed for this exact time.
        if (fa <= now && fa > now - 6 * 60 * 1000 && !sent.has(fa)) {
          const status = await sendWake(rec.subscription, env)
          console.log(
            `[cron] ${name} DUE fireAt=${new Date(fa).toISOString()} -> push status ${status}`,
          )
          if (status === 404 || status === 410) {
            dead = true
            break
          }
          sent.add(fa)
          changed = true
        }
      }
      if (dead) {
        await env.SUBS.delete(name)
        continue
      }
      if (changed) {
        await env.SUBS.put(
          name,
          JSON.stringify({
            subscription: rec.subscription,
            fireAts: rec.fireAts,
            sent: [...sent].filter((t) => t > now - DAY),
          }),
          { expirationTtl: 14 * 24 * 3600 },
        )
      }
    }
  },
}
