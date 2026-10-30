// ---------------------------------------------------------------------------
// Per-device "first time you did X" flags, used by the App-section badges
// (opened Stats, opened Timeline, ran a Search, dismissed the Welcome screen).
//
// These are one-way latches in localStorage: set once, never cleared. They're
// device-local and NOT part of a backup — the matching badge, once earned, is
// what syncs. buildBadgeContext reads them; marking one nudges the badge watcher.
// ---------------------------------------------------------------------------

export type AppFlag = 'welcomed' | 'openedStats' | 'openedTimeline' | 'searched'

const PREFIX = 'tvtracker.flag.'

export function getFlag(flag: AppFlag): boolean {
  try {
    return localStorage.getItem(PREFIX + flag) === '1'
  } catch {
    return false
  }
}

/** Latch a flag on (idempotent) and re-check badges. No-op if already set. */
export function markFlag(flag: AppFlag): void {
  try {
    if (localStorage.getItem(PREFIX + flag) === '1') return
    localStorage.setItem(PREFIX + flag, '1')
  } catch {
    // ignore (private mode / blocked storage)
  }
  // The badge watcher doesn't observe localStorage within the same tab, so ping it.
  try {
    window.dispatchEvent(new Event('tvtracker:badgecheck'))
  } catch {
    // ignore (non-browser env)
  }
}
