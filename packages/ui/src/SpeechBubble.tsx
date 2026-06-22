import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface SpeechBubbleProps {
  text: string;
  onComplete: () => void;
  hold?: boolean;
  immediate?: boolean;
  isSidePanel?: boolean;
}

export default function SpeechBubble({ text, onComplete, hold = false, immediate = false, isSidePanel = false }: SpeechBubbleProps) {
  const [internalDisplayedText, setInternalDisplayedText] = useState("");

  useEffect(() => {
    if (immediate) {
      return;
    }

    let charIndex = 0;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;

    const typeTimer = setInterval(() => {
      charIndex += 1;
      setInternalDisplayedText(text.slice(0, charIndex));

      if (charIndex >= text.length) {
        clearInterval(typeTimer);
        if (!hold) doneTimer = setTimeout(onComplete, 900);
      }
    }, 55);

    return () => {
      clearInterval(typeTimer);
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [hold, onComplete, text, immediate]);

  const displayedText = immediate ? text : internalDisplayedText;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      style={{
        position: "absolute",
        left: isSidePanel ? 16 : "auto",
        right: 16,
        bottom: isSidePanel ? 96 : 212,
        width: isSidePanel ? "auto" : 196,
        maxWidth: "calc(100vw - 32px)",
        border: isSidePanel ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(80, 55, 32, 0.12)",
        borderRadius: 14,
        background: isSidePanel ? "rgba(15, 10, 8, 0.88)" : "rgba(255, 255, 255, 0.96)",
        boxShadow: isSidePanel ? "0 10px 24px rgba(0, 0, 0, 0.35)" : "0 12px 32px rgba(37, 24, 15, 0.16)",
        color: isSidePanel ? "#f8fafc" : "#241914",
        backdropFilter: isSidePanel ? "blur(16px)" : "none",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 13,
        lineHeight: 1.45,
        padding: "10px 12px",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
      }}
    >
      {displayedText}
      <motion.span
        animate={{ opacity: [1, 0] }}
        transition={{ repeat: Infinity, duration: 0.7 }}
        style={{ marginLeft: 1 }}
      >
        |
      </motion.span>
      {!isSidePanel && (
        <span
          style={{
            position: "absolute",
            right: 34,
            bottom: -7,
            width: 14,
            height: 14,
            background: "rgba(255, 255, 255, 0.96)",
            borderBottom: "1px solid rgba(80, 55, 32, 0.1)",
            borderRight: "1px solid rgba(80, 55, 32, 0.1)",
            transform: "rotate(45deg)",
          }}
        />
      )}
    </motion.div>
  );
}
