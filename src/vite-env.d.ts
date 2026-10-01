/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Strongly-typed environment variables.
// Add new VITE_* vars here so TypeScript knows about them.
interface ImportMetaEnv {
  /** TMDB v4 Read Access Token (Bearer). Set in .env (git-ignored). */
  readonly VITE_TMDB_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
