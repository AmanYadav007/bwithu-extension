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
            delete config.OPENAI_API_KEY;
            delete config.BRAVE_SEARCH_API_KEY;
            delete config.BRAVE_API_KEY;
            delete config.apiKey;
            delete config.openAiKey;
            delete config.braveApiKey;

            // If a local .env exists, merge those keys back in for local development/testing
            if (existsSync('.env')) {
              const env = readFileSync('.env', 'utf8');
              const xaiMatch = env.match(/^XAI_API_KEY=(.+)$/m);
              const openAiMatch = env.match(/^OPENAI_API_KEY=(.+)$/m);
              const braveMatch = env.match(/^(?:BRAVE_SEARCH_API_KEY|BRAVE_API_KEY)=(.+)$/m);
              const googleClientMatch = env.match(/^GOOGLE_CLIENT_ID=(.+)$/m);
              const proxyMatch = env.match(/^BWITHU_PROXY_URL=(.+)$/m);

              if (xaiMatch?.[1]) config.XAI_API_KEY = xaiMatch[1].trim();
              if (openAiMatch?.[1]) config.OPENAI_API_KEY = openAiMatch[1].trim();
              if (braveMatch?.[1]) config.BRAVE_SEARCH_API_KEY = braveMatch[1].trim();
              if (googleClientMatch?.[1]) config.GOOGLE_CLIENT_ID = googleClientMatch[1].trim();
              if (proxyMatch?.[1]) config.BWITHU_PROXY_URL = proxyMatch[1].trim();
            }

            writeFileSync('dist/local-config.json', JSON.stringify(config, null, 2) + '\n');
            if (existsSync('.env')) {
              console.log('Maintained local development keys in build local-config.json.');
            } else {
              console.log('Stripped secret keys from build local-config.json while keeping public proxy URL.');
            }
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
        permissions: resolve(__dirname, 'permissions.html'),
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
