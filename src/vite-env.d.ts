/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

// Strongly-typed environment variables.
// Add new VITE_* vars here so TypeScript knows about them.
interface ImportMetaEnv {
  /** TMDB v4 Read Access Token (Bearer). Set in .env (git-ignored). */
  readonly VITE_TMDB_TOKEN?: string
  /** Google OAuth client ID for Drive sync. Public by design. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Trakt API client ID. Needed to read reviews/comments. */
  readonly VITE_TRAKT_CLIENT_ID?: string
  /** Trakt API client secret. Needed for sign-in (posting/liking/replying). */
  readonly VITE_TRAKT_CLIENT_SECRET?: string
  /** TMDB proxy worker URL. When set, TMDB calls go through it (token stays server-side). */
  readonly VITE_TMDB_PROXY?: string
  /** Trakt proxy worker URL. When set, public Trakt reads go through it (no preflight, edge-cached). */
  readonly VITE_TRAKT_PROXY?: string
  /** Min ms between TMDB proxy requests — client pacing floor. Default 60. */
  readonly VITE_TMDB_MIN_INTERVAL_MS?: string
  /** Min ms between Trakt requests — flat client pacing (no adaptation). Default 400. */
  readonly VITE_TRAKT_MIN_INTERVAL_MS?: string
  /** Anonymous usage-stats worker URL. When set, the app sends a once-per-day,
   *  PII-free "active install" ping (see worker-stats/). Unset = no ping. */
  readonly VITE_STATS_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
