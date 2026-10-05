/**
 * Placeholder for the Reviews feature (coming later). Rendered at the bottom of
 * the movie, show, and episode detail screens so the layout slot exists before
 * we build the real reviews UX. Uses a native <details> so it's collapsible and
 * accessible with no extra state.
 */
export default function ReviewsPlaceholder() {
  return (
    <details className="reviews">
      <summary className="reviews__summary">
        Reviews <span className="reviews__soon">Coming soon</span>
      </summary>
      <div className="reviews__body">
        <p className="muted">
          Reader reviews and your own notes will live here. This section is a placeholder while we
          design it — nothing to see yet.
        </p>
      </div>
    </details>
  )
}
