import { applyBackup, buildBackup, mergeBackups, type BackupData } from './exportImport'

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

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const FILE_NAME = 'tvtracker-backup.json'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

// Remembers across reloads that the user has connected before, so we can try a
// silent (no-popup) token refresh on load.
const CONNECTED_KEY = 'tvtracker.driveConnected'

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

/**
 * Obtain an access token.
 * @param interactive true to allow the consent popup; false for a silent attempt
 *   (resolves only if the user already granted access this session/recently).
 */
async function getAccessToken(interactive: boolean): Promise<string> {
  if (!hasGoogleClientId()) {
    throw new Error('Missing Google client ID. Set VITE_GOOGLE_CLIENT_ID in .env.')
  }
  await loadGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google sign-in unavailable.')

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID as string,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token)
        else reject(new Error(resp.error || 'Authorization failed.'))
      },
      error_callback: (err) => reject(new Error(err.type || 'Authorization failed.')),
    })
    // prompt '' = reuse an existing grant silently; 'consent' = force the popup.
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' })
  })
}

// --- Drive REST helpers ------------------------------------------------------
async function findBackupFileId(token: string): Promise<string | null> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('spaces', 'appDataFolder')
  url.searchParams.set('fields', 'files(id,name)')
  url.searchParams.set('q', `name = '${FILE_NAME}'`)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Drive list failed (${res.status}).`)
  const data = (await res.json()) as { files?: { id: string }[] }
  return data.files?.[0]?.id ?? null
}

async function downloadBackup(token: string, fileId: string): Promise<BackupData> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive download failed (${res.status}).`)
  return (await res.json()) as BackupData
}

async function uploadBackup(
  token: string,
  data: BackupData,
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
  const metadata = { name: FILE_NAME, parents: ['appDataFolder'] }
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

  const fileId = await findBackupFileId(token)
  const local = await buildBackup()
  const remote = fileId ? await downloadBackup(token, fileId) : null

  const merged = remote ? mergeBackups(local, remote) : local

  // Only touch local/remote when the merge actually changed them (cheap guard).
  await applyBackup(merged, 'replace')
  await uploadBackup(token, merged, fileId)

  return {
    items: merged.trackedItems.length,
    episodes: merged.episodeStates.length,
    events: merged.watchEvents.length,
    syncedAt: Date.now(),
  }
}

/** Forget the connection (next sync will prompt again). Does not revoke on Google. */
export function disconnect(): void {
  rememberConnected(false)
}

export type DeleteRemoteResult = 'deleted' | 'none' | 'skipped'

/**
 * Delete the backup file from the user's Drive app folder. Returns 'skipped' if
 * Drive isn't configured, 'none' if there was nothing to delete. May prompt for
 * sign-in when interactive.
 */
export async function deleteRemoteBackup(interactive: boolean): Promise<DeleteRemoteResult> {
  if (!hasGoogleClientId()) return 'skipped'
  const token = await getAccessToken(interactive)
  const fileId = await findBackupFileId(token)
  if (!fileId) return 'none'
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // 404 means it's already gone — treat as success.
  if (!res.ok && res.status !== 404) throw new Error(`Drive delete failed (${res.status}).`)
  return 'deleted'
}
