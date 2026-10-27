import { useEffect, useRef, useState, type ReactNode } from 'react'
import { parseQuery, type LengthConstraint, type YearConstraint } from '../utils/filter'
import { SERVICES } from '../data/services'
import { ESPN_LEAGUES } from '../api/espn'
import { useEnabledLeagues } from '../data/sportPrefs'
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

const YEAR_OPS: { value: '' | YearConstraint['op']; label: string }[] = [
  { value: '', label: 'Any year' },
  { value: '=', label: 'in year' },
  { value: '~', label: 'in decade' },
  { value: '<', label: 'before' },
  { value: '>', label: 'after' },
]

/** The dropdown's working state: free text kept separate from each token group. */
interface Editor {
  free: string
  // The multi-value filters are tri-state: an `inc` (include) set plus an `ex`
  // (exclude) set. A value in neither is "off".
  types: Set<'movie' | 'show' | 'sport'>
  typesEx: Set<'movie' | 'show' | 'sport'>
  statuses: Set<'ended' | 'ongoing'>
  released: Set<'aired' | 'upcoming'>
  seen: Set<'watched' | 'unwatched'>
  languages: Set<'english' | 'foreign'>
  genres: Set<string>
  genresEx: Set<string>
  services: Set<string>
  servicesEx: Set<string>
  actor: string
  series: string
  team: string
  /** Sport league keys to filter to (game: tokens). */
  games: Set<string>
  gamesEx: Set<string>
  lenOp: '' | LengthConstraint['op']
  lenVal: string
  yearOp: '' | YearConstraint['op']
  yearVal: string
  /** Minimum TMDB rating 1–10 (0 = no rating filter). */
  rating: number
}

const TOKEN_RE =
  /^(genre|service|actor|series|team|game|type|status|released|seen|language|lang|length|year|rating):/i

/** Split a raw query string into the dropdown's structured working state. When
 *  `sportsOptIn` is set (Search), an untyped query defaults to Movies + TV Shows
 *  so sports stay opt-in. */
function parseForEditor(raw: string, sportsOptIn = false): Editor {
  const p = parseQuery(raw)
  const free = raw
    .split(',')
    .map((s) => s.trim())
    .filter((part) => part && !TOKEN_RE.test(part))
    .join(', ')
  const len = p.lengths[0]
  const yr = p.years[0]
  const types: Editor['types'] =
    sportsOptIn && p.types.length === 0 ? new Set(['movie', 'show']) : new Set(p.types)
  return {
    free,
    types,
    typesEx: new Set(p.typesExclude),
    statuses: new Set(p.ended),
    // No token = both shown, so default both chips on; a single token restricts.
    released: new Set(p.released.length ? p.released : (['aired', 'upcoming'] as const)),
    seen: new Set(p.seen),
    languages: new Set(p.languages),
    genres: new Set(p.genres),
    genresEx: new Set(p.genresExclude),
    services: new Set(p.services),
    servicesEx: new Set(p.servicesExclude),
    actor: p.actors[0] ?? '',
    series: p.series[0] ?? '',
    team: p.teams[0] ?? '',
    games: new Set(p.games),
    gamesEx: new Set(p.gamesExclude),
    lenOp: len ? len.op : '',
    lenVal: len ? String(len.value) : '',
    yearOp: yr ? yr.op : '',
    yearVal: yr ? String(yr.value) : '',
    rating: p.rating ?? 0,
  }
}

/** Rebuild a query string from the dropdown's working state. */
function buildQuery(e: Editor): string {
  const parts: string[] = []
  if (e.free.trim()) parts.push(e.free.trim())
  for (const t of e.types) parts.push(`type:${t}`)
  for (const t of e.typesEx) parts.push(`type:-${t}`)
  for (const s of e.statuses) parts.push(`status:${s}`)
  // Only a single pick restricts (both/none = show everything, so no token).
  if (e.released.size === 1) parts.push(`released:${[...e.released][0]}`)
  for (const s of e.seen) parts.push(`seen:${s}`)
  for (const l of e.languages) parts.push(`language:${l}`)
  for (const g of e.genres) parts.push(`genre:${g}`)
  for (const g of e.genresEx) parts.push(`genre:-${g}`)
  for (const s of e.services) parts.push(`service:${s}`)
  for (const s of e.servicesEx) parts.push(`service:-${s}`)
  if (e.actor.trim()) parts.push(`actor:${e.actor.trim()}`)
  if (e.series.trim()) parts.push(`series:${e.series.trim()}`)
  if (e.team.trim()) parts.push(`team:${e.team.trim()}`)
  for (const g of e.games) parts.push(`game:${g}`)
  for (const g of e.gamesEx) parts.push(`game:-${g}`)
  if (e.lenOp && e.lenVal.trim() && Number.isFinite(Number(e.lenVal))) {
    parts.push(`length:${e.lenOp}${Number(e.lenVal)}`)
  }
  if (e.yearOp && e.yearVal.trim() && Number.isFinite(Number(e.yearVal))) {
    // '=' is the default op, so it needs no prefix; others carry their symbol.
    parts.push(`year:${e.yearOp === '=' ? '' : e.yearOp}${Number(e.yearVal)}`)
  }
  if (e.rating > 0) parts.push(`rating:${e.rating}`)
  return parts.join(', ')
}

