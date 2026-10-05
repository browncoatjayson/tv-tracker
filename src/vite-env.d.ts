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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
