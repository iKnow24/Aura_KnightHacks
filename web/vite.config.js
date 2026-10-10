import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The browser only talks to this dev server. It forwards /api and /ws to the Python brain,
// so one Cloudflare tunnel URL covers everything (phones need HTTPS for camera + mic).
const BRAIN = process.env.BRAIN_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': BRAIN,
      '/ws': { target: BRAIN.replace('http', 'ws'), ws: true },
    },
  },
})
