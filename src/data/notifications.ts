import { compactAirTime } from '../utils/airTime'

// ---------------------------------------------------------------------------
// "Airing soon" notifications. No backend, so delivery is best-effort:
//  - Chromium (Android Chrome, desktop Chrome/Edge): the Notification Triggers
//    API fires scheduled notifications even when the app is closed.
//  - Elsewhere (iOS Safari, Firefox): no background scheduling for web apps
//    without a push server, so we fall back to in-app timers that only fire
//    while the app is open.
// One notification is shown per distinct air time, listing every show then.
// ---------------------------------------------------------------------------

const ENABLED_KEY = 'tvtracker.notify'
export const LEAD_MS = 15 * 60 * 1000 // notify 15 minutes before air time
const WINDOW_MS = 8 * 24 * 60 * 60 * 1000 // schedule up to 8 days out
const MAX_TIMER_MS = 24 * 60 * 60 * 1000 // in-app fallback only covers the next day

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator
  )
}

/** True where the browser can fire scheduled notifications while closed. */
export function supportsTriggers(): boolean {
  return typeof window !== 'undefined' && 'TimestampTrigger' in window
}

export function notifyPermission(): NotifyPermission {
  if (!notificationsSupported()) return 'unsupported'
  return Notification.permission as NotifyPermission
}

export function isNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function setNotifyEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0')
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent('tvtracker:notify'))
  } catch {
    // ignore
  }
}

/** Ask the OS/browser for permission. Returns the resulting permission. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (!notificationsSupported()) return 'unsupported'
  try {
    return (await Notification.requestPermission()) as NotifyPermission
  } catch {
    return Notification.permission as NotifyPermission
  }
}

// --- Grouping ---------------------------------------------------------------

/** One upcoming episode that could be notified about. */
export interface AiringEntry {
  showTitle: string
  season: number
  episode: number
  epName?: string
  /** Full ISO datetime with timezone. */
  airstamp: string
}

/** A grouped notification: all shows airing at one time. */
export interface NotifyGroup {
  tag: string
  fireAt: number
  title: string
  body: string
}

/** Build one notification per distinct future air time within the window. */
export function buildNotifyGroups(
  entries: AiringEntry[],
  now = Date.now(),
  windowMs = WINDOW_MS,
): NotifyGroup[] {
  const byStamp = new Map<string, AiringEntry[]>()
  for (const e of entries) {
    const at = Date.parse(e.airstamp)
    if (Number.isNaN(at) || at <= now || at > now + windowMs) continue
    const arr = byStamp.get(e.airstamp) ?? []
    arr.push(e)
    byStamp.set(e.airstamp, arr)
  }
  const groups: NotifyGroup[] = []
  for (const [airstamp, list] of byStamp) {
    const time = compactAirTime(airstamp) ?? ''
    list.sort((a, b) => a.showTitle.localeCompare(b.showTitle))
    const lines = list.map(
      (e) =>
        `• ${e.showTitle} S${e.season}E${e.episode}${e.epName ? ` · ${e.epName}` : ''}`,
    )
    groups.push({
      tag: `airing-${airstamp}`,
      fireAt: Date.parse(airstamp) - LEAD_MS,
      title: 'New episodes starting soon',
      body: `At ${time}:\n${lines.join('\n')}`,
    })
  }
  return groups.sort((a, b) => a.fireAt - b.fireAt)
}

// --- Scheduling (side effects) ---------------------------------------------

let fallbackTimers: number[] = []

function notifyOptions(group: NotifyGroup): NotificationOptions {
  const base = import.meta.env.BASE_URL
  return {
    body: group.body,
    tag: group.tag,
    renotify: true,
    icon: `${base}pwa-192.png`,
    badge: `${base}pwa-192.png`,
    data: { url: `${window.location.origin}${base}#/upcoming` },
  } as NotificationOptions
}

/**
 * Reconcile the scheduled notifications with the current upcoming groups. Safe to
 * call repeatedly — it's keyed by a stable tag per air time, and clears timers /
 * stale pending notifications first.
 */
export async function syncNotifications(groups: NotifyGroup[]): Promise<void> {
  // Clear any in-app timers from a previous sync.
  for (const id of fallbackTimers) clearTimeout(id)
  fallbackTimers = []

  if (!notificationsSupported() || notifyPermission() !== 'granted' || !isNotifyEnabled()) {
    return
  }

  let reg: ServiceWorkerRegistration
  try {
    reg = await navigator.serviceWorker.ready
  } catch {
    return
  }

  if (supportsTriggers()) {
    // Close stale scheduled notifications (those we no longer want).
    const wanted = new Set(groups.map((g) => g.tag))
    try {
      const pending = await reg.getNotifications({
        includeTriggered: true,
      } as GetNotificationOptions & { includeTriggered: boolean })
      for (const n of pending) {
        if (n.tag.startsWith('airing-') && !wanted.has(n.tag)) n.close()
      }
    } catch {
      // getNotifications with triggers isn't universally supported — ignore.
    }
    const Trigger = (window as unknown as { TimestampTrigger: new (t: number) => unknown })
      .TimestampTrigger
    for (const g of groups) {
      try {
        await reg.showNotification(g.title, {
          ...notifyOptions(g),
          showTrigger: new Trigger(Math.max(g.fireAt, Date.now())),
        } as NotificationOptions)
      } catch {
        // ignore a single failed schedule
      }
    }
    return
  }

  // Fallback: in-app timers (fire only while the app stays open).
  for (const g of groups) {
    const delay = g.fireAt - Date.now()
    if (delay > MAX_TIMER_MS) continue // too far out; re-scheduled on next open
    const id = window.setTimeout(
      () => {
        void reg.showNotification(g.title, notifyOptions(g))
      },
      Math.max(0, delay),
    )
    fallbackTimers.push(id)
  }
}

/** Cancel everything (used when the user turns notifications off). */
export async function clearAllNotifications(): Promise<void> {
  for (const id of fallbackTimers) clearTimeout(id)
  fallbackTimers = []
  try {
    const reg = await navigator.serviceWorker.ready
    const pending = await reg.getNotifications({
      includeTriggered: true,
    } as GetNotificationOptions & { includeTriggered: boolean })
    for (const n of pending) if (n.tag.startsWith('airing-')) n.close()
  } catch {
    // ignore
  }
}
