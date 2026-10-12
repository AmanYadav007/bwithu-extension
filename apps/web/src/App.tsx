import { useEffect, useRef, useState } from "react";
import { GLBCharacter, SvgCompanion } from "@bwithu/ui";
import type { BearMood, BearState } from "@bwithu/shared";

type Mode = "audio" | "video";
type Screen = "welcome" | "call";

const MODEL_SRC = `${import.meta.env.BASE_URL}model.glb`;
const SVG_ARTWORK_SRC = `${import.meta.env.BASE_URL}characters/male/character.svg`;

export default function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [mode, setMode] = useState<Mode>("audio");
  const [note, setNote] = useState("");

  if (screen === "welcome") {
    return (
      <Welcome
        mode={mode}
        setMode={setMode}
        onStart={(next) => {
          setMode(next);
          setNote("");
          setScreen("call");
        }}
      />
    );
  }

  return <Call mode={mode} note={note} setNote={setNote} onEnd={() => setScreen("welcome")} />;
}

interface WelcomeProps {
  mode: Mode;
  setMode: (mode: Mode) => void;
  onStart: (mode: Mode) => void;
}

function Welcome({ mode, setMode, onStart }: WelcomeProps) {
  return (
    <div className="bw-screen bw-welcome">
      <header className="bw-brand">
        <span className="bw-brand__mark" aria-hidden="true" />
        <span className="bw-brand__name">BwithU</span>
      </header>

      <main className="bw-welcome__main">
        <h1>Your companion, on call.</h1>
        <p className="bw-welcome__sub">
          Talk naturally with a warm, voice-first companion — right in your browser.
        </p>

        <div className="bw-mode" role="radiogroup" aria-label="Call mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "audio"}
            className={mode === "audio" ? "bw-mode__btn bw-mode__btn--on" : "bw-mode__btn"}
            onClick={() => setMode("audio")}
          >
            <span className="bw-mode__dot" aria-hidden="true" />
            Audio call
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "video"}
            className={mode === "video" ? "bw-mode__btn bw-mode__btn--on" : "bw-mode__btn"}
            onClick={() => setMode("video")}
          >
            <span className="bw-mode__dot" aria-hidden="true" />
            Video call
          </button>
        </div>

        <button type="button" className="bw-primary" onClick={() => onStart(mode)}>
          Start Talking
        </button>
      </main>

      <footer className="bw-foot">No account needed · conversation stays on this device</footer>
    </div>
  );
}

interface CallProps {
  mode: Mode;
  note: string;
  setNote: (note: string) => void;
  onEnd: () => void;
}

function Call({ mode, note, setNote, onEnd }: CallProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 300, height: 440 });
  const [glbFailed, setGlbFailed] = useState(false);

  // Size the GLB canvas to the stage (quantized to avoid renderer re-creation).
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let last = { width: 0, height: 0 };
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      if (Math.abs(next.width - last.width) < 16 && Math.abs(next.height - last.height) < 16) return;
      last = next;
      setSize(next);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="bw-screen bw-call">
      <header className="bw-call__header">
        <span className="bw-call__name">Companion</span>
        <span className="bw-call__status">
          <i aria-hidden="true" />
          Ready
        </span>
      </header>

      <div className="bw-call__stage" ref={areaRef}>
        {glbFailed ? (
          <SvgCompanion src={SVG_ARTWORK_SRC} state="idle" />
        ) : (
          <GLBCharacter
            modelSrc={MODEL_SRC}
            state={"idle" as BearState}
            mood={"calm" as BearMood}
            facing={1}
            width={size.width}
            height={size.height}
            onLoadError={() => setGlbFailed(true)}
          />
        )}
        {mode === "video" && (
          <div className="bw-call__self" aria-label="Your camera preview (arrives in Phase 4)">
            <span>Camera preview — Phase 4</span>
          </div>
        )}
      </div>

      <div className="bw-call__caption" aria-live="polite">
        {note || null}
      </div>

      <div className="bw-call__controls">
        <button
          type="button"
          className="bw-control bw-control--primary"
          onClick={() => setNote("Voice arrives in Phase 2 — this is the scaffold.")}
          aria-label="Start talking"
        >
          <span className="bw-control__mic" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bw-control"
          onClick={() => setNote("Text chat arrives in Phase 3.")}
          aria-label="Open text chat"
        >
          Chat
        </button>
        <button type="button" className="bw-control bw-control--end" onClick={onEnd} aria-label="End call">
          End
        </button>
      </div>
    </div>
  );
}
