import {
  applyBackup,
  buildBackup,
  episodeCacheCount,
  mergeBackups,
  putEpisodeCache,
  readEpisodeCache,
  type BackupData,
} from './exportImport'
import type { CachedEpisode } from './types'

// ---------------------------------------------------------------------------
// Google Drive sync, fully client-side.
//
// Auth: Google Identity Services (GIS) "token model" — we request a short-lived
// access token (~1h, no refresh token) for the `drive.appdata` scope. Data lives
// in the hidden per-app folder in the USER's Drive; we never run a server and
// never see the data. The OAuth client ID is public by design.
//
// Sync strategy: pull remote, merge with local (see mergeBackups), write the
// merged result back to both local DB and Drive so devices converge.
// ---------------------------------------------------------------------------

// drive.appdata to store the backup; userinfo.profile so we can show the user's
// Google name + avatar on the stats page / header.
const SCOPE =
  'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile'
// Two files: the small core backup (synced on every change) and the larger,
// regenerable episode cache (synced on its own, only when it has changed) — so a
// routine "mark watched" doesn't re-upload the whole episode cache.
const CORE_FILE = 'tvtracker-backup.json'
const CACHE_FILE = 'tvtracker-cache.json'
// Remembers the cache's row count at its last upload, so an unchanged cache
// isn't re-uploaded. (A disposable, regenerable cache — count is a good-enough
// change signal; a content change with the same count self-heals via reindex.)
const CACHE_SIG_KEY = 'tvtracker.cacheCount'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
// .trim() guards against a stray newline/space in the .env value or repo secret.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()

// Remembers across reloads that the user has connected before, so we can try a
// silent (no-popup) token refresh on load.
const CONNECTED_KEY = 'tvtracker.driveConnected'
const PROFILE_KEY = 'tvtracker.googleProfile'

export interface GoogleProfile {
  name?: string
  picture?: string
}

/** The signed-in Google user's name + avatar, if we've fetched them. */
export function getGoogleProfile(): GoogleProfile | null {
  try {
    const v = localStorage.getItem(PROFILE_KEY)
    return v ? (JSON.parse(v) as GoogleProfile) : null
  } catch {
    return null
  }
}

function setGoogleProfile(profile: GoogleProfile | null): void {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    else localStorage.removeItem(PROFILE_KEY)
  } catch {
    // ignore storage errors
  }
  // Let the header / stats page update immediately.
  try {
    window.dispatchEvent(new CustomEvent('tvtracker:profile'))
  } catch {
    // ignore (non-browser env)
  }
}

/** Best-effort: fetch the signed-in user's name + avatar. Never throws. */
async function fetchProfile(token: string): Promise<void> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = (await res.json()) as { name?: string; picture?: string }
    if (data.name || data.picture) setGoogleProfile({ name: data.name, picture: data.picture })
  } catch {
    // Profile is a nicety; ignore failures (e.g. scope not yet granted).
  }
}

export function hasGoogleClientId(): boolean {
  return typeof CLIENT_ID === 'string' && CLIENT_ID.length > 0
}

export function wasConnected(): boolean {
  try {
    return localStorage.getItem(CONNECTED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberConnected(connected: boolean): void {
  try {
    if (connected) localStorage.setItem(CONNECTED_KEY, '1')
    else localStorage.removeItem(CONNECTED_KEY)
  } catch {
    // Ignore storage errors (private mode, etc.).
  }
}

// --- Minimal GIS typings (only what we use) ---------------------------------
interface TokenResponse {
  access_token?: string
  /** Seconds until the token expires (~3600). */
  expires_in?: number
  error?: string
}
interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
  callback: (resp: TokenResponse) => void
}
interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    prompt?: string
    callback: (resp: TokenResponse) => void
    error_callback?: (err: { type?: string }) => void
  }) => TokenClient
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google sign-in.'))
    document.head.appendChild(script)
  })
  return gisPromise
}

// A GIS access token is valid ~1 hour and there's no refresh token in this flow,
// so we cache it in memory and reuse it — otherwise every change would request a
// new token (and prompt). Cleared on disconnect.
let cachedToken: { token: string; expiresAt: number } | null = null

