import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import Bear from "./Bear";
import type { BearState } from "./animationStates";
import { playSpawnChime, playTinySparkle } from "./sounds";

interface AppProps {
  enabled?: boolean;
}

export default function App({ enabled = true }: AppProps) {
  const [bearState, setBearState] = useState<BearState>("hidden");
  const [showIntro, setShowIntro] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introFinishedRef = useRef(false);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const scheduleBlink = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      setBearState((current) => (current === "idle" ? "blink" : current));
    }, 5000 + Math.random() * 5000);
  }, [clearIdleTimer]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!enabled) {
        clearIdleTimer();
        setShowIntro(false);
        setBearState("hidden");
        return;
      }

      introFinishedRef.current = false;
      setShowIntro(false);
      setBearState("spawning");
      playSpawnChime();
      playTinySparkle();
    }, 0);

    return () => clearTimeout(timer);
  }, [clearIdleTimer, enabled]);

  useEffect(() => {
    if (!enabled) {
      clearIdleTimer();
      return;
    }
  }, [clearIdleTimer, enabled]);

  useEffect(() => {
    if (bearState === "idle") {
      scheduleBlink();
    }

    return clearIdleTimer;
  }, [bearState, clearIdleTimer, scheduleBlink]);

  const handleSpawnComplete = useCallback(() => {
    setBearState("intro");
    setShowIntro(true);
  }, []);

  const handleIntroComplete = useCallback(() => {
    if (introFinishedRef.current) return;
    introFinishedRef.current = true;
    setShowIntro(false);
    setBearState("wave");
  }, []);

  const handleWaveComplete = useCallback(() => {
    setBearState("idle");
  }, []);

  const handleBlinkComplete = useCallback(() => {
    setBearState("idle");
  }, []);

  const handleRequestWave = useCallback(() => {
    if (bearState === "hidden" || bearState === "spawning") return;
    clearIdleTimer();
    setShowIntro(false);
    setBearState("wave");
  }, [bearState, clearIdleTimer]);

  return (
    <AnimatePresence>
      {enabled && bearState !== "hidden" && (
        <Bear
          key="b"
          state={bearState}
          showIntro={showIntro}
          onSpawnComplete={handleSpawnComplete}
          onIntroComplete={handleIntroComplete}
          onBlinkComplete={handleBlinkComplete}
          onWaveComplete={handleWaveComplete}
          onRequestWave={handleRequestWave}
        />
      )}
    </AnimatePresence>
  );
}
