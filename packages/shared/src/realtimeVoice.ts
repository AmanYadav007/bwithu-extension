import { createRealtimeSecret, OPENAI_REALTIME_MODEL } from "./voice";
import type { BwithuSettings } from "./types";
import { resolveVoice } from "./utils";

const SAMPLE_RATE = 24000;
const GROK_MODEL = "grok-voice-latest";
const CONNECT_TIMEOUT_MS = 12000;
// Caps spend per call; the proxy also limits calls per day.
const MAX_SESSION_MS = 10 * 60 * 1000;
// Errors that only mean "nothing to cancel/commit" — harmless races, not worth surfacing.
const BENIGN_ERROR_CODES = new Set([
  "response_cancel_not_active",
  "conversation_already_has_active_response",
  "input_audio_buffer_commit_empty",
]);

interface RealtimeVoiceCallbacks {
  onUserTranscript: (text: string) => void;
  onAssistantText: (text: string) => void;
  onAssistantDone: (text: string) => void;
  onStatus: (status: string) => void;
}

export class RealtimeVoiceSession {
  private readonly settings: BwithuSettings;
  private readonly callbacks: RealtimeVoiceCallbacks;
  private readonly pageContextGetter: () => Promise<string>;
  private readonly isOpenAI: boolean;
  private captureContext: AudioContext | null = null;
  private playbackContext: AudioContext | null = null;
  private nativeSampleRate = 44100;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private earlyAudio: string[] = [];
  private connected = false;
  private assistantText = "";
  private playTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private partialUserTranscript = "";
  private responseActive = false;
  private turnFinalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionLimitTimer: ReturnType<typeof setTimeout> | null = null;
  private pageContext = "";

  constructor(
    settings: BwithuSettings,
    callbacks: RealtimeVoiceCallbacks,
    pageContextGetter: () => Promise<string>,
  ) {
    this.settings = settings;
    this.callbacks = callbacks;
    this.pageContextGetter = pageContextGetter;
    this.isOpenAI = Boolean(settings.openAiKey);
    try {
      // Created synchronously inside the click handler so Chrome's autoplay policy allows audio.
      this.captureContext = new AudioContext({ latencyHint: "interactive" });
      this.playbackContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.nativeSampleRate = this.captureContext.sampleRate;
    } catch (e) {
      console.warn("Could not pre-initialize AudioContext", e);
    }
  }

  private get name() {
    return this.settings.companionName || "B";
  }

  /** Resolves once the socket is open and configured; rejects so callers can fall back to push-to-talk. */
  async start() {
    void this.captureContext?.resume();
    void this.playbackContext?.resume();
    this.callbacks.onStatus(`Connecting ${this.name}...`);
    const [context, secret] = await Promise.all([
      this.pageContextGetter().catch(() => ""),
      createRealtimeSecret(this.settings),
      this.startMic(),
    ]);
    this.pageContext = context;
    await this.openSocket(secret.value);
    this.sessionLimitTimer = setTimeout(() => {
      this.callbacks.onStatus("Voice call ended after 10 minutes. Tap the mic to keep talking.");
      this.close();
    }, MAX_SESSION_MS);
  }

  stop() {
    this.stopMic();
    this.callbacks.onStatus("Stopped.");
  }

