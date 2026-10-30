import { useState } from 'react'
import {
  formatWatched,
  localDateValue,
  partsToWatched,
  watchedToParts,
  type DatePrecision,
} from '../utils/watchedDate'

// ---------------------------------------------------------------------------
// Shared "watched on" date control, used for movies and episodes.
//
// The inline control is a native date picker (day precision). The ✏️ pencil
// opens a Select-date dialog where the month and/or day can be zeroed out to
// record just a month ("Mar 2020") or a year ("2021"). The date math lives in
// utils/watchedDate so this file only exports the component (fast refresh).
// ---------------------------------------------------------------------------

export default function WatchedDateField({
  watchedAt,
  precision = 'day',
  onChange,
  label = 'Watched',
  className = 'watched-date',
}: {
  watchedAt?: number
  precision?: DatePrecision
  onChange: (ms: number, precision: DatePrecision) => void
  label?: string
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const partial = watchedAt !== undefined && precision !== 'day'

  return (
    // Stop clicks/keys from bubbling to a surrounding clickable row (episodes).
    <span
      className={`watched-date ${className}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="muted">{label}</span>
      {partial ? (
        <button type="button" className="watched-date__value" onClick={() => setEditing(true)}>
          {formatWatched(watchedAt, precision)}
        </button>
      ) : (
        <input
          type="date"
          value={watchedAt !== undefined ? localDateValue(watchedAt) : ''}
          onChange={(e) => {
            if (!e.target.value) return
            onChange(new Date(`${e.target.value}T12:00:00`).getTime(), 'day')
          }}
        />
      )}
      <button
        type="button"
        className="watched-date__edit"
        title="Select date — month or year only"
        aria-label="Select date"
        onClick={() => setEditing(true)}
      >
        ✏️
      </button>
      {editing && (
        <SelectDateDialog
          initial={watchedAt !== undefined ? watchedToParts(watchedAt, precision) : undefined}
          onCancel={() => setEditing(false)}
          onSave={(y, m, d) => {
            const { ms, precision: p } = partsToWatched(y, m, d)
            onChange(ms, p)
            setEditing(false)
          }}
        />
      )}
    </span>
  )
}

function SelectDateDialog({
  initial,
  onCancel,
  onSave,
}: {
  initial?: { year: number; month: number; day: number }
  onCancel: () => void
  onSave: (year: number, month: number, day: number) => void
}) {
  const [year, setYear] = useState(() => String(initial?.year ?? new Date().getFullYear()))
  const [month, setMonth] = useState(() => String(initial?.month ?? 0))
  const [day, setDay] = useState(() => String(initial?.day ?? 0))

  const y = Number(year) || 0
  const m = Math.min(Math.max(Number(month) || 0, 0), 12)
  const d = Math.min(Math.max(Number(day) || 0, 0), 31)
  const validYear = y >= 1900 && y <= 2200
  // A day with no month is meaningless — the result is a year, so flag it.
  const dayWithoutMonth = d > 0 && m === 0

  function save() {
    if (!validYear) return
    onSave(y, m, d)
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Select date"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="modal">
        <h3>Select date</h3>
        <p className="muted">
          Set the day to <strong>0</strong> to record just the month, or the month to{' '}
          <strong>0</strong> to record just the year.
        </p>
        <div className="date-fields">
          <label className="date-fields__f">
            <span>Month</span>
            <input
              type="number"
              min="0"
              max="12"
              inputMode="numeric"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <label className="date-fields__f">
            <span>Day</span>
            <input
              type="number"
              min="0"
              max="31"
              inputMode="numeric"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label className="date-fields__f date-fields__f--year">
            <span>Year</span>
            <input
              type="number"
              min="1900"
              max="2200"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </label>
        </div>
        <p className="muted date-fields__preview">
          {validYear
            ? `Will record: ${formatWatched(partsToWatched(y, m, d).ms, partsToWatched(y, m, d).precision)}`
            : 'Enter a valid year.'}
          {dayWithoutMonth && ' (a day needs a month, so only the year is kept)'}
        </p>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={!validYear} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
