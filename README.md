# BwithU Chrome Extension

BwithU is a Chrome MV3 side-panel companion. The beta direction is a live “B Call Screen”: a persistent side panel with a large animated character, microphone-first voice interaction, browser/page awareness, tab actions, search cards, and short captions.

## Development

```bash
npm install
npm run dev
npm run build
```

Load the built extension from `dist` in `chrome://extensions` with Developer Mode enabled.

## Local Keys

For local development, create `.env` and run:

```bash
npm run build:local
```

Supported variables:

```bash
OPENAI_API_KEY=sk-...
XAI_API_KEY=xai-...
BRAVE_SEARCH_API_KEY=...
BWITHU_PROXY_URL=https://...
GOOGLE_CLIENT_ID=...
```

`OPENAI_API_KEY` is the recommended path for realtime voice. Production builds strip private keys from `dist/local-config.json`; use a proxy URL for distributable builds.

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
