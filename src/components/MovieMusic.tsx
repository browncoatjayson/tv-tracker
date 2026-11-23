import { useEffect, useState } from 'react'
import { fetchMovieMusic, useTitleMeta } from '../data/titleMeta'
import type { TrackedItem } from '../data/types'

/** A link that opens a web search for the song, so it plays wherever the viewer
 *  likes (no music-service API / account needed). */
function searchUrl(title: string, artist?: string): string {
  const q = artist ? `${artist} ${title}` : title
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}

/**
 * A movie's soundtrack songs, in the Fun Facts area. Sourced from MusicBrainz (the
 * official soundtrack album tracklist) via the film's Wikidata link, cached in
 * titleMeta — fetched once on first view, re-pulled with Refresh. Each song links
 * out to a web search so it can be played anywhere.
 */
export default function MovieMusic({ item, tmdbId }: { item: TrackedItem; tmdbId: number }) {
  const meta = useTitleMeta(item.id)
  const [refreshing, setRefreshing] = useState(false)

  // First view fetches (and caches) the soundtrack; no-op once cached.
  useEffect(() => {
    void fetchMovieMusic(item.id, tmdbId)
  }, [item.id, tmdbId])

  async function refresh() {
    setRefreshing(true)
    try {
      await fetchMovieMusic(item.id, tmdbId, { force: true })
    } finally {
      setRefreshing(false)
    }
  }

  const fetched = !!meta && meta.musicFetchedAt !== undefined
  const music = meta?.music ?? []

  // Keep the section out of the page until the first fetch resolves.
  if (!fetched) return null

  return (
    <details className="facts music">
      <summary className="facts__summary">
        Soundtrack{music.length > 0 ? ` · ${music.length}` : ''}
      </summary>
      {music.length > 0 ? (
        <ul className="music__list">
          {music.map((t, i) => (
            <li key={`${t.title}-${i}`} className="music__row">
              <a
                className="music__link"
                href={searchUrl(t.title, t.artist)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="music__text">
                  <span className="music__title">{t.title}</span>
                  {t.artist && <span className="music__artist muted">{t.artist}</span>}
                </span>
                <span className="music__open" aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted music__empty">No soundtrack information available.</p>
      )}
      <div className="editions__foot">
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <span className="reviews__powered">Powered by MusicBrainz</span>
      </div>
    </details>
  )
}
