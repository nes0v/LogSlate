import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
