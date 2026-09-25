import type { BwithuSettings, RealtimeSecret } from "./types";
import { getApiEndpoint, preferredAudioName, resolveVoice } from "./utils";
import { proxyError, proxyHeaders } from "./storage";

export async function transcribeAudio(
  audio: number[],
  mimeType: string,
  settings: BwithuSettings,
): Promise<string> {
  if (settings.openAiKey) {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      preferredAudioName(mimeType),
    );
    formData.append("model", "whisper-1");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openAiKey}`,
      },
      body: formData,
    });

    if (!response.ok) throw new Error(`B could not transcribe that (${response.status}).`);
    const data = (await response.json()) as { text?: string };
    return data.text?.trim() ?? "";
  } else if (settings.apiKey) {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      preferredAudioName(mimeType),
    );

    const response = await fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) throw new Error(`B could not transcribe that (${response.status}).`);
    const data = (await response.json()) as { text?: string };
    return data.text?.trim() ?? "";
  } else {
    const proxyUrl = getApiEndpoint("transcribe", settings);
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: await proxyHeaders(),
      body: JSON.stringify({ audio, mimeType }),
    });

    if (!response.ok) throw await proxyError(response, "B could not transcribe that via proxy");
    const data = (await response.json()) as { text?: string };
    return data.text?.trim() ?? "";
  }
}

export async function speakText(
  text: string,
  settings: BwithuSettings,
): Promise<{ bytes: number[]; mimeType: string }> {
  if (settings.openAiKey) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: resolveVoice(settings, "openai"),
      }),
    });

    if (!response.ok) throw new Error(`B could not speak right now (${response.status}).`);
    const contentType = response.headers.get("Content-Type") ?? "audio/mpeg";
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    return { bytes, mimeType: contentType };
  } else if (settings.apiKey) {
    const response = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: resolveVoice(settings, "xai"),
        language: "auto",
      }),
    });

    if (!response.ok) throw new Error(`B could not speak right now (${response.status}).`);
    const contentType = response.headers.get("Content-Type") ?? "audio/mpeg";
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
    return { bytes, mimeType: contentType };
  } else {
    const proxyUrl = getApiEndpoint("speak", settings);
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: await proxyHeaders(),
      body: JSON.stringify({ text, voiceId: resolveVoice(settings, "xai") }),
    });

    if (!response.ok) throw await proxyError(response, "B could not speak right now via proxy");
    return response.json() as Promise<{ bytes: number[]; mimeType: string }>;
  }
}

export const OPENAI_REALTIME_MODEL = "gpt-realtime";

export async function createRealtimeSecret(settings: BwithuSettings): Promise<RealtimeSecret> {
  // OpenAI Realtime (GA). The old beta /v1/realtime/sessions endpoint was shut down,
  // which is why OpenAI live voice never connected.
  if (settings.openAiKey) {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "realtime",
          model: OPENAI_REALTIME_MODEL,
          audio: { output: { voice: resolveVoice(settings, "openai") } },
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Could not start OpenAI voice session (${response.status}). ${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as { value?: string; expires_at?: number };
    if (!data.value) throw new Error("OpenAI did not return a session token.");
    return { value: data.value, expires_at: data.expires_at ?? 0 };
  }

  // Grok Realtime path
  let response: Response;
  if (settings.apiKey) {
    response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    });
  } else {
    const proxyUrl = getApiEndpoint("realtime-secret", settings);
    response = await fetch(proxyUrl, {
      method: "POST",
      headers: await proxyHeaders(),
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    });
  }

  if (!response.ok) {
    const name = settings.companionName || "B";
    throw await proxyError(response, `${name} could not start realtime voice`);
  }
  return response.json() as Promise<RealtimeSecret>;
}
