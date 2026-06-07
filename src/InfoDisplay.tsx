import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface InfoDisplayProps {
  display: {
    kind: "weather" | "search" | "info";
    title: string;
    content: string;
  };
  onClose: () => void;
  position: "left" | "right";
}

export default function InfoDisplay({ display, onClose, position }: InfoDisplayProps) {
  const [typedLines, setTypedLines] = useState<string[]>([]);
  const { kind, title, content } = display;

  // Subtle typewriter line-by-line entry for high-tech HUD effect
  useEffect(() => {
    const rawLines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    let currentLine = 0;
    const interval = setInterval(() => {
      if (currentLine < rawLines.length) {
        setTypedLines((prev) => [...prev, rawLines[currentLine]]);
        currentLine++;
      } else {
        clearInterval(interval);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [content]);

  // Weather Emoji Selector
  function getWeatherEmoji(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("sunny") || lower.includes("clear") || lower.includes("hot")) return "☀️";
    if (lower.includes("rain") || lower.includes("drizzle") || lower.includes("shower")) return "🌧️";
    if (lower.includes("snow") || lower.includes("freeze") || lower.includes("cold")) return "❄️";
    if (lower.includes("cloud") || lower.includes("overcast") || lower.includes("haze")) return "☁️";
    if (lower.includes("thunder") || lower.includes("storm")) return "⛈️";
    if (lower.includes("wind") || lower.includes("breeze") || lower.includes("blow")) return "💨";
    return "🌡️";
  }

  return (
    <motion.div
      initial={{
        opacity: 0,
        x: position === "left" ? 45 : -45,
        scale: 0.94,
        rotateY: position === "left" ? -8 : 8,
      }}
      animate={{
        opacity: 1,
        x: 0,
        scale: 1,
        rotateY: 0,
      }}
      exit={{
        opacity: 0,
        x: position === "left" ? 30 : -30,
        scale: 0.94,
      }}
      transition={{ type: "spring", stiffness: 120, damping: 17 }}
      className={[
        "bwithu-tv-display",
        position === "left" ? "bwithu-tv-display--left" : "bwithu-tv-display--right",
      ].join(" ")}
      style={{
        position: "absolute",
        top: 10,
        [position === "left" ? "right" : "left"]: 216,
        width: 250,
        maxHeight: 280,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
      }}
    >
      {/* Scanline Grid Overlay Effect */}
      <div className="bwithu-tv-scanlines" aria-hidden="true" />

      {/* Futuristic Header Bar */}
      <div className="bwithu-tv-header">
        <div className="bwithu-tv-status">
          <span className="bwithu-tv-status__led" />
          <span className="bwithu-tv-status__text">{kind.toUpperCase()} HUD</span>
        </div>
        <span className="bwithu-tv-title">{title}</span>
        <button type="button" className="bwithu-tv-close" onClick={onClose} aria-label="Close TV Screen">
          ×
        </button>
      </div>

      {/* Screen Content Dashboard */}
      <div className="bwithu-tv-content scrollbar-thin">
        {kind === "weather" ? (
          <div className="bwithu-tv-weather">
            {typedLines.map((line, idx) => {
              const parts = line.split(":");
              const label = parts[0]?.trim() ?? "";
              const value = parts.slice(1).join(":").trim() ?? "";

              if (idx === 0) {
                // Main temperature/condition display
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bwithu-tv-weather-main"
                  >
                    <span className="bwithu-tv-weather-main__emoji" role="img" aria-label="weather">
                      {getWeatherEmoji(line)}
                    </span>
                    <span className="bwithu-tv-weather-main__text">{line}</span>
                  </motion.div>
                );
              }

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bwithu-tv-weather-grid-item"
                >
                  <span className="bwithu-tv-weather-grid-item__label">{label}</span>
                  <span className="bwithu-tv-weather-grid-item__value">{value || "N/A"}</span>
                </motion.div>
              );
            })}
          </div>
        ) : kind === "search" ? (
          <ul className="bwithu-tv-list bwithu-tv-list--search">
            {typedLines.map((line, idx) => (
              <motion.li
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bwithu-tv-list-item"
              >
                <span className="bwithu-tv-list-item__icon">🌐</span>
                <span className="bwithu-tv-list-item__text">{line}</span>
              </motion.li>
            ))}
          </ul>
        ) : (
          <ul className="bwithu-tv-list bwithu-tv-list--info">
            {typedLines.map((line, idx) => (
              <motion.li
                key={idx}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="bwithu-tv-list-item"
              >
                <span className="bwithu-tv-list-item__bullet" />
                <span className="bwithu-tv-list-item__text">{line}</span>
              </motion.li>
            ))}
          </ul>
        )}
      </div>

      {/* Retro HUD Bottom Details */}
      <div className="bwithu-tv-footer">
        <span className="bwithu-tv-footer__scan">SYS OK</span>
        <span className="bwithu-tv-footer__dots">● ● ●</span>
      </div>
    </motion.div>
  );
}
