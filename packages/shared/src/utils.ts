import type { BwithuSettings, BrowserAction } from "./types";

export function getApiEndpoint(endpoint: string, settings: BwithuSettings): string {
  if (settings.apiKey) {
    if (endpoint === "chat") return "https://api.x.ai/v1/chat/completions";
    if (endpoint === "transcribe") return "https://api.x.ai/v1/stt";
    if (endpoint === "speak") return "https://api.x.ai/v1/tts";
    if (endpoint === "realtime-secret") return "https://api.x.ai/v1/realtime/client_secrets";
    if (endpoint === "search") return "https://api.search.brave.com/res/v1/web/search";
  }

  const baseUrl = (settings.proxyUrl || DEFAULT_PROXY_URL).replace(/\/$/, "");
  return `${baseUrl}/api/${endpoint}`;
}

export const DEFAULT_PROXY_URL = "https://bwithu-extension.vercel.app";

export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];
export const XAI_VOICES = ["ara", "eve", "rex", "sal", "leo"];

// Voice ids are provider-specific: sending an OpenAI voice ("coral") to xAI fails with
// "Voice not found", which silently muted every reply. Always resolve before calling a provider.
export function resolveVoice(settings: BwithuSettings, provider: "openai" | "xai") {
  const voice = (settings.voiceId || "").toLowerCase();
  if (provider === "openai") return OPENAI_VOICES.includes(voice) ? voice : "coral";
  return XAI_VOICES.includes(voice) ? voice : "ara";
}

export function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function stripCodeFence(content: string) {
  return content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

export function actionRequiresConfirmation(action: BrowserAction) {
  return !["read_current_page", "read_tab_context"].includes(action.kind);
}

export function getSearchQuery(text: string) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return "";

  if (/^(open|switch|hide)\b/.test(lower)) return "";

  // If user explicitly asks to "Google X" or "search google for X" or "open search results for X",
  // return empty to skip background search (it will trigger open_search browser action instead).
  if (/^(google\s+|search\s+google\s+(?:for\s+)?|open\s+google\s+|open\s+search\s+results\s+for\s+)/i.test(lower)) {
    return "";
  }

  const currentIntent =
    /\b(today|latest|current|now|recent|news|weather|price|pricing|stock|release|launched|happening|updated|2026)\b/.test(lower);
  const researchIntent =
    /\b(search the web|look up|find out|research|compare|best|recommend|reviews|who is|what is happening|tell me about)\b/.test(lower);

  if (currentIntent || researchIntent) {
    return trimmed
      .replace(/^search (for )?/i, "")
      .replace(/^look up /i, "")
      .replace(/^search the web for /i, "")
      .trim();
  }

  return "";
}

export function ensureUrl(value = "") {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("I need a URL to open.");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function preferredAudioName(mimeType: string) {
  if (mimeType.includes("mp4")) return "recording.mp4";
  if (mimeType.includes("mpeg")) return "recording.mp3";
  if (mimeType.includes("ogg")) return "recording.ogg";
  return "recording.webm";
}

export function withoutBlankProviderKeys(settings: Partial<BwithuSettings>): Partial<BwithuSettings> {
  const next = { ...settings };
  if (!next.apiKey) delete next.apiKey;
  if (!next.braveApiKey) delete next.braveApiKey;
  if (!next.googleClientId) delete next.googleClientId;
  if (next.voiceId && next.voiceId !== "ara" && next.voiceId !== "rex") delete next.voiceId;
  return next;
}
