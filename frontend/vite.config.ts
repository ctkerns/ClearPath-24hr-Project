import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must come before react(): generates src/routeTree.gen.ts from files in src/routes/
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // `npm run dev`: send /api/* to the backend container, the same as Caddy does in Docker
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
})
