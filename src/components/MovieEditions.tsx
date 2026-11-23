import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../data/db'
import { fetchMovieEditions, setEditionSeen, useTitleMeta } from '../data/titleMeta'
import { clearMovieWatched, markMovieWatched } from '../data/library'
import type { MovieEdition, TrackedItem } from '../data/types'

/** "Year · N min" line for an edition, when known. */
function editionMeta(ed: MovieEdition): string {
  return [ed.year, ed.runtimeMin ? `${ed.runtimeMin} min` : null].filter(Boolean).join(' · ')
}

/**
 * "Editions" for a tracked movie: a checklist of the versions you've seen. The
 * first row, Theatrical, mirrors the movie's own watched state (checking it marks
 * the movie watched); alternate cuts (extended, director's cut, re-releases, "…
 * Version") come from Wikidata, cached in titleMeta. An edition that has its own
 * TMDB entry is a trackable title, so it's a link to open that version (mark it
 * there); a cut with no separate entry is a checkbox you tick here. Fetched once
 * on first view; a Refresh re-pulls when new cuts appear.
 */
export default function MovieEditions({ item, tmdbId }: { item: TrackedItem; tmdbId: number }) {
  const meta = useTitleMeta(item.id)
  const [refreshing, setRefreshing] = useState(false)
  // null = follow the default (open when there are alternate cuts, closed when
  // it's only Theatrical); a boolean once the user toggles it themselves.
  const [open, setOpen] = useState<boolean | null>(null)

  // First view fetches (and caches) the editions; no-op once cached.
  useEffect(() => {
    void fetchMovieEditions(item.id, tmdbId)
  }, [item.id, tmdbId])

  // Theatrical = the movie's own watched state (a movie watch event has no episode).
  const watchedCount =
    useLiveQuery(
      () =>
        db.watchEvents
          .where('itemId')
          .equals(item.id)
          .and((e) => e.episodeId === null)
          .count(),
      [item.id],
    ) ?? 0
  const sawTheatrical = watchedCount > 0

  const fetched = !!meta && meta.editionsFetchedAt !== undefined
  const alternates = meta?.editions ?? []
  const seen = new Set(meta?.editionsSeen ?? [])
  // Follow the default until the user toggles: expanded when alternate cuts exist.
  const effectiveOpen = open ?? alternates.length > 0

  async function refresh() {
    setRefreshing(true)
    try {
      await fetchMovieEditions(item.id, tmdbId, { force: true })
    } finally {
      setRefreshing(false)
    }
  }

  // Keep the section out of the page until the first fetch resolves.
  if (!fetched) return null

  return (
    <details
      className="facts editions"
      open={effectiveOpen}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="facts__summary">
        Editions{alternates.length > 0 ? ` · ${alternates.length + 1}` : ''}
      </summary>
      <ul className="editions__list">
        <li className="editions__row">
          <label className="editions__label">
            <input
              type="checkbox"
              checked={sawTheatrical}
              onChange={(e) =>
                e.target.checked
                  ? void markMovieWatched(item.id, false)
                  : void clearMovieWatched(item.id)
              }
            />
            <span className="editions__name">Theatrical</span>
            <span className="editions__kind muted">standard</span>
          </label>
        </li>
        {alternates.map((ed) => {
          const m = editionMeta(ed)
          // Has its own TMDB entry → open that title to track/mark it there.
          if (ed.tmdbId) {
            return (
              <li key={ed.id} className="editions__row">
                <Link
                  className="editions__label editions__link"
                  to={`/item/${encodeURIComponent(`movie:${ed.tmdbId}`)}`}
                >
                  <span className="editions__open" aria-hidden="true">
                    ↗
                  </span>
                  <span className="editions__name">{ed.label}</span>
                  {m && <span className="editions__kind muted">{m}</span>}
                </Link>
              </li>
            )
          }
          // A cut with no separate entry → tick it as seen here.
          return (
            <li key={ed.id} className="editions__row">
              <label className="editions__label">
                <input
                  type="checkbox"
                  checked={seen.has(ed.id)}
                  onChange={(e) => void setEditionSeen(item.id, ed.id, e.target.checked)}
                />
                <span className="editions__name">{ed.label}</span>
                {m && <span className="editions__kind muted">{m}</span>}
              </label>
            </li>
          )
        })}
      </ul>
      <div className="editions__foot">
        {alternates.length === 0 && <span className="muted">No other editions found.</span>}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <span className="reviews__powered">Powered by Wikidata</span>
      </div>
    </details>
  )
}