/**
 * Obtain an access token, reusing a cached one until it expires.
 * @param interactive true to allow a sign-in/consent popup (a user clicked). When
 *   false we request silently (`prompt: 'none'`) and reject rather than pop UI —
 *   so a background sync never interrupts the user.
 */
async function getAccessToken(interactive: boolean): Promise<string> {
  if (!hasGoogleClientId()) {
    throw new Error('Missing Google client ID. Set VITE_GOOGLE_CLIENT_ID in .env.')
  }
  // Reuse a still-valid token — no GIS call, no popup.
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token

  await loadGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google sign-in unavailable.')

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID as string,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.access_token) {
          // Cache with a 1-minute safety margin before the real expiry.
          const ttl = (resp.expires_in ?? 3600) * 1000
          cachedToken = { token: resp.access_token, expiresAt: Date.now() + ttl - 60_000 }
          resolve(resp.access_token)
        } else reject(new Error(resp.error || 'Authorization failed.'))
      },
      error_callback: (err) => reject(new Error(err.type || 'Authorization failed.')),
    })
    // Interactive: '' reuses an existing grant (shows consent only if needed).
    // Silent: 'none' never shows UI — it just fails if interaction is required.
    client.requestAccessToken({ prompt: interactive ? '' : 'none' })
  })
}

// --- Drive REST helpers (generic over a file name) ---------------------------
async function findFileId(token: string, name: string): Promise<string | null> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('spaces', 'appDataFolder')
  url.searchParams.set('fields', 'files(id,name)')
  url.searchParams.set('q', `name = '${name}'`)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Drive list failed (${res.status}).`)
  const data = (await res.json()) as { files?: { id: string }[] }
  return data.files?.[0]?.id ?? null
}

async function downloadJson<T>(token: string, fileId: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive download failed (${res.status}).`)
  return (await res.json()) as T
}

async function uploadJson(
  token: string,
  data: unknown,
  name: string,
  fileId: string | null,
): Promise<string> {
  const content = JSON.stringify(data)
  if (fileId) {
    // Update existing file contents.
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: content,
      },
    )
    if (!res.ok) throw new Error(`Drive update failed (${res.status}).`)
    return fileId
  }
  // Create a new file in the appDataFolder (multipart: metadata + content).
  const boundary = `tvt${Date.now()}`
  const metadata = { name, parents: ['appDataFolder'] }
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    `${content}\r\n--${boundary}--`
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) throw new Error(`Drive create failed (${res.status}).`)
  const created = (await res.json()) as { id: string }
  return created.id
}

interface CacheFile {
  episodeCache: CachedEpisode[]
}

/**
 * Sync the episode-cache file. Pulls it into an empty local cache (so a restore
 * gets its index without reindexing), and uploads the local cache only when its
 * row count has changed since the last upload (it's large and regenerable, so we
 * avoid re-sending an unchanged copy). Best-effort: never throws.
 */
async function syncCache(token: string): Promise<void> {
  try {
    const localCount = await episodeCacheCount()
    const cacheId = await findFileId(token, CACHE_FILE)

    // Restore path: a fresh/empty local cache gets seeded from Drive.
    if (localCount === 0 && cacheId) {
      const remote = await downloadJson<CacheFile>(token, cacheId)
      await putEpisodeCache(remote.episodeCache ?? [])
      rememberCacheSig(remote.episodeCache?.length ?? 0)
      return
    }

    // Push path: only re-upload when the cache changed (or Drive has none yet).
    if (localCount === 0) return
    if (cacheId && localCount === readCacheSig()) return
    const rows = await readEpisodeCache()
    await uploadJson(token, { episodeCache: rows } satisfies CacheFile, CACHE_FILE, cacheId)
    rememberCacheSig(rows.length)
  } catch {
    // The cache is regenerable; a failed cache sync just means a restore may
    // reindex. Never let it fail the core sync.
  }
}

function readCacheSig(): number {
  try {
    return Number(localStorage.getItem(CACHE_SIG_KEY)) || -1
  } catch {
    return -1
  }
}
function rememberCacheSig(count: number): void {
  try {
    localStorage.setItem(CACHE_SIG_KEY, String(count))
  } catch {
    // ignore
  }
}

