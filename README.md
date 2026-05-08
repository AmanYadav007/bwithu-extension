# BwithU Chrome Extension

A delightful AI companion that lives in your browser. This extension features a cute animated bear that drops, bounces, and introduces itself with voice and speech bubbles.

## Features

- **Animated Bear**: SVG bear with Framer Motion animations
- **Drop & Bounce**: Realistic falling and squash/stretch landing
- **Idle Behaviors**: Random blinking, head tilts, waving, yawning
- **Speech Bubble**: Typewriter-style introduction with two lines
- **Voice Intro**: Uses Web Speech API for calm voice greeting
- **Floating Particles**: Ambient glow particles for magical feel
- **Premium UI**: Dark glassmorphism design with Tailwind CSS

## Tech Stack

- React 18 + TypeScript
- Vite for building
- Framer Motion for animations
- Tailwind CSS for styling
- Chrome Extension Manifest V3
- Web Speech API

## Project Structure

```
bwithu-extension/
├── public/
│   ├── manifest.json
│   └── icons/
├── src/
│   ├── components/
│   │   ├── Bear.tsx          # Animated bear component
│   │   ├── IntroBubble.tsx   # Speech bubble
│   │   └── FloatingParticle.tsx
│   ├── hooks/
│   │   ├── useSpeech.ts      # Speech synthesis hook
│   │   └── useIdle.ts        # Idle behavior system
│   ├── App.tsx               # Main popup layout
│   └── index.css             # Global styles
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run dev server:
   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```

4. Load extension in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `bwithu-extension/dist` folder

## Usage

Click the extension icon to see:
1. Bear drops from top with squash/stretch animation
2. Bear bounces and settles into idle floating
3. Speech bubble appears with typewriter text
4. Voice speaks introduction
5. Bear continues idle animations (blinking, tilting, etc.)

## Future Enhancements

- AI integration (GPT)
- Memory system
- Browser interaction
- Voice commands
- Customization settings

## License

MIT
