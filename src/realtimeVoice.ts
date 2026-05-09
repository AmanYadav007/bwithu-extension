import { createRealtimeSecret } from "./brainClient";
import type { BwithuSettings } from "./storage";

const SAMPLE_RATE = 24000;
const MODEL = "grok-voice-think-fast-1.0";

interface RealtimeVoiceCallbacks {
  onUserTranscript: (text: string) => void;
  onAssistantText: (text: string) => void;
  onAssistantDone: (text: string) => void;
  onStatus: (status: string) => void;
}

export class RealtimeVoiceSession {
  private readonly settings: BwithuSettings;
  private readonly callbacks: RealtimeVoiceCallbacks;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private earlyAudio: string[] = [];
  private connected = false;
  private assistantText = "";
  private playTime = 0;
  private heardUserTranscript = false;
  private readonly pageContext: string;

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
    this.callbacks.onStatus("Opening B's live voice...");
    const [secret] = await Promise.all([createRealtimeSecret(this.settings), this.startMic()]);
    this.openSocket(secret.value);
  }

  stop(requestResponse = true) {
    this.stopMic();
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (requestResponse && !this.heardUserTranscript) {
        this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        this.ws.send(JSON.stringify({ type: "response.create" }));
      }
      this.callbacks.onStatus(requestResponse ? "B is answering..." : "B stopped listening.");
    }
  }

  close() {
    this.stopMic();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  private async startMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const chunk = float32ToBase64PCM16(input);
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
    const url = `wss://api.x.ai/v1/realtime?model=${MODEL}`;
    this.ws = new WebSocket(url, [`xai-client-secret.${secret}`]);

    this.ws.onopen = () => {
      this.connected = true;
      this.callbacks.onStatus("B is listening live...");
      this.ws?.send(
        JSON.stringify({
          type: "session.update",
          session: {
            voice: this.settings.voiceId,
            instructions: `You are B, a tiny pixel bear companion living on the user's webpage. Be warm, brief, emotionally alive, and helpful. Keep replies under two short sentences unless the user asks for more. Use the current webpage context when the user asks about what is on screen.\n\nCurrent webpage context:\n${this.pageContext.slice(0, 10000)}`,
            turn_detection: {
              type: "server_vad",
              threshold: 0.72,
              silence_duration_ms: 650,
              prefix_padding_ms: 333,
            },
            audio: {
              input: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
              output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
            },
          },
        }),
      );

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
      this.callbacks.onStatus("B's live voice connection stumbled.");
    };

    this.ws.onclose = () => {
      this.connected = false;
    };
  }

  private handleEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? "");

    if (type === "response.output_audio.delta" && typeof event.delta === "string") {
      this.playPcmDelta(event.delta);
      return;
    }

    if (
      (type === "response.text.delta" || type === "response.output_text.delta" || type === "response.output_audio_transcript.delta") &&
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
      this.callbacks.onAssistantDone(this.assistantText.trim());
      this.assistantText = "";
      this.callbacks.onStatus("");
    }
  }

  private playPcmDelta(base64: string) {
    if (!this.audioContext) return;
    const float32 = base64PCM16ToFloat32(base64);
    const buffer = this.audioContext.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    this.playTime = Math.max(this.playTime, now);
    source.start(this.playTime);
    this.playTime += buffer.duration;
  }
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
