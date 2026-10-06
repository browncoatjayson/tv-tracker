/**
 * A one-entry-wide group divider for wrapping card lists: a vertical-text label,
 * the group's count, and an optional "Hide" checkbox to collapse the group.
 * Sized to a single card so the cards keep their alignment. Shared by the Library
 * collapsed view and the Cast row.
 */
export default function SectionDivider({
  label,
  count,
  countNoun,
  hidden,
  onToggleHide,
  className,
}: {
  label: string
  count: number
  /** Optional unit after the count (singular), e.g. "Actor" → "6 Actors". */
  countNoun?: string
  hidden?: boolean
  onToggleHide?: (v: boolean) => void
  className?: string
}) {
  const countText = countNoun ? `${count} ${countNoun}${count === 1 ? '' : 's'}` : String(count)
  return (
    <div className={`section-divider${className ? ` ${className}` : ''}`} role="separator" aria-label={label}>
      <span className="section-divider__label">{label}</span>
      <span className="section-divider__meta">
        <span className="section-divider__count">{countText}</span>
        {onToggleHide && (
          <label className="section-divider__hide">
            <input
              type="checkbox"
              checked={!!hidden}
              onChange={(e) => onToggleHide(e.target.checked)}
            />
            Hide
          </label>
        )}
      </span>
    </div>
  )
}
