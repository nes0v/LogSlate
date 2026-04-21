import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'LogSlate',
        short_name: 'LogSlate',
        description: 'Personal trading journal for index futures',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    headers: {
      // Google Identity Services opens a cross-origin popup and polls
      // `window.closed` to detect it being dismissed. The strict default COOP
      // blocks that cross-origin access and prints a console warning on every
      // sign-in. `same-origin-allow-popups` keeps this document isolated
      // while letting popups it opens retain an opener reference.
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
})