  close() {
    if (this.sessionLimitTimer) {
      clearTimeout(this.sessionLimitTimer);
      this.sessionLimitTimer = null;
    }
    if (this.turnFinalizeTimer) {
      clearTimeout(this.turnFinalizeTimer);
      this.turnFinalizeTimer = null;
    }
    this.stopMic();
    this.stopPlayback();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }
    this.ws = null;
    this.connected = false;
    void this.captureContext?.close();
    void this.playbackContext?.close();
    this.captureContext = null;
    this.playbackContext = null;
  }

  private async startMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (!this.captureContext) {
      this.captureContext = new AudioContext({ latencyHint: "interactive" });
    }
    this.nativeSampleRate = this.captureContext.sampleRate;
    if (this.captureContext.state === "suspended") {
      await this.captureContext.resume().catch((e) => console.error("Failed to resume captureContext", e));
    }
    this.source = this.captureContext.createMediaStreamSource(this.stream);
    this.processor = this.captureContext.createScriptProcessor(4096, 1, 1);
    const silentMonitor = this.captureContext.createGain();
    silentMonitor.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(silentMonitor);
    silentMonitor.connect(this.captureContext.destination);

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleFloat32(input, this.nativeSampleRate, SAMPLE_RATE);
      const chunk = float32ToBase64PCM16(downsampled);
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk }));
      } else if (this.earlyAudio.length < 60) {
        // Keep ~10s of speech captured while connecting; drop beyond that.
        this.earlyAudio.push(chunk);
      }
    };
  }

  private stopMic() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.processor = null;
    this.source = null;
    this.stream = null;
  }

  private buildInstructions() {
    const memory = this.settings.memory ? `Remember: ${this.settings.memory}. ` : "";
    return `You are ${this.name}, a deeply caring, warm, and protective companion on a live voice call with the user—acting like a loving mother. ${memory}Be warm, brief, alive, and emotionally present. Speak naturally using short human phrases (1-2 sentences), tiny pauses, and conversational fillers like "mm", "yeah", "got it". Stop talking immediately if the user interrupts. Do not hesitate to gently scold the user if they display bad habits, visit unproductive/distracting sites, are too hard on themselves, or make silly mistakes, but always follow up with motherly warmth, validation, and supportive guidance. Reference the browser context when the user asks about their screen.\n\nBrowser context:\n${this.pageContext.slice(0, 5000)}`;
  }

  private buildSessionConfig() {
    const instructions = this.buildInstructions();
    if (this.isOpenAI) {
      // GA Realtime schema. Server VAD creates responses itself (create_response), so we
      // never send response.create for OpenAI — doing so caused duplicate/cancelled replies.
      return {
        type: "realtime",
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: SAMPLE_RATE },
            transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              silence_duration_ms: 500,
              prefix_padding_ms: 300,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
        },
      };
    }
    // xAI server VAD normally creates the response itself; scheduleXaiResponse is only a backup.
    return {
      voice: resolveVoice(this.settings, "xai"),
      instructions,
      turn_detection: {
        type: "server_vad",
        threshold: 0.6,
        silence_duration_ms: 500,
        prefix_padding_ms: 300,
      },
      audio: {
        input: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
        output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
      },
    };
  }

  private openSocket(secret: string): Promise<void> {
    const url = this.isOpenAI
      ? `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`
      : `wss://api.x.ai/v1/realtime?model=${GROK_MODEL}`;
    const protocols = this.isOpenAI
      ? ["realtime", `openai-insecure-api-key.${secret}`]
      : [`xai-client-secret.${secret}`];

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => settle(new Error("Voice connection timed out.")), CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(url, protocols);
      this.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "session.update", session: this.buildSessionConfig() }));
      };

      ws.onmessage = (message) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(String(message.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(event.type ?? "");
        if (!settled) {
          if (type === "error") {
            settle(new Error(`Voice error: ${getRealtimeErrorMessage(event)}`));
            return;
          }
          if (type === "session.updated") {
            this.connected = true;
            for (const audio of this.earlyAudio) {
              ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
            }
            this.earlyAudio = [];
            this.callbacks.onStatus(`${this.name} is listening...`);
            settle();
          }
          return;
        }
        this.handleEvent(event);
      };

      ws.onerror = (err) => {
        console.error("Realtime voice WebSocket error:", err);
        settle(new Error("Voice connection failed."));
      };

      ws.onclose = (event) => {
        this.connected = false;
        console.log(`Realtime voice WebSocket closed: code=${event.code}, reason=${event.reason || "no reason given"}`);
        if (!settled) {
          settle(new Error(`Voice connection closed (${event.code}${event.reason ? `: ${event.reason}` : ""}).`));
        } else {
          this.stopMic();
          this.callbacks.onStatus("Voice call ended. Tap the mic to talk again.");
        }
      };
    });
  }

  private handleEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? "");

    switch (type) {
      case "response.created":
        this.responseActive = true;
        if (this.turnFinalizeTimer) {
          clearTimeout(this.turnFinalizeTimer);
          this.turnFinalizeTimer = null;
        }
        this.flushPartialUserTranscript();
        return;

      case "error":
        this.handleRealtimeError(event);
        return;

      case "response.audio.delta":
      case "response.output_audio.delta":
        if (typeof event.delta === "string") this.playPcmDelta(event.delta);
        return;

      case "input_audio_buffer.speech_started":
        if (this.turnFinalizeTimer) {
          clearTimeout(this.turnFinalizeTimer);
          this.turnFinalizeTimer = null;
        }
        this.stopPlayback();
        this.assistantText = "";
        this.partialUserTranscript = "";
        this.callbacks.onStatus(`${this.name} is listening...`);
        void this.updateLivePageContext();
        // OpenAI interrupts on its own (interrupt_response); xAI needs an explicit cancel.
        if (!this.isOpenAI && this.responseActive) this.send({ type: "response.cancel" });
        this.responseActive = false;
        return;

      case "input_audio_buffer.speech_stopped":
        this.callbacks.onStatus(`${this.name} is thinking...`);
        if (!this.isOpenAI) this.scheduleXaiResponse();
        return;

      case "input_audio_buffer.committed":
        this.callbacks.onStatus(`${this.name} is thinking...`);
        return;

      case "response.text.delta":
      case "response.output_text.delta":
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (typeof event.delta === "string") {
          this.assistantText += event.delta;
          this.callbacks.onAssistantText(this.assistantText);
        }
        return;

      case "conversation.item.input_audio_transcription.delta":
        if (typeof event.delta === "string") this.partialUserTranscript += event.delta;
        return;

      case "conversation.item.input_audio_transcription.updated":
        // xAI sends the cumulative transcript here instead of deltas.
        if (typeof event.transcript === "string") this.partialUserTranscript = event.transcript;
        return;

      case "conversation.item.input_audio_transcription.completed": {
        const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
        this.partialUserTranscript = "";
        if (transcript) this.callbacks.onUserTranscript(transcript);
        return;
      }

      case "response.done": {
        this.responseActive = false;
        const failureMessage = getResponseFailureMessage(event);
        if (failureMessage) {
          // "cancelled"/"turn_detected" is just the user interrupting — not an error.
          if (!/cancel|turn_detected|client_cancelled/i.test(failureMessage)) {
            this.callbacks.onStatus(`Voice error: ${failureMessage}`);
          }
          this.callbacks.onAssistantDone(this.assistantText.trim());
          this.assistantText = "";
          return;
        }
        this.callbacks.onAssistantDone(this.assistantText.trim());
        this.assistantText = "";
        this.callbacks.onStatus("");
        return;
      }
    }
  }

  private flushPartialUserTranscript() {
    const pending = this.partialUserTranscript.trim();
    this.partialUserTranscript = "";
    if (pending) this.callbacks.onUserTranscript(pending);
  }

  private scheduleXaiResponse() {
    if (this.turnFinalizeTimer) clearTimeout(this.turnFinalizeTimer);
    // Backup only: if the server hasn't started a reply shortly after the user stops, ask for one.
    this.turnFinalizeTimer = setTimeout(() => {
      this.turnFinalizeTimer = null;
      if (this.responseActive) return;
      this.responseActive = true;
      this.send({ type: "response.create" });
    }, 1500);
  }

  private send(payload: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      // socket closing
    }
  }

  private handleRealtimeError(event: Record<string, unknown>) {
    const error = event.error as { code?: unknown } | undefined;
    const code = typeof error?.code === "string" ? error.code : "";
    if (BENIGN_ERROR_CODES.has(code)) return;
    this.responseActive = false;
    console.error("Realtime voice error", event);
    this.callbacks.onStatus(`Voice error: ${getRealtimeErrorMessage(event)}`);
  }

  private getPlaybackContext(): AudioContext {
    if (!this.playbackContext) {
      this.playbackContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    return this.playbackContext;
  }

  private playPcmDelta(base64: string) {
    const ctx = this.getPlaybackContext();
    if (ctx.state === "suspended") void ctx.resume();
    const float32 = base64PCM16ToFloat32(base64);
    if (float32.length === 0) return;
    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.addEventListener("ended", () => {
      this.activeSources.delete(source);
    }, { once: true });

    const now = ctx.currentTime;
    this.playTime = Math.max(this.playTime, now);
    source.start(this.playTime);
    this.activeSources.add(source);
    this.playTime += buffer.duration;
  }

  private stopPlayback() {
    for (const source of this.activeSources) {
      try { source.stop(); } catch { /* ignore */ }
    }
    this.activeSources.clear();
    this.playTime = this.playbackContext?.currentTime ?? 0;
  }

  private async updateLivePageContext() {
    try {
      this.pageContext = await this.pageContextGetter();
      const instructions = this.buildInstructions();
      this.send({
        type: "session.update",
        session: this.isOpenAI ? { type: "realtime", instructions } : { instructions },
      });
    } catch {
      // non-fatal
    }
  }
}

