# BwithU Chrome Extension

BwithU is a Chrome MV3 side-panel companion. The beta direction is a live “B Call Screen”: a persistent side panel with a large animated character, microphone-first voice interaction, browser/page awareness, tab actions, search cards, and short captions.

## Development

```bash
npm install
npm run dev
npm run build
```

Load the built extension from `dist` in `chrome://extensions` with Developer Mode enabled.

## Proxy (Vercel) environment

Users never enter keys: the extension and desktop apps call the proxy in `api/`, which holds them.

| Variable | Required | Purpose |
| --- | --- | --- |
| `XAI_API_KEY` | yes | Chat, live voice, TTS, STT (console.x.ai) |
| `TAVILY_API_KEY` | recommended | Web search, free 1,000/month (tavily.com) |
| `BRAVE_SEARCH_API_KEY` | optional | Alternative web search |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | before launch | Global daily quotas (upstash.com, free tier) |
| `ALLOWED_ORIGINS` | after publishing | e.g. `chrome-extension://<extension-id>` |
| `DAILY_LIMIT_CHAT` / `_VOICE` / `_SPEAK` / `_TRANSCRIBE` / `_SEARCH` | optional | Override per-install daily limits (defaults 300 / 15 / 300 / 200 / 100) |

Live voice calls are capped at 10 minutes each.

## Local Keys

`npm run build` never ships private keys. For local testing with your own keys, create a repo-root `.env` and run `npm run build:local` in `apps/chrome-extension`. If `OPENAI_API_KEY` is set, the app talks to OpenAI directly instead of the proxy.

## Publishing

```bash
npm run build:shared
cd apps/chrome-extension && npm run zip   # -> bwithu-extension.zip, manifest at the root
```

Privacy policy: `https://bwithu-extension.vercel.app/privacy.html` (source: `apps/chrome-extension/public/privacy.html`).

## Character Pipeline

The current renderer supports ordinary GLB assets and is ready for professional characters:

- Embedded animation clips are auto-mapped by names like `idle`, `talk`, `listen`, `wave`, `happy`, and `walk`.
- Common head, neck, eye, hand, and arm bones get subtle procedural motion.
- Common morph targets like mouth open, jaw open, smile, blink, and viseme-style names are driven from B’s state.

Recommended asset workflow:

1. Create/export a character from Reallusion Character Creator.
2. Animate or prepare idle/listen/talk/wave clips in iClone, Mixamo, Blender, or equivalent.
3. Export an optimized GLB or VRM with textures, animation clips, bones, and facial morph targets.
4. Put the file in `public/`, for example `public/b.vrm`.
5. Open B settings and set `Character file` to `b.vrm`.

VRM support uses `@pixiv/three-vrm`, so standard VRM humanoid bones and expressions are used when present.

Keep the side panel as the default experience. The content script should only collect page context.
