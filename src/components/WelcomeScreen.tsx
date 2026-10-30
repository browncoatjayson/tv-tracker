import { useRef, useState } from 'react'
import ToastOverlay from './ToastOverlay'
import { hasGoogleClientId, recordSynced, syncNow } from '../data/driveSync'
import { importBackup } from '../data/exportImport'
import { awardBadges, badgeById } from '../data/badges'
import { showBadgeToast } from '../utils/badgeToast'
import { markFlag } from '../data/appFlags'
import { resetBadgePriming } from '../hooks/useBadgeWatcher'

/**
 * First-run / empty-library welcome. Explains the app and, for returning users
 * (e.g. after a browser-data wipe), offers a one-click Drive restore or a backup
 * import. Only shown when the library is empty on launch (see Library). A restore
 * that actually brings data back earns the "Welcome Back!" badge.
 */
export default function WelcomeScreen({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState<null | 'drive' | 'import'>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Dismissing the welcome (any path) = the user has opened the app — earns
  // "Are You New Here?".
  function close() {
    markFlag('welcomed')
    onClose()
  }

  function celebrateRestore(restored: number) {
    if (restored <= 0) return
    void awardBadges(['welcome-back'])
    const b = badgeById('welcome-back')
    if (b) showBadgeToast(b)
  }

  async function handleDrive() {
    setBusy('drive')
    setError(null)
    // Adopt restored badges silently — only "Welcome Back!" should celebrate.
    resetBadgePriming()
    try {
      const r = await syncNow(true)
      recordSynced(r.syncedAt)
      celebrateRestore(r.items)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      setBusy(null)
    }
  }

  async function handleFile(file: File) {
    setBusy('import')
    setError(null)
    // Adopt restored badges silently — only "Welcome Back!" should celebrate.
    resetBadgePriming()
    try {
      const counts = await importBackup(await file.text(), 'merge')
      celebrateRestore(counts.items)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setBusy(null)
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <ToastOverlay>
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <img className="welcome__logo" src="/app-icon.svg" alt="" />
        <h2 className="welcome__title" id="welcome-title">
          Welcome to TV Tracker!
        </h2>
        <p className="welcome__sub">Everything you watch, in one place.</p>

        <p className="welcome__body">
          To get started, use the <strong>Search</strong> tab to find your shows, movies, and sports
          teams. Add them to your <strong>Library</strong>, where you can mark them as watched. You'll
          see the next episodes and games appear on the <strong>Upcoming</strong> tab.
        </p>
        <p className="welcome__tip">💡 Tip: for the best experience, install this site as an app!</p>

        <div className="welcome__returning">
          <span className="welcome__returning-label">Returning?</span>
          <div className="welcome__returning-btns">
            {hasGoogleClientId() && (
              <button className="btn" disabled={!!busy} onClick={() => void handleDrive()}>
                {busy === 'drive' ? 'Signing in…' : 'Sign into Drive'}
              </button>
            )}
            <button
              className="btn btn--ghost"
              disabled={!!busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy === 'import' ? 'Importing…' : 'Import backup file'}
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
        </div>

        {error && <p className="badge badge--warn welcome__error">{error}</p>}

        <button className="btn welcome__start" disabled={!!busy} onClick={close}>
          Get started
        </button>
      </div>
    </ToastOverlay>
  )
}
