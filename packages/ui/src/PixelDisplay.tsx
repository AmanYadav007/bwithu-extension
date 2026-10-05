import { useEffect, useRef, useState } from "react";

export interface PixelDisplayData {
  kind: "weather" | "search" | "info" | "tab_picker" | "confirmation" | "error" | "memory";
  title: string;
  content: string;
}

interface PixelDisplayProps {
  display: PixelDisplayData;
  onClose: () => void;
  onConfirmAction?: () => void;
  onCancelAction?: () => void;
  onSelectTab?: (tabId: number) => void;
}

const KIND_LABEL: Record<PixelDisplayData["kind"], string> = {
  weather: "Weather",
  search: "Found this",
  info: "Look",
  tab_picker: "Your tabs",
  confirmation: "Okay?",
  error: "Uh oh",
  memory: "I remember",
};

const AUTO_CLOSE_MS = 10000;
const URL_PATTERN = /(https?:\/\/[^\s)]+)/;

function weatherIcon(text: string) {
  const lower = text.toLowerCase();
  if (/thunder|storm/.test(lower)) return "⛈️";
  if (/rain|drizzle|shower/.test(lower)) return "🌧️";
  if (/snow|freez|cold/.test(lower)) return "❄️";
  if (/cloud|overcast|haze|fog|mist/.test(lower)) return "☁️";
  if (/wind|breez/.test(lower)) return "💨";
  if (/sun|clear|hot/.test(lower)) return "☀️";
  return "🌡️";
}

/** Renders a line, turning a URL in it into a link that opens in a new tab. */
function LineText({ line }: { line: string }) {
  const match = line.match(URL_PATTERN);
  if (!match) return <>{line}</>;
  const [before, after] = [line.slice(0, match.index), line.slice((match.index ?? 0) + match[0].length)];
  let label = match[0];
  try {
    label = new URL(match[0]).hostname.replace(/^www\./, "");
  } catch {
    // Not a parseable URL; show it as written.
  }
  return (
    <>
      {before}
      <a href={match[0]} target="_blank" rel="noreferrer">
        {label}
      </a>
      {after}
    </>
  );
}

/** The companion's pop-up screen: a pixel window it holds up to show you things. */
export default function PixelDisplay({ display, onClose, onConfirmAction, onCancelAction, onSelectTab }: PixelDisplayProps) {
  const { kind, title } = display;
  // The model sometimes sends a display card without content.
  const content = display.content ?? "";
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const interactive = kind === "tab_picker" || kind === "confirmation";
  const [shownLines, setShownLines] = useState(0);
  const [hovered, setHovered] = useState(false);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Reveal line by line, like the companion is writing it out.
  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setShownLines(count);
      if (count >= lines.length) clearInterval(timer);
    }, 110);
    return () => {
      clearInterval(timer);
      setShownLines(0);
    };
  }, [content, lines.length]);

  useEffect(() => {
    if (interactive || hovered) return undefined;
    const timer = setTimeout(() => closeRef.current(), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [interactive, hovered, content]);

  const visible = lines.slice(0, shownLines);

  return (
    <div
      className={`bwithu-px-display bwithu-px-display--${kind}`}
      role={interactive ? "dialog" : "status"}
      aria-label={title || KIND_LABEL[kind]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="bwithu-px-display__bar">
        <span className="bwithu-px-display__tag">{KIND_LABEL[kind]}</span>
        <span className="bwithu-px-display__title">{title}</span>
        <button type="button" className="bwithu-px-display__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="bwithu-px-display__body">
        {kind === "weather" ? (
          <div className="bwithu-px-weather">
            {visible[0] && (
              <div className="bwithu-px-weather__main">
                <span className="bwithu-px-weather__icon" aria-hidden="true">{weatherIcon(content)}</span>
                <span>{visible[0]}</span>
              </div>
            )}
            <dl className="bwithu-px-weather__grid">
              {visible.slice(1).map((line, index) => {
                const [label, ...rest] = line.split(":");
                return (
                  <div key={index}>
                    <dt>{label.trim()}</dt>
                    <dd>{rest.join(":").trim() || "N/A"}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ) : kind === "tab_picker" ? (
          <div className="bwithu-px-tabs">
            {visible.map((line, index) => {
              const colon = line.indexOf(":");
              if (colon === -1) return null;
              const tabId = Number.parseInt(line.slice(0, colon), 10);
              return (
                <button key={index} type="button" onClick={() => onSelectTab?.(tabId)}>
                  <span className="bwithu-px-tabs__index">{index + 1}</span>
                  <span className="bwithu-px-tabs__name">{line.slice(colon + 1).trim()}</span>
                </button>
              );
            })}
          </div>
        ) : kind === "confirmation" ? (
          <div className="bwithu-px-confirm">
            <p>{content}</p>
            <div>
              <button type="button" className="bwithu-px-confirm__yes" onClick={onConfirmAction}>
                Do it
              </button>
              <button type="button" className="bwithu-px-confirm__no" onClick={onCancelAction}>
                Not now
              </button>
            </div>
          </div>
        ) : kind === "error" ? (
          <p className="bwithu-px-error">
            <span aria-hidden="true">!</span>
            {content}
          </p>
        ) : (
          <ol className={`bwithu-px-list bwithu-px-list--${kind}`}>
            {visible.map((line, index) => (
              <li key={index}>
                <span className="bwithu-px-list__marker" aria-hidden="true">
                  {kind === "search" ? index + 1 : kind === "memory" ? "♥" : ""}
                </span>
                <span>
                  <LineText line={line} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
