import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface SpeechBubbleProps {
  text: string;
  onComplete: () => void;
  hold?: boolean;
}

export default function SpeechBubble({ text, onComplete, hold = false }: SpeechBubbleProps) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    let charIndex = 0;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;

    const typeTimer = setInterval(() => {
      charIndex += 1;
      setDisplayedText(text.slice(0, charIndex));

      if (charIndex >= text.length) {
        clearInterval(typeTimer);
        if (!hold) doneTimer = setTimeout(onComplete, 900);
      }
    }, 55);

    return () => {
      clearInterval(typeTimer);
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [hold, onComplete, text]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      style={{
        position: "absolute",
        right: 14,
        bottom: 212,
        width: 196,
        maxWidth: "calc(100vw - 32px)",
        border: "1px solid rgba(80, 55, 32, 0.12)",
        borderRadius: 12,
        background: "rgba(255, 255, 255, 0.96)",
        boxShadow: "0 12px 32px rgba(37, 24, 15, 0.16)",
        color: "#241914",
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
    </motion.div>
  );
}
