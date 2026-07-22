import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  },
})
