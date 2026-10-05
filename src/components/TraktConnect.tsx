import { useState } from 'react'
import { beginSignIn, canSignIn, getTraktLastSync, hasTraktClientId, signOut } from '../api/trakt'
import { syncTraktHistory } from '../data/traktSync'
import { useTraktAuth } from '../hooks/useTraktAuth'

export default function TraktConnect() {
  const { signedIn, username } = useTraktAuth()
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<number | null>(getTraktLastSync())

  async function startSignIn() {
    setError(null)
    setBusy(true)
    try {
      await beginSignIn() // redirects away; the app finishes sign-in on return
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  async function doSync() {
    setSyncing(true)
    setError(null)
    setMessage(null)
    setProgress({ done: 0, total: 0 })
    try {
      const r = await syncTraktHistory(setProgress)
      setLastSync(getTraktLastSync())
      setMessage(
        `Synced ${r.items} titles · ${r.episodes} episodes · ${r.events} watch events` +
          (r.unmatched ? ` · ${r.unmatched} couldn’t be matched.` : '.'),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  function handleSignOut() {
    signOut()
    setLastSync(null)
    setMessage(null)
  }

  if (!hasTraktClientId()) {
    return (
      <section className="card">
        <h2>Trakt reviews &amp; sync</h2>
        <p className="badge badge--warn">
          Not configured — set VITE_TRAKT_CLIENT_ID in .env (local) or the repo secret (deploy).
        </p>
      </section>
    )
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <section className="card">
      <h2>Trakt reviews &amp; sync</h2>
      <p className="muted">
        Sign in to post reviews and sync your Trakt watch history into your library.
      </p>

      {!signedIn ? (
        <button className="btn" disabled={busy || !canSignIn()} onClick={() => void startSignIn()}>
          {busy ? 'Redirecting…' : 'Sign in with Trakt'}
        </button>
      ) : (
        <>
          <div className="sync-actions">
            <span className="badge badge--ok">Signed in{username ? ` as ${username}` : ''}</span>
            <button className="btn" disabled={syncing} onClick={() => void doSync()}>
              {syncing ? 'Syncing…' : 'Sync watch history'}
            </button>
            <button className="btn btn--ghost btn--small" disabled={syncing} onClick={handleSignOut}>
              Sign out
            </button>
          </div>

          {syncing && progress.total > 0 && (
            <div className="import-progress">
              <p className="muted">
                Matching to TMDB… {progress.done} / {progress.total}
              </p>
              <div className="progress-bar">
                <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {lastSync && (
            <p className="muted sync-last">Last Trakt sync: {new Date(lastSync).toLocaleString()}</p>
          )}
        </>
      )}

      {message && <p className="badge badge--ok">{message}</p>}
      {error && <p className="badge badge--warn">{error}</p>}
    </section>
  )
}
