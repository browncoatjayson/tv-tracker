# TV Tracker v1.0.0 — First public release 🎉

A personal, offline-first replacement for TV Time. Track the shows, movies, and
sports you watch, keep your own ratings, and see what's coming up — **no account,
no server database.** Your data lives on your device and, optionally, in your own
Google Drive.

**▶ Try it:** [tvtracker.alteriorfantasy.com](https://tvtracker.alteriorfantasy.com)
 · [About](https://tvtracker.alteriorfantasy.com/about.html)
 · [Demo video](https://youtu.be/sRRo4-yAxcs)

---

## Highlights

- **One library for TV, movies & sports.** Track series, films, and favorite
  teams side by side, each with full schedules and status (watching, completed,
  plan to watch, …).
- **Episode & season tracking.** Mark episodes watched, log rewatches, and let
  status advance automatically (watching → completed). Step through episodes with
  Prev/Next across season boundaries, and set the watched date with a picker that
  also accepts month- or year-only precision.
- **Skip episodes.** Mark an episode — or a whole season's worth — as *skipped*
  for the ones you'll never watch: it drops off your watchlist without counting
  toward your watched stats, and can be switched back to watched or unwatched
  anytime.
- **Specials, sorted.** Narrative specials (Christmas specials, anniversary
  episodes, …) are interleaved between seasons by air date, while clips and
  behind-the-scenes extras go to their own "Extras" tab.
- **Upcoming tab.** "This Week", upcoming, and "Recently Aired" feeds with local
  air times — including episodes that just aired even while TMDB still lists them
  as the "next" episode.
- **Sports schedules.** Upcoming and recent games for the teams and leagues you
  follow.
- **Ratings & progress.** Rate anything on a 10-star scale (shown next to the
  community average) and pick up where you left off.
- **Powerful filters.** Narrow the library by genre, year, language, cast, and
  streaming service — and exclude what you don't want. Also accepts `genre:` and
  `service:` tokens (e.g. `genre:crime, service:hbo`).
- **Related & universes.** Jump between sequels, spin-offs, and shared universes
  that span movies and TV — grouped to a sensible size (e.g. an MCU film shows
  its phase, not all 100+ titles) from TMDB collections, keywords, and Wikidata.
- **Watch providers.** See where a title streams, with near-duplicate services
  merged and cable-replacement/live-TV bundles filtered out.
- **Timeline & badges.** Browse your watch history as an agenda and earn
  milestone badges as you go.
- **"Airing soon" notifications.** Optional Web Push reminders before an episode
  airs, with an in-app fallback where background push isn't available.

## Private & offline-first

- No accounts and no server database — everything lives in your browser
  (IndexedDB) unless you opt in to sync.
- **Optional Google Drive sync** backs up your library to your own Drive app
  folder; sign-in is per session, and the app remembers your account so re-linking
  skips the account chooser.
- **JSON export/import** and an optional **Trakt history import** for moving data
  in and out.

## Installable PWA

Add it to your home screen or dock for a full-screen, offline-ready experience,
with an update prompt when a new version ships and a request for persistent
storage so browser cleanups don't wipe your library.

- **Chrome / Edge (desktop):** install icon in the address bar, or **⋮ → Install
  TV Tracker**.
- **Chrome (Android):** **⋮ → Install app**.
- **iPhone / iPad:** open in **Safari**, **Share → Add to Home Screen**.

## Data sources

TMDB (metadata & images) · TVmaze (per-episode air times) · ESPN (sports) ·
Trakt (reviews & optional history import) · Wikidata (franchise links) · IMDb
(outbound links).

## Under the hood

Vite · React 19 · TypeScript · React Router (HashRouter) · TanStack Query ·
Dexie · vite-plugin-pwa. Static build on GitHub Pages behind a custom domain;
the TMDB token stays server-side behind a Cloudflare proxy worker.

---

*This is the first public release — feedback and bug reports are very welcome.*
