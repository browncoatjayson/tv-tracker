import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A primary button with a ▾ toggle that reveals a small menu of secondary
 * actions (e.g. "Mark as watched" with a "Mark as skipped" alternative). The menu
 * closes on outside click, Escape, or after a pick.
 */
export default function SplitButton({
  label,
  onClick,
  menu,
  disabled,
  className = '',
}: {
  label: ReactNode
  onClick: () => void
  menu: { label: string; onClick: () => void }[]
  /** Disables the primary action only — the menu stays reachable. */
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`split-btn ${className}`} ref={ref}>
      <button className="btn split-btn__main" disabled={disabled} onClick={onClick}>
        {label}
      </button>
      <button
        className="btn split-btn__toggle"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <div className="split-btn__menu" role="menu">
          {menu.map((m, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className="split-btn__item"
              onClick={() => {
                setOpen(false)
                m.onClick()
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
