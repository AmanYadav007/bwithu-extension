import type { BwithuSettings } from "./storage";

export interface BrowserAction {
  kind: "open_url" | "search" | "switch_tab" | "hide_bear";
  payload: Record<string, string>;
}

export interface BrainReply {
  type: "reply" | "browser_action";
  message: string;
  action?: BrowserAction;
  requiresConfirmation: boolean;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RealtimeSecret {
  value: string;
  expires_at: number;
}

interface RuntimeLike {
  id?: string;
  sendMessage?: (message: unknown) => Promise<unknown>;
}

function runtime() {
  const chromeRuntime = (globalThis as { chrome?: { runtime?: RuntimeLike } }).chrome?.runtime;
  return chromeRuntime?.id ? chromeRuntime : undefined;
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  const chromeRuntime = runtime();
  if (!chromeRuntime?.sendMessage) {
    throw new Error("Open Bumi from the installed Chrome extension so I can reach Grok.");
  }

  const response = (await chromeRuntime.sendMessage(message)) as { ok?: boolean; error?: string; data?: T };
  if (!response?.ok) throw new Error(response?.error ?? "Bumi could not reach Grok.");
  return response.data as T;
}

export async function sendTextMessage(
  text: string,
  settings: BwithuSettings,
  history: ConversationTurn[],
  pageContext: string,
): Promise<BrainReply> {
  return sendRuntimeMessage<BrainReply>({
    type: "BWITHU_BRAIN_TEXT",
    text,
    settings,
    history: history.slice(-8),
    pageContext,
  });
}

export async function transcribeAudio(blob: Blob, settings: BwithuSettings): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return sendRuntimeMessage<string>({
    type: "BWITHU_TRANSCRIBE_AUDIO",
    audio: Array.from(new Uint8Array(buffer)),
    mimeType: blob.type || "audio/webm",
    settings,
  });
}

export async function speakText(text: string, settings: BwithuSettings): Promise<Blob> {
  const audio = await sendRuntimeMessage<{ bytes: number[]; mimeType: string }>({
    type: "BWITHU_SPEAK_TEXT",
    text,
    settings,
  });
  return new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType });
}

export async function runBrowserAction(action: BrowserAction): Promise<string> {
  return sendRuntimeMessage<string>({
    type: "BWITHU_RUN_BROWSER_ACTION",
    action,
  });
}

export async function createRealtimeSecret(settings: BwithuSettings): Promise<RealtimeSecret> {
  return sendRuntimeMessage<RealtimeSecret>({
    type: "BWITHU_CREATE_REALTIME_SECRET",
    settings,
  });
}

export async function getBrowserContext(currentPageContext: string): Promise<string> {
  return sendRuntimeMessage<string>({
    type: "BWITHU_GET_BROWSER_CONTEXT",
    currentPageContext,
  });
}
