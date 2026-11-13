// ---------------------------------------------------------------------------
// User profile customization images: an avatar (used app-wide, overrides the
// Google photo) and a Stats-page backdrop. Stored locally as base64 data URLs,
// separate from the core backup (they'll ride along in the lists/extras sync
// file later). Writes dispatch the existing 'tvtracker:profile' event so the
// header avatar and Stats page update immediately.
// ---------------------------------------------------------------------------

import type { ProfileData } from './types'

const AVATAR_KEY = 'tvtracker.profileAvatar'
const BACKDROP_KEY = 'tvtracker.profileBackdrop'
const NAME_KEY = 'tvtracker.profileName'
const WATCHNEXT_KEY = 'tvtracker.watchNextFav'
const TS_KEY = 'tvtracker.profileUpdatedAt'

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) || undefined
  } catch {
    return undefined
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new CustomEvent('tvtracker:profile'))
  } catch {
    // ignore (non-browser env)
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
    localStorage.setItem(TS_KEY, String(Date.now())) // bump for last-write-wins
  } catch {
    // ignore storage errors (private mode, quota)
  }
  notify()
}

/** Snapshot of the profile customization (for the backup / extras sync). */
export function getProfileData(): ProfileData {
  return {
    avatar: read(AVATAR_KEY),
    backdrop: read(BACKDROP_KEY),
    name: read(NAME_KEY),
    watchNext: read(WATCHNEXT_KEY) === '1' || undefined,
    updatedAt: Number(read(TS_KEY)) || 0,
  }
}

/** Overwrite the local profile from an incoming one (sync/import), keeping its
 *  updatedAt as-is (no re-bump) so the timestamp reflects the true last write. */
export function applyProfileData(p: ProfileData): void {
  try {
    if (p.avatar) localStorage.setItem(AVATAR_KEY, p.avatar)
    else localStorage.removeItem(AVATAR_KEY)
    if (p.backdrop) localStorage.setItem(BACKDROP_KEY, p.backdrop)
    else localStorage.removeItem(BACKDROP_KEY)
    if (p.name) localStorage.setItem(NAME_KEY, p.name)
    else localStorage.removeItem(NAME_KEY)
    if (p.watchNext) localStorage.setItem(WATCHNEXT_KEY, '1')
    else localStorage.removeItem(WATCHNEXT_KEY)
    localStorage.setItem(TS_KEY, String(p.updatedAt))
  } catch {
    // ignore storage errors
  }
  notify()
}

/** The user's custom avatar (overrides the Google photo everywhere). */
export function getProfileAvatar(): string | undefined {
  return read(AVATAR_KEY)
}
/** The user's Stats-page backdrop. */
export function getProfileBackdrop(): string | undefined {
  return read(BACKDROP_KEY)
}
export function setProfileAvatar(value: string | null): void {
  write(AVATAR_KEY, value)
}
export function setProfileBackdrop(value: string | null): void {
  write(BACKDROP_KEY, value)
}

/** The user's custom display name (overrides the Google name on the Stats page). */
export function getProfileName(): string | undefined {
  return read(NAME_KEY)
}
export function setProfileName(value: string | null): void {
  write(NAME_KEY, value)
}

/** Whether the "Watch Next" shuffle shortcut is pinned to Library Favorites. */
export function getWatchNextFav(): boolean {
  return read(WATCHNEXT_KEY) === '1'
}
export function setWatchNextFav(on: boolean): void {
  write(WATCHNEXT_KEY, on ? '1' : null)
}

/** Remove all profile customization (used by the account reset). */
export function clearProfileData(): void {
  try {
    localStorage.removeItem(AVATAR_KEY)
    localStorage.removeItem(BACKDROP_KEY)
    localStorage.removeItem(NAME_KEY)
    localStorage.removeItem(WATCHNEXT_KEY)
    localStorage.removeItem(TS_KEY)
  } catch {
    // ignore
  }
  notify()
}
