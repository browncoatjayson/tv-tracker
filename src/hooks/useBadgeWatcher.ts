import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../data/db'
import {
  awardBadges,
  badgeById,
  buildBadgeContext,
  evaluateBadges,
} from '../data/badges'
import { showBadgeSummaryToast, showBadgeToast } from '../utils/badgeToast'
import { useTraktAuth } from './useTraktAuth'

// Once this many badges land at once (e.g. a big import or first adoption on a
// loaded library) we show one summary toast instead of a confetti storm.
const SUMMARY_THRESHOLD = 3
const PRIMED_KEY = 'tvtracker.badges.primed'

function isPrimed(): boolean {
  try {
    return localStorage.getItem(PRIMED_KEY) === '1'
  } catch {
    return true // if storage is unavailable, don't spam toasts
  }
}
function setPrimed(): void {
  try {
    localStorage.setItem(PRIMED_KEY, '1')
  } catch {
    // ignore
  }
}

// --- Restore / reset toast suppression ---------------------------------------
// A Drive restore, backup import, or account reset writes to Dexie in several
// steps, so the watcher below re-evaluates many times as data streams in. The old
// one-shot "clear primed" trick only silenced the FIRST of those evaluations, so
// every one after it toasted the newly-qualified badges — the "4, then 6, then 8"
// flood on sign-in, and the stray set on reset. Instead we bracket the whole
// operation: while suppression is active, met badges are adopted silently, and a
// short tail after endBadgeSuppression() covers Dexie's async live-query callbacks
// that fire just after the final write. "Welcome Back!" is unaffected — the
// restore flow toasts it explicitly, not through this watcher.
let suppressed = false
let suppressTimer: ReturnType<typeof setTimeout> | null = null

/** Start silently adopting earned badges (no toasts). Pair with
 *  endBadgeSuppression() in a finally, around a bulk restore/import/reset. */
export function beginBadgeSuppression(): void {
  suppressed = true
  if (suppressTimer) {
    clearTimeout(suppressTimer)
    suppressTimer = null
  }
}

/** Stop suppressing after a short tail, long enough for the live-query callbacks
 *  from the operation's last write to land (and be adopted silently). */
export function endBadgeSuppression(tailMs = 2500): void {
  if (suppressTimer) clearTimeout(suppressTimer)
  suppressTimer = setTimeout(() => {
    suppressed = false
    suppressTimer = null
  }, tailMs)
}

function isSuppressed(): boolean {
  return suppressed
}

/**
 * Watches the library + account flags and awards badges as they're earned,
 * firing a confetti toast for each. Mount once (in Layout).
 *
 * The first run on a device "primes" silently: a user adopting the feature with
 * an already-full library gets their due badges without a flood of toasts. After
 * that, each newly-met badge celebrates. A session-level guard (toastedRef)
 * avoids a double toast between awarding and the live query catching up.
 */
export function useBadgeWatcher(): void {
  const items = useLiveQuery(() => db.trackedItems.toArray(), [])
  const states = useLiveQuery(() => db.episodeStates.toArray(), [])
  const events = useLiveQuery(() => db.watchEvents.toArray(), [])
  const earned = useLiveQuery(() => db.badges.toArray(), [])
  const favPeople = useLiveQuery(() => db.favoritePeople.filter((p) => !p.removed).count(), [])
  const favServices = useLiveQuery(() => db.favoriteServices.filter((s) => !s.removed).count(), [])
  const trakt = useTraktAuth()

  // Re-check on account actions that only touch localStorage (export, sync,
  // Google connect, notifications, first-run flags) — Dexie live queries don't
  // observe those.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    const evs = [
      'tvtracker:profile',
      'tvtracker:trakt',
      'tvtracker:badgecheck',
      'tvtracker:notify',
      'storage',
    ]
    evs.forEach((e) => window.addEventListener(e, bump))
    return () => evs.forEach((e) => window.removeEventListener(e, bump))
  }, [])

  const toastedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!items || !states || !events || !earned) return

    const ctx = buildBadgeContext(items, states, events, trakt.signedIn, {
      favoritePeople: favPeople ?? 0,
      favoriteServices: favServices ?? 0,
    })
    const met = evaluateBadges(ctx)
    const have = new Set(earned.map((b) => b.id))
    const newly = [...met].filter((id) => !have.has(id) && !toastedRef.current.has(id))

    // Adopt silently (no toast) on the first-ever evaluation on this device (a
    // user adopting the feature with a full library) OR while a restore/import/
    // reset is in progress. Either way the badges are still recorded, so they
    // won't re-celebrate once normal evaluation resumes.
    if (!isPrimed() || isSuppressed()) {
      setPrimed()
      if (newly.length) {
        newly.forEach((id) => toastedRef.current.add(id))
        void awardBadges(newly)
      }
      return
    }

    if (newly.length === 0) return
    newly.forEach((id) => toastedRef.current.add(id))
    void awardBadges(newly)

    if (newly.length > SUMMARY_THRESHOLD) {
      showBadgeSummaryToast(newly.length)
    } else {
      for (const id of newly) {
        const b = badgeById(id)
        if (b) showBadgeToast(b)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, states, events, earned, favPeople, favServices, trakt.signedIn, tick])
}
