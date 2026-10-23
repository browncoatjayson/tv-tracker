// Imported into the generated service worker (see vite.config workbox.importScripts).
// Handles the "airing soon" push wake-ups and notification taps.

const PUSH_DB = 'tvtracker-push'
const STORE = 'kv'

function openPushDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PUSH_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function readPushGroups() {
  try {
    const db = await openPushDb()
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get('groups')
      r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result : [])
      r.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

// A push arrives (payload-less) when a notification is due; read the content the
// app stored locally and show the group(s) whose time has just come.
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const icon = `${self.registration.scope}pwa-192.png`
      const url = `${self.registration.scope}#/upcoming`
      const groups = await readPushGroups()
      const now = Date.now()
      const due = groups.filter((g) => g.fireAt <= now && g.fireAt > now - 20 * 60 * 1000)
      if (due.length === 0) {
        // Keep the browser's userVisibleOnly promise even if we have no content.
        await self.registration.showNotification('New episodes starting soon', {
          body: 'Open TV Tracker to see what’s on.',
          tag: 'airing-fallback',
          icon,
          badge: icon,
          data: { url },
        })
        return
      }
      for (const g of due) {
        await self.registration.showNotification(g.title, {
          body: g.body,
          tag: g.tag,
          renotify: true,
          icon,
          badge: icon,
          data: { url },
        })
      }
    })(),
  )
})

// Focus an open app window (or open one) when a notification is tapped.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of wins) {
        if ('focus' in w) {
          await w.focus()
          if ('navigate' in w) w.navigate(url).catch(() => {})
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url)
    })(),
  )
})
