import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The browser only talks to this dev server. It forwards /api and /ws to the Python brain,
// so one Cloudflare tunnel URL covers everything (phones need HTTPS for camera + mic).
const BRAIN = process.env.BRAIN_URL || 'http://localhost:8000'

// BASE_PATH: set when the site is served from a sub-folder (GitHub Pages serves /Aura_KnightHacks/).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': BRAIN,
      '/ws': { target: BRAIN.replace('http', 'ws'), ws: true },
    },
  },
})
