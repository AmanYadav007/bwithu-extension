import { animate, motion, useMotionValue } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import GLBCharacter from "./GLBCharacter";
import SpritePlayer from "./SpritePlayer";
import SpeechBubble from "./SpeechBubble";
import { animationConfigs, INTRO_TEXT } from "./animationStates";
import type { BearState } from "./animationStates";
import type { BearMood } from "./behaviorController";
import { playClickPop } from "./sounds";
import type { BearPosition, BwithuSettings } from "./storage";
import { loadBearPosition, saveBearPosition } from "./storage";

const SIZE = 230;
const DEFAULT_MARGIN = 40;

interface ChromeLike {
  runtime?: {
    getURL?: (filename: string) => string;
  };
}

interface BearProps {
  state: BearState;
  showIntro: boolean;
  speechText: string;
  settings: BwithuSettings;
  mood: BearMood;
  panelOpen: boolean;
  onSpawnComplete: () => void;
  onIntroComplete: () => void;
  onLoopComplete: () => void;
  onRequestWave: () => void;
  onOpenPanel: () => void;
  onDragReaction: () => void;
  onHoverReaction: () => void;
  controls?: ReactNode;
}

function resolveAsset(filename: string): string {
  try {
    return ((globalThis as { chrome?: ChromeLike }).chrome?.runtime?.getURL?.(filename)) ?? filename;
  } catch {
    return filename;
  }
}

function clampPosition(position: BearPosition): BearPosition {
  const maxX = Math.max(DEFAULT_MARGIN, window.innerWidth - SIZE - 8);
  const maxY = Math.max(DEFAULT_MARGIN, window.innerHeight - SIZE - 8);
  return {
    x: Math.min(Math.max(8, position.x), maxX),
    y: Math.min(Math.max(8, position.y), maxY),
  };
}

function defaultPosition(): BearPosition {
  return {
    x: Math.max(8, window.innerWidth - SIZE - DEFAULT_MARGIN),
    y: Math.max(8, window.innerHeight - SIZE - DEFAULT_MARGIN),
  };
}

function wanderDelay(intensity: BwithuSettings["wanderIntensity"]) {
  if (intensity === "calm") return 9000 + Math.random() * 7000;
  if (intensity === "curious") return 5500 + Math.random() * 5000;
  return 3200 + Math.random() * 3600;
}

function wanderDistance(intensity: BwithuSettings["wanderIntensity"]) {
  if (intensity === "calm") return 110;
  if (intensity === "curious") return 220;
  return 360;
}

function nextWanderPosition(current: BearPosition, intensity: BwithuSettings["wanderIntensity"]) {
  const distance = wanderDistance(intensity);
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const angle = Math.random() * Math.PI * 2;
  let target = {
    x: current.x + Math.cos(angle) * (80 + Math.random() * distance),
    y: current.y + Math.sin(angle) * (40 + Math.random() * distance * 0.55),
  };

  const nearCenter = Math.abs(target.x - centerX) < window.innerWidth * 0.18 && Math.abs(target.y - centerY) < window.innerHeight * 0.18;
  if (nearCenter) {
    target = {
      x: target.x < centerX ? target.x - 160 : target.x + 160,
      y: target.y < centerY ? target.y - 80 : target.y + 80,
    };
  }

  return clampPosition(target);
}

