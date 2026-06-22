import { animate, motion, useMotionValue, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import GLBCharacter from "./GLBCharacter";
import SpritePlayer from "./SpritePlayer";
import SpeechBubble from "./SpeechBubble";
import InfoDisplay from "./InfoDisplay";
import { animationConfigs, INTRO_TEXT } from "./animationStates";
import type { BearState } from "./animationStates";
import type { BearMood } from "./behaviorController";
import { playClickPop } from "./sounds";
import type { BearPosition, BwithuSettings } from "./storage";
import type { BrowserAction } from "./brainClient";
import { loadBearPosition, saveBearPosition } from "./storage";

const SIZE = 320;
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
  display?: {
    kind: "weather" | "search" | "info" | "tab_picker" | "confirmation" | "error" | "memory";
    title: string;
    content: string;
  } | null;
  pendingAction?: BrowserAction | null;
  onCloseDisplay?: () => void;
  onSpawnComplete: () => void;
  onIntroComplete: () => void;
  onLoopComplete: () => void;
  onRequestWave: () => void;
  onOpenPanel: () => void;
  onDragReaction: () => void;
  onHoverReaction: () => void;
  onConfirmAction?: () => void;
  onCancelAction?: () => void;
  onSelectTab?: (tabId: number) => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  immediateSpeech?: boolean;
  controls?: ReactNode;
  isSidePanel?: boolean;
  sidePanelWidth?: number;
  sidePanelHeight?: number;
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
  display,
  pendingAction,
  onCloseDisplay,
  onSpawnComplete,
  onIntroComplete,
  onLoopComplete,
  onRequestWave,
  onOpenPanel,
  onDragReaction,
  onHoverReaction,
  onConfirmAction,
  onCancelAction,
  onSelectTab,
  isRecording,
  onToggleRecording,
  immediateSpeech = false,
  controls,
  isSidePanel = false,
  sidePanelWidth = 320,
  sidePanelHeight = 600,
}: BearProps) {
  const x = useMotionValue(defaultPosition().x);
  const y = useMotionValue(defaultPosition().y);
  const panelSize = Math.min(
    Math.max(300, sidePanelWidth * 0.82),
    Math.max(320, sidePanelHeight * 0.62),
    640,
  );
  const [positionReady, setPositionReady] = useState(isSidePanel);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [glbUnavailable, setGlbUnavailable] = useState(false);
  const [isWandering, setIsWandering] = useState(false);
  const [reactions, setReactions] = useState<{ id: number; char: string; x: number }[]>([]);
  const hasDraggedRef = useRef(false);
  const wanderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useGlbRenderer = settings.characterRenderer === "glb" && !glbUnavailable;

  const triggerReaction = useCallback((char: string) => {
    const id = Date.now() + Math.random();
    const randomOffset = -40 + Math.random() * 80;
    setReactions((current) => [...current, { id, char, x: randomOffset }].slice(-5));
  }, []);

  useEffect(() => {
    let active = true;
    if (state === "searching" || state === "think") {
      setTimeout(() => { if (active) triggerReaction("🤔"); }, 0);
    } else if (state === "happy" || state === "wave") {
      setTimeout(() => { if (active) triggerReaction(Math.random() > 0.5 ? "✨" : "❤️"); }, 0);
    } else if (state === "listen") {
      setTimeout(() => { if (active) triggerReaction("👀"); }, 0);
    } else if (state === "sleepy" || state === "sleep") {
      setTimeout(() => { if (active) triggerReaction("😴"); }, 0);
    }
    return () => {
      active = false;
    };
  }, [state, triggerReaction]);

  useEffect(() => {
    if (isSidePanel) return;
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
  }, [x, y, isSidePanel]);

  useEffect(() => {
    if (isSidePanel) return;
    function keepInsideViewport() {
      const next = clampPosition({ x: x.get(), y: y.get() });
      x.set(next.x);
      y.set(next.y);
    }

    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, [x, y, isSidePanel]);

  useEffect(() => {
    if (!useGlbRenderer || state !== "spawning") return undefined;
    const timer = setTimeout(onSpawnComplete, 1180);
    return () => clearTimeout(timer);
  }, [onSpawnComplete, state, useGlbRenderer]);

  useEffect(() => {
    if (isSidePanel || !positionReady || panelOpen || state !== "idle") return;

    wanderTimerRef.current = setTimeout(() => {
      const current = { x: x.get(), y: y.get() };
      const next = nextWanderPosition(current, settings.wanderIntensity);
      setFacing(next.x >= current.x ? 1 : -1);
      
      setIsWandering(true);
      const animationX = animate(x, next.x, { type: "spring", stiffness: 70, damping: 18, mass: 0.9 });
      const animationY = animate(y, next.y, { type: "spring", stiffness: 90, damping: 20, mass: 1 });
      
      Promise.all([animationX, animationY]).then(() => {
        setIsWandering(false);
      });

      void saveBearPosition(next);
    }, wanderDelay(settings.wanderIntensity));

    return () => {
      if (wanderTimerRef.current) clearTimeout(wanderTimerRef.current);
    };
  }, [panelOpen, positionReady, settings.wanderIntensity, state, x, y, isSidePanel]);

  const animationState = state === "hidden" ? "idle" : (isWandering && state === "idle" ? "walk" : state);
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
      drag={!isSidePanel}
      dragMomentum={!isSidePanel}
      dragElastic={0.09}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onMouseEnter={onHoverReaction}
      onDrag={() => {
        if (isSidePanel) return;
        hasDraggedRef.current = true;
        onDragReaction();
      }}
      onDragEnd={(_, info) => {
        if (isSidePanel) return;
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
      whileDrag={isSidePanel ? undefined : { cursor: "grabbing", scale: 1.05, rotate: 2 }}
      style={{
        position: isSidePanel ? "relative" : "fixed",
        left: isSidePanel ? "auto" : 0,
        top: isSidePanel ? "auto" : 0,
        margin: isSidePanel ? "0 auto" : undefined,
        width: isSidePanel ? panelSize : SIZE,
        height: isSidePanel ? panelSize : SIZE,
        cursor: isSidePanel ? "default" : "grab",
        pointerEvents: "auto",
        userSelect: "none",
        touchAction: "none",
        ...(isSidePanel ? {} : { x, y }),
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
        {state === "spawning" && (
          <div
            className="bwithu-portal"
            style={{
              position: "absolute",
              left: ((isSidePanel ? panelSize : SIZE) - 196) / 2,
              top: ((isSidePanel ? panelSize : SIZE) - 196) / 2,
              right: "auto",
              bottom: "auto",
              zIndex: -1,
            }}
            aria-hidden="true"
          />
        )}
        <div className="bwithu-bear-shadow" aria-hidden="true" />
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.span
              key={r.id}
              initial={{ opacity: 0, y: -20, scale: 0.8, x: r.x }}
              animate={{ opacity: 1, y: -90, scale: 1.25 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              onAnimationComplete={() => {
                setReactions((current) => current.filter((item) => item.id !== r.id));
              }}
              style={{
                position: "absolute",
                top: 0,
                left: "50%",
                transform: "translateX(-50%)",
                fontSize: "28px",
                pointerEvents: "none",
                zIndex: 100,
                filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.15))",
              }}
            >
              {r.char}
            </motion.span>
          ))}
        </AnimatePresence>
        {!isSidePanel && (showIntro || speechText) && (
          <SpeechBubble
            text={speechText || INTRO_TEXT}
            onComplete={showIntro ? onIntroComplete : () => undefined}
            hold={!showIntro}
            immediate={immediateSpeech}
            isSidePanel={isSidePanel}
          />
        )}
        {(() => {
          const describeAction = (action: BrowserAction, companionName: string) => {
            switch (action.kind) {
              case "open_url":
                return `Open "${action.payload.url}"`;
              case "search":
                return `Google search for "${action.payload.query}"`;
              case "switch_tab":
                return `Switch to tab "${action.payload.index || action.payload.query}"`;
              case "read_current_page":
                return "Read current page text";
              case "read_tab_context":
                return `Read tab details for ${action.payload.index || action.payload.query}`;
              case "create_calendar_event":
                return `Schedule event: ${action.payload.title || "Calendar Meeting"}`;
              case "hide_bear":
                return `Hide ${companionName}`;
              default:
                return "perform a browser command";
            }
          };

          const activeDisplay = display || (pendingAction ? {
            kind: "confirmation" as const,
            title: "Action Confirmation",
            content: describeAction(pendingAction, settings.companionName || "Bumi"),
          } : null);

          if (!activeDisplay) return null;

          return (
            <InfoDisplay
              key={activeDisplay.content}
              display={activeDisplay}
              onClose={onCloseDisplay || (() => {})}
              position={isSidePanel ? "center" : (x.get() > window.innerWidth / 2 ? "left" : "right")}
              onConfirmAction={onConfirmAction}
              onCancelAction={onCancelAction}
              onSelectTab={onSelectTab}
            />
          );
        })()}
        {controls}
        {useGlbRenderer ? (
          <GLBCharacter
            modelSrc={resolveAsset(settings.characterModelUrl || "result.glb")}
            state={animationState}
            mood={mood}
            facing={facing}
            width={isSidePanel ? panelSize : SIZE}
            height={isSidePanel ? panelSize : SIZE}
            onLoadError={() => setGlbUnavailable(true)}
          />
        ) : (
          <SpritePlayer
            key={animationState}
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
      {/* Mini-dock — hidden in side panel (bottom bar handles this instead) */}
      {!isSidePanel && !panelOpen && (
        <motion.div
          className="bwithu-mini-dock"
          initial={{ opacity: 0.35 }}
          whileHover={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "absolute",
            bottom: -32,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 12,
            background: "rgba(20, 15, 12, 0.82)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "20px",
            padding: "4px 12px",
            pointerEvents: "auto",
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            zIndex: 1000,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={isRecording ? "bwithu-dock-btn bwithu-dock-btn--active" : "bwithu-dock-btn"}
            onClick={onToggleRecording}
            style={{
              background: "transparent",
              border: 0,
              fontSize: 16,
              cursor: "pointer",
              padding: 0,
              color: isRecording ? "#ef4444" : "#f1f5f9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              transition: "color 0.15s ease",
            }}
            title={isRecording ? "Stop listening" : "Talk to companion"}
          >
            🎙️
          </button>
          <button
            type="button"
            className="bwithu-dock-btn"
            onClick={onOpenPanel}
            style={{
              background: "transparent",
              border: 0,
              fontSize: 16,
              cursor: "pointer",
              padding: 0,
              color: "#f1f5f9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
            }}
            title="Open chat"
          >
            💬
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
