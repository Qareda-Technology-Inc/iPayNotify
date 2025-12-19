import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Ensure service worker and manifest are included in build
    rollupOptions: {
      input: {
        main: './index.html',
      },
    },
  },
  // Ensure public files are served correctly
  publicDir: 'public',
})