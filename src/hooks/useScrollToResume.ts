import { useEffect, useRef } from 'react'

/**
 * Horizontally scroll a card row to its "resume" card — the one marked with a
 * `data-resume` attribute (the next unwatched episode / game) — once its contents
 * have loaded. Useful for long season/schedule rows (20+ episodes, a sports
 * season) so opening a show or team lands on where you left off instead of the
 * start of the list.
 *
 * It only ever adjusts the ROW's own horizontal scroll, never the page's vertical
 * scroll, so it doesn't jump the page down to the row. It runs a single time, on
 * the first render where `ready` is true (so marking episodes watched, or the user
 * scrolling the row, won't yank it back). Because the row loads asynchronously,
 * pass `ready` as the signal that the cards are in the DOM (e.g. the season query
 * resolved); the hook then scrolls on that delayed load.
 *
 * @param ready true once the row's cards (including the `data-resume` one, if any)
 *   are rendered. Scrolling happens on the first `ready` tick and not again.
 * @returns a ref to attach to the scrollable row element.
 */
export function useScrollToResume<T extends HTMLElement>(ready: boolean) {
  const rowRef = useRef<T>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    if (doneRef.current || !ready) return
    const row = rowRef.current
    if (!row) return
    doneRef.current = true
    const target = row.querySelector<HTMLElement>('[data-resume]')
    // No resume card (everything watched, or nothing marked) → leave at the start.
    if (!target) return
    // Position the resume card a small gutter in from the row's left edge, moving
    // only the row's horizontal scroll (scrollLeft clamps itself to valid range).
    const t = target.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    row.scrollLeft += t.left - r.left - 16
  }, [ready])

  return rowRef
}
