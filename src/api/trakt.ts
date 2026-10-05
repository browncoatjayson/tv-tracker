// ---------------------------------------------------------------------------
// Trakt API client (reviews/comments, sign-in, watch-history sync).
//
// Reading comments needs only the client ID (public API key). Posting, liking,
// replying and syncing need a signed-in user, obtained via Trakt's OAuth
// *authorization-code flow with PKCE* — no client secret, no backend. We send
// the browser to Trakt, it redirects back with a code, and we exchange it using
// the PKCE verifier. The client ID lives in .env like the TMDB token.
// ---------------------------------------------------------------------------

const BASE = 'https://api.trakt.tv'
const AUTHORIZE_URL = 'https://trakt.tv/oauth/authorize'
const CLIENT_ID = import.meta.env.VITE_TRAKT_CLIENT_ID
const TOKEN_KEY = 'tvtracker.trakt'
const PKCE_KEY = 'tvtracker.trakt.pkce'
const LAST_SYNC_KEY = 'tvtracker.traktLastSync'

/** This app's OAuth redirect URI (its own base URL) — must be registered in the
 *  Trakt app settings exactly, including the trailing slash. */
export function getRedirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

/** Reviews can be *read* when a client ID is configured. */
export function hasTraktClientId(): boolean {
  return typeof CLIENT_ID === 'string' && CLIENT_ID.length > 0
}

/** PKCE needs no secret, so the client ID alone enables sign-in. */
export function canSignIn(): boolean {
  return hasTraktClientId()
}

function baseHeaders(accessToken?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': CLIENT_ID ?? '',
  }
  if (accessToken) h.Authorization = `Bearer ${accessToken}`
  return h
}

// --- Token storage -----------------------------------------------------------
interface StoredToken {
  access_token: string
  refresh_token: string
  expires_at: number // epoch ms
  username?: string
}

function readToken(): StoredToken | null {
  try {
    const v = localStorage.getItem(TOKEN_KEY)
    return v ? (JSON.parse(v) as StoredToken) : null
  } catch {
    return null
  }
}

function writeToken(token: StoredToken | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore storage errors
  }
  try {
    window.dispatchEvent(new CustomEvent('tvtracker:trakt'))
  } catch {
    // ignore
  }
}

export function isSignedIn(): boolean {
  return readToken() !== null
}

export function getTraktUsername(): string | undefined {
  return readToken()?.username
}

export function signOut(): void {
  writeToken(null)
  try {
    localStorage.removeItem(LAST_SYNC_KEY)
  } catch {
    // ignore
  }
}

/** When the user last pulled their Trakt watch history into the app. */
export function getTraktLastSync(): number | null {
  try {
    const v = localStorage.getItem(LAST_SYNC_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function setTraktLastSync(ms: number): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(ms))
  } catch {
    // ignore
  }
}

/** A valid access token, refreshing if near expiry. Null if not signed in. */
async function validAccessToken(): Promise<string | null> {
  const t = readToken()
  if (!t) return null
  if (Date.now() < t.expires_at - 60_000) return t.access_token
  // Refresh.
  try {
    const res = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({
        refresh_token: t.refresh_token,
        client_id: CLIENT_ID,
        redirect_uri: getRedirectUri(),
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) {
      writeToken(null)
      return null
    }
    const tok = (await res.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
      created_at: number
    }
    writeToken({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: (tok.created_at + tok.expires_in) * 1000,
      username: t.username,
    })
    return tok.access_token
  } catch {
    return null
  }
}

// --- PKCE sign-in (authorization-code flow) ----------------------------------
function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(digest)
}

