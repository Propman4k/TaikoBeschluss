import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Build-Zeitpunkt ins Bundle backen (Anzeige unten in der Sidebar)
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 3009,
    proxy: {
      '/api': 'http://127.0.0.1:3010',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'server/**/*.test.{js,jsx}'],
    setupFiles: ['./server/test/setup.js'],
    coverage: {
      // Ratchet: knapp unter Ist-Stand — darf nur steigen, nie sinken
      thresholds: { lines: 90, branches: 68 },
    },
  },
})