export interface SyncResult {
  items: number
  episodes: number
  events: number
  syncedAt: number
}

/**
 * Full sync: pull remote, merge with local, write the merged result to both the
 * local DB and Drive.
 * @param interactive whether a consent popup is allowed (true for a user click).
 */
export async function syncNow(interactive: boolean): Promise<SyncResult> {
  const token = await getAccessToken(interactive)
  rememberConnected(true)
  void fetchProfile(token)

  // Core data (small): pull, merge, apply locally, push. No episode cache here.
  const fileId = await findFileId(token, CORE_FILE)
  const local = await buildBackup(false)
  const remote = fileId ? await downloadJson<BackupData>(token, fileId) : null
  const merged = remote ? mergeBackups(local, remote) : local
  // apply with the merged cache (seeds the local cache when migrating from an
  // old single-file backup), but keep the uploaded CORE file cache-free.
  await applyBackup(merged, 'replace')
  await uploadJson(token, { ...merged, episodeCache: undefined }, CORE_FILE, fileId)

  // Episode cache (large, regenerable): its own file, synced only when changed.
  await syncCache(token)

  return {
    items: merged.trackedItems.length,
    episodes: merged.episodeStates.length,
    events: merged.watchEvents.length,
    syncedAt: Date.now(),
  }
}

const LAST_SYNCED_KEY = 'tvtracker.lastSynced'

/** Record a successful sync time (drives the "In the Cloud" badge + the "Last
 *  synced" labels) and nudge the badge watcher. */
export function recordSynced(at: number): void {
  try {
    localStorage.setItem(LAST_SYNCED_KEY, String(at))
    window.dispatchEvent(new Event('tvtracker:badgecheck'))
  } catch {
    // ignore storage errors
  }
}

/**
 * Background push used by auto-sync after a local change: pull + merge + upload
 * the CORE file only (never the large episode cache), silently, WITHOUT rewriting
 * the local DB — so it stays small and never disrupts the user. No-op unless Drive
 * is connected; the caller handles failures (an expired silent grant = "later").
 */
export async function autoSync(): Promise<void> {
  if (!hasGoogleClientId() || !wasConnected()) return
  const token = await getAccessToken(false) // silent only; throws if grant is gone
  const fileId = await findFileId(token, CORE_FILE)
  const local = await buildBackup(false)
  const remote = fileId ? await downloadJson<BackupData>(token, fileId) : null
  const merged = remote ? mergeBackups(local, remote) : local
  // Core file only — never carry the episode cache here (it has its own file).
  await uploadJson(token, { ...merged, episodeCache: undefined }, CORE_FILE, fileId)
  recordSynced(Date.now())
}

/** Forget the connection (next sync will prompt again). Does not revoke on Google. */
export function disconnect(): void {
  rememberConnected(false)
  setGoogleProfile(null)
  cachedToken = null
}

export type DeleteRemoteResult = 'deleted' | 'none' | 'skipped'

async function deleteFile(token: string, fileId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // 404 means it's already gone — treat as success.
  if (!res.ok && res.status !== 404) throw new Error(`Drive delete failed (${res.status}).`)
}

/**
 * Delete the backup files (core + episode cache) from the user's Drive app
 * folder. Returns 'skipped' if Drive isn't configured, 'none' if there was
 * nothing to delete. May prompt for sign-in when interactive.
 */
export async function deleteRemoteBackup(interactive: boolean): Promise<DeleteRemoteResult> {
  if (!hasGoogleClientId()) return 'skipped'
  const token = await getAccessToken(interactive)
  const [coreId, cacheId] = await Promise.all([
    findFileId(token, CORE_FILE),
    findFileId(token, CACHE_FILE),
  ])
  if (!coreId && !cacheId) return 'none'
  if (coreId) await deleteFile(token, coreId)
  if (cacheId) await deleteFile(token, cacheId)
  try {
    localStorage.removeItem(CACHE_SIG_KEY)
  } catch {
    // ignore
  }
  return 'deleted'
}
