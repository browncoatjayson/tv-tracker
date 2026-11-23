// ---------------------------------------------------------------------------
// MusicBrainz client (keyless, CORS-friendly) for a movie's official soundtrack
// album tracklist. We reach it via Wikidata: a film's "soundtrack release"
// (P406) entity carries the MusicBrainz release-group id (P436), which we then
// expand to a tracklist here.
//
// Scope note: this is the released soundtrack ALBUM (score + any songs that made
// the album), NOT every licensed needle-drop in the film and not per-scene/
// per-episode data — that richer "songs in this scene" info needs Tunefind /
// WhatSong (added later behind the Cloudflare worker). Every call fails soft.
// ---------------------------------------------------------------------------

// Prefer the shared music proxy worker (VITE_MUSIC_PROXY): it adds the descriptive
// User-Agent MusicBrainz wants — which a browser can't set — so it isn't
// 503-throttled under load. The worker routes by source, so MusicBrainz lives
// under /musicbrainz (Tunefind/WhatSong will get their own prefixes later). With
// no proxy configured we call MusicBrainz directly, which works at low volume but
// is throttled harder.
const PROXY = import.meta.env.VITE_MUSIC_PROXY?.trim().replace(/\/+$/, '') || undefined
const MB = PROXY ? `${PROXY}/musicbrainz` : 'https://musicbrainz.org/ws/2'
// MusicBrainz asks clients to stay under ~1 request/second; going over earns a
// 503. Whether direct or proxied, we serialize requests and space them out, with
// one retry on a 503.
const MIN_GAP_MS = 1100

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** fetch that gives up after `ms` so a slow MusicBrainz can't hang a page. */
async function fetchSoft(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// A one-at-a-time gate: each request waits for the previous one, then the gate is
// held ~1.1s after it finishes so the next is comfortably spaced.
let gate: Promise<void> = Promise.resolve()

async function mbGet<T>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${MB}${path}${sep}fmt=json`
  const myTurn = gate
  let release!: () => void
  gate = new Promise<void>((r) => (release = r))
  await myTurn
  try {
    let res = await fetchSoft(url)
    if (res.status === 503) {
      await delay(2000) // rate-limited — back off and try once more
      res = await fetchSoft(url)
    }
    if (!res.ok) throw new Error(`MusicBrainz request failed (${res.status})`)
    return (await res.json()) as T
  } finally {
    void delay(MIN_GAP_MS).then(release)
  }
}

export interface SoundtrackTrack {
  title: string
  artist?: string
}

interface MbArtistCredit {
  name: string
}
interface MbTrack {
  title?: string
  recording?: { title?: string; 'artist-credit'?: MbArtistCredit[] }
  'artist-credit'?: MbArtistCredit[]
}
interface MbMedium {
  tracks?: MbTrack[]
}
interface MbRelease {
  id: string
  status?: string
  media?: MbMedium[]
}
interface MbReleaseGroup {
  releases?: MbRelease[]
}

function artistOf(t: MbTrack): string | undefined {
  const credit = t['artist-credit'] ?? t.recording?.['artist-credit'] ?? []
  const name = credit
    .map((c) => c.name)
    .filter(Boolean)
    .join(', ')
  return name || undefined
}

/**
 * The tracklist of a soundtrack by its MusicBrainz release-group id. Picks one
 * release from the group (an Official one when available) and reads its tracks.
 * Errors propagate so a transient failure isn't cached as "no soundtrack"; a
 * group with no usable release returns [].
 */
export async function getSoundtrackTracks(releaseGroupId: string): Promise<SoundtrackTrack[]> {
  const id = releaseGroupId.trim()
  if (!id) return []
  const group = await mbGet<MbReleaseGroup>(`/release-group/${id}?inc=releases`)
  const releases = group.releases ?? []
  if (!releases.length) return []
  const chosen = releases.find((r) => r.status === 'Official') ?? releases[0]
  const full = await mbGet<MbRelease>(`/release/${chosen.id}?inc=recordings+artist-credits`)
  const tracks: SoundtrackTrack[] = []
  for (const medium of full.media ?? []) {
    for (const t of medium.tracks ?? []) {
      const title = t.title || t.recording?.title
      if (title) tracks.push({ title, artist: artistOf(t) })
    }
  }
  return tracks
}
