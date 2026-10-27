# TV Tracker — TMDB proxy worker

A tiny Cloudflare Worker that proxies the app's TMDB JSON calls so the TMDB
**Read Access Token** lives as a server-side secret instead of in the public app
bundle. It also caches responses at Cloudflare's edge, so repeated lookups
(shared across every visitor) hit TMDB far less often.

This is a **separate** worker from the push worker (`../worker`) so each can be
deployed, updated, or disabled on its own.

## What it does / doesn't do

- Adds `Authorization: Bearer <TMDB_TOKEN>` to each request, server-side.
- **GET only**, CORS restricted to `ALLOWED_ORIGINS`, and only the TMDB path
  prefixes the app uses are forwarded (`movie`, `tv`, `person`, `search`,
  `genre`, `trending`, `discover`, `find`, `credit`, `collection`, `watch`,
  `configuration`) — so it can't be used as an open TMDB proxy.
- Caches successful responses at the edge with per-endpoint TTLs (details ~1 day,
  trending ~6h, genres/providers ~7 days, search/discover ~1h).
- Does **not** proxy images — those need no token and the client loads them
  straight from `image.tmdb.org`.

## Deploy

```bash
cd worker-tmdb
npm i -g wrangler        # if you don't have it
wrangler login
wrangler secret put TMDB_TOKEN   # paste your TMDB v4 Read Access Token
wrangler deploy
```

`wrangler deploy` prints the worker URL, e.g.
`https://tvtracker-tmdb.<subdomain>.workers.dev`. Use that (optionally behind a
custom route/subdomain) as the app's `VITE_TMDB_PROXY`.

## Wire it into the app

Set `VITE_TMDB_PROXY` to the worker's base URL (no trailing path):

- **Local dev** (`.env`): leave it unset to call TMDB directly with
  `VITE_TMDB_TOKEN` (simplest for development), or set it to test the proxy.
- **Deploy** (GitHub Actions): add repo secret `VITE_TMDB_PROXY` and reference it
  in `.github/workflows/deploy.yml`. When set, the client talks only to the proxy
  and the TMDB token is no longer shipped in the bundle.

The client (`src/api/tmdb.ts`) uses the proxy when `VITE_TMDB_PROXY` is set and
otherwise falls back to a direct token call, so nothing breaks if it's absent.

## Updating the allowlist

If the app starts calling a new TMDB path, add its first segment to the `ALLOWED`
set in `src/index.js` and redeploy.
