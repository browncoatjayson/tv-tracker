# TV Tracker

A personal, offline-first replacement for TV Time. Track the shows and movies
you watch, keep your own ratings, and see what's coming up — with no server and
no account required. Your data stays on your device (and, optionally, in your
own Google Drive).

- **Metadata:** [TMDB](https://www.themoviedb.org/) (movies, shows, episodes) + [TVmaze](https://www.tvmaze.com/) (air times)
- **Detail pages:** link out to [IMDb](https://www.imdb.com/)
- **Storage:** IndexedDB on-device + JSON export/import + optional Google Drive sync
- **Hosting:** static build on GitHub Pages
- **Stack:** Vite · React · TypeScript · React Router · TanStack Query · Dexie

## Using the app

**Open it:** [browncoatjayson.github.io/tv-tracker](https://browncoatjayson.github.io/tv-tracker)

**1. Install it (recommended).** It works in any browser, but installing gives you
a home-screen icon, a full-screen app window, and offline access.

- **Chrome / Edge (desktop):** click the install icon at the right of the address
  bar, or the **⋮** menu → **Install TV Tracker**.
- **Chrome (Android):** **⋮** menu → **Install app** (or **Add to Home screen**).
- **iPhone / iPad:** open the site in **Safari**, tap the **Share** button, then
  **Add to Home Screen**. (iOS only installs web apps from Safari.)

**2. Build your library.** Use the **Search** tab to add shows and movies (results
show a description; once added, tap the tile to open its details). Open a title to
track episodes, rate it on a 10-star scale (shown next to the average), and jump
to IMDb. Marking episodes advances the status automatically (watching → completed),
and you can log rewatches. The **Upcoming** tab shows what's airing next (with
local air times) and what you recently missed.

The Library filter box also takes `genre:` and `service:` tokens, e.g.
`genre:comedy` or `genre:crime, service:hbo`. (Genre/service data fills in as you
browse, or all at once via **Settings → Build index**.)

**3. Import your TV Time history (optional).** Request your data export from TV
Time (you'll get a `.zip`), then go to **Settings → Import from another tracker →
TV Time**, choose **Merge** or **Replace**, and pick the `.zip`. A large library
takes a minute or two to match everything to TMDB.

**4. Sync across devices (optional).** **Settings → Connect Google Drive** stores
your data in a private, app-only folder in your own Drive. Connect and sync on
each device to merge them. After importing a big library, use **Settings → Build
index** once so episode-name search covers your whole back catalog.

**5. Updating.** When a new version is deployed, a small "A new version is
available" prompt appears — tap **Reload** to get it.

## Getting started

```bash
npm install
cp .env.example .env     # then paste your TMDB token into .env
npm run dev
```

Open the printed localhost URL. Search won't return results until the TMDB token
is set, but the rest of the app (library, settings, backup/restore) works
without it.

### Getting a TMDB token

1. Create a free account at themoviedb.org.
2. **Settings → API →** create a **Developer** key.
3. Copy the **API Read Access Token** (the long `eyJ...` value) into `.env` as
   `VITE_TMDB_TOKEN`.

## Scripts

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Start the dev server                      |
| `npm run build`   | Type-check and build to `dist/`           |
| `npm run preview` | Preview the production build locally       |
| `npm run lint`    | Run oxlint                                 |

## Project structure

```
src/
  api/tmdb.ts        TMDB client (auth, image URLs, search)
  data/
    types.ts         Domain types (TrackedItem, WatchEvent, EpisodeState)
    db.ts            Dexie (IndexedDB) schema + key helpers
    library.ts       All writes to user data go through here
    exportImport.ts  JSON backup / restore
  components/
    Layout.tsx       App shell + bottom tab nav
  views/             One component per route
```

## Deployment (GitHub Pages)

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes to Pages. Two one-time setup steps in the repo:

1. **Settings → Pages → Source:** GitHub Actions.
2. **Settings → Secrets and variables → Actions:** add a secret named
   `VITE_TMDB_TOKEN` with your token (used at build time).

The workflow sets the Vite `base` path to `/<repo-name>/` automatically.
