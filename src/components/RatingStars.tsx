import { useState } from 'react'

/** A clickable 1–10 star row (IMDb-style), with hover preview and optional clear. */
export default function RatingStars({
  value,
  onPick,
  onClear,
}: {
  value?: number
  onPick: (n: number) => void
  onClear?: () => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  return (
    <div className="stars-wrap">
      <div className="stars" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className="star-btn"
            aria-label={`Rate ${n} of 10`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onPick(n)}
          >
            {n <= shown ? '★' : '☆'}
          </button>
        ))}
      </div>
      {onClear && (
        <button type="button" className="link-btn" onClick={onClear}>
          clear
        </button>
      )}
    </div>
  )
}
