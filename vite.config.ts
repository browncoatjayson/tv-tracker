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
      // Prompt the user to reload when a new build is available (see UpdatePrompt).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'app-icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'TV Tracker',
        short_name: 'TV Tracker',
        description:
          'Track the shows and movies you watch, rate them, and see what is coming up.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        // PNG icons for Android/installability; SVG kept as a scalable extra.
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
})
