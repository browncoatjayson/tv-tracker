# TV Tracker — Trakt proxy worker

A tiny Cloudflare Worker that proxies the app's **public** Trakt read calls (the
TMDB→Trakt id lookup and episode air times used by the background indexer).

Going direct to `api.trakt.tv` requires the `trakt-api-key` / `trakt-api-version`
headers, which are **not** CORS-"simple" — so the browser fires a **preflight**
`OPTIONS` before every call. That doubled the request count and, under the
indexer's burst, made Trakt's rate-limit (429) responses show up as opaque
**"CORS errors"** in the browser. This worker removes the preflight (the client
calls it with a simple GET; the key/version are added server-side) and caches
responses at Cloudflare's edge, so repeat lookups hit Trakt far less often.

This is a **separate** worker from the TMDB proxy (`../worker-tmdb`) and the push
worker (`../worker`), so each can be deployed, updated, or disabled on its own.

## What it does / doesn't do

- Adds `trakt-api-key` + `trakt-api-version` to each request, server-side.
- **GET only**, CORS restricted to `ALLOWED_ORIGINS`, and only the public read
  path prefixes the app uses are forwarded (`search`, `shows`, `movies`) — so it
  can't be used as an open Trakt proxy.
- Caches successful responses at the edge (id lookups ~7 days, air times ~1 day).
- Passes a 429's `Retry-After` through and returns it **with CORS headers**, so
  the client retries cleanly instead of seeing a CORS failure.
- Does **not** proxy authed endpoints — sign-in (`/oauth`), settings/stats
  (`/users`), history (`/sync`), or comments. Those stay direct from the client
  so no user access token ever passes through this shared-cache proxy.

## Deploy

```bash
cd worker-trakt
npm i -g wrangler                 # if you don't have it
wrangler login
wrangler secret put TRAKT_CLIENT_ID   # paste your Trakt app's Client ID
wrangler deploy
```

`wrangler deploy` prints the worker URL, e.g.
`https://tvtracker-trakt.<subdomain>.workers.dev`. Use that as the app's
`VITE_TRAKT_PROXY`.

## Wire it into the app

Set `VITE_TRAKT_PROXY` to the worker's base URL (a trailing slash is fine):

- **Local dev** (`.env`): leave it unset to call Trakt directly (the client still
  paces requests and retries 429s), or set it to test the proxy.
- **Deploy** (GitHub Actions): add repo secret `VITE_TRAKT_PROXY` and reference it
  in `.github/workflows/deploy.yml`.

The client (`src/api/trakt.ts`) uses the proxy for public reads when
`VITE_TRAKT_PROXY` is set and otherwise falls back to a direct call, so nothing
breaks if it's absent. Sign-in and other authed calls always go direct.

## Updating the allowlist

If the app starts routing a new **public** Trakt path through `traktFetch`, add
its first segment to the `ALLOWED` set in `src/index.js` and redeploy. Never add
authed namespaces (`oauth`, `users`, `sync`, `comments`) — those must not be
cached by a shared proxy.
