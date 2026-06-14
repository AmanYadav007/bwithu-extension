import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-extension-files',
      writeBundle() {
        // Copy manifest.json
        copyFileSync('public/manifest.json', 'dist/manifest.json')

        // Safety check: Strip private keys from local-config.json inside dist build folder
        // so developer API keys are never packaged for the web store, while keeping BWITHU_PROXY_URL!
        if (existsSync('dist/local-config.json')) {
          try {
            const raw = readFileSync('dist/local-config.json', 'utf8');
            const config = JSON.parse(raw);
            delete config.XAI_API_KEY;
            delete config.BRAVE_SEARCH_API_KEY;
            delete config.BRAVE_API_KEY;
            delete config.apiKey;
            delete config.braveApiKey;

            writeFileSync('dist/local-config.json', JSON.stringify(config, null, 2) + '\n');
            console.log('Stripped secret keys from build local-config.json while keeping public proxy URL.');
          } catch {
            // fallback: delete file if parse fails
            try {
              unlinkSync('dist/local-config.json');
            } catch {
              // Ignore fallback delete errors
            }
          }
        }
      }
    }
  ],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
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
