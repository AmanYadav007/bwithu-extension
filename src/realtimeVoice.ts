import { createRealtimeSecret } from "./brainClient";
import type { BwithuSettings } from "./storage";
import { getActivePageContext } from "./pageContext";

const SAMPLE_RATE = 24000;
const GROK_MODEL = "grok-voice-think-fast-1.0";
const OPENAI_REALTIME_MODEL = "gpt-realtime-2";

interface RealtimeVoiceCallbacks {
  onUserTranscript: (text: string) => void;
  onAssistantText: (text: string) => void;
  onAssistantDone: (text: string) => void;
  onStatus: (status: string) => void;
}

export class RealtimeVoiceSession {
  private readonly settings: BwithuSettings;
  private readonly callbacks: RealtimeVoiceCallbacks;
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
  private heardUserTranscript = false;
  private responseActive = false;
  private responseRequested = false;
  private turnFinalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private pageContext: string;

  constructor(
    settings: BwithuSettings,
    callbacks: RealtimeVoiceCallbacks,
    pageContext: string,
  ) {
    this.settings = settings;
    this.callbacks = callbacks;
    this.pageContext = pageContext;
  }

  async start() {
    const name = this.settings.companionName || "B";
    this.callbacks.onStatus(`Connecting ${name}...`);
    const [secret] = await Promise.all([createRealtimeSecret(this.settings), this.startMic()]);
    this.openSocket(secret.value);
  }

