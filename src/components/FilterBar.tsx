import { useEffect, useRef, useState, type ReactNode } from 'react'
import { parseQuery, type LengthConstraint } from '../utils/filter'
import { SERVICES } from '../data/services'
import RatingStars from './RatingStars'

// Curated quick-pick lists. Matching is case-insensitive substring (see
// matchesFilter), so e.g. "apple tv" matches TMDB's "Apple TV+". Any value
// typed directly into the box that isn't here still shows as a chip so it can
// be toggled off.
const GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Mystery',
  'Romance',
  'Science Fiction',
  'Thriller',
  'War',
  'Western',
  'Reality',
  'Kids',
]

const LEN_OPS: { value: '' | LengthConstraint['op']; label: string }[] = [
  { value: '', label: 'Any length' },
  { value: '<', label: 'under' },
  { value: '<=', label: 'at most' },
  { value: '=', label: 'exactly' },
  { value: '>=', label: 'at least' },
  { value: '>', label: 'over' },
]

/** The dropdown's working state: free text kept separate from each token group. */
interface Editor {
  free: string
  types: Set<'movie' | 'show' | 'sport'>
  statuses: Set<'ended' | 'ongoing'>
  released: Set<'aired' | 'upcoming'>
  genres: Set<string>
  services: Set<string>
  actor: string
  series: string
  team: string
  lenOp: '' | LengthConstraint['op']
  lenVal: string
  /** Minimum TMDB rating 1–10 (0 = no rating filter). */
  rating: number
}

const TOKEN_RE = /^(genre|service|actor|series|team|type|status|released|length|rating):/i

/** Split a raw query string into the dropdown's structured working state. */
function parseForEditor(raw: string): Editor {
  const p = parseQuery(raw)
  const free = raw
    .split(',')
    .map((s) => s.trim())
    .filter((part) => part && !TOKEN_RE.test(part))
    .join(', ')
  const len = p.lengths[0]
  return {
    free,
    types: new Set(p.types),
    statuses: new Set(p.ended),
    // No token = both shown, so default both chips on; a single token restricts.
    released: new Set(p.released.length ? p.released : (['aired', 'upcoming'] as const)),
    genres: new Set(p.genres),
    services: new Set(p.services),
    actor: p.actors[0] ?? '',
    series: p.series[0] ?? '',
    team: p.teams[0] ?? '',
    lenOp: len ? len.op : '',
    lenVal: len ? String(len.value) : '',
    rating: p.rating ?? 0,
  }
}

/** Rebuild a query string from the dropdown's working state. */
function buildQuery(e: Editor): string {
  const parts: string[] = []
  if (e.free.trim()) parts.push(e.free.trim())
  for (const t of e.types) parts.push(`type:${t}`)
  for (const s of e.statuses) parts.push(`status:${s}`)
  // Only a single pick restricts (both/none = show everything, so no token).
  if (e.released.size === 1) parts.push(`released:${[...e.released][0]}`)
  for (const g of e.genres) parts.push(`genre:${g}`)
  for (const s of e.services) parts.push(`service:${s}`)
  if (e.actor.trim()) parts.push(`actor:${e.actor.trim()}`)
  if (e.series.trim()) parts.push(`series:${e.series.trim()}`)
  if (e.team.trim()) parts.push(`team:${e.team.trim()}`)
  if (e.lenOp && e.lenVal.trim() && Number.isFinite(Number(e.lenVal))) {
    parts.push(`length:${e.lenOp}${Number(e.lenVal)}`)
  }
  if (e.rating > 0) parts.push(`rating:${e.rating}`)
  return parts.join(', ')
}

/** Number of active token filters (free text isn't counted — it's in the box). */
function activeCount(raw: string): number {
  const p = parseQuery(raw)
  return (
    p.types.length +
    p.ended.length +
    (p.released.length === 1 ? 1 : 0) +
    p.genres.length +
    p.services.length +
    p.actors.length +
    p.series.length +
    p.teams.length +
    p.lengths.length +
    (p.rating !== undefined ? 1 : 0)
  )
}

/**
 * The shared filter bar: a text box, a "Filters" button, and a dropdown that
 * builds the token query (genre:/service:/actor:/type:/status:/length:) for
 * the user. The query string stays the single source of truth, so typing in
 * the box still works and the dropdown round-trips cleanly.
 *
 * `children` renders after the Filters button (e.g. a sort select or the
 * Upcoming view toggle).
 */
