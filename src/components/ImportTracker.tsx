import { useRef, useState } from 'react'
import type { ImportMode } from '../data/exportImport'
import { applyImport } from '../data/importers/build'
import { resolveTmdbIds } from '../data/importers/resolve'
import { parseTvTimeZip } from '../data/importers/tvtime'
import type { ImportItem } from '../data/importers/types'

type Source = 'tvtime'

// How to parse each supported source. Add a parser here to support a new tracker.
const PARSERS: Record<Source, { label: string; accept: string; parse: (f: File) => Promise<ImportItem[]> }> = {
  tvtime: { label: 'TV Time (.zip export)', accept: '.zip', parse: parseTvTimeZip },
}

type Phase = 'idle' | 'parsing' | 'mapping' | 'saving' | 'done' | 'error'

export default function ImportTracker() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<Source>('tvtime')
  const [mode, setMode] = useState<ImportMode>('merge')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setPhase('parsing')
    setError(null)
    setResult(null)
    setUnmatched([])
    try {
      const items = await PARSERS[source].parse(file)
      if (items.length === 0) throw new Error('No titles found in that file.')

      setPhase('mapping')
      setProgress({ done: 0, total: items.length })
      const { resolved, unmatched } = await resolveTmdbIds(items, setProgress)

      setPhase('saving')
      const summary = await applyImport(resolved, mode)

      setUnmatched(unmatched.map((u) => u.title))
      setResult(
        `Imported ${summary.items} titles · ${summary.episodes} episodes · ${summary.events} watch events.`,
      )
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setPhase('error')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const busy = phase === 'parsing' || phase === 'mapping' || phase === 'saving'
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <section className="card">
      <h2>Import from another tracker</h2>
      <p className="muted">
        Bring in your history from another app. Titles are matched to TMDB, so a large library can
        take a minute to map.
      </p>

      <label className="field">
        <span>Source</span>
        <select value={source} onChange={(e) => setSource(e.target.value as Source)} disabled={busy}>
          {Object.entries(PARSERS).map(([key, p]) => (
            <option key={key} value={key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="field">
        <legend>Import mode</legend>
        <label className="radio">
          <input
            type="radio"
            name="import-mode"
            checked={mode === 'merge'}
            onChange={() => setMode('merge')}
            disabled={busy}
          />
          Merge (keep existing, add from file)
        </label>
        <label className="radio">
          <input
            type="radio"
            name="import-mode"
            checked={mode === 'replace'}
            onChange={() => setMode('replace')}
            disabled={busy}
          />
          Replace (wipe, then load file)
        </label>
      </fieldset>

      <input
        ref={fileInput}
        type="file"
        accept={PARSERS[source].accept}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />

      {phase === 'parsing' && <p className="muted">Reading file…</p>}
      {phase === 'mapping' && (
        <div className="import-progress">
          <p className="muted">
            Matching to TMDB… {progress.done} / {progress.total}
          </p>
          <div className="progress-bar">
            <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {phase === 'saving' && <p className="muted">Saving…</p>}

      {result && <p className="badge badge--ok">{result}</p>}
      {unmatched.length > 0 && (
        <details className="unmatched">
          <summary>{unmatched.length} titles couldn’t be matched to TMDB</summary>
          <ul>
            {unmatched.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="badge badge--warn">{error}</p>}
    </section>
  )
}
