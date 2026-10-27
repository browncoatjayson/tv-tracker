// A tiny promise-free pub/sub for badge-earned toasts, mirroring utils/confirm.
// The watcher calls show*(); <BadgeToastHost/> (mounted once in Layout) renders
// them with a confetti burst. Callable from non-React code.

import type { BadgeDef } from '../data/badges'

export interface BadgeToast {
  id: number
  /** A single earned badge, or … */
  badge?: BadgeDef
  /** … a summary when several were earned at once (e.g. after an import). */
  count?: number
  /** When the badge was earned — shown in a review toast. */
  earnedAt?: number
  /** A re-shown toast (from tapping a badge): stays until OK / click-outside,
   *  instead of auto-dismissing like a freshly-earned celebration. */
  review?: boolean
}

type Listener = (t: BadgeToast) => void

let listener: Listener | null = null
let seq = 0

/** Registered by the mounted BadgeToastHost; internal. */
export function _setBadgeToastListener(l: Listener | null): void {
  listener = l
}

/** Celebrate one newly-earned badge. */
export function showBadgeToast(badge: BadgeDef): void {
  listener?.({ id: ++seq, badge })
}

/** Celebrate a batch (e.g. several badges cleared by one import). */
export function showBadgeSummaryToast(count: number): void {
  listener?.({ id: ++seq, count })
}

/** Re-show an already-earned badge's toast as a notification (tapping it on the
 *  Stats page). Stays up until the user dismisses it. */
export function reviewBadgeToast(badge: BadgeDef, earnedAt?: number): void {
  listener?.({ id: ++seq, badge, earnedAt, review: true })
}
