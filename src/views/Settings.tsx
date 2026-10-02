import { useRef, useState } from 'react'
import { downloadBackup, importBackup, type ImportMode } from '../data/exportImport'
import DriveSync from '../components/DriveSync'
import ImportTracker from '../components/ImportTracker'
import ResetAccount from '../components/ResetAccount'

export default function Settings() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setMessage(null)
    setError(null)
    try {
      const text = await file.text()
      const counts = await importBackup(text, mode)
      setMessage(
        `Imported ${counts.items} titles, ${counts.events} watch events, ${counts.episodes} episodes.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="settings">
      <DriveSync />

      <section className="card">
        <h2>Backup &amp; restore</h2>
        <p className="muted">
          Export a backup file to keep it safe or move it to another device. This works even
          without Google Drive sync.
        </p>

        <button className="btn" onClick={() => void downloadBackup()}>
          Export backup (.json)
        </button>

        <hr className="divider" />

        <fieldset className="field">
          <legend>Import mode</legend>
          <label className="radio">
            <input
              type="radio"
              name="mode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
            />
            Merge (keep existing, add from file)
          </label>
          <label className="radio">
            <input
              type="radio"
              name="mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            Replace (wipe, then load file)
          </label>
        </fieldset>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />

        {message && <p className="badge badge--ok">{message}</p>}
        {error && <p className="badge badge--warn">{error}</p>}
      </section>

      <ImportTracker />

      <section className="card">
        <h2>About</h2>
        <p className="muted">
          TV Tracker — a personal, offline-first replacement for TV Time. Metadata from TMDB,
          detail pages link to IMDb.
        </p>
      </section>

      <ResetAccount />
    </div>
  )
}