/** Redirect the browser to Trakt to authorize this app (PKCE). */
export async function beginSignIn(): Promise<void> {
  if (!canSignIn()) throw new Error('Trakt sign-in is not configured.')
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const challenge = base64url(await sha256(verifier))
  try {
    localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }))
  } catch {
    // ignore
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID ?? '',
    redirect_uri: getRedirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`)
}

async function fetchUsername(accessToken: string): Promise<string | undefined> {
  try {
    const s = await fetch(`${BASE}/users/settings`, { headers: baseHeaders(accessToken) })
    if (!s.ok) return undefined
    const j = (await s.json()) as { user?: { username?: string } }
    return j.user?.username
  } catch {
    return undefined
  }
}

/**
 * If the current URL is an OAuth redirect (`?code=…`), exchange the code for a
 * token (PKCE). Cleans the code out of the URL either way. Returns true if a
 * sign-in completed. Call once on app startup.
 */
export async function completeSignInFromRedirect(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  if (!code) return false

  let saved: { verifier: string; state: string } | null = null
  try {
    const raw = localStorage.getItem(PKCE_KEY)
    saved = raw ? (JSON.parse(raw) as { verifier: string; state: string }) : null
  } catch {
    saved = null
  }
  const cleanUrl = `${window.location.pathname}${window.location.hash || '#/settings'}`

  if (!saved || saved.state !== state) {
    window.history.replaceState(null, '', cleanUrl)
    return false
  }

  try {
    const res = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({
        code,
        client_id: CLIENT_ID,
        redirect_uri: getRedirectUri(),
        code_verifier: saved.verifier,
        grant_type: 'authorization_code',
      }),
    })
    if (!res.ok) throw new Error(`Trakt sign-in failed (${res.status}).`)
    const tok = (await res.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
      created_at: number
    }
    const username = await fetchUsername(tok.access_token)
    writeToken({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: (tok.created_at + tok.expires_in) * 1000,
      username,
    })
    return true
  } finally {
    try {
      localStorage.removeItem(PKCE_KEY)
    } catch {
      // ignore
    }
    window.history.replaceState(null, '', cleanUrl)
  }
}

// --- Resolve a TMDB id to a Trakt id -----------------------------------------
export interface TraktRef {
  trakt: number
  slug: string
}

const refCache = new Map<string, TraktRef | null>()

export async function resolveTraktId(
  mediaType: 'movie' | 'show',
  tmdbId: number,
): Promise<TraktRef | null> {
  const type = mediaType === 'movie' ? 'movie' : 'show'
  const key = `${type}:${tmdbId}`
  const cached = refCache.get(key)
  if (cached !== undefined) return cached
  const res = await fetch(`${BASE}/search/tmdb/${tmdbId}?type=${type}`, { headers: baseHeaders() })
  if (!res.ok) throw new Error(`Trakt lookup failed (${res.status}).`)
  const arr = (await res.json()) as Array<Record<string, { ids?: { trakt: number; slug: string } }>>
  const hit = arr.find((x) => x[type]?.ids) ?? null
  const ids = hit?.[type]?.ids
  const ref = ids ? { trakt: ids.trakt, slug: ids.slug } : null
  refCache.set(key, ref)
  return ref
}

async function resolveEpisodeTraktId(
  showTrakt: number,
  season: number,
  episode: number,
): Promise<number | null> {
  const res = await fetch(`${BASE}/shows/${showTrakt}/seasons/${season}/episodes/${episode}`, {
    headers: baseHeaders(),
  })
  if (!res.ok) return null
  const ep = (await res.json()) as { ids?: { trakt: number } }
  return ep.ids?.trakt ?? null
}

// --- Comments / reviews ------------------------------------------------------
export interface TraktComment {
  id: number
  comment: string
  spoiler: boolean
  review: boolean
  replies: number
  likes: number
  user_rating: number | null
  created_at: string
  user: {
    username: string
    name?: string
    ids?: { slug: string }
    images?: { avatar?: { full?: string } }
  }
}

export interface ReviewTarget {
  mediaType: 'movie' | 'show'
  tmdbId: number
  /** For episode reviews. */
  season?: number
  episode?: number
}

export type CommentSort = 'likes' | 'newest'

export interface CommentsPage {
  comments: TraktComment[]
  pageCount: number
  page: number
}

function commentsPath(ref: TraktRef, target: ReviewTarget, sort: CommentSort): string {
  if (target.season != null && target.episode != null) {
    return `/shows/${ref.trakt}/seasons/${target.season}/episodes/${target.episode}/comments/${sort}`
  }
  return target.mediaType === 'movie'
    ? `/movies/${ref.trakt}/comments/${sort}`
    : `/shows/${ref.trakt}/comments/${sort}`
}

export async function getComments(
  target: ReviewTarget,
  sort: CommentSort,
  page: number,
  limit = 10,
): Promise<CommentsPage> {
  const ref = await resolveTraktId(target.mediaType, target.tmdbId)
  if (!ref) return { comments: [], pageCount: 0, page }
  const auth = await validAccessToken()
  const url = `${BASE}${commentsPath(ref, target, sort)}?page=${page}&limit=${limit}`
  const res = await fetch(url, { headers: baseHeaders(auth ?? undefined) })
  if (!res.ok) throw new Error(`Couldn't load reviews (${res.status}).`)
  const comments = (await res.json()) as TraktComment[]
  const pageCount = Number(res.headers.get('X-Pagination-Page-Count')) || 1
  return { comments, pageCount, page }
}

export async function getReplies(commentId: number): Promise<TraktComment[]> {
  const auth = await validAccessToken()
  const res = await fetch(`${BASE}/comments/${commentId}/replies`, {
    headers: baseHeaders(auth ?? undefined),
  })
  if (!res.ok) throw new Error(`Couldn't load replies (${res.status}).`)
  return (await res.json()) as TraktComment[]
}

