import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Bear from "./Bear";
import type { BirthState } from "./animationStates";
import { BIRTH_TIMINGS } from "./animationStates";

const BIRTH_SEQUENCE: BirthState[] = [
  "portal",
  "summon",
  "spawn",
  "awaken",
  "intro",
  "idle",
];

const SPEECH_LINES = [
  "Hi... I'm B.",
  "This is my first day here.",
  "Will you keep me company?",
];

const PARTICLES = Array.from({ length: 8 }, (_, i) => i);

export default function App() {
  const [birthState, setBirthState] = useState<BirthState>("portal");
  const [speechVisible, setSpeechVisible] = useState(false);
  const [displayedText, setDisplayedText] = useState("");
  const birthStateRef = useRef(birthState);
  birthStateRef.current = birthState;

  // ── Birth sequence progression ──────────────────────────────────────────
  useEffect(() => {
    let idx = 0;

    function advance() {
      idx++;
      if (idx >= BIRTH_SEQUENCE.length) return;
      const next = BIRTH_SEQUENCE[idx];
      setBirthState(next);
      if (next !== "idle") {
        setTimeout(advance, BIRTH_TIMINGS[next]);
      }
    }

    const first = setTimeout(advance, BIRTH_TIMINGS.portal);
    return () => clearTimeout(first);
  }, []);

  // ── Speech: starts during awaken, runs independently ───────────────────
  useEffect(() => {
    if (birthState !== "awaken") return;

    let cancelled = false;

    function speakLine(lineIdx: number) {
      if (cancelled || lineIdx >= SPEECH_LINES.length) {
        if (!cancelled) setSpeechVisible(false);
        return;
      }

      const text = SPEECH_LINES[lineIdx];
      setSpeechVisible(true);
      setDisplayedText("");

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = 1.3;
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);

      let charIdx = 0;
      const interval = setInterval(() => {
        if (cancelled) {
          clearInterval(interval);
          return;
        }
        charIdx++;
        setDisplayedText(text.slice(0, charIdx));
        if (charIdx >= text.length) {
          clearInterval(interval);
          setTimeout(() => speakLine(lineIdx + 1), 1600);
        }
      }, 65);
    }

    const delay = setTimeout(() => speakLine(0), 400);

    return () => {
      cancelled = true;
      clearTimeout(delay);
      speechSynthesis.cancel();
    };
  }, [birthState]);

  const bearVisible =
    birthState === "spawn" ||
    birthState === "awaken" ||
    birthState === "intro" ||
    birthState === "idle";

  return (
    <>
      {/* ── Purple portal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {(birthState === "portal" || birthState === "summon") && (
          <motion.div
            key="portal"
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: birthState === "summon" ? [1, 1.25, 1] : 1,
              opacity: 1,
            }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{
              position: "fixed",
              bottom: 56,
              right: 56,
              width: 72,
              height: 72,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, #c084fc, #7c3aed 60%, transparent)",
              boxShadow: "0 0 48px 24px rgba(168, 85, 247, 0.55)",
              pointerEvents: "none",
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Particle burst on spawn ────────────────────────────────────── */}
      <AnimatePresence>
        {birthState === "spawn" && (
          <>
            {PARTICLES.map((i) => {
              const angle = (i / PARTICLES.length) * Math.PI * 2;
              return (
                <motion.div
                  key={`p${i}`}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{
                    x: Math.cos(angle) * 64,
                    y: Math.sin(angle) * 64,
                    opacity: 0,
                    scale: 0,
                  }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                  style={{
                    position: "fixed",
                    bottom: 88,
                    right: 88,
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: i % 2 === 0 ? "#c084fc" : "#f0abfc",
                    pointerEvents: "none",
                  }}
                />
              );
            })}
          </>
        )}
      </AnimatePresence>

      {/* ── Bear ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {bearVisible && <Bear key="bear" birthState={birthState} />}
      </AnimatePresence>

      {/* ── Typewriter speech bubble ───────────────────────────────────── */}
      <AnimatePresence>
        {speechVisible && (
          <motion.div
            key="speech"
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.92 }}
            transition={{ duration: 0.2 }}
            style={{
              position: "fixed",
              bottom: 128,
              right: 40,
              background: "rgba(255, 255, 255, 0.96)",
              borderRadius: 14,
              padding: "10px 14px",
              fontSize: 13,
              lineHeight: 1.5,
              color: "#1a1a2e",
              fontFamily: "system-ui, -apple-system, sans-serif",
              maxWidth: 190,
              boxShadow: "0 4px 24px rgba(0,0,0,0.14)",
              pointerEvents: "none",
              whiteSpace: "pre-wrap",
            }}
          >
            {displayedText}
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ repeat: Infinity, duration: 0.6 }}
              style={{ marginLeft: 1 }}
            >
              |
            </motion.span>
            {/* bubble tail */}
            <div
              style={{
                position: "absolute",
                bottom: -7,
                right: 28,
                width: 0,
                height: 0,
                borderLeft: "7px solid transparent",
                borderRight: "7px solid transparent",
                borderTop: "7px solid rgba(255,255,255,0.96)",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
