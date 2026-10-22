import { useEffect, useState } from 'react'
import {
  clearAllNotifications,
  isNotifyEnabled,
  notificationsSupported,
  notifyPermission,
  requestNotifyPermission,
  setNotifyEnabled,
  supportsTriggers,
  type NotifyPermission,
} from '../data/notifications'

export default function NotificationsSettings() {
  const supported = notificationsSupported()
  const [perm, setPerm] = useState<NotifyPermission>(notifyPermission())
  const [enabled, setEnabled] = useState(isNotifyEnabled())

  // Re-read permission when returning to the page (it may have changed in OS
  // settings while we were away).
  useEffect(() => {
    const refresh = () => setPerm(notifyPermission())
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  async function enable() {
    const p = await requestNotifyPermission()
    setPerm(p)
    if (p === 'granted') {
      setNotifyEnabled(true)
      setEnabled(true)
    }
  }

  function disable() {
    setNotifyEnabled(false)
    setEnabled(false)
    void clearAllNotifications()
  }

  const on = enabled && perm === 'granted'

  return (
    <section className="card">
      <h2>Airing-soon notifications</h2>
      <p className="muted">
        Get a heads-up 15 minutes before an episode of a show you’re watching airs. When several
        start at the same time they’re combined into one notification.
      </p>

      {!supported ? (
        <p className="badge badge--warn">This browser doesn’t support notifications.</p>
      ) : perm === 'denied' ? (
        <>
          <p className="badge badge--warn">
            Notifications are blocked for this site. Re-enable them in your browser / phone settings
            for this app, then reopen this page.
          </p>
          <button className="btn btn--ghost" onClick={() => setPerm(notifyPermission())}>
            Re-check permission
          </button>
        </>
      ) : on ? (
        <>
          <p className="badge badge--ok">Notifications are on.</p>
          <button className="btn btn--danger" onClick={disable}>
            Turn off
          </button>
        </>
      ) : (
        <button className="btn" onClick={() => void enable()}>
          Enable notifications
        </button>
      )}

      {supported && !supportsTriggers() && (
        <p className="muted" style={{ marginTop: 10, fontSize: '0.82rem' }}>
          Heads-up: on this platform (e.g. iPhone/iPad) web apps can’t schedule notifications in the
          background, so these only fire while the app is open. On Android/Chrome (installed) they
          arrive even when it’s closed.
        </p>
      )}
    </section>
  )
}
