import { hasTmdbToken } from '../api/tmdb'

// Placeholder for Phase 2 (TMDB search + add to library).
// We already surface whether the TMDB token is configured so setup is verifiable.
export default function Search() {
  return (
    <div className="placeholder">
      <h2>Search</h2>
      <p className="muted">Coming in Phase 2: search TMDB for movies &amp; shows and add them to your library.</p>
      <p className={hasTmdbToken() ? 'badge badge--ok' : 'badge badge--warn'}>
        TMDB token: {hasTmdbToken() ? 'configured ✓' : 'not set — add VITE_TMDB_TOKEN to .env'}
      </p>
    </div>
  )
}