export default function FilterBar({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  children,
}: {
  value: string
  onChange: (q: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Fired when Enter is pressed in the box (e.g. to run a filter-only search). */
  onSubmit?: () => void
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [ed, setEd] = useState<Editor>(() => parseForEditor(value))
  const wrapRef = useRef<HTMLDivElement>(null)

  // (Re)stage the working state from the live query whenever the dropdown opens.
  useEffect(() => {
    if (open) setEd(parseForEditor(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
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

  const count = activeCount(value)

  function toggleIn<T>(set: Set<T>, v: T): Set<T> {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  function apply() {
    // Combine the latest free text from the box with the staged token picks.
    const free = parseForEditor(value).free
    onChange(buildQuery({ ...ed, free }))
    setOpen(false)
  }

  function clearAll() {
    // Drop every token filter but keep whatever free text is in the box.
    onChange(parseForEditor(value).free)
    setOpen(false)
  }

  const customGenres = [...ed.genres].filter((g) => !GENRES.some((x) => x.toLowerCase() === g))
  const customServices = [...ed.services].filter((v) => !SERVICES.some((s) => s.value === v))

  return (
    <div className="filter-bar" ref={wrapRef}>
      <div className="filter-bar__row">
        <input
          className="search__input"
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit?.()
          }}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className={`filter-btn${open || count > 0 ? ' filter-btn--active' : ''}`}
          aria-expanded={open}
          aria-label="Filters"
          title="Filters"
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
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {count > 0 && <span className="filter-btn__badge">{count}</span>}
        </button>
        {children}
      </div>

      {open && (
        <div className="filter-pop" role="dialog" aria-label="Filter options">
          <div className="filter-pop__group">
            <span className="filter-pop__label">Type</span>
            <div className="chip-row">
              {(['movie', 'show', 'sport'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip${ed.types.has(t) ? ' chip--on' : ''}`}
                  aria-pressed={ed.types.has(t)}
                  onClick={() => setEd({ ...ed, types: toggleIn(ed.types, t) })}
                >
                  {t === 'movie' ? 'Movies' : t === 'show' ? 'TV Shows' : 'Sports'}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-pop__group">
            <span className="filter-pop__label">Status</span>
            <div className="chip-row">
              {(['ended', 'ongoing'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip${ed.statuses.has(s) ? ' chip--on' : ''}`}
                  aria-pressed={ed.statuses.has(s)}
                  onClick={() => setEd({ ...ed, statuses: toggleIn(ed.statuses, s) })}
                >
                  {s === 'ended' ? 'Ended' : 'Ongoing'}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-pop__group">
            <span className="filter-pop__label">Released</span>
            <div className="chip-row">
              {([
                ['aired', 'Aired'],
                ['upcoming', 'Upcoming'],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${ed.released.has(v) ? ' chip--on' : ''}`}
                  aria-pressed={ed.released.has(v)}
                  onClick={() => setEd({ ...ed, released: toggleIn(ed.released, v) })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-pop__group">
            <span className="filter-pop__label">Genre</span>
            <div className="chip-row">
              {GENRES.map((g) => {
                const v = g.toLowerCase()
                const on = ed.genres.has(v)
                return (
                  <button
                    key={g}
                    type="button"
                    className={`chip${on ? ' chip--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setEd({ ...ed, genres: toggleIn(ed.genres, v) })}
                  >
                    {g}
                  </button>
                )
              })}
              {customGenres.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="chip chip--on"
                  aria-pressed="true"
                  onClick={() => setEd({ ...ed, genres: toggleIn(ed.genres, v) })}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-pop__group">
            <span className="filter-pop__label">Service</span>
            <div className="chip-row">
              {SERVICES.map((s) => {
                const on = ed.services.has(s.value)
                return (
                  <button
                    key={s.value}
                    type="button"
                    className={`chip${on ? ' chip--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setEd({ ...ed, services: toggleIn(ed.services, s.value) })}
                  >
                    {s.label}
                  </button>
                )
              })}
              {customServices.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="chip chip--on"
                  aria-pressed="true"
                  onClick={() => setEd({ ...ed, services: toggleIn(ed.services, v) })}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-pop__group">
            <label className="filter-pop__label" htmlFor="filter-actor">
              Actor
            </label>
            <input
              id="filter-actor"
              className="filter-pop__input"
              type="text"
              placeholder="e.g. Bryan Cranston"
              value={ed.actor}
              onChange={(e) => setEd({ ...ed, actor: e.target.value })}
            />
          </div>

          <div className="filter-pop__group">
            <label className="filter-pop__label" htmlFor="filter-series">
              Series
            </label>
            <input
              id="filter-series"
              className="filter-pop__input"
              type="text"
              placeholder="e.g. Halloween"
              value={ed.series}
              onChange={(e) => setEd({ ...ed, series: e.target.value })}
            />
          </div>

          <div className="filter-pop__group">
            <label className="filter-pop__label" htmlFor="filter-team">
              Team <span className="muted">(sports)</span>
            </label>
            <input
              id="filter-team"
              className="filter-pop__input"
              type="text"
              placeholder="e.g. Nebraska"
              value={ed.team}
              onChange={(e) => setEd({ ...ed, team: e.target.value })}
            />
          </div>

          <div className="filter-pop__group">
            <span className="filter-pop__label">Length</span>
            <div className="filter-len">
              <select
                className="filter-pop__input"
                value={ed.lenOp}
                onChange={(e) => setEd({ ...ed, lenOp: e.target.value as Editor['lenOp'] })}
                aria-label="Length comparison"
              >
                {LEN_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                className="filter-pop__input filter-len__num"
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="min"
                value={ed.lenVal}
                disabled={!ed.lenOp}
                onChange={(e) => setEd({ ...ed, lenVal: e.target.value })}
                aria-label="Length in minutes"
              />
              <span className="muted">min</span>
            </div>
          </div>

          <div className="filter-pop__group">
            <span className="filter-pop__label">
              Rating{ed.rating > 0 ? ` (★${ed.rating} and up)` : ' (any)'}
            </span>
            <RatingStars
              value={ed.rating || undefined}
              onPick={(n) => setEd({ ...ed, rating: n })}
              onClear={ed.rating > 0 ? () => setEd({ ...ed, rating: 0 }) : undefined}
            />
          </div>

          <div className="filter-pop__foot">
            <button type="button" className="btn btn--small btn--ghost" onClick={clearAll}>
              Clear
            </button>
            <button type="button" className="btn btn--small" onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
