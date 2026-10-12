import { useEffect, useRef, useState } from "react";
import { GLBCharacter, SvgCompanion } from "@bwithu/ui";
import { RealtimeVoiceSession, loadSettings, loadMessages, saveMessages } from "@bwithu/shared";
import type { BearMood, BearState, BwithuSettings, ConversationTurn } from "@bwithu/shared";

type Mode = "audio" | "video";
type Screen = "welcome" | "call";
type CallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "error" | "ended";

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
  const [settings, setSettings] = useState<BwithuSettings | null>(null);
  const [messages, setMessages] = useState<ConversationTurn[]>([]);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const isMountedRef = useRef(true);
  const pendingUserTranscriptRef = useRef("");
  const pendingAssistantTranscriptRef = useRef("");
  const assistantDoneRef = useRef(false);
  const sessionEndedRef = useRef(false);

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

  // Load settings and messages on mount
  useEffect(() => {
    isMountedRef.current = true;
    sessionEndedRef.current = false;
    loadSettings().then((s) => {
      if (isMountedRef.current) setSettings(s);
    });
    loadMessages().then((msgs) => {
      if (isMountedRef.current) setMessages(msgs);
    });
    return () => {
      isMountedRef.current = false;
      // Cleanup session on unmount
      if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
      }
    };
  }, []);

  // Persist messages when they change (but not on every partial transcript)
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  const handleStatus = (status: string) => {
    if (!isMountedRef.current) return;
    const lower = status.toLowerCase();
    if (lower.includes("connecting")) setCallStatus("connecting");
    else if (lower.includes("listening")) setCallStatus("listening");
    else if (lower.includes("thinking")) setCallStatus("thinking");
    else if (lower.includes("muted")) setCallStatus("muted");
    else if (lower.includes("error")) setCallStatus("error");
    else if (lower.includes("ended") || lower.includes("stopped")) setCallStatus("ended");
    else if (lower.includes("speaking") || lower.includes("reply")) setCallStatus("speaking");
    setNote(status);
  };

  const handleUserTranscript = (text: string) => {
    if (!isMountedRef.current) return;
    pendingUserTranscriptRef.current = text;
    setUserTranscript(text);
    setCallStatus("listening");
  };

  const handleAssistantText = (text: string) => {
    if (!isMountedRef.current) return;
    pendingAssistantTranscriptRef.current = text;
    setAssistantTranscript(text);
    setCallStatus("speaking");
  };

  const handleAssistantDone = (text: string) => {
    if (!isMountedRef.current || sessionEndedRef.current) return;
    const finalText = text.trim();
    if (finalText) {
      // Save completed turn
      setMessages((prev) => {
        // Avoid duplicate if already added
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.content === finalText) return prev;
        return [...prev, { role: "assistant", content: finalText }];
      });
    }
    pendingAssistantTranscriptRef.current = "";
    setAssistantTranscript("");
    assistantDoneRef.current = true;
    setCallStatus("listening");
  };

  const startSession = async () => {
    if (!settings || sessionRef.current) return;
    setError(null);
    setCallStatus("connecting");
    setUserTranscript("");
    setAssistantTranscript("");
    pendingUserTranscriptRef.current = "";
    pendingAssistantTranscriptRef.current = "";
    assistantDoneRef.current = false;

    const pageContextGetter = async () => {
      // In web app, no browser context; return empty or page info
      return `Current page: ${document.title} (${window.location.href})`;
    };

    const session = new RealtimeVoiceSession(
      settings,
      {
        onUserTranscript: handleUserTranscript,
        onAssistantText: handleAssistantText,
        onAssistantDone: handleAssistantDone,
        onStatus: handleStatus,
      },
      pageContextGetter,
    );

    sessionRef.current = session;

    try {
      await session.start();
      if (!isMountedRef.current) {
        session.close();
        return;
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : "Failed to start voice session.";
      setError(msg);
      setCallStatus("error");
      setNote(`Error: ${msg}`);
      sessionRef.current = null;
    }
  };

  const endCall = () => {
    sessionEndedRef.current = true;
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setCallStatus("ended");
    setUserTranscript("");
    setAssistantTranscript("");
    setIsMuted(false);
    // Save any pending transcripts
    if (pendingUserTranscriptRef.current.trim()) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "user" && last.content === pendingUserTranscriptRef.current.trim()) return prev;
        return [...prev, { role: "user", content: pendingUserTranscriptRef.current.trim() }];
      });
      pendingUserTranscriptRef.current = "";
    }
    onEnd();
  };

  const toggleMute = () => {
    if (!sessionRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    sessionRef.current.setMuted(nextMuted);
  };

  const handleMicClick = () => {
    if (callStatus === "idle" || callStatus === "ended" || callStatus === "error") {
      startSession();
    } else if (callStatus === "listening" || callStatus === "thinking" || callStatus === "speaking") {
      toggleMute();
    }
  };

  // Determine mic button appearance
  const micButtonClass = callStatus === "idle" || callStatus === "ended" || callStatus === "error"
    ? "bw-control bw-control--primary"
    : isMuted
      ? "bw-control bw-control--primary bw-control--muted"
      : "bw-control bw-control--primary bw-control--active";

  // Status dot color
  const statusDotClass = callStatus === "error" ? "bw-status__dot--error"
    : callStatus === "ended" || callStatus === "idle" ? "bw-status__dot--idle"
    : isMuted ? "bw-status__dot--muted"
    : "bw-status__dot--active";

  // Status text
  const statusText = error
    ? "Error"
    : callStatus === "connecting"
      ? "Connecting..."
      : callStatus === "listening"
        ? "Listening..."
        : callStatus === "thinking"
          ? "Thinking..."
          : callStatus === "speaking"
            ? "Speaking..."
            : callStatus === "muted"
              ? "Muted"
              : callStatus === "ended"
                ? "Ended"
                : "Ready";

  return (
    <div className="bw-screen bw-call">
      <header className="bw-call__header">
        <span className="bw-call__name">Companion</span>
        <span className="bw-call__status">
          <i className={statusDotClass} aria-hidden="true" />
          {statusText}
        </span>
      </header>

      <div className="bw-call__stage" ref={areaRef}>
        {glbFailed ? (
          <SvgCompanion src={SVG_ARTWORK_SRC} state="idle" />
        ) : (
          <GLBCharacter
            modelSrc={MODEL_SRC}
            state={callStatus === "speaking" ? "talk" : callStatus === "listening" ? "listen" : "idle"}
            mood="calm"
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
        {assistantTranscript || userTranscript || note || null}
      </div>

      {error && (
        <div className="bw-call__error" role="alert">
          {error}
        </div>
      )}

      <div className="bw-call__controls">
        <button
          type="button"
          className={micButtonClass}
          onClick={handleMicClick}
          aria-label={isMuted ? "Unmute" : callStatus === "idle" ? "Start talking" : "Mute"}
          disabled={callStatus === "connecting"}
        >
          <span className={`bw-control__mic ${isMuted ? "bw-control__mic--muted" : ""}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bw-control"
          onClick={() => setNote("Text chat arrives in Phase 3.")}
          aria-label="Open text chat"
          disabled
        >
          Chat
        </button>
        <button type="button" className="bw-control bw-control--end" onClick={endCall} aria-label="End call">
          End
        </button>
      </div>
    </div>
  );
}