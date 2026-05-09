import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import Bear from "./Bear";
import PixelPanel from "./PixelPanel";
import type { BearState } from "./animationStates";
import { nextBehaviorState, stateDuration } from "./behaviorController";
import type { BehaviorEvent } from "./behaviorController";
import type { BrowserAction, ConversationTurn } from "./brainClient";
import { getBrowserContext, runBrowserAction, sendTextMessage, speakText, transcribeAudio } from "./brainClient";
import { collectPageContext } from "./pageContext";
import { RealtimeVoiceSession } from "./realtimeVoice";
import { playClickPop, playHappyChirp, playListenStart, playSpawnChime, playThinkingTick, playTinySparkle } from "./sounds";
import { DEFAULT_SETTINGS, loadSettings, resetBearPosition, saveSettings } from "./storage";
import type { BwithuSettings } from "./storage";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

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

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

interface AppProps {
  enabled?: boolean;
  onRequestHide?: () => void;
}

export default function App({ enabled = true, onRequestHide }: AppProps) {
  const [bearState, setBearState] = useState<BearState>("hidden");
  const [showIntro, setShowIntro] = useState(false);
  const [speechText, setSpeechText] = useState("");
  const [settings, setSettings] = useState<BwithuSettings>(DEFAULT_SETTINGS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [messages, setMessages] = useState<ConversationTurn[]>([]);
  const [pendingAction, setPendingAction] = useState<BrowserAction | null>(null);
  const [status, setStatus] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [liveCaption, setLiveCaption] = useState("");
  const [assistantCaption, setAssistantCaption] = useState("");
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introFinishedRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const realtimeVoiceRef = useRef<RealtimeVoiceSession | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalTranscriptRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((next) => {
      if (!cancelled) setSettings(next);
    });
    return () => {
      cancelled = true;
    };
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
      setBearState((current) => {
        const next = nextBehaviorState(current, event);
        const duration = stateDuration(next);
        if (duration > 0) {
          clearStateTimer();
          stateTimerRef.current = setTimeout(() => setBearState("idle"), duration);
        }
        return next;
      });
    },
    [clearStateTimer],
  );

  const scheduleIdleEvent = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      dispatchBehavior("idleTimeout");
    }, 5000 + Math.random() * 6000);
  }, [clearIdleTimer, dispatchBehavior]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!enabled) {
        clearIdleTimer();
        clearStateTimer();
        setShowIntro(false);
        setSpeechText("");
        setLiveCaption("");
        setAssistantCaption("");
        setPanelOpen(false);
        setBearState("hidden");
        realtimeVoiceRef.current?.close();
        realtimeVoiceRef.current = null;
        return;
      }

      introFinishedRef.current = false;
      setShowIntro(false);
      setSpeechText("");
      setAssistantCaption("");
      setPanelOpen(true);
      setBearState("spawning");
      if (settings.soundEnabled) {
        playSpawnChime();
        playTinySparkle();
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [clearIdleTimer, clearStateTimer, enabled, settings.soundEnabled]);

  useEffect(() => {
    if (bearState === "idle") scheduleIdleEvent();
    return clearIdleTimer;
  }, [bearState, clearIdleTimer, scheduleIdleEvent]);

  useEffect(() => {
    function reactToScroll() {
      dispatchBehavior("scroll");
    }

    window.addEventListener("scroll", reactToScroll, { passive: true });
    return () => window.removeEventListener("scroll", reactToScroll);
  }, [dispatchBehavior]);

  const handleSettingsChange = useCallback((next: BwithuSettings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);

  const playVoiceReply = useCallback(async (text: string) => {
    if (!settings.voiceEnabled || !settings.apiKey) return;

    try {
      const blob = await speakText(text, settings);
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
    if (settings.voiceEnabled && settings.apiKey) void playVoiceReply("Hi. I'm B. This is my first day here.");
  }, [playVoiceReply, settings.apiKey, settings.soundEnabled, settings.voiceEnabled]);

  const handleIntroComplete = useCallback(() => {
    if (introFinishedRef.current) return;
    introFinishedRef.current = true;
    setShowIntro(false);
    setBearState("wave");
  }, []);

  const handleLoopComplete = useCallback(() => {
    setBearState("idle");
  }, []);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!settings.apiKey) {
        setPanelOpen(true);
        setStatus("Add your xAI API key, or run npm run seed:key and rebuild locally.");
        setSpeechText("I need my Grok key before I can think.");
        return;
      }

      const userTurn: ConversationTurn = { role: "user", content: text };
      const nextHistory = [...messages, userTurn].slice(-8);
      setMessages(nextHistory);
      setAssistantCaption("");
      setSpeechText("Thinking...");
      setStatus("B is thinking...");
      if (settings.soundEnabled) playThinkingTick();
      dispatchBehavior("messageStarted");

      try {
        const reply = await sendTextMessage(text, settings, nextHistory, collectPageContext());
        const assistantTurn: ConversationTurn = { role: "assistant", content: reply.message };
        setMessages([...nextHistory, assistantTurn].slice(-8));
        setAssistantCaption(reply.message);
        setSpeechText(reply.message);
        setPendingAction(reply.type === "browser_action" && reply.action ? reply.action : null);
        setStatus(reply.requiresConfirmation ? "B needs your confirmation." : "");
        dispatchBehavior(reply.type === "browser_action" ? "messageEnded" : "messageEnded");
        if (settings.soundEnabled) playHappyChirp();
        void playVoiceReply(reply.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : "B had trouble reaching Grok.";
        setStatus(message);
        setSpeechText(message);
        setBearState("curious");
      }
    },
    [dispatchBehavior, messages, playVoiceReply, settings],
  );

  const stopRecording = useCallback(() => {
    if (realtimeVoiceRef.current) {
      realtimeVoiceRef.current.stop(false);
      realtimeVoiceRef.current.close();
      realtimeVoiceRef.current = null;
      setIsRecording(false);
      dispatchBehavior("voiceEnded");
      return;
    }

    recognitionRef.current?.stop();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, [dispatchBehavior]);

  const startLegacyRecording = useCallback(async () => {
    if (isRecording) return;
    if (!settings.apiKey) {
      setPanelOpen(true);
      setStatus("Add your xAI API key, or run npm run seed:key and rebuild locally.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        recognition.onerror = () => {
          recognitionRef.current = null;
        };
        recognition.onend = () => {
          recognitionRef.current = null;
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
          void handleSendMessage(caption);
          return;
        }

        setStatus("Catching your words...");
        void transcribeAudio(blob, settings)
          .then((text) => {
            setStatus(text ? "B heard you." : "B did not catch that.");
            setLiveCaption(text);
            if (text) void handleSendMessage(text);
          })
          .catch((error) => {
            setStatus(error instanceof Error ? error.message : "B could not transcribe that.");
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
      setStatus("Microphone permission is needed for push-to-talk.");
      setSpeechText("I need mic permission to hear you.");
    }
  }, [dispatchBehavior, handleSendMessage, isRecording, settings]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    if (!settings.apiKey) {
      setPanelOpen(true);
      setStatus("Add your xAI API key, or run npm run seed:key and rebuild locally.");
      return;
    }

    setLiveCaption("");
    setAssistantCaption("");
    setSpeechText("I'm listening...");
      setStatus("Opening live voice...");
      if (settings.soundEnabled) playListenStart();
      dispatchBehavior("voiceStarted");

    try {
      const browserContext = await getBrowserContext(collectPageContext());
      const session = new RealtimeVoiceSession(settings, {
        onUserTranscript: (text) => {
          setLiveCaption(text);
          setMessages((current) => [...current, { role: "user" as const, content: text }].slice(-8));
        },
        onAssistantText: (text) => {
          setAssistantCaption(text);
          setSpeechText(text || "...");
        },
        onAssistantDone: (text) => {
          if (text) {
            setMessages((current) => [...current, { role: "assistant" as const, content: text }].slice(-8));
            setAssistantCaption(text);
            setSpeechText(text);
          }
          setIsRecording(false);
          if (settings.soundEnabled) playHappyChirp();
          dispatchBehavior("messageEnded");
          realtimeVoiceRef.current?.close();
          realtimeVoiceRef.current = null;
        },
        onStatus: setStatus,
      }, browserContext);
      realtimeVoiceRef.current = session;
      await session.start();
      setIsRecording(true);
    } catch {
      realtimeVoiceRef.current?.close();
      realtimeVoiceRef.current = null;
      setStatus("Live voice fell back to normal voice.");
      await startLegacyRecording();
    }
  }, [dispatchBehavior, isRecording, settings, startLegacyRecording]);

  const handleConfirmAction = useCallback(async () => {
    if (!pendingAction) return;
    setStatus("B is doing it...");
    if (settings.soundEnabled) playClickPop();
    try {
      const result = await runBrowserAction(pendingAction);
      setStatus(result);
      setSpeechText(result);
      if (pendingAction.kind === "hide_bear") onRequestHide?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "B could not complete that action.";
      setStatus(message);
      setSpeechText(message);
    } finally {
      setPendingAction(null);
    }
  }, [onRequestHide, pendingAction, settings.soundEnabled]);

  const handleResetPosition = useCallback(() => {
    void resetBearPosition();
    setStatus("B will start from his default spot next time.");
  }, []);

  return (
    <AnimatePresence>
      {enabled && bearState !== "hidden" && (
        <>
          {bearState === "spawning" && <div className="bwithu-portal" aria-hidden="true" />}
          <Bear
            key="b"
            state={bearState}
            showIntro={showIntro}
            speechText={speechText}
            settings={settings}
            panelOpen={panelOpen}
            onSpawnComplete={handleSpawnComplete}
            onIntroComplete={handleIntroComplete}
            onLoopComplete={handleLoopComplete}
            onRequestWave={() => dispatchBehavior("clicked")}
            onOpenPanel={() => setPanelOpen(true)}
            onDragReaction={() => dispatchBehavior("dragged")}
            onHoverReaction={() => dispatchBehavior("hovered")}
          />
          {panelOpen && (
            <PixelPanel
              settings={settings}
              messages={messages}
              pendingAction={pendingAction}
              status={status}
              isRecording={isRecording}
              liveCaption={liveCaption}
              assistantCaption={assistantCaption}
              onSettingsChange={handleSettingsChange}
              onSendMessage={handleSendMessage}
              onToggleRecording={() => {
                if (isRecording) stopRecording();
                else void startRecording();
              }}
              onConfirmAction={handleConfirmAction}
              onCancelAction={() => setPendingAction(null)}
              onResetPosition={handleResetPosition}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </>
      )}
    </AnimatePresence>
  );
}
