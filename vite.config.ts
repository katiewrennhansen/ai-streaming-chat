import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Forward API calls to the server in server/index.ts.
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
})
