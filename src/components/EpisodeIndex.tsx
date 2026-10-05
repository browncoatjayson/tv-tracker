import { startIndexing, useIndexProgress } from '../data/episodeIndex'

export default function EpisodeIndex() {
  const { status, done, total } = useIndexProgress()
  const running = status === 'running'
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <section className="card">
      <h2>Episode search index</h2>
      <p className="muted">
        Index your library to power <em>episode-name</em> search, the Library filters
        (genre, service, length, status), and your personal stats. It runs in the background — you
        can keep using the app — and resumes where it left off, so a large library may take a few
        passes.
      </p>

      <button className="btn" disabled={running} onClick={() => void startIndexing({ full: true })}>
        {running ? `Indexing… ${done}/${total}` : 'Build / update index'}
      </button>

      {running && (
        <div className="progress-bar" style={{ marginTop: 10 }}>
          <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      {status === 'done' && !running && (
        <p className="badge badge--ok">Index up to date ({total} shows).</p>
      )}
    </section>
  )
}