/** Post a new comment/review on the target. Trakt requires at least 5 words. */
export async function postComment(
  target: ReviewTarget,
  comment: string,
  spoiler: boolean,
): Promise<TraktComment> {
  const auth = await validAccessToken()
  if (!auth) throw new Error('Sign in to Trakt to post.')
  const ref = await resolveTraktId(target.mediaType, target.tmdbId)
  if (!ref) throw new Error('Could not match this title on Trakt.')

  const body: Record<string, unknown> = { comment, spoiler }
  if (target.season != null && target.episode != null) {
    const epId = await resolveEpisodeTraktId(ref.trakt, target.season, target.episode)
    if (!epId) throw new Error('Could not match this episode on Trakt.')
    body.episode = { ids: { trakt: epId } }
  } else if (target.mediaType === 'movie') {
    body.movie = { ids: { trakt: ref.trakt } }
  } else {
    body.show = { ids: { trakt: ref.trakt } }
  }

  const res = await fetch(`${BASE}/comments`, {
    method: 'POST',
    headers: baseHeaders(auth),
    body: JSON.stringify(body),
  })
  if (res.status === 422) throw new Error('Your review needs at least 5 words.')
  if (!res.ok) throw new Error(`Couldn't post your review (${res.status}).`)
  return (await res.json()) as TraktComment
}

export async function postReply(
  commentId: number,
  comment: string,
  spoiler: boolean,
): Promise<TraktComment> {
  const auth = await validAccessToken()
  if (!auth) throw new Error('Sign in to Trakt to reply.')
  const res = await fetch(`${BASE}/comments/${commentId}/replies`, {
    method: 'POST',
    headers: baseHeaders(auth),
    body: JSON.stringify({ comment, spoiler }),
  })
  if (res.status === 422) throw new Error('Your reply needs at least 5 words.')
  if (!res.ok) throw new Error(`Couldn't post your reply (${res.status}).`)
  return (await res.json()) as TraktComment
}

export async function likeComment(commentId: number): Promise<void> {
  const auth = await validAccessToken()
  if (!auth) throw new Error('Sign in to Trakt to like.')
  const res = await fetch(`${BASE}/comments/${commentId}/like`, {
    method: 'POST',
    headers: baseHeaders(auth),
  })
  if (!res.ok && res.status !== 204) throw new Error(`Couldn't like (${res.status}).`)
}

export async function unlikeComment(commentId: number): Promise<void> {
  const auth = await validAccessToken()
  if (!auth) throw new Error('Sign in to Trakt to unlike.')
  const res = await fetch(`${BASE}/comments/${commentId}/like`, {
    method: 'DELETE',
    headers: baseHeaders(auth),
  })
  if (!res.ok && res.status !== 204) throw new Error(`Couldn't unlike (${res.status}).`)
}

// --- Watch-history sync + profile stats --------------------------------------

/** Pull the full watch history (newest-first, paged). Entries match the Trakt
 *  export format, so the existing Trakt file parser can consume them. */
export async function fetchWatchedHistory(): Promise<unknown[]> {
  const auth = await validAccessToken()
  if (!auth) throw new Error('Sign in to Trakt first.')
  const all: unknown[] = []
  let page = 1
  let pageCount = 1
  do {
    const res = await fetch(`${BASE}/sync/history?page=${page}&limit=1000`, {
      headers: baseHeaders(auth),
    })
    if (!res.ok) throw new Error(`Couldn't load your Trakt history (${res.status}).`)
    const data = (await res.json()) as unknown[]
    all.push(...data)
    pageCount = Number(res.headers.get('X-Pagination-Page-Count')) || 1
    page += 1
  } while (page <= pageCount && page <= 25) // safety cap (~25k events)
  return all
}

/** Record that a history sync just completed (for the stats page). */
export function recordTraktSync(): void {
  setTraktLastSync(Date.now())
}

export interface TraktStatBlock {
  plays?: number
  watched?: number
  minutes?: number
  collected?: number
  ratings?: number
  comments?: number
}

export interface TraktStats {
  movies?: TraktStatBlock
  shows?: TraktStatBlock
  seasons?: TraktStatBlock
  episodes?: TraktStatBlock
  ratings?: { total?: number }
}

/** The signed-in user's Trakt profile stats (watched counts, ratings, comments). */
export async function getTraktStats(): Promise<TraktStats> {
  const auth = await validAccessToken()
  if (!auth) throw new Error('Sign in to Trakt first.')
  const res = await fetch(`${BASE}/users/me/stats`, { headers: baseHeaders(auth) })
  if (!res.ok) throw new Error(`Couldn't load your Trakt stats (${res.status}).`)
  return (await res.json()) as TraktStats
}
