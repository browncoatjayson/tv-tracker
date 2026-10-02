import { useState } from 'react'
import { db } from '../data/db'
import { downloadBackup } from '../data/exportImport'
import { deleteRemoteBackup, disconnect, wasConnected } from '../data/driveSync'

// Must match the key DriveSync uses for its "last synced" timestamp.
const LAST_SYNCED_KEY = 'tvtracker.lastSynced'

export default function ResetAccount() {
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (busy) return
    setOpen(false)
    setConfirmed(false)
    setError(null)
    setDone(null)
  }

  async function doReset() {
    setBusy(true)
    setError(null)
    try {
      // Delete the cloud copy FIRST — if that fails (or sign-in is cancelled) we
      // stop before wiping local, so we never leave local empty but Drive intact
      // (which auto-sync could then restore).
      let driveNote = ''
      if (wasConnected()) {
        const result = await deleteRemoteBackup(true)
        driveNote =
          result === 'deleted'
            ? ' Google Drive backup deleted.'
            : result === 'none'
              ? ' No Google Drive backup was found.'
              : ''
      }

      await db.transaction(
        'rw',
        db.trackedItems,
        db.watchEvents,
        db.episodeStates,
        db.episodeCache,
        async () => {
          await Promise.all([
            db.trackedItems.clear(),
            db.watchEvents.clear(),
            db.episodeStates.clear(),
            db.episodeCache.clear(),
          ])
        },
      )

      disconnect()
      try {
        localStorage.removeItem(LAST_SYNCED_KEY)
        localStorage.removeItem('tvtracker.indexedShows')
      } catch {
        // ignore storage errors
      }

      setDone(`Your account has been reset.${driveNote}`)
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Nothing was erased — try again.`
          : 'Reset failed. Nothing was erased.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card card--danger">
      <h2>Reset account</h2>
      <p className="muted">
        Permanently erase everything in the app and in Google Drive. Use this to start over — the
        recommended way to “delete” titles across devices is: clean up your list, export a backup,
        reset, then re-import what you want to keep.
      </p>
      <button className="btn btn--danger" onClick={() => setOpen(true)}>
        Reset account…
      </button>

      {open && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <>
                <h3>Done</h3>
                <p className="badge badge--ok">{done}</p>
                <div className="modal__actions">
                  <button className="btn" onClick={close}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Erase everything?</h3>
                <p>
                  This permanently deletes your entire library on this device{' '}
                  {wasConnected() ? 'and in Google Drive' : ''}. This cannot be undone.
                </p>
                <p className="muted">Export a backup first if there’s any chance you’ll want it back.</p>

                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() => void downloadBackup()}
                >
                  Export backup first
                </button>

                <label className="radio reset-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I understand this permanently erases everything.
                </label>

                {error && <p className="badge badge--warn">{error}</p>}

                <div className="modal__actions">
                  <button className="btn btn--ghost" disabled={busy} onClick={close}>
                    Cancel
                  </button>
                  <button
                    className="btn btn--danger"
                    disabled={!confirmed || busy}
                    onClick={() => void doReset()}
                  >
                    {busy ? 'Erasing…' : 'Delete everything'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
