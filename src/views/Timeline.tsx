import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../data/db'
import { badgeById } from '../data/badges'
import { reviewBadgeToast } from '../utils/badgeToast'
import {
  buildTimeline,
  compareInDay,
  groupByDay,
  localDay,
  type TimelineEntry,
} from '../data/timeline'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function parseDay(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m: m - 1, d }
}
function toDate(s: string): Date {
  const { y, m, d } = parseDay(s)
  return new Date(y, m, d)
}
function longDay(s: string): string {
  return toDate(s).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
function shortDay(s: string): string {
  return toDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function addDays(s: string, n: number): string {
  const d = toDate(s)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
/** Compressed list reveals this many rows at a time. */
const PAGE = 1000

export default function Timeline() {
  const items = useLiveQuery(() => db.trackedItems.toArray())
  const states = useLiveQuery(() => db.episodeStates.toArray())
  const badges = useLiveQuery(() => db.badges.toArray())
  const cache = useLiveQuery(() => db.episodeCache.toArray())

  const entries = useMemo(() => {
    if (!items || !states || !badges) return null
    const names = new Map<string, string>()
    for (const c of cache ?? []) if (c.name) names.set(c.id, c.name)
    return buildTimeline(items, states, badges, names)
  }, [items, states, badges, cache])

  const byDay = useMemo(() => (entries ? groupByDay(entries) : new Map()), [entries])

  // Captured once on mount so it stays stable across re-renders.
  const [today] = useState(() => localDay(Date.now()))
  const [mode, setModeState] = useState<'agenda' | 'list'>('agenda')
  const [selected, setSelected] = useState(today)
  const [limit, setLimit] = useState(PAGE)
  // Switching into the list starts its pagination fresh.
  const setMode = (m: 'agenda' | 'list') => {
    if (m === 'list') setLimit(PAGE)
    setModeState(m)
  }

  if (!entries) return <p className="muted">Building your timeline…</p>

  if (entries.length === 0) {
    return (
      <div className="timeline">
        <TimelineHeader mode={mode} onMode={setMode} />
        <div className="empty-state">
          <p className="empty-state__emoji">🗓️</p>
          <h2>Nothing on your timeline yet</h2>
          <p className="muted">
            Mark episodes or movies watched and they’ll show up here by the day you saw them.
          </p>
        </div>
      </div>
    )
  }

  // The week (Sun–Sat) containing the selected day.
  const weekStart = toDate(selected)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekDays: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    weekDays.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  }
  const wa = toDate(weekDays[0])
  const wb = toDate(weekDays[6])
  const weekLabel =
    `${wa.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ` +
    `${wb.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${wb.getFullYear()}`
  const shiftWeek = (delta: number) => setSelected(addDays(selected, delta * 7))
  const jumpToday = () => setSelected(today)

  const dayEntries: TimelineEntry[] = byDay.get(selected) ?? []

  // Compressed list: newest day first, ordered within a day — paginated.
  const listEntries = [...entries].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : compareInDay(a, b)),
  )
  const shown = listEntries.slice(0, limit)

  return (
    <div className="timeline">
      <TimelineHeader mode={mode} onMode={setMode} />

      {mode === 'agenda' ? (
        <>
          <section className="card tl-cal">
            <div className="tl-cal__nav">
              <button className="tl-cal__arrow" aria-label="Previous week" onClick={() => shiftWeek(-1)}>
                ‹
              </button>
              <strong>{weekLabel}</strong>
              <button className="tl-cal__arrow" aria-label="Next week" onClick={() => shiftWeek(1)}>
                ›
              </button>
              <button className="btn btn--small btn--ghost tl-cal__today" onClick={jumpToday}>
                Today
              </button>
            </div>
            <div className="tl-cal__grid tl-cal__grid--head">
              {WEEKDAYS.map((w) => (
                <span key={w} className="tl-cal__wd">
                  {w}
                </span>
              ))}
            </div>
            <div className="tl-cal__grid">
              {weekDays.map((d) => (
                <button
                  key={d}
                  className={
                    'tl-cal__cell' +
                    (d === selected ? ' tl-cal__cell--sel' : '') +
                    (d === today ? ' tl-cal__cell--today' : '')
                  }
                  onClick={() => setSelected(d)}
                >
                  {parseDay(d).d}
                  {byDay.has(d) && <span className="tl-cal__dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <h3 className="section-title tl-day-title">
              {longDay(selected)}
              <span className="muted section-title__count">
                {dayEntries.length
                  ? `${dayEntries.length} ${dayEntries.length === 1 ? 'thing' : 'things'}`
                  : 'nothing'}
              </span>
            </h3>
            {dayEntries.length === 0 ? (
              <p className="muted">Nothing recorded on this day.</p>
            ) : (
              <ul className="tl-list">
                {dayEntries.map((e) => (
                  <EntryRow key={e.key} e={e} />
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="card">
          <ul className="tl-list">
            {shown.map((e) => (
              <EntryRow key={e.key} e={e} showDate />
            ))}
          </ul>
          {limit < listEntries.length && (
            <button
              className="btn btn--ghost tl-more"
              onClick={() => setLimit((n) => n + PAGE)}
            >
              Show more ({listEntries.length - limit} left)
            </button>
          )}
        </section>
      )}
    </div>
  )
}

function TimelineHeader({
  mode,
  onMode,
}: {
  mode: 'agenda' | 'list'
  onMode: (m: 'agenda' | 'list') => void
}) {
  return (
    <div className="tl-head">
      <h2 className="tl-head__title">Timeline</h2>
      <button
        type="button"
        className={`sort-btn${mode === 'list' ? ' filter-btn--active' : ''}`}
        aria-pressed={mode === 'list'}
        title={mode === 'list' ? 'Calendar view' : 'Compressed list'}
        aria-label={mode === 'list' ? 'Switch to calendar view' : 'Switch to compressed list'}
        onClick={() => onMode(mode === 'list' ? 'agenda' : 'list')}
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
    </div>
  )
}

function EntryRow({ e, showDate }: { e: TimelineEntry; showDate?: boolean }) {
  const art = e.poster ? (
    <img
      className={`tl-row__img${e.kind === 'game' ? ' tl-row__img--logo' : ''}`}
      src={e.poster}
      alt=""
      loading="lazy"
    />
  ) : (
    <span className="tl-row__img tl-row__img--emoji" aria-hidden="true">
      {e.emoji}
    </span>
  )
  const body = (
    <>
      {art}
      <span className="tl-row__body">
        <span className="tl-row__title">{e.title}</span>
        {e.subtitle && (
          <span className="tl-row__sub muted">
            {e.subtitle}
            {e.vague && ' · approx.'}
          </span>
        )}
      </span>
      {showDate && <span className="tl-row__date muted">{shortDay(e.date)}</span>}
    </>
  )

  if (e.kind === 'badge') {
    const def = badgeById(e.badgeId ?? '')
    return (
      <li>
        <button
          className="tl-row tl-row--badge"
          title="See how you earned this badge"
          onClick={() => def && reviewBadgeToast(def, e.at)}
        >
          {body}
        </button>
      </li>
    )
  }
  return (
    <li>
      <Link className="tl-row" to={`/item/${encodeURIComponent(e.itemId ?? '')}`}>
        {body}
      </Link>
    </li>
  )
}
