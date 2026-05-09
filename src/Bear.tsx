import { motion, useMotionValue } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SpritePlayer from "./SpritePlayer";
import SpeechBubble from "./SpeechBubble";
import { animationConfigs, INTRO_TEXT } from "./animationStates";
import type { BearState } from "./animationStates";
import { playClickPop } from "./sounds";

const STORAGE_KEY = "bwithu.bearPosition";
const SIZE = 128;
const DEFAULT_MARGIN = 40;

interface Position {
  x: number;
  y: number;
}

interface ChromeLike {
  runtime?: {
    getURL?: (filename: string) => string;
  };
  storage?: {
    local?: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (value: Record<string, unknown>) => Promise<void>;
    };
  };
}

interface BearProps {
  state: BearState;
  showIntro: boolean;
  onSpawnComplete: () => void;
  onIntroComplete: () => void;
  onBlinkComplete: () => void;
  onWaveComplete: () => void;
  onRequestWave: () => void;
}

function resolveAsset(filename: string): string {
  try {
    return ((globalThis as { chrome?: ChromeLike }).chrome?.runtime?.getURL?.(filename)) ?? filename;
  } catch {
    return filename;
  }
}

function clampPosition(position: Position): Position {
  const maxX = Math.max(DEFAULT_MARGIN, window.innerWidth - SIZE - 8);
  const maxY = Math.max(DEFAULT_MARGIN, window.innerHeight - SIZE - 8);
  return {
    x: Math.min(Math.max(8, position.x), maxX),
    y: Math.min(Math.max(8, position.y), maxY),
  };
}

function defaultPosition(): Position {
  return {
    x: Math.max(8, window.innerWidth - SIZE - DEFAULT_MARGIN),
    y: Math.max(8, window.innerHeight - SIZE - DEFAULT_MARGIN),
  };
}

async function loadPosition(): Promise<Position | undefined> {
  const chromeStorage = (globalThis as { chrome?: ChromeLike }).chrome?.storage?.local;

  try {
    if (chromeStorage) {
      const stored = await chromeStorage.get(STORAGE_KEY);
      return stored[STORAGE_KEY] as Position | undefined;
    }
  } catch {
    // Fall through to localStorage for the Vite preview.
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Position) : undefined;
  } catch {
    return undefined;
  }
}

async function savePosition(position: Position) {
  const chromeStorage = (globalThis as { chrome?: ChromeLike }).chrome?.storage?.local;

  try {
    if (chromeStorage) {
      await chromeStorage.set({ [STORAGE_KEY]: position });
      return;
    }
  } catch {
    // Fall through to localStorage for the Vite preview.
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
}

export default function Bear({
  state,
  showIntro,
  onSpawnComplete,
  onIntroComplete,
  onBlinkComplete,
  onWaveComplete,
  onRequestWave,
}: BearProps) {
  const x = useMotionValue(defaultPosition().x);
  const y = useMotionValue(defaultPosition().y);
  const [positionReady, setPositionReady] = useState(false);
  const hasDraggedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function restorePosition() {
      const saved = await loadPosition();
      if (cancelled) return;

      const next = saved ? clampPosition(saved) : defaultPosition();
      x.set(next.x);
      y.set(next.y);
      setPositionReady(true);
    }

    restorePosition();
    return () => {
      cancelled = true;
    };
  }, [x, y]);

  useEffect(() => {
    function keepInsideViewport() {
      const next = clampPosition({ x: x.get(), y: y.get() });
      x.set(next.x);
      y.set(next.y);
    }

    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, [x, y]);

  const animationState = state === "hidden" || state === "sleep" ? "idle" : state;
  const config = animationConfigs[animationState] ?? animationConfigs.idle;

  const handleAnimationComplete = useMemo(() => {
    if (state === "spawning") return onSpawnComplete;
    if (state === "blink") return onBlinkComplete;
    if (state === "wave") return onWaveComplete;
    return undefined;
  }, [onBlinkComplete, onSpawnComplete, onWaveComplete, state]);

  const handlePointerDown = useCallback(() => {
    hasDraggedRef.current = false;
  }, []);

  const handleClick = useCallback(() => {
    if (hasDraggedRef.current || state === "spawning") return;
    playClickPop();
    onRequestWave();
  }, [onRequestWave, state]);

  if (!positionReady) return null;

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.04}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onDrag={() => {
        hasDraggedRef.current = true;
      }}
      onDragEnd={(_, info) => {
        hasDraggedRef.current = Math.abs(info.offset.x) > 3 || Math.abs(info.offset.y) > 3;
        const next = clampPosition({ x: x.get(), y: y.get() });
        x.set(next.x);
        y.set(next.y);
        void savePosition(next);
      }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{
        opacity: 1,
        scale: state === "wave" ? [1, 1.08, 1] : 1,
      }}
      exit={{ opacity: 0, scale: 0.82 }}
      transition={{
        scale: { duration: 0.3 },
        opacity: { duration: 0.2 },
      }}
      whileDrag={{ cursor: "grabbing", scale: 1.04 }}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        x,
        y,
        width: SIZE,
        height: SIZE,
        cursor: "grab",
        pointerEvents: "auto",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <motion.div
        animate={{
          y: state === "idle" ? [0, -4, 0] : 0,
          rotate: state === "idle" ? [0, -1.4, 0.8, 0] : 0,
        }}
        transition={{
          y: { repeat: state === "idle" ? Infinity : 0, duration: 3.6, ease: "easeInOut" },
          rotate: { repeat: state === "idle" ? Infinity : 0, duration: 5.2, ease: "easeInOut" },
        }}
      >
        {showIntro && <SpeechBubble text={INTRO_TEXT} onComplete={onIntroComplete} />}
        <SpritePlayer
          key={state}
          imageSrc={resolveAsset(config.imageSrc)}
          frameWidth={SIZE}
          frameHeight={SIZE}
          frameCount={config.frameCount}
          fps={config.fps}
          loop={config.loop}
          onComplete={handleAnimationComplete}
          style={{
            filter: "drop-shadow(0 10px 18px rgba(48, 31, 18, 0.2))",
          }}
        />
      </motion.div>
    </motion.div>
  );
}
