import { autoSync, hasGoogleClientId, wasConnected } from './driveSync'

// ---------------------------------------------------------------------------
// Debounced background sync. Library mutations (add, mark watched, status
// change, rate, remove) call scheduleAutoSync() so a connected user's changes
// are pushed to Drive shortly after — without losing anything if they clear
// their browser data between sessions. It's best-effort and never throws into
// the caller: a mutation always succeeds locally first.
// ---------------------------------------------------------------------------

const DEFAULT_DELAY = 6000

let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let queuedWhileRunning = false

/** Queue a background push to Drive (coalesces rapid changes). No-op unless the
 *  user has connected Drive. */
export function scheduleAutoSync(delayMs = DEFAULT_DELAY): void {
  if (typeof window === 'undefined') return
  if (!hasGoogleClientId() || !wasConnected()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(fire, delayMs)
}

async function fire(): Promise<void> {
  timer = undefined
  if (running) {
    // A change landed mid-sync — run once more after this finishes.
    queuedWhileRunning = true
    return
  }
  running = true
  try {
    await autoSync()
  } catch {
    // Silent: a failed auto-sync (e.g. offline, or the silent grant expired)
    // just means the change syncs on the next successful sync.
  } finally {
    running = false
    if (queuedWhileRunning) {
      queuedWhileRunning = false
      scheduleAutoSync(2000)
    }
  }
}
