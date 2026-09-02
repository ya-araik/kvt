import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4174',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/u, '')
      }
    }
  }
})
