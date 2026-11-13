// ---------------------------------------------------------------------------
// Anonymous, privacy-preserving usage ping. See worker-stats/.
//
// TV Tracker has no backend, so there's no server-side view of how many people
// use it. This generates a random per-device "install id" (no account, no email)
// and, at most once per day, tells the stats worker this install was active — so
// we can count unique installs and daily-active users without anyone's identity.
// Fire-and-forget: failures are ignored and never block the app. No-op when
// VITE_STATS_API is unset (e.g. local dev), so nothing is sent unless configured.
// ---------------------------------------------------------------------------

const API = import.meta.env.VITE_STATS_API?.trim().replace(/\/+$/, '') || undefined
const ID_KEY = 'tvtracker.installId'
const PING_KEY = 'tvtracker.statsPingedDay'

/** A stable random id for this browser profile. Not tied to any identity, and
 *  reset when the user clears site data. */
function installId(): string {
  try {
    let id = localStorage.getItem(ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(ID_KEY, id)
    }
    return id
  } catch {
    // No storage (private mode): an ephemeral id still lets a ping through; it
    // just won't dedupe across launches. Rare enough not to matter.
    return crypto.randomUUID()
  }
}

/** UTC YYYY-MM-DD, matching the worker's bucketing. */
function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Record (anonymously) that this install is active today. Safe to call on every
 * launch: it pings at most once per device per day and swallows all errors.
 */
export async function pingStats(): Promise<void> {
  if (!API) return
  const day = utcDay()
  try {
    if (localStorage.getItem(PING_KEY) === day) return
  } catch {
    // ignore storage errors and fall through to ping
  }
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iid: installId() }),
      keepalive: true,
    })
    if (res.ok) {
      try {
        localStorage.setItem(PING_KEY, day)
      } catch {
        // ignore — worst case we ping again next launch
      }
    }
  } catch {
    // offline / blocked — try again next launch
  }
}