  stop(requestResponse = true) {
    this.stopMic();
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (requestResponse && !this.heardUserTranscript) {
        this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        this.requestResponse();
      }
      const name = this.settings.companionName || "B";
      this.callbacks.onStatus(requestResponse ? `${name} is answering...` : "Stopped.");
    }
  }

  close() {
    if (this.turnFinalizeTimer) {
      clearTimeout(this.turnFinalizeTimer);
      this.turnFinalizeTimer = null;
    }
    this.stopMic();
    this.stopPlayback();
    this.ws?.close();
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

    // Use the browser's native sampleRate to avoid resampling bugs with createMediaStreamSource.
    // We manually downsample to SAMPLE_RATE before encoding.
    this.captureContext = new AudioContext({ latencyHint: "interactive" });
    this.nativeSampleRate = this.captureContext.sampleRate;

    if (this.captureContext.state === "suspended") await this.captureContext.resume();
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
      } else {
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

  private openSocket(secret: string) {
    const isOpenAI = Boolean(this.settings.openAiKey);
    const url = isOpenAI
      ? `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`
      : `wss://api.x.ai/v1/realtime?model=${GROK_MODEL}&smart_turn=0.5&smart_turn_timeout=1200`;
    const protocols: string[] = isOpenAI
      ? ["realtime", `openai-insecure-api-key.${secret}`]
      : [`xai-client-secret.${secret}`];

    this.ws = new WebSocket(url, protocols);

    this.ws.onopen = () => {
      this.connected = true;
      const name = this.settings.companionName || "B";
      this.callbacks.onStatus(`${name} is listening...`);

      const instructions = `You are ${name}, a deeply caring, warm, and protective companion on a live voice call with the user—acting like a loving mother. ${this.settings.memory ? `Remember: ${this.settings.memory}. ` : ""}Be warm, brief, alive, and emotionally present. Speak naturally using short human phrases (1-2 sentences), tiny pauses, and conversational fillers like "mm", "yeah", "got it". Stop talking immediately if the user interrupts. Do not hesitate to gently scold the user if they display bad habits, visit unproductive/distracting sites, are too hard on themselves, or make silly mistakes, but always follow up with motherly warmth, validation, and supportive guidance. Reference the browser context when the user asks about their screen.\n\nBrowser context:\n${this.pageContext.slice(0, 5000)}`;

      const sessionConfig = isOpenAI ? {
        modalities: ["text", "audio"],
        voice: this.settings.voiceId || "coral",
        instructions,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.45,
          silence_duration_ms: 350,
          prefix_padding_ms: 200,
        },
      } : {
        voice: this.settings.voiceId || "ara",
        instructions,
        turn_detection: {
          type: "server_vad",
          threshold: 0.45,
          silence_duration_ms: 350,
          prefix_padding_ms: 200,
        },
        audio: {
          input: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
          output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
        },
      };

      this.ws?.send(JSON.stringify({ type: "session.update", session: sessionConfig }));

      for (const audio of this.earlyAudio) {
        this.ws?.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
      }
      this.earlyAudio = [];
    };

    this.ws.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as Record<string, unknown>;
      this.handleEvent(event);
    };

    this.ws.onerror = () => {
      this.callbacks.onStatus("Voice connection failed. Check your API key in settings.");
    };

    this.ws.onclose = () => {
      this.connected = false;
    };
  }

  private handleEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? "");

    if (type === "response.created") {
      this.responseActive = true;
      this.responseRequested = true;
      return;
    }

    if (type === "error") {
      this.handleRealtimeError(event);
      return;
    }

    // OpenAI: response.audio.delta | Grok: response.output_audio.delta
    if ((type === "response.audio.delta" || type === "response.output_audio.delta") && typeof event.delta === "string") {
      this.playPcmDelta(event.delta);
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      if (this.turnFinalizeTimer) {
        clearTimeout(this.turnFinalizeTimer);
        this.turnFinalizeTimer = null;
      }
      this.stopPlayback();
      this.assistantText = "";
      const name = this.settings.companionName || "B";
      this.callbacks.onStatus(`${name} is listening...`);
      void this.updateLivePageContext();
      try {
        if (this.responseActive) this.ws?.send(JSON.stringify({ type: "response.cancel" }));
      } catch {
        // ignore cancellation errors
      }
      this.responseActive = false;
      this.responseRequested = false;
      return;
    }

    // OpenAI: response.audio_transcript.delta | Grok: response.output_audio_transcript.delta
    if (
      (type === "response.text.delta" ||
        type === "response.output_text.delta" ||
        type === "response.output_audio_transcript.delta" ||
        type === "response.audio_transcript.delta") &&
      typeof event.delta === "string"
    ) {
      this.assistantText += event.delta;
      this.callbacks.onAssistantText(this.assistantText);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = typeof event.transcript === "string" ? event.transcript : "";
      if (transcript) {
        this.heardUserTranscript = true;
        this.callbacks.onUserTranscript(transcript);
      }
      return;
    }

    if (type === "response.done") {
      const failureMessage = getResponseFailureMessage(event);
      if (failureMessage) {
        this.responseActive = false;
        this.responseRequested = false;
        this.callbacks.onStatus(`Voice error: ${failureMessage}`);
        this.callbacks.onAssistantDone("");
        return;
      }
      this.callbacks.onAssistantDone(this.assistantText.trim());
      this.assistantText = "";
      this.responseActive = false;
      this.responseRequested = false;
      this.heardUserTranscript = false;
      this.callbacks.onStatus("");
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      const name = this.settings.companionName || "B";
      this.callbacks.onStatus(`${name} is thinking...`);
      this.finalizeInputTurn();
      return;
    }

    if (type === "input_audio_buffer.committed") {
      const name = this.settings.companionName || "B";
      this.callbacks.onStatus(`${name} is thinking...`);
      if (!this.responseActive && !this.responseRequested) this.requestResponse();
      return;
    }
  }

  private finalizeInputTurn() {
    if (this.turnFinalizeTimer) clearTimeout(this.turnFinalizeTimer);
    const isOpenAI = Boolean(this.settings.openAiKey);
    this.turnFinalizeTimer = setTimeout(() => {
      this.turnFinalizeTimer = null;
      if (this.responseActive || this.responseRequested || this.ws?.readyState !== WebSocket.OPEN) return;
      try {
        if (!isOpenAI) this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      } catch {
        // Some providers auto-commit server-VAD turns.
      }
      this.requestResponse();
    }, isOpenAI ? 900 : 180);
  }

  private requestResponse() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.responseActive = true;
    this.responseRequested = true;
    this.ws.send(JSON.stringify({ type: "response.create" }));
  }

  private handleRealtimeError(event: Record<string, unknown>) {
    const message = getRealtimeErrorMessage(event);
    this.responseActive = false;
    this.responseRequested = false;
    console.error("Realtime voice error", event);
    this.callbacks.onStatus(`Voice error: ${message}`);
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
      try { source.stop(); } catch { /* already ended */ }
    }
    this.activeSources.clear();
    this.playTime = this.playbackContext?.currentTime ?? 0;
  }

  private async updateLivePageContext() {
    try {
      const context = await getActivePageContext();
      this.pageContext = context;
      if (this.ws?.readyState === WebSocket.OPEN) {
        const name = this.settings.companionName || "B";
        const instructions = `You are ${name}, a deeply caring, warm, and protective companion on a live voice call with the user—acting like a loving mother. ${this.settings.memory ? `Remember: ${this.settings.memory}. ` : ""}Be warm, brief, alive, and emotionally present. Speak naturally using short human phrases (1-2 sentences), tiny pauses, and conversational fillers like "mm", "yeah", "got it". Stop talking immediately if the user interrupts. Do not hesitate to gently scold the user if they display bad habits, visit unproductive/distracting sites, are too hard on themselves, or make silly mistakes, but always follow up with motherly warmth, validation, and supportive guidance. Reference the browser context when the user asks about their screen.\n\nBrowser context:\n${this.pageContext.slice(0, 5000)}`;
        this.ws.send(JSON.stringify({ type: "session.update", session: { instructions } }));
      }
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
  const pcm16 = new Int16Array(bytes.buffer);
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
