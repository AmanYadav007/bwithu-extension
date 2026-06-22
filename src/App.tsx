import { useCallback, useEffect, useRef, useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;
import Bear from "./Bear";
import PixelPanel from "./PixelPanel";
import type { BearState } from "./animationStates";
import { nextBehaviorState, stateDuration } from "./behaviorController";
import type { BehaviorEvent } from "./behaviorController";
import type { BrowserAction, BrainReply, ConversationTurn } from "./brainClient";
import { getBrowserContext, runBrowserAction, sendTextMessage, speakText, transcribeAudio } from "./brainClient";
import { useBearStore } from "./bearStore";
import { getActivePageContext } from "./pageContext";
import { RealtimeVoiceSession } from "./realtimeVoice";
import { playClickPop, playHappyChirp, playListenStart, playSpawnChime, playThinkingTick, playTinySparkle } from "./sounds";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, loadMessages, saveMessages, resetBearPosition } from "./storage";
import type { BwithuSettings } from "./storage";

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
    case "granted":
      return "Mic is on";
    case "denied":
      return "Mic is blocked";
    case "requesting":
      return "Asking for mic...";
    case "unsupported":
      return "Mic unavailable";
    case "prompt":
      return "Mic needs permission";
    case "unknown":
    default:
      return "Mic not checked";
  }
}

function cleanLiveCaption(text: string): string {
  if (!text) return "";
  
  let cleaned = text.trim();
  
  // Remove "You're talking" loops specifically
  cleaned = cleaned.replace(/(You're talking[\s.,!?]*)+/gi, () => {
    return "You're talking... ";
  }).trim();
  
  // Collapse duplicate adjacent words
  const words = cleaned.split(/\s+/);
  const result: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i === 0 || words[i].toLowerCase() !== words[i - 1].toLowerCase()) {
      result.push(words[i]);
    }
  }
  cleaned = result.join(" ");

  // Trim to 140 characters
  if (cleaned.length > 140) {
    cleaned = cleaned.slice(0, 137) + "...";
  }
  
  return cleaned.trim();
}

