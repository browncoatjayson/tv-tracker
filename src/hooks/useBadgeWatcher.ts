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
  const trakt = useTraktAuth()

  // Re-check on account actions that only touch localStorage (export, sync,
  // Google connect) — Dexie live queries don't observe those.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    const evs = ['tvtracker:profile', 'tvtracker:trakt', 'tvtracker:badgecheck', 'storage']
    evs.forEach((e) => window.addEventListener(e, bump))
    return () => evs.forEach((e) => window.removeEventListener(e, bump))
  }, [])

  const toastedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!items || !states || !events || !earned) return

    const ctx = buildBadgeContext(items, states, events, trakt.signedIn)
    const met = evaluateBadges(ctx)
    const have = new Set(earned.map((b) => b.id))
    const newly = [...met].filter((id) => !have.has(id) && !toastedRef.current.has(id))

    // First-ever evaluation on this device: adopt whatever's already earned
    // silently (no flood), and mark primed even if nothing qualified yet — so a
    // brand-new user's *next* badge is the first one that actually celebrates.
    if (!isPrimed()) {
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
  }, [items, states, events, earned, trakt.signedIn, tick])
}
