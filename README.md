# TV Tracker

A personal, offline-first replacement for TV Time. Track the shows and movies
you watch, keep your own ratings, and see what's coming up — with no server and
no account required. Your data stays on your device (and, from Phase 5, in your
own Google Drive).

- **Metadata:** [TMDB](https://www.themoviedb.org/) (movies, shows, episodes, air dates)
- **Detail pages:** link out to [IMDb](https://www.imdb.com/)
- **Storage:** IndexedDB on-device + JSON export/import (Google Drive sync later)
- **Hosting:** static build on GitHub Pages
- **Stack:** Vite · React · TypeScript · React Router · TanStack Query · Dexie

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

## Roadmap

- **Phase 1 — Skeleton** ✅ app shell, routing, PWA, data layer, backup/restore
- **Phase 2 — Search & add** TMDB search, add titles, IMDb links, posters
- **Phase 3 — Tracking** per-episode watched/rewatch, status, ratings
- **Phase 4 — Upcoming** calendar of upcoming episodes & releases
- **Phase 5 — Sync** Google Drive `appDataFolder` sync
- **Phase 6 — Polish** offline hardening, PNG/iOS icons, install prompts
