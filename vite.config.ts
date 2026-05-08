import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync } from 'fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-extension-files',
      writeBundle() {
        // Copy manifest.json
        copyFileSync('public/manifest.json', 'dist/manifest.json')
        // Copy background.js
        copyFileSync('public/background.js', 'dist/background.js')
      }
    }
  ],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    // Ensure we don't exceed Chrome extension size limits
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 3000,
  },
})
