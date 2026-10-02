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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