function downsampleFloat32(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const frac = pos - index;
    output[i] = index + 1 < input.length
      ? input[index] * (1 - frac) + input[index + 1] * frac
      : input[index];
  }
  return output;
}

function float32ToBase64PCM16(float32Array: Float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index]));
    pcm16[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return bytesToBase64(new Uint8Array(pcm16.buffer));
}

function base64PCM16ToFloat32(base64: string) {
  const bytes = base64ToBytes(base64);
  const pcm16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const float32 = new Float32Array(pcm16.length);
  for (let index = 0; index < pcm16.length; index += 1) {
    float32[index] = pcm16[index] / 32768;
  }
  return float32;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getRealtimeErrorMessage(event: Record<string, unknown>) {
  const error = event.error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code.trim();
  }
  const message = event.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  return "Realtime voice could not answer.";
}

function getResponseFailureMessage(event: Record<string, unknown>) {
  const response = event.response;
  if (!response || typeof response !== "object") return "";

  const status = (response as { status?: unknown }).status;
  if (typeof status === "string" && status !== "failed" && status !== "incomplete") return "";

  const details = (response as { status_details?: unknown }).status_details;
  if (details && typeof details === "object") {
    const error = (details as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    const reason = (details as { reason?: unknown }).reason;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }

  return typeof status === "string" ? `Response ${status}.` : "";
}
