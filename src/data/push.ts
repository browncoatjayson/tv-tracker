import type { NotifyGroup } from './notifications'

// ---------------------------------------------------------------------------
// Web Push wiring. When a VAPID public key + Worker URL are configured, the app
// subscribes the device and uploads its upcoming notification "fire times" to
// the Worker, which pushes a wake-up when one is due (even with the app closed).
// The notification *content* is kept in a tiny local IndexedDB that the service
// worker reads on push — so pushes carry no payload (no encryption needed).
// ---------------------------------------------------------------------------

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC as string | undefined
const PUSH_API = (import.meta.env.VITE_PUSH_API as string | undefined)?.replace(/\/$/, '')

const PUSH_DB = 'tvtracker-push'
const STORE = 'kv'

/** True when a push backend is configured and the browser supports push. */
export function pushConfigured(): boolean {
  return (
    !!VAPID_PUBLIC &&
    !!PUSH_API &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

function urlB64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function deviceId(endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

// --- Tiny local store the service worker reads on push ----------------------
function openPushDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PUSH_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function writePushGroups(groups: NotifyGroup[]): Promise<void> {
  try {
    const db = await openPushDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(groups, 'groups')
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // ignore
  }
}

/** Subscribe (if needed) and upload the current schedule to the Worker. */
export async function registerPush(groups: NotifyGroup[]): Promise<void> {
  if (!pushConfigured()) return
  await writePushGroups(groups)
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC as string) as BufferSource,
      })
    }
    const id = await deviceId(sub.endpoint)
    await fetch(`${PUSH_API}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, subscription: sub.toJSON(), fireAts: groups.map((g) => g.fireAt) }),
    })
  } catch {
    // best-effort
  }
}

/** Tear down the subscription + server record (when notifications are turned off). */
export async function unregisterPush(): Promise<void> {
  await writePushGroups([])
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const id = await deviceId(sub.endpoint)
      if (PUSH_API) {
        await fetch(`${PUSH_API}/unregister`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        }).catch(() => {})
      }
      await sub.unsubscribe()
    }
  } catch {
    // ignore
  }
}

/** Send an immediate test push to this device (for verifying setup). */
export async function sendTestPush(): Promise<number | null> {
  if (!pushConfigured()) return null
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return null
    const id = await deviceId(sub.endpoint)
    const res = await fetch(`${PUSH_API}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    return res.ok ? ((await res.json()) as { status: number }).status : res.status
  } catch {
    return null
  }
}
