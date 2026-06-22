import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface InfoDisplayProps {
  display: {
    kind: "weather" | "search" | "info" | "tab_picker" | "confirmation" | "error" | "memory";
    title: string;
    content: string;
  };
  onClose: () => void;
  position: "left" | "right" | "center";
  onConfirmAction?: () => void;
  onCancelAction?: () => void;
  onSelectTab?: (tabId: number) => void;
}

export default function InfoDisplay({
  display,
  onClose,
  position,
  onConfirmAction,
  onCancelAction,
  onSelectTab,
}: InfoDisplayProps) {
  const [typedLines, setTypedLines] = useState<string[]>([]);
  const { kind, title, content } = display;

  const [prevContent, setPrevContent] = useState(content);
  if (content !== prevContent) {
    setPrevContent(content);
    setTypedLines([]);
  }

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
    }, 120);

    return () => clearInterval(interval);
  }, [content]);

  // Auto-collapse for non-interactive cards after 8 seconds
  useEffect(() => {
    const interactiveKinds = ["tab_picker", "confirmation"];
    if (interactiveKinds.includes(kind)) return;

    const timer = setTimeout(() => {
      onClose();
    }, 8000);

    return () => clearTimeout(timer);
  }, [kind, onClose]);

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
        x: position === "center" ? "-50%" : (position === "left" ? 45 : -45),
        scale: 0.94,
        rotateY: position === "center" ? 0 : (position === "left" ? -8 : 8),
      }}
      animate={{
        opacity: 1,
        x: position === "center" ? "-50%" : 0,
        scale: 1,
        rotateY: 0,
      }}
      exit={{
        opacity: 0,
        x: position === "center" ? "-50%" : (position === "left" ? 30 : -30),
        scale: 0.94,
      }}
      transition={{ type: "spring", stiffness: 120, damping: 17 }}
      className={[
        "bwithu-tv-display",
        `bwithu-tv-display--${kind}`,
        position === "left" ? "bwithu-tv-display--left" : (position === "right" ? "bwithu-tv-display--right" : "bwithu-tv-display--center"),
      ].join(" ")}
      style={{
        position: "absolute",
        top: 10,
        ...(position === "center"
          ? { left: "50%" }
          : { [position === "left" ? "right" : "left"]: 216 }),
        width: position === "center" ? 280 : 250,
        maxHeight: 280,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        zIndex: 99999,
      }}
    >
      {/* Scanline Grid Overlay Effect */}
      <div className="bwithu-tv-scanlines" aria-hidden="true" />

      {/* Futuristic Header Bar */}
      <div className="bwithu-tv-header">
        <div className="bwithu-tv-status">
          <span className="bwithu-tv-status__led" />
          <span className="bwithu-tv-status__text">
            {kind === "tab_picker" ? "TAB LIST" : kind === "confirmation" ? "CONFIRM" : kind.toUpperCase()}
          </span>
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
                <span className="bwithu-tv-list-item__icon">🔍</span>
                <span className="bwithu-tv-list-item__text">{line}</span>
              </motion.li>
            ))}
          </ul>
        ) : kind === "tab_picker" ? (
          <div className="bwithu-tv-tab-picker">
            {typedLines.map((line, idx) => {
              const colonIdx = line.indexOf(":");
              if (colonIdx === -1) return null;
              const id = parseInt(line.substring(0, colonIdx), 10);
              const name = line.substring(colonIdx + 1);

              return (
                <motion.button
                  key={idx}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  type="button"
                  className="bwithu-tv-tab-btn"
                  onClick={() => onSelectTab?.(id)}
                >
                  <span className="bwithu-tv-tab-btn__bullet">●</span>
                  <span className="bwithu-tv-tab-btn__name">{name}</span>
                </motion.button>
              );
            })}
          </div>
        ) : kind === "confirmation" ? (
          <div className="bwithu-tv-confirm">
            <p className="bwithu-tv-confirm__prompt">{content}</p>
            <div className="bwithu-tv-confirm__actions">
              <button
                type="button"
                className="bwithu-tv-confirm-btn bwithu-tv-confirm-btn--yes"
                onClick={onConfirmAction}
              >
                Do it
              </button>
              <button
                type="button"
                className="bwithu-tv-confirm-btn bwithu-tv-confirm-btn--no"
                onClick={onCancelAction}
              >
                Not now
              </button>
            </div>
          </div>
        ) : kind === "error" ? (
          <div className="bwithu-tv-error">
            <div className="bwithu-tv-error__icon">⚠️</div>
            <p className="bwithu-tv-error__text">{content}</p>
          </div>
        ) : kind === "memory" ? (
          <ul className="bwithu-tv-list bwithu-tv-list--memory">
            {typedLines.map((line, idx) => (
              <motion.li
                key={idx}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="bwithu-tv-list-item"
              >
                <span className="bwithu-tv-list-item__icon">💭</span>
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
