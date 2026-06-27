import { useCallback, useEffect, useRef, useState } from "react";
import { Bear, PixelPanel, playClickPop, playHappyChirp, playListenStart, playSpawnChime, playThinkingTick, playTinySparkle } from "@bwithu/ui";
import {
  useBearStore,
  nextBehaviorState,
  stateDuration,
  RealtimeVoiceSession,
  loadSettings,
  saveSettings,
  loadMessages,
  saveMessages,
  resetBearPosition,
  DEFAULT_SETTINGS,
  sendBrainMessage,
  transcribeAudio,
  speakText,
  getSearchQuery,
  collectWebContext,
} from "@bwithu/shared";
import type { BearState, BehaviorEvent, BrowserAction, BrainReply, ConversationTurn, BwithuSettings } from "@bwithu/shared";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type MicPermissionStatus = "unknown" | "prompt" | "requesting" | "granted" | "denied" | "unsupported";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
}

declare global {
  interface Window {
    electron?: {
      setAlwaysOnTop: (alwaysOnTop: boolean) => void;
      getAlwaysOnTop: () => Promise<boolean>;
      onShortcutToggle: (callback: () => void) => void;
    };
  }
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function looksLikeWebIntent(text: string) {
  return /\b(today|latest|current|now|recent|news|weather|price|pricing|research|compare|best|recommend|reviews|look up|find out|search the web)\b/i.test(
    text,
  );
}

function micPermissionLabel(status: MicPermissionStatus) {
  switch (status) {
    case "granted": return "Mic is on";
    case "denied": return "Mic is blocked";
    case "requesting": return "Asking for mic...";
    case "unsupported": return "Mic unavailable";
    case "prompt": return "Mic needs permission";
    default: return "Mic not checked";
  }
}

function callStateLabel(state: BearState, status: string, isRecording: boolean) {
  if (isRecording || state === "listen") return "Listening...";
  if (state === "think") return "Thinking...";
  if (state === "talk" || status.toLowerCase().includes("answering")) return "Speaking...";
  if (state === "searching" || status.toLowerCase().includes("search")) return "Searching...";
  return "Ready";
}

function cleanLiveCaption(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();
  cleaned = cleaned.replace(/(You're talking[\s.,!?]*)+/gi, "You're talking... ").trim();
  const words = cleaned.split(/\s+/);
  const result: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i === 0 || words[i].toLowerCase() !== words[i - 1].toLowerCase()) {
      result.push(words[i]);
    }
  }
  cleaned = result.join(" ");
  if (cleaned.length > 140) {
    cleaned = cleaned.slice(0, 137) + "...";
  }
  return cleaned.trim();
}

export default function App() {
  const [bearState, setBearState] = useState<BearState>("hidden");
  const [showIntro, setShowIntro] = useState(false);
  const [speechText, setSpeechText] = useState("");
  const [settings, setSettings] = useState<BwithuSettings>(DEFAULT_SETTINGS);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [panelSettingsOpen, setPanelSettingsOpen] = useState(false);
  const [callDraft, setCallDraft] = useState("");
  const [messages, setMessages] = useState<ConversationTurn[]>([]);
  const [pendingAction, setPendingAction] = useState<BrowserAction | null>(null);
  const [status, setStatus] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [voiceDialogueActive, setVoiceDialogueActive] = useState(false);
  const [micPermissionStatus, setMicPermissionStatus] = useState<MicPermissionStatus>("unknown");
  const [activeDisplay, setActiveDisplay] = useState<BrainReply["display"] | null>(null);
  const [liveCaption, setLiveCaption] = useState("");
  const [assistantCaption, setAssistantCaption] = useState("");
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  const [viewport, setViewport] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 320,
    height: typeof window !== "undefined" ? window.innerHeight : 600,
  });

  useEffect(() => {
    function handleResize() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introFinishedRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const realtimeVoiceRef = useRef<RealtimeVoiceSession | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalTranscriptRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const handleSendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);

  const mood = useBearStore((store) => store.mood);
  const dispatchMoodEvent = useBearStore((store) => store.dispatchMoodEvent);
  const refreshEnvironmentalMood = useBearStore((store) => store.refreshEnvironmentalMood);

  // Sync window Always-on-top state with Electron
  useEffect(() => {
    if (window.electron) {
      window.electron.setAlwaysOnTop(alwaysOnTop);
    }
  }, [alwaysOnTop]);

  // IPC listener for global shortcut show/hide
  useEffect(() => {
    if (window.electron?.onShortcutToggle) {
      window.electron.onShortcutToggle(() => {
        // Toggle character display state or wave
        dispatchBehavior("hovered");
      });
    }
  }, [dispatchMoodEvent]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSettings(), loadMessages()]).then(([nextSettings, nextMessages]) => {
      if (!cancelled) {
        setSettings(nextSettings);
        setMessages(nextMessages);
        if (nextSettings.onboardingCompleted === false) {
          setShowChatPanel(true);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void saveMessages(messages);
  }, [messages]);

  const refreshMicPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermissionStatus("unsupported");
      return "unsupported" as MicPermissionStatus;
    }
    try {
      const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      const next = permission?.state === "granted" ? "granted" : permission?.state === "denied" ? "denied" : "prompt";
      setMicPermissionStatus(next);
      permission.onchange = () => {
        void refreshMicPermission();
      };
      return next;
    } catch {
      setMicPermissionStatus("prompt");
      return "prompt" as MicPermissionStatus;
    }
  }, []);

  useEffect(() => {
    void refreshMicPermission();
  }, [refreshMicPermission]);

  const requestMicrophoneAccess = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermissionStatus("unsupported");
      setStatus("I need microphone permission to hear you.");
      return false;
    }
    setMicPermissionStatus("requesting");
    setStatus("Requesting microphone...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermissionStatus("granted");
      return true;
    } catch (err) {
      setMicPermissionStatus("denied");
      setStatus("Microphone access denied. Enable it in system settings.");
      return false;
    }
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearStateTimer = useCallback(() => {
    if (stateTimerRef.current) {
      clearTimeout(stateTimerRef.current);
      stateTimerRef.current = null;
    }
  }, []);

  const dispatchBehavior = useCallback(
    (event: BehaviorEvent) => {
      dispatchMoodEvent(event);
      setBearState((current) => {
        const next = nextBehaviorState(current, event, mood);
        const duration = stateDuration(next);
        if (duration > 0) {
          clearStateTimer();
          stateTimerRef.current = setTimeout(() => setBearState("idle"), duration);
        }
        return next;
      });
    },
    [clearStateTimer, dispatchMoodEvent, mood],
  );

  const scheduleIdleEvent = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      dispatchBehavior("idleTimeout");
    }, 5000 + Math.random() * 6000);
  }, [clearIdleTimer, dispatchBehavior]);

  useEffect(() => {
    const timer = setTimeout(() => {
      introFinishedRef.current = false;
      setShowIntro(false);
      setSpeechText("");
      setAssistantCaption("");
      setShowChatPanel(false);
      setBearState("spawning");
      if (settings.soundEnabled) {
        playSpawnChime();
        playTinySparkle();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [clearIdleTimer, clearStateTimer, settings.soundEnabled]);

  useEffect(() => {
    if (bearState === "idle") scheduleIdleEvent();
    return clearIdleTimer;
  }, [bearState, clearIdleTimer, scheduleIdleEvent]);

  const bearStateRef = useRef<BearState>(bearState);
  useEffect(() => {
    bearStateRef.current = bearState;
  }, [bearState]);

  useEffect(() => {
    function reactToScroll() {
      if (bearStateRef.current !== "hidden") {
        dispatchBehavior("scroll");
      }
    }
    window.addEventListener("scroll", reactToScroll, { passive: true });
    return () => window.removeEventListener("scroll", reactToScroll);
  }, [dispatchBehavior]);

  useEffect(() => {
    const timer = setInterval(refreshEnvironmentalMood, 60_000);
    return () => clearInterval(timer);
  }, [refreshEnvironmentalMood]);

  const playVoiceReply = useCallback(async (text: string) => {
    if (!settings.voiceEnabled || (!settings.apiKey && !settings.proxyUrl && !settings.openAiKey)) return;
    try {
      const audioData = await speakText(text, settings);
      const blob = new Blob([new Uint8Array(audioData.bytes)], { type: audioData.mimeType });
      const url = URL.createObjectURL(blob);
      audioRef.current?.pause();
      audioRef.current = new Audio(url);
      audioRef.current.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      await audioRef.current.play();
    } catch {
      setStatus("B could not speak this time, but he heard you.");
    }
  }, [settings]);

  const handleSpawnComplete = useCallback(() => {
    setBearState("intro");
    setShowIntro(true);
    if (settings.soundEnabled) playTinySparkle();
    const introText = settings.companionName
      ? `Hi. I'm ${settings.companionName}. This is my first day here.`
      : "Hi... I'm a little bear, but I don't have a name yet. What would you like to call me?";
    setSpeechText(introText);
    if (settings.voiceEnabled && (settings.apiKey || settings.proxyUrl)) {
      void playVoiceReply(introText);
    }
  }, [playVoiceReply, settings.apiKey, settings.proxyUrl, settings.soundEnabled, settings.voiceEnabled, settings.companionName]);

  const handleIntroComplete = useCallback(() => {
    if (introFinishedRef.current) return;
    introFinishedRef.current = true;
    setShowIntro(false);
    setBearState("wave");
  }, []);

  useEffect(() => {
    if (!showIntro || !speechText) return undefined;
    const timer = window.setTimeout(handleIntroComplete, Math.min(5200, Math.max(2200, speechText.length * 38)));
    return () => window.clearTimeout(timer);
  }, [handleIntroComplete, showIntro, speechText]);

  const handleVoiceAudioEnded = useCallback(() => {
    if (voiceDialogueActive) {
      window.setTimeout(() => {
        if (!realtimeVoiceRef.current) {
          void startRecordingRef.current?.();
        }
      }, 550);
    }
  }, [voiceDialogueActive]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const companionName = settings.companionName || "";

      if (!companionName) {
        const chosenName = text.trim();
        if (chosenName.length > 0) {
          const updatedSettings = { ...settings, companionName: chosenName };
          setSettings(updatedSettings);
          void saveSettings(updatedSettings);
          const userTurn: ConversationTurn = { role: "user" as const, content: `I'd like to call you ${chosenName}.` };
          const assistantReply = `Okay, from now on you can call me ${chosenName}! I can talk with you (🎙️), and search the web (🔍)!`;
          const assistantTurn: ConversationTurn = { role: "assistant" as const, content: assistantReply };
          setMessages([userTurn, assistantTurn]);
          setSpeechText(assistantReply);
          setAssistantCaption(assistantReply);
          setStatus("");
          dispatchBehavior("messageEnded");
          if (settings.soundEnabled) playHappyChirp();
          if (settings.voiceEnabled) void playVoiceReply(assistantReply);
          return;
        }
      }

      if (!settings.apiKey && !settings.proxyUrl && !settings.openAiKey) {
        setStatus("Add your Grok/OpenAI key or check connection settings.");
        setSpeechText("I need my key setup before I can think.");
        return;
      }

      const userTurn: ConversationTurn = { role: "user", content: text };
      const nextHistory = [...messages, userTurn].slice(-8);
      const needsSearch = looksLikeWebIntent(text);
      setMessages(nextHistory);
      setAssistantCaption("");
      setSpeechText(needsSearch ? "Let me look that up..." : "Thinking...");
      setStatus(needsSearch ? `${companionName || "B"} is checking the internet...` : `${companionName || "B"} is thinking...`);
      if (settings.soundEnabled) playThinkingTick();
      dispatchBehavior(needsSearch ? "searchStarted" : "messageStarted");
      setActiveDisplay(null);

      try {
        const browserContext = "Standalone desktop companion wrapper mode.";
        const searchQuery = getSearchQuery(text);
        const webContext = searchQuery ? await collectWebContext(searchQuery, settings) : "";
        const reply = await sendBrainMessage(text, settings, nextHistory, browserContext, webContext, []);

        let assistantMessage = reply.message;

        if (reply.memoryUpdate) {
          const oldMemory = settings.memory || "";
          const newMemory = (oldMemory + " " + reply.memoryUpdate).trim();
          const updatedSettings = { ...settings, memory: newMemory };
          setSettings(updatedSettings);
          void saveSettings(updatedSettings);
        }

        if (reply.type === "browser_action" && reply.action && !reply.requiresConfirmation) {
          // Extension triggers browser actions. On desktop MVP, ignore tab switching, calendar, etc.
          assistantMessage = reply.message || "I tried performing that command, but I can't interact with your browser from outside the extension yet.";
        }

        let voiceBlobUrl: string | null = null;
        if (settings.voiceEnabled) {
          try {
            const audioData = await speakText(assistantMessage, settings);
            const blob = new Blob([new Uint8Array(audioData.bytes)], { type: audioData.mimeType });
            voiceBlobUrl = URL.createObjectURL(blob);
          } catch {
            // silent fallback
          }
        }

        const assistantTurn: ConversationTurn = { role: "assistant", content: assistantMessage };
        setMessages([...nextHistory, assistantTurn].slice(-8));
        setAssistantCaption(assistantMessage);
        setSpeechText(assistantMessage);
        if (reply.display) {
          setActiveDisplay(reply.display);
        }

        setPendingAction(null); // No browser actions in desktop MVP
        setStatus("");
        dispatchBehavior(needsSearch ? "searchEnded" : "messageEnded");
        if (settings.soundEnabled) playHappyChirp();

        if (voiceBlobUrl) {
          audioRef.current?.pause();
          audioRef.current = new Audio(voiceBlobUrl);
          audioRef.current.addEventListener("ended", () => {
            URL.revokeObjectURL(voiceBlobUrl!);
            handleVoiceAudioEnded();
          }, { once: true });
          await audioRef.current.play();
        } else {
          window.setTimeout(handleVoiceAudioEnded, 2000);
        }
      } catch (error) {
        setStatus("I had trouble with that. Let's try again in a bit!");
        setSpeechText("Let me look at that again.");
        setBearState("curious");
      }
    },
    [dispatchBehavior, messages, settings, handleVoiceAudioEnded, playVoiceReply],
  );

  const stopRecording = useCallback(() => {
    setVoiceDialogueActive(false);
    if (realtimeVoiceRef.current) {
      realtimeVoiceRef.current.stop(true);
      realtimeVoiceRef.current.close();
      realtimeVoiceRef.current = null;
      setIsRecording(false);
      dispatchBehavior("voiceEnded");
      return;
    }
    recognitionRef.current?.stop();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, [dispatchBehavior]);

  const startLegacyRecording = useCallback(async () => {
    if (isRecording) return;
    setVoiceDialogueActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      chunksRef.current = [];
      finalTranscriptRef.current = "";
      setLiveCaption("");
      setAssistantCaption("");
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const SpeechRecognition = getSpeechRecognition();
      const recognition = SpeechRecognition ? new SpeechRecognition() : null;

      if (recognition) {
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognition.onresult = (event) => {
          let interim = "";
          let finalText = "";
          for (let index = 0; index < event.results.length; index += 1) {
            const result = event.results[index];
            const transcript = result[0]?.transcript ?? "";
            if (result.isFinal) finalText += transcript;
            else interim += transcript;
          }
          if (finalText.trim()) finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalText}`.trim();
          setLiveCaption((finalTranscriptRef.current || interim).trim());
          setSpeechText((finalTranscriptRef.current || interim || "I'm listening...").trim());
        };
        recognitionRef.current = recognition;
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const caption = finalTranscriptRef.current.trim();
        setIsRecording(false);
        dispatchBehavior("voiceEnded");

        if (caption) {
          setStatus("B heard you.");
          setLiveCaption(caption);
          void handleSendMessageRef.current?.(caption);
          return;
        }

        setStatus("Catching your words...");
        const audioArrPromise = blob.arrayBuffer().then((buf) => Array.from(new Uint8Array(buf)));
        audioArrPromise
          .then((audioArr) => transcribeAudio(audioArr, blob.type || "audio/webm", settings))
          .then((text) => {
            setStatus(text ? "B heard you." : "B did not catch that.");
            setLiveCaption(text);
            if (text) void handleSendMessageRef.current?.(text);
          })
          .catch(() => {
            setStatus("B could not transcribe that.");
            setSpeechText("I could not catch that. Try again?");
          });
      };
      recorder.start();
      recognition?.start();
      setIsRecording(true);
      setStatus("Listening live...");
      setSpeechText("I'm listening...");
      if (settings.soundEnabled) playListenStart();
      dispatchBehavior("voiceStarted");
    } catch {
      setStatus("Microphone permission is needed.");
    }
  }, [dispatchBehavior, isRecording, settings]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    const hasMicAccess = await requestMicrophoneAccess();
    if (!hasMicAccess) return;

    setVoiceDialogueActive(true);
    setShowChatPanel(false);
    setLiveCaption("");
    setAssistantCaption("");
    setSpeechText("I'm listening...");
    setStatus("Opening live voice...");
    if (settings.soundEnabled) playListenStart();
    dispatchBehavior("voiceStarted");
    setBearState("listen");

    try {
      const session = new RealtimeVoiceSession(settings, {
        onUserTranscript: (text) => {
          setBearState("listen");
          setLiveCaption(text);
          setMessages((current) => [...current, { role: "user" as const, content: text }].slice(-8));
        },
        onAssistantText: (text) => {
          setBearState("talk");
          setAssistantCaption(text);
          setSpeechText(text || "...");
        },
        onAssistantDone: (text) => {
          setBearState("talk");
          if (text) {
            setMessages((current) => [...current, { role: "assistant" as const, content: text }].slice(-8));
            setAssistantCaption(text);
            setSpeechText(text);
          }
          if (settings.soundEnabled) playHappyChirp();
          dispatchBehavior("messageEnded");
          window.setTimeout(() => {
            if (realtimeVoiceRef.current) {
              setStatus("Listening live...");
              setBearState("listen");
              dispatchBehavior("voiceStarted");
            }
          }, 450);
        },
        onStatus: (nextStatus) => {
          setStatus(nextStatus);
          const lowered = nextStatus.toLowerCase();
          if (lowered.includes("listening")) {
            setBearState("listen");
            setLiveCaption("");
            setAssistantCaption("");
          } else if (lowered.includes("thinking") || lowered.includes("connecting")) {
            setBearState("think");
          } else if (lowered.includes("answering") || lowered.includes("speaking")) {
            setBearState("talk");
          }
        },
      }, async () => "Standalone Desktop Window Context");
      realtimeVoiceRef.current = session;
      await session.start();
      setIsRecording(true);
    } catch {
      realtimeVoiceRef.current?.close();
      realtimeVoiceRef.current = null;
      setSpeechText("Trying the backup mic...");
      await startLegacyRecording();
    }
  }, [dispatchBehavior, isRecording, requestMicrophoneAccess, settings, startLegacyRecording]);

  const handleMicButtonClick = useCallback(() => {
    if (isRecording) stopRecording();
    else void startRecording();
  }, [isRecording, startRecording, stopRecording]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
    handleSendMessageRef.current = handleSendMessage;
  }, [startRecording, handleSendMessage]);

  const latestUserMessage = cleanLiveCaption(liveCaption || [...messages].reverse().find((message) => message.role === "user")?.content || "");
  const latestAssistantMessage = assistantCaption || speechText || [...messages].reverse().find((message) => message.role === "assistant")?.content || "";
  const companionName = settings.companionName || "B";
  const liveStateText = callStateLabel(bearState, status, isRecording);

  const sendCallDraft = useCallback(() => {
    const text = callDraft.trim();
    if (!text) return;
    setCallDraft("");
    void handleSendMessage(text);
  }, [callDraft, handleSendMessage]);

  return (
    <div className="bwithu-sidepanel-layout" style={{ height: "100vh", overflow: "hidden" }}>
      <header className="bwithu-call-header" style={{ WebkitAppRegion: "drag" } as any}>
        <div>
          <span className="bwithu-call-header__eyebrow">BwithU Companion</span>
          <strong>{companionName}</strong>
        </div>
        <span className={`bwithu-call-header__status bwithu-call-header__status--${mood}`}>
          {liveStateText}
        </span>
      </header>

      <div className={`bwithu-bear-area bwithu-bear-area--mood-${mood}`} style={{ height: "calc(100% - 130px)", position: "relative" }}>
        {bearState !== "hidden" && (
          <Bear
            key="b"
            state={bearState}
            showIntro={showIntro}
            speechText={speechText}
            settings={settings}
            mood={mood}
            panelOpen={showChatPanel}
            display={activeDisplay}
            pendingAction={pendingAction}
            onCloseDisplay={() => setActiveDisplay(null)}
            onConfirmAction={() => {}}
            onCancelAction={() => setPendingAction(null)}
            isRecording={isRecording}
            onToggleRecording={handleMicButtonClick}
            immediateSpeech={isRecording || voiceDialogueActive}
            onSpawnComplete={handleSpawnComplete}
            onIntroComplete={handleIntroComplete}
            onLoopComplete={() => setBearState("idle")}
            onRequestWave={() => dispatchBehavior("clicked")}
            onOpenPanel={() => setShowChatPanel(true)}
            onDragReaction={() => dispatchBehavior("dragged")}
            onHoverReaction={() => dispatchBehavior("hovered")}
            isSidePanel={true}
            sidePanelWidth={viewport.width}
            sidePanelHeight={viewport.height}
            controls={
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  zIndex: 99999,
                  pointerEvents: "auto",
                }}
              >
                <button
                  type="button"
                  onClick={() => setAlwaysOnTop(!alwaysOnTop)}
                  style={{
                    background: alwaysOnTop ? "rgba(74, 222, 128, 0.2)" : "rgba(239, 68, 68, 0.2)",
                    border: alwaysOnTop ? "1px solid rgb(74, 222, 128)" : "1px solid rgb(239, 68, 68)",
                    color: "#fff",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "10px",
                    cursor: "pointer",
                    textTransform: "uppercase",
                  }}
                >
                  {alwaysOnTop ? "Always-on-top 📌" : "Always-on-top 📍"}
                </button>
              </div>
            }
          />
        )}
        {!showChatPanel && (latestAssistantMessage || latestUserMessage) && (
          <div className="bwithu-conversation-strip" aria-live="polite">
            {latestUserMessage && (
              <div className="bwithu-conversation-bubble bwithu-conversation-bubble--user">
                {latestUserMessage}
              </div>
            )}
            {latestAssistantMessage && (
              <div className="bwithu-conversation-bubble bwithu-conversation-bubble--assistant">
                {latestAssistantMessage}
              </div>
            )}
          </div>
        )}
      </div>

      {showChatPanel && (
        <PixelPanel
          settings={settings}
          messages={messages}
          pendingAction={pendingAction}
          status={status}
          micPermissionStatus={micPermissionLabel(micPermissionStatus)}
          settingsOpen={panelSettingsOpen}
          isRecording={isRecording}
          liveCaption={liveCaption}
          assistantCaption={assistantCaption}
          onSettingsChange={(nextSettings) => {
            setSettings(nextSettings);
            void saveSettings(nextSettings);
          }}
          onSendMessage={handleSendMessage}
          onConfirmAction={() => {}}
          onCancelAction={() => setPendingAction(null)}
          onResetPosition={async () => {
            await resetBearPosition();
            setStatus("Position reset!");
          }}
          onRequestMicAccess={requestMicrophoneAccess}
          onSettingsOpenChange={setPanelSettingsOpen}
          onClose={() => {
            setShowChatPanel(false);
            setPanelSettingsOpen(false);
          }}
        />
      )}

      {settings.onboardingCompleted && !showChatPanel && (
        <form
          className="bwithu-call-controls"
          onSubmit={(event) => {
            event.preventDefault();
            sendCallDraft();
          }}
        >
          <button
            type="button"
            className={`bwithu-call-control bwithu-call-control--mic${isRecording ? " bwithu-call-control--active" : ""}`}
            onClick={handleMicButtonClick}
            title={isRecording ? "Stop listening" : "Talk to B"}
          >
            🎙️
          </button>
          <input
            value={callDraft}
            onChange={(event) => setCallDraft(event.target.value)}
            placeholder={`Message ${companionName}...`}
            aria-label={`Message ${companionName}`}
          />
          <button type="submit" className="bwithu-call-control" title="Send message">➤</button>
          <button type="button" className="bwithu-call-control bwithu-call-control--quiet" onClick={() => setShowChatPanel(true)} title="Settings">⚙️</button>
        </form>
      )}
    </div>
  );
}
