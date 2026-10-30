# TV Tracker

A personal, offline-first replacement for TV Time. Track the shows, movies, and
sports you watch, keep your own ratings, and see what's coming up — with no
server database and no account required. Your data stays on your device and,
optionally, in your own Google Drive.

**Live:** [tvtracker.alteriorfantasy.com](https://tvtracker.alteriorfantasy.com)
· [About / landing page](https://tvtracker.alteriorfantasy.com/about.html)
· [Demo video](https://youtu.be/sRRo4-yAxcs)

- **Metadata:** [TMDB](https://www.themoviedb.org/) (movies, shows, episodes,
  cast, watch providers, images) via a Cloudflare proxy worker that keeps the
  API token server-side
- **Air times:** [TVmaze](https://www.tvmaze.com/) (local, per-episode air times)
- **Sports:** [ESPN](https://www.espn.com/)'s public (keyless) scoreboard API
  for teams, leagues, and fixtures
- **Reviews & sync:** [Trakt](https://trakt.tv/) (reviews/discussion on detail
  pages, plus optional history import)
- **Universes & franchises:** [Wikidata](https://www.wikidata.org/) for
  sequel / spin-off / shared-universe links
- **Outbound links:** [IMDb](https://www.imdb.com/) on detail pages
- **Storage:** IndexedDB on-device (via Dexie) + JSON export/import + optional
  Google Drive sync
- **Notifications:** optional Web Push ("airing soon") via a Cloudflare Worker,
  with an in-app fallback
- **Hosting:** static build on GitHub Pages behind a custom domain
- **Stack:** Vite · React 19 · TypeScript · React Router (HashRouter) ·
  TanStack Query · Dexie · vite-plugin-pwa

## Features

- **TV, movies & sports in one library.** Track series, films, and favorite
  teams side by side, each with full schedules and status (watching, completed,
  plan to watch, etc.).
- **Episode & season tracking.** Mark episodes watched, log rewatches, and let
  status advance automatically (watching → completed). Step through episodes with
  Prev/Next (across season boundaries), and edit the watched date with a picker
  that also accepts month- or year-only precision. Narrative specials (Christmas
  specials, anniversary episodes, …) are interleaved between the regular seasons
  by air date, while clips and behind-the-scenes extras go to a separate "Extras"
  tab.
- **Ratings & progress.** Rate anything on a 10-star scale (shown next to the
  community average) and pick up where you left off.
- **Upcoming tab.** "This Week", upcoming, and "Recently Aired" feeds with
  local air times — including episodes that just aired even while TMDB still
  lists them as the "next" episode.
- **Sports schedules.** Upcoming and recent games for the teams and leagues you
  follow.
- **Powerful filters.** Narrow the library by genre, year, language, cast, and
  streaming service — and exclude what you don't want. The filter box also
  accepts `genre:` and `service:` tokens (e.g. `genre:crime, service:hbo`).
- **Related & universes.** Jump between sequels, spin-offs, and shared universes
  that span movies and TV — grouped to a sensible size (e.g. an MCU film shows
  its phase, not all 100+ titles) from TMDB collections, keywords, and Wikidata.
- **Watch providers.** See where a title streams, with near-duplicate services
  merged (e.g. "Netflix" + "Netflix Standard") and cable-replacement/live-TV
  bundles (Fubo, Sling, etc.) filtered out.
- **Timeline & badges.** Browse your watch history as an agenda and earn
  milestone badges as you go.
- **Welcome screen.** On first launch with an empty library, a welcome dialog
  explains the app and offers returning users a one-click Drive restore or backup
  import. On later launches (once the Drive sign-in has lapsed for the session) a
  "Welcome Back! Log in to Drive" prompt lets you re-authorize with one tap;
  signing in shows a brief "Welcome Back!" toast to confirm you're signed in and
  ready.
- **Installable PWA.** Add it to your home screen or dock for a full-screen,
  offline-ready experience, with an update prompt when a new version ships and
  a request for persistent storage so browser cleanups don't wipe your library.
- **Private & offline-first.** No accounts, no server database. Everything
  lives in your browser unless you opt into Drive sync.

## Using the app

**Open it:** [tvtracker.alteriorfantasy.com](https://tvtracker.alteriorfantasy.com)

**1. Install it (recommended).** It works in any browser, but installing gives
you a home-screen icon, a full-screen app window, and offline access.

- **Chrome / Edge (desktop):** click the install icon at the right of the
  address bar, or the **⋮** menu → **Install TV Tracker**.
- **Chrome (Android):** **⋮** menu → **Install app** (or **Add to Home screen**).
- **iPhone / iPad:** open the site in **Safari**, tap the **Share** button, then
  **Add to Home Screen**. (iOS only installs web apps from Safari.)

**2. Build your library.** Use the **Search** tab to add shows, movies, and
sports teams. Open a title to track episodes/games, rate it, and jump to IMDb.
The **Upcoming** tab shows what's airing next (with local air times) and what
you recently missed.

**3. Import your history (optional).** Under **Settings → Import from another
tracker**, choose your source, **Merge** or **Replace**, and pick the file:

- **TV Time** — a `.zip` export (request it from TV Time).
- **Trakt** — a history `.json` export (re-import anytime; duplicates are skipped).

A large library takes a minute or two to match everything to TMDB. After a big
import, run **Settings → Build index** once so episode-name search covers your
whole back catalog.

**4. Sync across devices (optional).** **Settings → Connect Google Drive**
stores your data in a private, app-only folder (`drive.appdata` scope) in your
own Drive. Connect and sync on each device to merge them. See
[Google Drive sync](#google-drive-sync) below for how the per-session login
works.

**5. Notifications (optional).** **Settings → Notifications** can send
"airing soon" reminders. With a push worker configured these arrive even when
the app is closed; otherwise the app falls back to in-app notifications.

**6. Updating.** When a new version is deployed, a small "A new version is
available" prompt appears — tap **Reload** to get it.

## Google Drive sync

Sync is optional and uses Google Identity Services (GIS) with the
`drive.appdata` scope, so TV Tracker can only see its own private folder — never
the rest of your Drive.

- **Per-session login.** GIS issues short-lived access tokens (~1 hour) and does
  **not** provide a refresh token. The token is cached in memory and reused for
  silent background syncs, so you are not prompted to sign in every time you add
  a show or mark an episode. A fresh sign-in may be needed again after the token
  expires (roughly an hour) and the app reloads, or if third-party cookies are
  blocked. When that happens, a "Welcome Back! Log in to Drive" prompt appears on
  launch so you can re-authorize with one tap.
- **Sync on open and on change.** The app syncs silently when it opens (if you
  were connected) and auto-syncs shortly after you add/remove items, mark
  episodes or movies, or change status.
- **Two-file backup.** Your core library is stored in `tvtracker-backup.json`
  and the (larger, more volatile) episode cache in a separate
  `tvtracker-cache.json`, so frequent auto-syncs stay small.
- **What's backed up.** Tracked items, watch events, episode states, favorites,
  tombstones (so deletes propagate), earned badges, and the episode cache. The
  "Welcome Back!" entry is a per-session sign-in notification, not a real badge,
  so it's never synced.
- **Manual backup.** **Settings → Export / Import** writes or reads the same
  JSON locally, independent of Drive.

## Getting started (development)

```bash
npm install
cp .env.example .env     # then fill in your tokens (see below)
npm run dev
```

Open the printed localhost URL. Search won't return results until TMDB access is
configured, but the rest of the app (library, settings, backup/restore) works
without it.

### Environment variables

All variables are optional for a bare run, but each unlocks a feature. See
`.env.example` for the authoritative list and notes.

| Variable                  | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `VITE_TMDB_PROXY`         | URL of the TMDB proxy worker (keeps the token server-side; preferred).  |
| `VITE_TMDB_TOKEN`         | TMDB v4 Read Access Token, sent from the browser. Used only if no proxy. |
| `VITE_GOOGLE_CLIENT_ID`   | Google OAuth client ID for Drive sync (public by design).               |
| `VITE_TRAKT_CLIENT_ID`    | Enables reading Trakt reviews on detail pages.                          |
| `VITE_TRAKT_CLIENT_SECRET`| Enables Trakt sign-in (posting / liking / replying) via the device flow. |
| `VITE_VAPID_PUBLIC`       | VAPID public key for Web Push notifications.                            |
| `VITE_PUSH_API`           | URL of the deployed push worker.                                        |

For TMDB, use **one** of the two options: set `VITE_TMDB_PROXY` to a deployed
proxy (recommended for public deploys — the token never ships in the bundle), or
`VITE_TMDB_TOKEN` for simple local dev. Get a token from a free account at
themoviedb.org → **Settings → API** → create a Developer key → copy the **API
Read Access Token** (the long `eyJ...` value).

## Scripts

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Start the dev server                      |
| `npm run build`   | Type-check (`tsc -b`) and build to `dist/` |
| `npm run preview` | Preview the production build locally      |
| `npm run lint`    | Run oxlint                                |

## Project structure

```
src/
  api/
    tmdb.ts          TMDB client (auth/proxy, images, search, providers)
    tvmaze.ts        Per-episode air times
    espn.ts          Keyless sports scoreboard / schedules
    trakt.ts         Trakt reviews + OAuth device flow
    wikidata.ts      Franchise / shared-universe links
  data/
    types.ts         Domain types (TrackedItem, WatchEvent, EpisodeState, …)
    db.ts            Dexie (IndexedDB) schema + key helpers
    library.ts       All writes to user data go through here
    exportImport.ts  JSON backup / restore (versioned BackupData)
    driveSync.ts     Google Drive (GIS) auth, token caching, two-file sync
    autoSync.ts      Debounced auto-sync on library changes
    episodeCache.ts  Cached episode metadata (synced as its own Drive file)
    episodeIndex.ts  Episode-name search index
    badges.ts        Declarative badge registry + evaluation
    favorites.ts     Favorite people / services
    sports.ts        Sports data + sportPrefs.ts (followed teams/leagues)
    notifications.ts Local + push notification scheduling
    push.ts          Web Push subscription management
    traktSync.ts     Trakt history import/merge
    importers/       TV Time (.zip) and Trakt (.json) importers
  components/
    Layout.tsx       App shell + bottom tab nav (mounts the badge watcher)
    WelcomeScreen.tsx First-run / empty-library welcome + restore
    DriveSync.tsx, NotificationsSettings.tsx, …  Settings panels & UI
  hooks/
    useBadgeWatcher.ts  Awards badges and fires toasts as they're earned
    useTrackedItems.ts, useTraktAuth.ts, …        Data / auth hooks
  utils/             Air-time formatting, filtering, toasts, confirm dialogs
  views/             One component per route (Library, Search, Upcoming,
                     ShowDetail, MovieDetail, SportDetail, Timeline, Stats,
                     Settings, …)

public/
  about.html         Marketing / landing page (with the embedded demo video)
  privacy.html       Privacy policy
  terms.html         Terms of service (required for Google OAuth)
  attributions.html  Data-source credits + "how it was built" AI disclosure
  logos/             Service logos used on the attributions page
  CNAME              Custom domain for GitHub Pages
  app-icon.svg, favicon.svg, pwa-*.png, apple-touch-icon.png, notify-sw.js

worker-tmdb/         Cloudflare Worker: TMDB proxy (edge cache, token hidden)
worker/              Cloudflare Worker: Web Push delivery
```

Each Cloudflare Worker has its own `README.md` with deploy instructions
(`worker-tmdb/README.md`, `worker/README.md`).

## Deployment (GitHub Pages)

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes to Pages. One-time setup in the repo:

1. **Settings → Pages → Source:** GitHub Actions (custom domain set via the
   `public/CNAME` file → `tvtracker.alteriorfantasy.com`).
2. **Settings → Secrets and variables → Actions:** add the `VITE_*` secrets you
   use (at minimum `VITE_TMDB_PROXY` or `VITE_TMDB_TOKEN`) — they're read at
   build time.

The app uses `HashRouter`, so deep links work on Pages without extra rewrite
rules.
