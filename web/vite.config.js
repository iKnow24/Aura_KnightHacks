import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The browser only talks to this dev server. It forwards /api and /ws to the Python brain,
// so one Cloudflare tunnel URL covers everything (phones need HTTPS for camera + mic).
const BRAIN = process.env.BRAIN_URL || 'http://localhost:8000'

const kokoroFs = fileURLToPath(new URL('./src/lib/kokoro-fs-stub.js', import.meta.url))
const kokoroPath = fileURLToPath(new URL('./src/lib/kokoro-path-stub.js', import.meta.url))

// Kokoro's published "web" file always loads the WebGPU build, which never finishes
// on a machine whose GPU is software. Use the small entry instead and let the browser
// build of Transformers run the voice on ordinary WebAssembly.
function kokoroBrowser() {
  return {
    name: 'kokoro-browser',
    resolveId(id, importer) {
      if (!importer || !importer.includes('kokoro-js')) return null
      if (id === 'fs/promises' || id === 'node:fs/promises') return kokoroFs
      if (id === 'path' || id === 'node:path') return kokoroPath
    },
  }
}

// BASE_PATH: set when the site is served from a sub-folder (GitHub Pages serves /Aura_KnightHacks/).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'kokoro-js': fileURLToPath(new URL('./node_modules/kokoro-js/dist/kokoro.js', import.meta.url)),
    },
  },
  optimizeDeps: { exclude: ['kokoro-js'] },
  plugins: [react(), tailwindcss(), kokoroBrowser()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': BRAIN,
      '/ws': { target: BRAIN.replace('http', 'ws'), ws: true },
    },
  },
})
