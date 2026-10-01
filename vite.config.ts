import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Base public path.
  //  - Local dev / preview: '/'
  //  - GitHub Pages project site: '/<repo-name>/'
  // The deploy workflow sets VITE_BASE automatically from the repo name,
  // so you never have to hardcode it here.
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    VitePWA({
      // Auto-update the service worker when a new build is deployed.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'app-icon.svg'],
      manifest: {
        name: 'TV Tracker',
        short_name: 'TV Tracker',
        description:
          'Track the shows and movies you watch, rate them, and see what is coming up.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        // Icons are referenced relative to the configured base path.
        icons: [
          {
            src: 'app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
