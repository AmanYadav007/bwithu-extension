import { motion } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import browser from "webextension-polyfill";
import SpritePlayer from "./SpritePlayer";
import {
  animationConfigs,
  IDLE_BEHAVIORS,
  IDLE_DURATIONS,
} from "./animationStates";
import type { BirthState, IdleState } from "./animationStates";

interface BearProps {
  birthState: BirthState;
}

function weightedRandom(behaviors: [IdleState, number][]): IdleState {
  const total = behaviors.reduce((sum, [, w]) => sum + w, 0);
  let rand = Math.random() * total;
  for (const [state, weight] of behaviors) {
    rand -= weight;
    if (rand <= 0) return state;
  }
  return "idle";
}

function resolveAsset(filename: string): string {
  try {
    return browser.runtime.getURL(filename);
  } catch {
    return filename;
  }
}

export default function Bear({ birthState }: BearProps) {
  const [idleState, setIdleState] = useState<IdleState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (birthState !== "idle" || idleState !== "idle") return;

    const delay = 4000 + Math.random() * 8000;
    timerRef.current = setTimeout(() => {
      const next = weightedRandom(IDLE_BEHAVIORS);
      setIdleState(next);
      setTimeout(() => setIdleState("idle"), IDLE_DURATIONS[next]);
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [birthState, idleState]);

  const animKey =
    birthState === "spawn"
      ? "spawn"
      : birthState === "awaken"
      ? "awaken"
      : birthState === "intro"
      ? "intro"
      : idleState;

  const config = animationConfigs[animKey] ?? animationConfigs["idle"];

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.08}
      initial={{ y: 50, scale: 0.5, opacity: 0 }}
      animate={{
        y: 0,
        scale: birthState === "awaken" ? [0.9, 1.06, 1] : 1,
        opacity: 1,
      }}
      exit={{ y: 50, scale: 0.5, opacity: 0 }}
      transition={{ type: "spring", stiffness: 140, damping: 15 }}
      whileDrag={{ cursor: "grabbing", scale: 1.05 }}
      style={{
        position: "fixed",
        bottom: 40,
        right: 40,
        cursor: "grab",
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      <SpritePlayer
        imageSrc={resolveAsset(config.imageSrc)}
        frameWidth={128}
        frameHeight={128}
        frameCount={config.frameCount}
        fps={config.fps}
        loop={config.loop}
      />
    </motion.div>
  );
}
