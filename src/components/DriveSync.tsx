import { useCallback, useEffect, useState } from 'react'
import {
  disconnect,
  hasGoogleClientId,
  syncNow,
  wasConnected,
} from '../data/driveSync'

const LAST_KEY = 'tvtracker.lastSynced'

function readLastSynced(): number | null {
  try {
    const v = localStorage.getItem(LAST_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}
function writeLastSynced(t: number): void {
  try {
    localStorage.setItem(LAST_KEY, String(t))
  } catch {
    // ignore
  }
}

export default function DriveSync() {
  const [connected, setConnected] = useState(wasConnected())
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<number | null>(readLastSynced())

  const doSync = useCallback(async (interactive: boolean) => {
    setSyncing(true)
    setError(null)
    setMessage(null)
    try {
      const r = await syncNow(interactive)
      writeLastSynced(r.syncedAt)
      setLastSynced(r.syncedAt)
      setConnected(true)
      setMessage(`Synced ${r.items} titles · ${r.episodes} episodes · ${r.events} watch events.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }, [])

  // If previously connected, try a silent sync on load (no popup).
  useEffect(() => {
    if (connected && hasGoogleClientId()) void doSync(false)
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleDisconnect() {
    disconnect()
    setConnected(false)
    setMessage('Disconnected. Your Drive data is kept; reconnect to sync again.')
  }

  if (!hasGoogleClientId()) {
    return (
      <section className="card">
        <h2>Google Drive sync</h2>
        <p className="badge badge--warn">
          Not configured — set VITE_GOOGLE_CLIENT_ID in .env (local) or the repo secret (deploy).
        </p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Google Drive sync</h2>
      <p className="muted">
        Sync your library to your own Google Drive (a hidden app folder we can’t browse). Sign in
        on another device and sync to merge them.
      </p>

      {!connected ? (
        <button className="btn" disabled={syncing} onClick={() => void doSync(true)}>
          {syncing ? 'Connecting…' : 'Connect Google Drive'}
        </button>
      ) : (
        <div className="sync-actions">
          <button className="btn" disabled={syncing} onClick={() => void doSync(true)}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button className="btn btn--ghost btn--small" disabled={syncing} onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      )}

      {lastSynced && (
        <p className="muted sync-last">Last synced: {new Date(lastSynced).toLocaleString()}</p>
      )}
      {message && <p className="badge badge--ok">{message}</p>}
      {error && <p className="badge badge--warn">{error}</p>}
    </section>
  )
}
