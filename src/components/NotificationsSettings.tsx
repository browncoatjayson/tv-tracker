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
import { pushConfigured, sendTestPush, unregisterPush } from '../data/push'

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
    void unregisterPush()
  }

  const [testMsg, setTestMsg] = useState<string | null>(null)
  async function test() {
    setTestMsg('Sending…')
    const status = await sendTestPush()
    setTestMsg(
      status === 201 || status === 200
        ? 'Test sent — you should see a notification shortly.'
        : status === null
          ? 'Couldn’t send (no subscription yet — reopen the app once).'
          : `Push service returned ${status}.`,
    )
  }

  const on = enabled && perm === 'granted'
  const background = pushConfigured()

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
          <p className="badge badge--ok">
            Notifications are on{background ? ' (delivered even when the app is closed)' : ''}.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--danger" onClick={disable}>
              Turn off
            </button>
            {background && (
              <button className="btn btn--ghost" onClick={() => void test()}>
                Send test
              </button>
            )}
          </div>
          {testMsg && <p className="muted" style={{ marginTop: 8 }}>{testMsg}</p>}
        </>
      ) : (
        <button className="btn" onClick={() => void enable()}>
          Enable notifications
        </button>
      )}

      {supported && !background && !supportsTriggers() && (
        <p className="muted" style={{ marginTop: 10, fontSize: '0.82rem' }}>
          Note: these fire while the app is open (including right when you reopen it near air time).
          Background delivery for a closed app needs the push backend to be configured.
        </p>
      )}
    </section>
  )
}
