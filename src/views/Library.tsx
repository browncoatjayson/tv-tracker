import { Fragment, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../data/db'
import { hasAired, imageUrl } from '../api/tmdb'
import { markEpisode, toggleFavorite } from '../data/library'
import type { CachedEpisode, EpisodeState, TrackedItem, WatchStatus } from '../data/types'
import { matchesFilter, parseQuery } from '../utils/filter'
import { usePersistentFilter } from '../hooks/usePersistentFilter'
import { useTrackedItems } from '../hooks/useTrackedItems'
import FilterBar from '../components/FilterBar'
import SectionDivider from '../components/SectionDivider'

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

/** One rendered group of titles (a status, or Favorites). */
interface Section {
  key: string
  label: string
  items: TrackedItem[]
  /** Watching shows get the "next episode" strip (full view only). */
  watching?: boolean
  /** Dropped gets a "Hide" toggle so you can tuck it away. */
  dropped?: boolean
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

const HIDDEN_KEY = 'tvtracker.libraryHidden'

/** Section keys the user has collapsed. Migrates the old dropped-only flag. */
function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
    if (localStorage.getItem('tvtracker.libraryHideDropped') === '1') return new Set(['dropped'])
  } catch {
    // ignore
  }
  return new Set()
}

function comparator(sort: SortKey): (a: TrackedItem, b: TrackedItem) => number {
  switch (sort) {
    case 'premiere':
      // Newest first; items without a year sort last.
      return (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.title.localeCompare(b.title)
    case 'lastEpisode': {
      // Sort by the last *aired* episode date (shows) / release date (movies),
      // newest first. Titles with nothing aired yet (unaired shows, unreleased
      // movies, or not-yet-indexed) have no date and sort to the end, alphabetically.
      return (a, b) => {
        const ka = a.lastAirDate ?? ''
        const kb = b.lastAirDate ?? ''
        if (ka && kb) return kb.localeCompare(ka) || a.title.localeCompare(b.title)
        if (ka) return -1
        if (kb) return 1
        return a.title.localeCompare(b.title)
      }
    }
    default:
      return (a, b) => a.title.localeCompare(b.title)
  }
}

export default function Library() {
  const items = useTrackedItems()
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
  // Compact "collapsed" layout, and which groups are tucked away.
  const [collapsed, setCollapsed] = useState(() => readFlag('tvtracker.libraryCollapsed'))
  const [hidden, setHidden] = useState<Set<string>>(readHidden)
  const toggleHidden = (key: string, v: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (v) next.add(key)
      else next.delete(key)
      return next
    })
  useEffect(() => {
    try {
      localStorage.setItem('tvtracker.librarySort', sort)
    } catch {
      // ignore
    }
  }, [sort])
  useEffect(() => {
    try {
      localStorage.setItem('tvtracker.libraryCollapsed', collapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [collapsed])
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]))
    } catch {
      // ignore
    }
  }, [hidden])

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

  // When searching, keep only titles matching the query/filters; otherwise all.
  const matched = searching
    ? sorted.filter((i) =>
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
    : sorted

  // Keep the status groups in both modes so results stay in context. Favorites
  // get their own section only when browsing (not mixed into search results).
  const sections: Section[] = []
  if (!searching) {
    const favs = matched.filter((i) => i.favorite)
    if (favs.length > 0) sections.push({ key: 'fav', label: '★ Favorites', items: favs })
  }
  for (const status of STATUS_ORDER) {
    const group = matched.filter((i) => i.status === status && (searching || !i.favorite))
    if (group.length > 0) {
      sections.push({
        key: status,
        label: STATUS_LABEL[status],
        items: group,
        watching: status === 'watching',
        dropped: status === 'dropped',
      })
    }
  }

  // Episode-name matches, one row per episode (only for shows not already matched
  // by title, and still respecting any genre/service/actor/type filter).
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const titleIds = new Set(matched.map((i) => i.id))
  const episodeHits = searching
    ? (episodeMatches ?? [])
        .filter((e) => {
          const it = itemsById.get(e.itemId)
          if (!it || titleIds.has(e.itemId)) return false
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
          (a, b) => a.itemId.localeCompare(b.itemId) || a.season - b.season || a.episode - b.episode,
        )
        .slice(0, 40)
    : []

  const noMatches = searching && sections.length === 0 && episodeHits.length === 0

  return (
    <div className="library">
      <FilterBar value={query} onChange={setQuery} placeholder="Search for a title">
        <ViewToggle collapsed={collapsed} onChange={setCollapsed} />
        <SortMenu sort={sort} onChange={setSort} />
      </FilterBar>

      {noMatches && <p className="muted">No matches for “{query}”.</p>}

      {!noMatches &&
        (collapsed ? (
          <CollapsedList sections={sections} hidden={hidden} onToggleHidden={toggleHidden} />
        ) : (
          sections.map((sec) => (
            <FullSection
              key={sec.key}
              sec={sec}
              hidden={hidden.has(sec.key)}
              onToggleHidden={toggleHidden}
              nextUnwatched={nextUnwatched}
            />
          ))
        ))}

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
                  <Link to={`/item/${encodeURIComponent(item.id)}`} className="result-row__link">
                    {imageUrl(item.posterPath, 'w92') ? (
                      <img
                        className="result-row__poster"
                        src={imageUrl(item.posterPath, 'w92')}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="result-row__poster result-row__poster--placeholder">📺</div>
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
    </div>
  )
}

/** A full-size status group: header (+ Hide toggle for Dropped) and a poster grid. */
function FullSection({
  sec,
  hidden,
  onToggleHidden,
  nextUnwatched,
}: {
  sec: Section
  hidden: boolean
  onToggleHidden: (key: string, v: boolean) => void
  nextUnwatched: (id: string) => CachedEpisode | null
}) {
  // In the full view only Dropped is collapsible.
  const isHidden = !!sec.dropped && hidden
  return (
    <section className="library__section">
      <h2 className={`section-title${sec.dropped ? ' section-title--row' : ''}`}>
        {sec.label} <span className="count">{sec.items.length}</span>
        {sec.dropped && (
          <label className="lib-hide">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => onToggleHidden(sec.key, e.target.checked)}
            />
            Hide
          </label>
        )}
      </h2>
      {isHidden ? (
        <p className="muted lib-hidden-note">{sec.items.length} hidden</p>
      ) : sec.watching ? (
        <WatchingGrid items={sec.items} nextUnwatched={nextUnwatched} />
      ) : (
        <PosterGrid items={sec.items} />
      )}
    </section>
  )
}

/** Compact layout: every group flows in one wrapping list, each introduced by a
 *  one-card-wide divider with its count and a Hide toggle (mirrors the Cast row). */
function CollapsedList({
  sections,
  hidden,
  onToggleHidden,
}: {
  sections: Section[]
  hidden: Set<string>
  onToggleHidden: (key: string, v: boolean) => void
}) {
  return (
    <div className="lib-collapsed">
      {sections.map((sec) => {
        const isHidden = hidden.has(sec.key)
        return (
          <Fragment key={sec.key}>
            <SectionDivider
              className="section-divider--lib"
              label={sec.label}
              count={sec.items.length}
              countNoun="Title"
              hidden={isHidden}
              onToggleHide={(v) => onToggleHidden(sec.key, v)}
            />
            {!isHidden && sec.items.map((item) => <LibChip key={item.id} item={item} />)}
          </Fragment>
        )
      })}
    </div>
  )
}

/** A small poster + title card for the collapsed view. */
function LibChip({ item }: { item: TrackedItem }) {
  const poster = imageUrl(item.posterPath, 'w92')
  return (
    <Link to={`/item/${encodeURIComponent(item.id)}`} className="lib-chip" title={item.title}>
      {poster ? (
        <img className="lib-chip__img" src={poster} alt="" loading="lazy" />
      ) : (
        <div className="lib-chip__img lib-chip__img--ph">{item.mediaType === 'movie' ? '🎬' : '📺'}</div>
      )}
      <span className="lib-chip__title">{item.title}</span>
    </Link>
  )
}

/** Toggle between the full poster grid and the compact collapsed view. */
function ViewToggle({ collapsed, onChange }: { collapsed: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`sort-btn${collapsed ? ' filter-btn--active' : ''}`}
      aria-pressed={collapsed}
      title={collapsed ? 'Full view' : 'Collapsed view'}
      aria-label={collapsed ? 'Switch to full view' : 'Switch to collapsed view'}
      onClick={() => onChange(!collapsed)}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    </button>
  )
}

/** Icon-only sort control: an up/down-arrows button that opens a small menu. */
function SortMenu({ sort, onChange }: { sort: SortKey; onChange: (s: SortKey) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="sort" ref={ref}>
      <button
        type="button"
        className="sort-btn"
        aria-label="Sort"
        aria-expanded={open}
        title="Sort"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 3v18" />
          <path d="M4 7l4-4 4 4" />
          <path d="M16 21V3" />
          <path d="M12 17l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="sort-menu" role="menu">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={sort === k}
              className={`sort-menu__item${sort === k ? ' sort-menu__item--on' : ''}`}
              onClick={() => {
                onChange(k)
                setOpen(false)
              }}
            >
              {SORT_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PosterGrid({ items }: { items: TrackedItem[] }) {
  return (
    <ul className="poster-grid">
      {items.map((item) => (
        <li key={item.id} className="poster-cell">
          <Link
            to={`/item/${encodeURIComponent(item.id)}`}
            className="poster-card"
            title={item.title}
          >
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
        const to = `/item/${encodeURIComponent(item.id)}`
        return (
          <li key={item.id} className="poster-cell watching-cell">
            <Link to={to} className="watching-art" aria-label={item.title} title={item.title}>
              {imageUrl(item.posterPath) ? (
                <img className="poster-card__img" src={imageUrl(item.posterPath)} alt="" loading="lazy" />
              ) : (
                <div className="poster-card__img poster-card__img--placeholder">
                  {item.mediaType === 'movie' ? '🎬' : '📺'}
                </div>
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
            {/* Next-episode card tucked behind the poster, then the title.
                Always rendered (even empty) so every card is the same height. */}
            {next ? (
              <NextEpCard item={item} ep={next} />
            ) : (
              <div className="next-ep next-ep--empty">
                <span className="next-ep__label">Nothing scheduled</span>
              </div>
            )}
            <Link to={to} className="poster-card__title watching-title" title={item.title}>
              {item.title}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function NextEpCard({ item, ep }: { item: TrackedItem; ep: CachedEpisode }) {
  const aired = hasAired(ep.airDate)
  const label = `S${ep.season}E${ep.episode}${ep.name ? ` · ${ep.name}` : ''}`
  return (
    <div className="next-ep">
      <span className="next-ep__label" title={label}>
        {label}
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