function callStateLabel(state: BearState, status: string, isRecording: boolean) {
  if (isRecording || state === "listen") return "Listening...";
  if (state === "think") return "Thinking...";
  if (state === "talk" || status.toLowerCase().includes("answering")) return "Speaking...";
  if (state === "searching" || status.toLowerCase().includes("search")) return "Searching...";
  return "Ready";
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

  const [viewport, setViewport] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 320,
    height: typeof window !== "undefined" ? window.innerHeight : 600,
  });

  useEffect(() => {
    function handleResize() {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
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

  const handleVoiceAudioEnded = useCallback(() => {
    if (voiceDialogueActive) {
      window.setTimeout(() => {
        if (realtimeVoiceRef.current) {
          // WebRTC socket handles continuous conversation naturally
        } else {
          // Fallback push-to-talk mic loop, automatically restart listening
          void startRecordingRef.current?.();
        }
      }, 550);
    }
  }, [voiceDialogueActive]);

  const mood = useBearStore((store) => store.mood);
  const dispatchMoodEvent = useBearStore((store) => store.dispatchMoodEvent);
  const refreshEnvironmentalMood = useBearStore((store) => store.refreshEnvironmentalMood);

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

  const openSettingsPanel = useCallback(() => {
    setShowChatPanel(true);
    setPanelSettingsOpen(true);
  }, []);

  const requestMicrophoneAccess = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermissionStatus("unsupported");
      console.log("Microphone failed");
      setStatus("I need microphone permission to hear you.");
      setSpeechText("I need microphone permission to hear you.");
      return false;
    }

    setMicPermissionStatus("requesting");
    setStatus("Requesting microphone...");
    console.log("Requesting microphone");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermissionStatus("granted");
      console.log("Microphone granted");
      return true;
    } catch (err) {
      console.log("Microphone failed:", err);
      setMicPermissionStatus("denied");
      setStatus("Setting up microphone permission...");
      setSpeechText("I need microphone permission to hear you. Opening permission tab...");
      
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html") });
      }
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
      if (!enabled) {
        clearIdleTimer();
        clearStateTimer();
        setShowIntro(false);
        setSpeechText("");
        setLiveCaption("");
        setAssistantCaption("");
        setShowChatPanel(false);
        setBearState("hidden");
        realtimeVoiceRef.current?.close();
        realtimeVoiceRef.current = null;
        return;
      }

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
  }, [clearIdleTimer, clearStateTimer, enabled, settings.soundEnabled]);

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
    if (typeof chrome !== "undefined" && chrome.tabs) {
      const handleActivated = () => {
        dispatchBehavior("hovered"); // look around when user switches tab
      };
      chrome.tabs.onActivated.addListener(handleActivated);
      chrome.tabs.onUpdated.addListener(handleActivated);
      return () => {
        chrome.tabs.onActivated.removeListener(handleActivated);
        chrome.tabs.onUpdated.removeListener(handleActivated);
      };
    }
  }, [dispatchBehavior]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(refreshEnvironmentalMood, 60_000);
    return () => clearInterval(timer);
  }, [refreshEnvironmentalMood, enabled]);

  const playVoiceReply = useCallback(async (text: string) => {
    if (!settings.voiceEnabled || (!settings.apiKey && !settings.proxyUrl)) return;

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

  const runCommandDiagnostics = useCallback(async () => {
    const name = settings.companionName || "B";
    console.log(`🛠️ Starting ${name} Command Diagnostics Test Suite...`);
    const tests = [
      { cmd: "What is this page about?", desc: "Test page context extraction" },
      { cmd: "Summarize this page", desc: "Test summarization tool" },
      { cmd: "Search latest AI news", desc: "Test Brave web search" },
      { cmd: "What's the weather in Mumbai?", desc: "Test weather search & TV display" },
      { cmd: "Open YouTube", desc: "Test URL opening" },
      { cmd: "Switch to tab 2", desc: "Test tab switching" },
      { cmd: "Hide yourself", desc: "Test hiding action" },
      { cmd: "What tabs are open?", desc: "Test tab list context" },
      { cmd: "Remember my name is Aman", desc: "Test long-term memory update" },
      { cmd: "What do you remember about me?", desc: "Test memory retrieval" }
    ];

    for (const [idx, t] of tests.entries()) {
      try {
        console.log(`[${idx + 1}/10] Testing: "${t.cmd}" (${t.desc})`);
        
        // Simulating the flow
        const reply = await sendTextMessage(t.cmd, settings, [], await getActivePageContext());
        
        if (reply && (reply.message || reply.action || reply.display)) {
          console.log(`✅ Passed: "${t.cmd}" -> Received message length: ${reply.message?.length || 0}`);
          if (reply.action) console.log(`   Action parsed:`, reply.action);
          if (reply.display) console.log(`   Display info:`, reply.display);
          if (reply.memoryUpdate) console.log(`   Memory updated: "${reply.memoryUpdate}"`);
        } else {
          throw new Error("Empty reply received from model");
        }
      } catch (err) {
        console.error(`❌ Failed: "${t.cmd}" -> Error:`, err);
      }
    }
    console.log("🛠️ BWithU Diagnostics Completed!");
  }, [settings]);

  const handleLoopComplete = useCallback(() => {
    setBearState("idle");
  }, []);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const companionName = settings.companionName || "";

      // INTERCEPT USER INPUT TO SET COMPANION NAME ON FIRST RUN
      if (!companionName) {
        const chosenName = text.trim();
        if (chosenName.length > 0) {
          const updatedSettings = { ...settings, companionName: chosenName };
          setSettings(updatedSettings);
          void saveSettings(updatedSettings);

          const userTurn: ConversationTurn = { role: "user" as const, content: `I'd like to call you ${chosenName}.` };
          const assistantReply = `Okay, from now on you can call me ${chosenName}! I can talk with you (🎙️), read this page (📄), and search the web (🔍)!`;
          const assistantTurn: ConversationTurn = { role: "assistant" as const, content: assistantReply };
          
          setMessages([userTurn, assistantTurn]);
          setSpeechText(assistantReply);
          setAssistantCaption(assistantReply);
          setStatus("");
          dispatchBehavior("messageEnded");
          
          if (settings.soundEnabled) playHappyChirp();
          if (settings.voiceEnabled) {
            void playVoiceReply(assistantReply);
          }
          return;
        }
      }

      if (text.trim().toLowerCase() === "/test") {
        setSpeechText("Running command diagnostics in developer console...");
        setStatus("Running tests...");
        void runCommandDiagnostics().then(() => {
          setSpeechText("Command diagnostics complete! Check console.");
          setStatus("");
        });
        return;
      }

      if (!settings.apiKey && !settings.proxyUrl) {
        setStatus("Add your Grok key or check connection settings.");
        setSpeechText("I need my Grok key setup before I can think.");
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
      setActiveDisplay(null); // Clear previous TV screen details

      try {
        const reply = await sendTextMessage(text, settings, nextHistory, await getActivePageContext());
        let assistantMessage = reply.message;

        // Persist learned user facts to settings memory
        if (reply.memoryUpdate) {
          const oldMemory = settings.memory || "";
          const newMemory = (oldMemory + " " + reply.memoryUpdate).trim();
          const updatedSettings = { ...settings, memory: newMemory };
          setSettings(updatedSettings);
          void saveSettings(updatedSettings);
        }
        if (reply.type === "browser_action" && reply.action && !reply.requiresConfirmation) {
          assistantMessage = await runBrowserAction(reply.action);
        }

        // PRE-FETCH VOICE FOR SEAMLESS SYNC
        let voiceBlobUrl: string | null = null;
        if (settings.voiceEnabled) {
          try {
            const blob = await speakText(assistantMessage, settings);
            voiceBlobUrl = URL.createObjectURL(blob);
          } catch {
            // silent fallback
          }
        }

        const assistantTurn: ConversationTurn = { role: "assistant", content: assistantMessage };
        setMessages([...nextHistory, assistantTurn].slice(-8));
        setAssistantCaption(assistantMessage);

        // Launch speech bubble and slide out TV screen synchronously!
        setSpeechText(assistantMessage);
        if (reply.display) {
          setActiveDisplay(reply.display);
        }

        setPendingAction(reply.type === "browser_action" && reply.action && reply.requiresConfirmation ? reply.action : null);
        setStatus(reply.requiresConfirmation ? "B needs your confirmation." : "");
        dispatchBehavior(needsSearch ? "searchEnded" : "messageEnded");
        if (settings.soundEnabled) playHappyChirp();

        // PLAY PRE-FETCHED AUDIO AND REGISTER MIC LOOP TRIGGER
        if (voiceBlobUrl) {
          audioRef.current?.pause();
          audioRef.current = new Audio(voiceBlobUrl);
          audioRef.current.addEventListener("ended", () => {
            URL.revokeObjectURL(voiceBlobUrl!);
            handleVoiceAudioEnded();
          }, { once: true });
          await audioRef.current.play();
        } else {
          // If no audio, trigger ended loop directly after a brief timeout
          window.setTimeout(handleVoiceAudioEnded, 2000);
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : "";
        let friendlyMessage = "I had trouble with that. Let's try again in a bit!";
        
        if (errMessage.includes("API key")) {
          friendlyMessage = `I need my API key setup to think. Could you check my settings?`;
        } else if (errMessage.includes("restricted") || errMessage.includes("permission")) {
          friendlyMessage = "I need permission for that, or this page might be restricted.";
        } else if (errMessage.includes("Brave") || errMessage.includes("search")) {
          friendlyMessage = "I had trouble searching the web. Let me try another way.";
        }
        
        setStatus(friendlyMessage);
        setSpeechText(friendlyMessage);
        setBearState("curious");
      }
    },
    [dispatchBehavior, messages, settings, handleVoiceAudioEnded, playVoiceReply, runCommandDiagnostics],
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
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, [dispatchBehavior]);

  const startLegacyRecording = useCallback(async () => {
    if (isRecording) return;
    if (!settings.apiKey && !settings.proxyUrl) {
      setStatus("Add your xAI API key, or run npm run seed:key and rebuild locally.");
      return;
    }

    setVoiceDialogueActive(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
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
          void handleSendMessageRef.current?.(caption);
          return;
        }

        setStatus("Catching your words...");
        void transcribeAudio(blob, settings)
          .then((text) => {
            setStatus(text ? "B heard you." : "B did not catch that.");
            setLiveCaption(text);
            if (text) void handleSendMessageRef.current?.(text);
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
  }, [dispatchBehavior, isRecording, settings]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    const hasMicAccess = await requestMicrophoneAccess();
    if (!hasMicAccess) return;

    if (!settings.apiKey && !settings.proxyUrl && !settings.openAiKey) {
      setStatus("Add your API key in settings first.");
      setSpeechText("I can hear you now. Add an API key so I can answer live.");
      return;
    }

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
      const browserContext = await getBrowserContext(await getActivePageContext());
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
          if (lowered.includes("listening")) setBearState("listen");
          else if (lowered.includes("thinking") || lowered.includes("connecting")) setBearState("think");
          else if (lowered.includes("answering") || lowered.includes("speaking")) setBearState("talk");
        },
      }, browserContext);
      realtimeVoiceRef.current = session;
      await session.start();
      setIsRecording(true);
    } catch (error) {
      realtimeVoiceRef.current?.close();
      realtimeVoiceRef.current = null;
      const message = error instanceof Error ? error.message : "Live voice fell back to normal voice.";
      setSpeechText(message.includes("API key") ? "I need my voice key first." : "Trying the backup mic...");
      setStatus(message);
      await startLegacyRecording();
    }
  }, [dispatchBehavior, isRecording, requestMicrophoneAccess, settings, startLegacyRecording]);

  const handleMicButtonClick = useCallback(() => {
    console.log("Mic button clicked");
    if (isRecording) stopRecording();
    else void startRecording();
  }, [isRecording, startRecording, stopRecording]);

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

  const handleSelectTab = useCallback(async (tabId: number) => {
    setActiveDisplay(null);
    setStatus("Switched tabs.");
    if (settings.soundEnabled) playClickPop();
    try {
      await runBrowserAction({ kind: "switch_tab", payload: { tabId: String(tabId) } });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not switch tab.");
    }
  }, [settings.soundEnabled]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
    handleSendMessageRef.current = handleSendMessage;
  }, [startRecording, handleSendMessage]);

  const latestUserMessage = cleanLiveCaption(liveCaption || [...messages].reverse().find((message) => message.role === "user")?.content || "");
  const latestAssistantMessage =
    assistantCaption ||
    speechText ||
    [...messages].reverse().find((message) => message.role === "assistant")?.content ||
    "";
  const companionName = settings.companionName || "B";
  const liveStateText = callStateLabel(bearState, status, isRecording);

  const sendCallDraft = useCallback(() => {
    const text = callDraft.trim();
    if (!text) return;
    setCallDraft("");
    void handleSendMessage(text);
  }, [callDraft, handleSendMessage]);

  const sendCallCommand = useCallback((text: string) => {
    setCallDraft("");
    void handleSendMessage(text);
  }, [handleSendMessage]);

  return (
    <div className="bwithu-sidepanel-layout">
      <header className="bwithu-call-header">
        <div>
          <span className="bwithu-call-header__eyebrow">BwithU</span>
          <strong>{companionName} Call</strong>
        </div>
        <span className={`bwithu-call-header__status bwithu-call-header__status--${mood}`}>
          {liveStateText}
        </span>
      </header>

      <div className={`bwithu-bear-area bwithu-bear-area--mood-${mood}`}>
        {enabled && bearState !== "hidden" && (
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
            onConfirmAction={handleConfirmAction}
            onCancelAction={() => setPendingAction(null)}
            onSelectTab={handleSelectTab}
            isRecording={isRecording}
            onToggleRecording={handleMicButtonClick}
            immediateSpeech={isRecording || voiceDialogueActive}
            onSpawnComplete={handleSpawnComplete}
            onIntroComplete={handleIntroComplete}
            onLoopComplete={handleLoopComplete}
            onRequestWave={() => dispatchBehavior("clicked")}
            onOpenPanel={() => setShowChatPanel(true)}
            onDragReaction={() => dispatchBehavior("dragged")}
            onHoverReaction={() => dispatchBehavior("hovered")}
            isSidePanel={true}
            sidePanelWidth={viewport.width}
            sidePanelHeight={viewport.height}
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

      {/* Chat panel */}
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
            setSettings((current) => {
              if (!current.onboardingCompleted && nextSettings.onboardingCompleted) {
                setSpeechText("");
                setBearState("wave");
                if (nextSettings.soundEnabled) playHappyChirp();
                setShowChatPanel(false);
              }
              void saveSettings(nextSettings);
              return nextSettings;
            });
          }}
          onSendMessage={handleSendMessage}
          onConfirmAction={handleConfirmAction}
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

      {settings.onboardingCompleted && !showChatPanel ? (
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
            placeholder={`Message ${companionName}`}
            aria-label={`Message ${companionName}`}
          />
          <button type="submit" className="bwithu-call-control" title="Send message">➤</button>
          <button type="button" className="bwithu-call-control" onClick={() => sendCallCommand("Read this page")} title="Read page">📄</button>
          <button type="button" className="bwithu-call-control" onClick={() => sendCallCommand("What tabs are open?")} title="Tabs">▦</button>
          <button
            type="button"
            className="bwithu-call-control"
            onClick={() => {
              const query = callDraft.trim();
              if (query) sendCallCommand(`Search the web for ${query}`);
              else {
                setSpeechText("Type what you want me to search.");
                setAssistantCaption("Type what you want me to search.");
              }
            }}
            title="Search"
          >
            🔍
          </button>
          <button type="button" className="bwithu-call-control bwithu-call-control--quiet" onClick={openSettingsPanel} title="Settings">⚙️</button>
        </form>
      ) : (
        !showChatPanel && (
          <div className="bwithu-bottom-bar bwithu-bottom-bar--onboarding">
            <button
              type="button"
              className="bwithu-mic-main"
              onClick={() => setShowChatPanel(true)}
              title="Set up companion"
            >
              👋
            </button>
          </div>
        )
      )}
    </div>
  );
}