export default function Bear({
  state,
  showIntro,
  speechText,
  settings,
  mood,
  panelOpen,
  onSpawnComplete,
  onIntroComplete,
  onLoopComplete,
  onRequestWave,
  onOpenPanel,
  onDragReaction,
  onHoverReaction,
  controls,
}: BearProps) {
  const x = useMotionValue(defaultPosition().x);
  const y = useMotionValue(defaultPosition().y);
  const [positionReady, setPositionReady] = useState(false);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [glbUnavailable, setGlbUnavailable] = useState(false);
  const hasDraggedRef = useRef(false);
  const wanderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useGlbRenderer = settings.characterRenderer === "glb" && !glbUnavailable;

  useEffect(() => {
    let cancelled = false;

    async function restorePosition() {
      const saved = await loadBearPosition();
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

  useEffect(() => {
    if (!useGlbRenderer || state !== "spawning") return undefined;
    const timer = setTimeout(onSpawnComplete, 1180);
    return () => clearTimeout(timer);
  }, [onSpawnComplete, state, useGlbRenderer]);

  useEffect(() => {
    if (!positionReady || panelOpen || state !== "idle") return;

    wanderTimerRef.current = setTimeout(() => {
      const current = { x: x.get(), y: y.get() };
      const next = nextWanderPosition(current, settings.wanderIntensity);
      setFacing(next.x >= current.x ? 1 : -1);
      animate(x, next.x, { type: "spring", stiffness: 70, damping: 18, mass: 0.9 });
      animate(y, next.y, { type: "spring", stiffness: 90, damping: 20, mass: 1 });
      void saveBearPosition(next);
    }, wanderDelay(settings.wanderIntensity));

    return () => {
      if (wanderTimerRef.current) clearTimeout(wanderTimerRef.current);
    };
  }, [panelOpen, positionReady, settings.wanderIntensity, state, x, y]);

  const animationState = state === "hidden" ? "idle" : state;
  const config = animationConfigs[animationState] ?? animationConfigs.idle;

  const handleAnimationComplete = useMemo(() => {
    if (state === "spawning") return onSpawnComplete;
    if (config.loop) return undefined;
    return onLoopComplete;
  }, [config.loop, onLoopComplete, onSpawnComplete, state]);

  const handlePointerDown = useCallback(() => {
    hasDraggedRef.current = false;
  }, []);

  const handleClick = useCallback(() => {
    if (hasDraggedRef.current || state === "spawning") return;
    if (settings.soundEnabled) playClickPop();
    onRequestWave();
    onOpenPanel();
  }, [onOpenPanel, onRequestWave, settings.soundEnabled, state]);

  if (!positionReady) return null;

  return (
    <motion.div
      drag
      dragMomentum
      dragElastic={0.09}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onMouseEnter={onHoverReaction}
      onDrag={() => {
        hasDraggedRef.current = true;
        onDragReaction();
      }}
      onDragEnd={(_, info) => {
        hasDraggedRef.current = Math.abs(info.offset.x) > 3 || Math.abs(info.offset.y) > 3;
        const next = clampPosition({ x: x.get(), y: y.get() });
        x.set(next.x);
        y.set(next.y);
        void saveBearPosition(next);
      }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{
        opacity: 1,
        scale: state === "wave" || state === "happy" ? [1, 1.1, 1] : 1,
      }}
      exit={{ opacity: 0, scale: 0.82 }}
      transition={{
        scale: { duration: 0.3 },
        opacity: { duration: 0.2 },
      }}
      whileDrag={{ cursor: "grabbing", scale: 1.05, rotate: 2 }}
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
        className={["bwithu-bear-stage", `bwithu-bear-stage--${state}`, `bwithu-bear-stage--mood-${mood}`].join(" ")}
        animate={{
          y: state === "idle" || state === "curious" || state === "sleep" || state === "sleepy" ? [0, -5, 0] : 0,
          rotate:
            state === "idle"
              ? [0, -1.2, 0.8, 0]
              : state === "think" || state === "searching"
                ? [-2, 2, -2]
                : state === "drag"
                  ? [0, 4, -3, 0]
                  : 0,
          scaleX: useGlbRenderer ? 1 : facing,
          scaleY: state === "idle" || state === "listen" || state === "sleepy" ? [1, 0.965, 1] : 1,
        }}
        transition={{
          y: { repeat: state === "idle" || state === "curious" || state === "sleep" || state === "sleepy" ? Infinity : 0, duration: 3.4, ease: "easeInOut" },
          rotate: { repeat: state === "idle" || state === "think" || state === "searching" ? Infinity : 0, duration: state === "think" || state === "searching" ? 0.7 : 5.2 },
          scaleY: { repeat: state === "idle" || state === "listen" || state === "sleepy" ? Infinity : 0, duration: 2.6, ease: "easeInOut" },
        }}
      >
        <div className="bwithu-bear-shadow" aria-hidden="true" />
        {(showIntro || speechText) && (
          <SpeechBubble text={speechText || INTRO_TEXT} onComplete={showIntro ? onIntroComplete : () => undefined} hold={!showIntro} />
        )}
        {controls}
        {useGlbRenderer ? (
          <GLBCharacter
            modelSrc={resolveAsset("result.glb")}
            state={state}
            mood={mood}
            facing={facing}
            size={SIZE}
            onLoadError={() => setGlbUnavailable(true)}
          />
        ) : (
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
              width: SIZE,
              height: SIZE,
              backgroundSize: `${SIZE * config.frameCount}px ${SIZE}px`,
              filter: "drop-shadow(0 10px 18px rgba(48, 31, 18, 0.24))",
            }}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
