import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, existsSync, unlinkSync } from 'fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-extension-files',
      writeBundle() {
        // Copy manifest.json
        copyFileSync('public/manifest.json', 'dist/manifest.json')

        // Safety check: Wipe local-config.json from production build folder
        // so developer API keys are never packaged for the web store!
        if (existsSync('dist/local-config.json')) {
          unlinkSync('dist/local-config.json');
          console.log('Wiped local-config.json from build output folder for store safety.');
        }
      }
    }
  ],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.tsx'),
        background: resolve(__dirname, 'src/background.ts'),
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
