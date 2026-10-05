import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../data/db'
import { hasAired, imageUrl } from '../api/tmdb'
import { markEpisode, toggleFavorite } from '../data/library'
import type { CachedEpisode, EpisodeState, TrackedItem, WatchStatus } from '../data/types'
import { matchesFilter, parseQuery } from '../utils/filter'
import { usePersistentFilter } from '../hooks/usePersistentFilter'
import FilterBar from '../components/FilterBar'

const STATUS_ORDER: WatchStatus[] = ['watching', 'watchlist', 'completed', 'dropped']
const STATUS_LABEL: Record<WatchStatus, string> = {
  watching: 'Watching',
  watchlist: 'Watchlist',
  completed: 'Completed',
  dropped: 'Dropped',
}

type SortKey = 'title' | 'premiere' | 'lastEpisode'
const SORT_LABEL: Record<SortKey, string> = {
  title: 'Title (A–Z)',
  premiere: 'Premiere date (newest)',
  lastEpisode: 'Last episode date (newest)',
}

function comparator(sort: SortKey): (a: TrackedItem, b: TrackedItem) => number {
  switch (sort) {
    case 'premiere':
      // Newest first; items without a year sort last.
      return (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.title.localeCompare(b.title)
    case 'lastEpisode': {
      // Newest last-aired first; fall back to the year, then push blanks last.
      const key = (i: TrackedItem) => i.lastAirDate ?? (i.year ? `${i.year}-00-00` : '')
      return (a, b) => key(b).localeCompare(key(a)) || a.title.localeCompare(b.title)
    }
    default:
      return (a, b) => a.title.localeCompare(b.title)
  }
}

export default function Library() {
  const items = useLiveQuery(() => db.trackedItems.toArray())
  const [query, setQuery] = usePersistentFilter('tvtracker.filter.library')
  const [sort, setSort] = useState<SortKey>(() => {
    try {
      const v = localStorage.getItem('tvtracker.librarySort')
      if (v === 'title' || v === 'premiere' || v === 'lastEpisode') return v
    } catch {
      // ignore
    }
    return 'title'
  })
  useEffect(() => {
    try {
      localStorage.setItem('tvtracker.librarySort', sort)
    } catch {
      // ignore
    }
  }, [sort])

  // Episode-name matches from the local cache (populated as shows are viewed /
  // the calendar loads). Coverage grows with use; shows never opened won't match.
  const episodeMatches = useLiveQuery<CachedEpisode[]>(() => {
    const qq = parseQuery(query).text
    if (qq.length < 2) return Promise.resolve([] as CachedEpisode[])
    return db.episodeCache.filter((e) => e.name.toLowerCase().includes(qq)).toArray()
  }, [query])

  // For the Watching section's "next episode" card: cached episodes + watched
  // state for the shows currently being watched (scoped, so it stays light).
  const watchingIds = (items ?? [])
    .filter((i) => i.status === 'watching' && i.mediaType === 'show')
    .map((i) => i.id)
  const watchingKey = watchingIds.join('|')
  const watchingEpisodes = useLiveQuery<CachedEpisode[]>(
    () =>
      watchingIds.length
        ? db.episodeCache.where('itemId').anyOf(watchingIds).toArray()
        : Promise.resolve([] as CachedEpisode[]),
    [watchingKey],
  )
  const watchingStates = useLiveQuery<EpisodeState[]>(
    () =>
      watchingIds.length
        ? db.episodeStates.where('itemId').anyOf(watchingIds).toArray()
        : Promise.resolve([] as EpisodeState[]),
    [watchingKey],
  )
  const watchedEpKeys = new Set(
    (watchingStates ?? []).filter((s) => s.watched).map((s) => `${s.itemId}:${s.season}:${s.episode}`),
  )
  const epByItem = new Map<string, CachedEpisode[]>()
  for (const e of watchingEpisodes ?? []) {
    if (e.season === 0) continue // skip specials
    const arr = epByItem.get(e.itemId) ?? []
    arr.push(e)
    epByItem.set(e.itemId, arr)
  }
  const nextUnwatched = (itemId: string): CachedEpisode | null => {
    const eps = (epByItem.get(itemId) ?? [])
      .slice()
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
    return eps.find((e) => !watchedEpKeys.has(`${e.itemId}:${e.season}:${e.episode}`)) ?? null
  }

  if (items === undefined) return <p className="muted">Loading…</p>

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__emoji">📺</p>
        <h2>Your library is empty</h2>
        <p className="muted">
          Head to <Link to="/search">Search</Link> to add the first show or movie.
        </p>
      </div>
    )
  }

  const sorted = [...items].sort(comparator(sort))
  const parsed = parseQuery(query)
  const searching = query.trim().length > 0

  return (
    <div className="library">
      <FilterBar
        value={query}
        onChange={setQuery}
        placeholder="Filter… name, genre:comedy, service:apple"
      >
        <select
          className="sort-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </FilterBar>

      {searching ? (
        (() => {
          const titleResults = sorted.filter((i) =>
            matchesFilter(
              {
                title: i.title,
                genres: i.genres,
                providers: i.providers,
                cast: i.cast,
                mediaType: i.mediaType,
                ended: i.ended,
                runtime: i.runtime,
              },
              parsed,
            ),
          )

          // Episode-name matches, one row per episode (excluding shows already
          // matched by title, or excluded by an active genre/service filter).
          const titleIds = new Set(titleResults.map((i) => i.id))
          const itemsById = new Map(items.map((i) => [i.id, i]))
          const episodeHits = (episodeMatches ?? [])
            .filter((e) => {
              const it = itemsById.get(e.itemId)
              if (!it || titleIds.has(e.itemId)) return false
              // Respect genre/service/actor/type filters on the episode's show too.
              return matchesFilter(
                {
                  genres: it.genres,
                  providers: it.providers,
                  cast: it.cast,
                  mediaType: 'show',
                  ended: it.ended,
                  runtime: it.runtime,
                },
                { ...parsed, text: '' },
              )
            })
            .sort(
              (a, b) =>
                a.itemId.localeCompare(b.itemId) || a.season - b.season || a.episode - b.episode,
            )
            .slice(0, 40)

          if (titleResults.length === 0 && episodeHits.length === 0) {
            return <p className="muted">No matches for “{query}”.</p>
          }

          return (
            <>
              {titleResults.length > 0 && (
                <section className="library__section">
                  <h2 className="section-title">
                    Results <span className="count">{titleResults.length}</span>
                  </h2>
                  <PosterGrid items={titleResults} />
                </section>
              )}
              {episodeHits.length > 0 && (
                <section className="library__section">
                  <h2 className="section-title">
                    Episode matches <span className="count">{episodeHits.length}</span>
                  </h2>
                  <ul className="result-list">
                    {episodeHits.map((e) => {
                      const item = itemsById.get(e.itemId) as TrackedItem
                      const aired = hasAired(e.airDate)
                      return (
                        <li key={e.id} className="result-row">
                          <Link
                            to={`/item/${encodeURIComponent(item.id)}`}
                            className="result-row__link"
                          >
                            {imageUrl(item.posterPath, 'w92') ? (
                              <img
                                className="result-row__poster"
                                src={imageUrl(item.posterPath, 'w92')}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <div className="result-row__poster result-row__poster--placeholder">
                                📺
                              </div>
                            )}
                            <div className="result-row__info">
                              <span className="result-row__title">{item.title}</span>
                              <span className="muted upcoming__detail">
                                S{e.season}E{e.episode} · {e.name}
                              </span>
                            </div>
                            {aired ? (
                              <span className="upcoming__date">{e.airDate}</span>
                            ) : (
                              <span className="episode__upcoming">
                                {e.airDate ? `Upcoming · ${e.airDate}` : 'Upcoming'}
                              </span>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
            </>
          )
        })()
      ) : (
        <>
          {(() => {
            const favs = sorted.filter((i) => i.favorite)
            if (favs.length === 0) return null
            return (
              <section className="library__section">
                <h2 className="section-title">
                  ★ Favorites <span className="count">{favs.length}</span>
                </h2>
                <PosterGrid items={favs} />
              </section>
            )
          })()}

          {STATUS_ORDER.map((status) => {
            // Favorites are shown in their own section above, not duplicated here.
            const group = sorted.filter((i) => i.status === status && !i.favorite)
            if (group.length === 0) return null
            return (
              <section key={status} className="library__section">
                <h2 className="section-title">
                  {STATUS_LABEL[status]} <span className="count">{group.length}</span>
                </h2>
                {status === 'watching' ? (
                  <WatchingGrid items={group} nextUnwatched={nextUnwatched} />
                ) : (
                  <PosterGrid items={group} />
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}

function PosterGrid({ items }: { items: TrackedItem[] }) {
  return (
    <ul className="poster-grid">
      {items.map((item) => (
        <li key={item.id} className="poster-cell">
          <Link to={`/item/${encodeURIComponent(item.id)}`} className="poster-card">
            {imageUrl(item.posterPath) ? (
              <img className="poster-card__img" src={imageUrl(item.posterPath)} alt="" loading="lazy" />
            ) : (
              <div className="poster-card__img poster-card__img--placeholder">
                {item.mediaType === 'movie' ? '🎬' : '📺'}
              </div>
            )}
            <span className="poster-card__title">{item.title}</span>
            {item.userRating !== undefined && (
              <span className="poster-card__rating">★ {item.userRating}</span>
            )}
          </Link>
          <button
            className={`fav-star${item.favorite ? ' fav-star--on' : ''}`}
            title={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            aria-label={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={() => void toggleFavorite(item.id, !item.favorite)}
          >
            {item.favorite ? '★' : '☆'}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Watching section: each show card gets a "next unwatched episode" strip. */
function WatchingGrid({
  items,
  nextUnwatched,
}: {
  items: TrackedItem[]
  nextUnwatched: (id: string) => CachedEpisode | null
}) {
  return (
    <ul className="poster-grid">
      {items.map((item) => {
        const next = item.mediaType === 'show' ? nextUnwatched(item.id) : null
        return (
          <li key={item.id} className="poster-cell">
            <Link to={`/item/${encodeURIComponent(item.id)}`} className="poster-card">
              {imageUrl(item.posterPath) ? (
                <img className="poster-card__img" src={imageUrl(item.posterPath)} alt="" loading="lazy" />
              ) : (
                <div className="poster-card__img poster-card__img--placeholder">
                  {item.mediaType === 'movie' ? '🎬' : '📺'}
                </div>
              )}
              <span className="poster-card__title">{item.title}</span>
            </Link>
            <button
              className={`fav-star${item.favorite ? ' fav-star--on' : ''}`}
              title={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
              aria-label={item.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
              onClick={() => void toggleFavorite(item.id, !item.favorite)}
            >
              {item.favorite ? '★' : '☆'}
            </button>
            {next && <NextEpCard item={item} ep={next} />}
          </li>
        )
      })}
    </ul>
  )
}

function NextEpCard({ item, ep }: { item: TrackedItem; ep: CachedEpisode }) {
  const aired = hasAired(ep.airDate)
  return (
    <div className="next-ep">
      <span className="next-ep__label">
        S{ep.season}E{ep.episode}
        {ep.name ? ` · ${ep.name}` : ''}
      </span>
      {aired ? (
        <button
          className="next-ep__check"
          title="Mark watched"
          aria-label={`Mark S${ep.season}E${ep.episode} watched`}
          onClick={() => void markEpisode(item.id, ep.season, ep.episode, true)}
        >
          ✓
        </button>
      ) : (
        <span className="next-ep__date">{ep.airDate ?? 'TBA'}</span>
      )}
    </div>
  )
}
