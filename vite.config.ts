import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true,
    watch: {
      ignored: path => {
        const normalized = path.replace(/\\/g, '/')
        return normalized.includes('/android/') || normalized.includes('/dist/')
      },
    },
  },
})
