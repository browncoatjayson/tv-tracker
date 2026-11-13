// The crossing-arrows "shuffle" glyph used on the Search page's Watch Next
// button, and a 2:3 poster card built around it — a blue tile that stands in for
// the Watch Next shortcut wherever a poster would go (Library Favorites, lists).

/** The crossing-arrows shuffle icon (matches the Search "Watch next" button). */
export function ShuffleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  )
}

/** A 2:3 poster tile for the Watch Next shortcut: a blue card with the shuffle
 *  glyph, used in place of real poster artwork in Favorites and lists. */
export default function WatchNextPoster({ className }: { className?: string }) {
  return (
    <div className={`wn-poster${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span className="wn-poster__icon">
        <ShuffleIcon size={34} />
      </span>
      <span className="wn-poster__label">Watch Next</span>
    </div>
  )
}
