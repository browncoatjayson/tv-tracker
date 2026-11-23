# tvtracker-music (Cloudflare Worker)

One proxy for every music-data source the app uses, routed by the first path
segment:

```
/musicbrainz/release-group/<id>   -> MusicBrainz release-group
/musicbrainz/release/<id>         -> MusicBrainz release (tracklist)
# /tunefind/… and /whatsong/… slot in later (see SOURCES in src/index.js)
```

**Why:** MusicBrainz expects a descriptive `User-Agent`, which a browser can't set
(forbidden header), and it 503-throttles browser clients hard — so direct calls
fail under any burst. The worker adds it server-side, where MusicBrainz grants the
normal rate allowance. The future keyed sources (Tunefind / WhatSong via RapidAPI)
will live here too, so their API keys never reach the client.

GET only, CORS restricted to `ALLOWED_ORIGINS`, and each source whitelists exactly
the endpoints the app uses.

## Deploy

```bash
cd worker-music
npx wrangler deploy
```

Then point the app at it in `.env`:

```
VITE_MUSIC_PROXY=https://tvtracker-music.<your-subdomain>.workers.dev/
```

With no proxy set, the app calls MusicBrainz directly (works at low volume,
throttled harder).

## Adding a source later (Tunefind / WhatSong)

1. Add an entry to `SOURCES` in `src/index.js` — its `base`, allowed `endpoints`,
   `headers(env)` (read the key from `env`), and a `ttl`.
2. `wrangler secret put <KEY_NAME>`.
3. Call it from the client as `${VITE_MUSIC_PROXY}/<source>/<endpoint>/…`.

## Caching note

`caches.default` (the shared edge cache) is a **no-op on `*.workers.dev`** — it
only persists on a custom domain / route in a zone you own (same as the Trakt
worker). So on `workers.dev` each client still fetches per-view; the app's own
`titleMeta` cache (synced across a user's devices via the extras file) is what
avoids re-querying.

## Local test

```bash
npx wrangler dev          # serves on http://localhost:8787
# then run the app with VITE_MUSIC_PROXY=http://localhost:8787
```