/** Number of active token filters (free text isn't counted — it's in the box). */
function activeCount(raw: string): number {
  const p = parseQuery(raw)
  return (
    p.types.length +
    p.typesExclude.length +
    p.ended.length +
    (p.released.length === 1 ? 1 : 0) +
    p.seen.length +
    p.languages.length +
    p.genres.length +
    p.genresExclude.length +
    p.services.length +
    p.servicesExclude.length +
    p.actors.length +
    p.series.length +
    p.teams.length +
    p.games.length +
    p.gamesExclude.length +
    p.lengths.length +
    p.years.length +
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
  sportsOptIn,
  children,
}: {
  value: string
  onChange: (q: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Fired when Enter is pressed in the box (e.g. to run a filter-only search). */
  onSubmit?: () => void
  /** Search only: an untyped query defaults to Movies + TV Shows, so sports are
   *  opt-in and the Team/Game options stay dimmed until Sports is selected. */
  sportsOptIn?: boolean
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [ed, setEd] = useState<Editor>(() => parseForEditor(value, sportsOptIn))
  const wrapRef = useRef<HTMLDivElement>(null)
  const enabledLeagues = useEnabledLeagues()

  // (Re)stage the working state from the live query whenever the dropdown opens.
  useEffect(() => {
    if (open) setEd(parseForEditor(value, sportsOptIn))
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

  // Tri-state cycle for a multi-value filter: off → include → exclude → off.
  // Returns the updated include/exclude sets.
  function cycleTri<T>(inc: Set<T>, ex: Set<T>, v: T): { inc: Set<T>; ex: Set<T> } {
    const ni = new Set(inc)
    const ne = new Set(ex)
    if (ni.has(v)) {
      ni.delete(v)
      ne.add(v)
    } else if (ne.has(v)) {
      ne.delete(v)
    } else {
      ni.add(v)
    }
    return { inc: ni, ex: ne }
  }

  /** The chip class suffix for a tri-state value: on, excluded, or neither. */
  function triClass<T>(inc: Set<T>, ex: Set<T>, v: T): string {
    return inc.has(v) ? ' chip--on' : ex.has(v) ? ' chip--exclude' : ''
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

  // Custom (hand-typed) values not in the quick-pick lists — shown so they can be
  // cycled/cleared. Includes both included and excluded custom values.
  const customGenres = [...ed.genres, ...ed.genresEx].filter(
    (g) => !GENRES.some((x) => x.toLowerCase() === g),
  )
  const customServices = [...ed.services, ...ed.servicesEx].filter(
    (v) => !SERVICES.some((s) => s.value === v),
  )

  // Game (league) chips: the user's enabled leagues, plus any custom game: value
  // typed by hand that isn't one of them.
  const leagueChips = ESPN_LEAGUES.filter((l) => enabledLeagues.includes(l.key))
  const customGames = [...ed.games, ...ed.gamesEx].filter(
    (g) => !ESPN_LEAGUES.some((l) => l.key === g),
  )
  // Game / Team only apply to sports, so dim them when sports aren't in scope.
  // With sportsOptIn (Search) that means Sports must be explicitly selected;
  // elsewhere (Library/Upcoming) an empty Type = everything, so still in scope.
  const sportsInScope = sportsOptIn
    ? ed.types.has('sport')
    : ed.types.size === 0 || ed.types.has('sport')

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
                  className={`chip${triClass(ed.types, ed.typesEx, t)}`}
                  aria-pressed={ed.types.has(t)}
                  title={ed.typesEx.has(t) ? 'Excluded — click to clear' : 'Click to include, again to exclude'}
                  onClick={() => {
                    const r = cycleTri(ed.types, ed.typesEx, t)
                    setEd({ ...ed, types: r.inc, typesEx: r.ex })
                  }}
                >
                  {ed.typesEx.has(t) ? '− ' : ''}
                  {t === 'movie' ? 'Movies' : t === 'show' ? 'TV Shows' : 'Sports'}
                </button>
              ))}
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

          <div className="filter-pop__group">
            <span className="filter-pop__label">Genre</span>
            <div className="chip-row">
              {GENRES.map((g) => {
                const v = g.toLowerCase()
                return (
                  <button
                    key={g}
                    type="button"
                    className={`chip${triClass(ed.genres, ed.genresEx, v)}`}
                    aria-pressed={ed.genres.has(v)}
                    title={ed.genresEx.has(v) ? 'Excluded — click to clear' : 'Click to include, again to exclude'}
                    onClick={() => {
                      const r = cycleTri(ed.genres, ed.genresEx, v)
                      setEd({ ...ed, genres: r.inc, genresEx: r.ex })
                    }}
                  >
                    {ed.genresEx.has(v) ? '− ' : ''}
                    {g}
                  </button>
                )
              })}
              {customGenres.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${triClass(ed.genres, ed.genresEx, v)}`}
                  aria-pressed={ed.genres.has(v)}
                  onClick={() => {
                    const r = cycleTri(ed.genres, ed.genresEx, v)
                    setEd({ ...ed, genres: r.inc, genresEx: r.ex })
                  }}
                >
                  {ed.genresEx.has(v) ? '− ' : ''}
                  {v}
                </button>
              ))}
            </div>
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
            <span className="filter-pop__label">Service</span>
            <div className="chip-row">
              {SERVICES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`chip${triClass(ed.services, ed.servicesEx, s.value)}`}
                  aria-pressed={ed.services.has(s.value)}
                  title={ed.servicesEx.has(s.value) ? 'Excluded — click to clear' : 'Click to include, again to exclude'}
                  onClick={() => {
                    const r = cycleTri(ed.services, ed.servicesEx, s.value)
                    setEd({ ...ed, services: r.inc, servicesEx: r.ex })
                  }}
                >
                  {ed.servicesEx.has(s.value) ? '− ' : ''}
                  {s.label}
                </button>
              ))}
              {customServices.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${triClass(ed.services, ed.servicesEx, v)}`}
                  aria-pressed={ed.services.has(v)}
                  onClick={() => {
                    const r = cycleTri(ed.services, ed.servicesEx, v)
                    setEd({ ...ed, services: r.inc, servicesEx: r.ex })
                  }}
                >
                  {ed.servicesEx.has(v) ? '− ' : ''}
                  {v}
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
            <span className="filter-pop__label">
              Seen <span className="muted">(excludes dropped)</span>
            </span>
            <div className="chip-row">
              {([
                ['watched', 'Watched'],
                ['unwatched', 'Unwatched'],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${ed.seen.has(v) ? ' chip--on' : ''}`}
                  aria-pressed={ed.seen.has(v)}
                  onClick={() => setEd({ ...ed, seen: toggleIn(ed.seen, v) })}
                >
                  {label}
                </button>
              ))}
            </div>
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
            <span className="filter-pop__label">Year</span>
            <div className="filter-len">
              <select
                className="filter-pop__input"
                value={ed.yearOp}
                onChange={(e) => {
                  const op = e.target.value as Editor['yearOp']
                  // Default the field to 1900 when a comparison is first chosen.
                  setEd({ ...ed, yearOp: op, yearVal: op && !ed.yearVal.trim() ? '1900' : ed.yearVal })
                }}
                aria-label="Year comparison"
              >
                {YEAR_OPS.map((o) => (
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
                placeholder="year"
                value={ed.yearVal}
                disabled={!ed.yearOp}
                onChange={(e) => setEd({ ...ed, yearVal: e.target.value })}
                aria-label="Year"
              />
            </div>
          </div>

          <div className="filter-pop__group">
            <span className="filter-pop__label">Language</span>
            <div className="chip-row">
              {([
                ['english', 'English'],
                ['foreign', 'Foreign'],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`chip${ed.languages.has(v) ? ' chip--on' : ''}`}
                  aria-pressed={ed.languages.has(v)}
                  onClick={() => setEd({ ...ed, languages: toggleIn(ed.languages, v) })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={`filter-pop__group${sportsInScope ? '' : ' filter-pop__group--dim'}`}>
            <span className="filter-pop__label">
              Game <span className="muted">(league)</span>
            </span>
            {leagueChips.length === 0 && customGames.length === 0 ? (
              <span className="muted filter-pop__hint">
                Enable leagues in Settings → Sports to filter by league.
              </span>
            ) : (
              <div className="chip-row">
                {leagueChips.map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    className={`chip${triClass(ed.games, ed.gamesEx, l.key)}`}
                    aria-pressed={ed.games.has(l.key)}
                    title={ed.gamesEx.has(l.key) ? 'Excluded — click to clear' : 'Click to include, again to exclude'}
                    onClick={() => {
                      const r = cycleTri(ed.games, ed.gamesEx, l.key)
                      setEd({ ...ed, games: r.inc, gamesEx: r.ex })
                    }}
                  >
                    {ed.gamesEx.has(l.key) ? '− ' : ''}
                    {l.emoji} {l.label}
                  </button>
                ))}
                {customGames.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`chip${triClass(ed.games, ed.gamesEx, g)}`}
                    aria-pressed={ed.games.has(g)}
                    onClick={() => {
                      const r = cycleTri(ed.games, ed.gamesEx, g)
                      setEd({ ...ed, games: r.inc, gamesEx: r.ex })
                    }}
                  >
                    {ed.gamesEx.has(g) ? '− ' : ''}
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={`filter-pop__group${sportsInScope ? '' : ' filter-pop__group--dim'}`}>
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
