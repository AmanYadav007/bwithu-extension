import { defineConfig } from 'vite'
import { resolve } from 'path'

// Content scripts run as classic scripts (no ES module imports), so they are built
// separately as a single self-contained IIFE instead of sharing chunks with the app.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content.tsx'),
      formats: ['iife'],
      name: 'BwithuContent',
      fileName: () => 'content.js',
    },
  },
})
