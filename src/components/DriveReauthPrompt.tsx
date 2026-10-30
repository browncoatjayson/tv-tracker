import { useState } from 'react'
import ToastOverlay from './ToastOverlay'
import { recordSynced, syncNow } from '../data/driveSync'
import { awardBadges, badgeById } from '../data/badges'
import { showBadgeToast } from '../utils/badgeToast'

/**
 * Shown on launch when the user has connected Drive before but this session has
 * no live token yet (a cold start / reload — GIS tokens live only in memory).
 *
 * We can't refresh silently in a PWA: GIS would open an account-chooser popup,
 * which the installed app blocks ("Popup blocked") and which never shows the
 * account. So instead of auto-syncing, we ask the user to sign in — the Sign-in
 * button runs the interactive flow from a real click, so the popup is allowed.
 *
 * Dismissing ("Not now") hides it for this session only; a user who doesn't want
 * to see it again can unlink Drive in Settings.
 */
export default function DriveReauthPrompt({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    setError(null)
    try {
      const r = await syncNow(true) // user gesture → popup allowed, not blocked
      recordSynced(r.syncedAt)
      // "Welcome Back!" doubles as a "signed in and ready" notification each time
      // you log in for the day. It's re-awarded here (and deleted at launch when a
      // new session has no token — see Layout) and never synced to the backup.
      void awardBadges(['welcome-back'])
      const b = badgeById('welcome-back')
      if (b) showBadgeToast(b)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  return (
    <ToastOverlay onBackdrop={busy ? undefined : onDone}>
      <div className="update-toast reauth-toast" role="status">
        <div className="reauth-toast__text">
          <strong>Welcome back!</strong>
          <span>Log in to Drive to continue.</span>
          {error && <span className="reauth-toast__err">{error}</span>}
        </div>
        <button className="btn btn--small" disabled={busy} onClick={() => void signIn()}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn btn--small btn--ghost" disabled={busy} onClick={onDone}>
          Not now
        </button>
      </div>
    </ToastOverlay>
  )
}
