import type { BrowserAction, BrainReply, ConversationTurn } from "./brainClient";
import type { BwithuSettings } from "./storage";

interface ChromeTab {
  id?: number;
  index?: number;
  title?: string;
  url?: string;
  active?: boolean;
  windowId?: number;
}

interface ChromeExtensionApi {
  action: {
    onClicked: {
      addListener: (callback: (tab: ChromeTab) => void | Promise<void>) => void;
    };
  };
  runtime: {
    onMessage: {
      addListener: (
        callback: (message: RuntimeMessage, sender: unknown, sendResponse: (response: RuntimeResponse) => void) => true | void,
      ) => void;
    };
  };
  tabs: {
    create: (properties: { url: string; active?: boolean }) => Promise<ChromeTab>;
    query: (queryInfo: { currentWindow?: boolean; active?: boolean }) => Promise<ChromeTab[]>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
    update: (tabId: number, properties: { active?: boolean }) => Promise<ChromeTab>;
  };
  windows: {
    update: (windowId: number, properties: { focused?: boolean }) => Promise<unknown>;
  };
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
    };
  };
}

type RuntimeMessage =
  | { type: "BWITHU_BRAIN_TEXT"; text: string; settings: BwithuSettings; history: ConversationTurn[]; pageContext?: string }
  | { type: "BWITHU_TRANSCRIBE_AUDIO"; audio: number[]; mimeType: string; settings: BwithuSettings }
  | { type: "BWITHU_SPEAK_TEXT"; text: string; settings: BwithuSettings }
  | { type: "BWITHU_RUN_BROWSER_ACTION"; action: BrowserAction }
  | { type: "BWITHU_CREATE_REALTIME_SECRET"; settings: BwithuSettings }
  | { type: "BWITHU_GET_BROWSER_CONTEXT"; currentPageContext: string };

type RuntimeResponse = { ok: true; data: unknown } | { ok: false; error: string };

const chromeApi = (globalThis as unknown as { chrome: ChromeExtensionApi }).chrome;

chromeApi.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    await chromeApi.tabs.sendMessage(tab.id, { type: "BWITHU_TOGGLE" });
  } catch {
    // Content scripts do not run on restricted pages like chrome:// URLs.
  }
});

chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "B hit a browser snag." }));

  return true;
});

async function handleMessage(message: RuntimeMessage) {
  switch (message.type) {
    case "BWITHU_BRAIN_TEXT":
      return sendBrainMessage(message.text, message.settings, message.history, message.pageContext ?? "");
    case "BWITHU_TRANSCRIBE_AUDIO":
      return transcribeAudio(message.audio, message.mimeType, message.settings);
    case "BWITHU_SPEAK_TEXT":
      return speakText(message.text, message.settings);
    case "BWITHU_RUN_BROWSER_ACTION":
      return runBrowserAction(message.action);
    case "BWITHU_CREATE_REALTIME_SECRET":
      return createRealtimeSecret(message.settings);
    case "BWITHU_GET_BROWSER_CONTEXT":
      return collectBrowserContext(message.currentPageContext);
    default:
      throw new Error("B does not know that message yet.");
  }
}

async function sendBrainMessage(
  text: string,
  settings: BwithuSettings,
  history: ConversationTurn[],
  pageContext: string,
): Promise<BrainReply> {
  const storedSettings = await loadStoredSettings(settings);
  assertApiKey(storedSettings);

  const browserContext = await collectBrowserContext(pageContext);
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${storedSettings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4.3",
      temperature: 0.7,
      reasoning_effort: "none",
      max_tokens: 140,
      messages: [
        {
          role: "system",
          content: `You are B, a tiny pixel bear companion living in the user's browser. Be warm, brief, alive, and helpful. You can use the browser-wide context below when the user asks about tabs, "tab 2", or what is on screen. Return ONLY valid JSON with shape: {"type":"reply"|"browser_action","message":"short reply","requiresConfirmation":true|false,"action":{"kind":"open_url"|"search"|"switch_tab"|"hide_bear","payload":{}}}. Only use browser_action for safe browser commands. Always set requiresConfirmation true for browser_action. To switch tabs by number, use {"kind":"switch_tab","payload":{"index":"2"}}. Do not claim you can access Gmail, calendars, native apps, or email yet.\n\nBrowser context:\n${browserContext.slice(0, 18000)}`,
        },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: text },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Grok could not think right now (${response.status}).`);

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  return normalizeBrainReply(content, text);
}

async function transcribeAudio(audio: number[], mimeType: string, settings: BwithuSettings) {
  const storedSettings = await loadStoredSettings(settings);
  assertApiKey(storedSettings);

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), preferredAudioName(mimeType));

  const response = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${storedSettings.apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) throw new Error(`B could not transcribe that (${response.status}).`);
  const data = (await response.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

async function speakText(text: string, settings: BwithuSettings) {
  const storedSettings = await loadStoredSettings(settings);
  assertApiKey(storedSettings);

  const response = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${storedSettings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: storedSettings.voiceId,
      language: "auto",
    }),
  });

  if (!response.ok) throw new Error(`B could not speak right now (${response.status}).`);
  const contentType = response.headers.get("Content-Type") ?? "audio/mpeg";
  const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
  return { bytes, mimeType: contentType };
}

async function runBrowserAction(action: BrowserAction) {
  switch (action.kind) {
    case "open_url": {
      const url = ensureUrl(action.payload.url);
      await chromeApi.tabs.create({ url, active: true });
      return "Opened it for you.";
    }
    case "search": {
      const query = action.payload.query ?? "";
      await chromeApi.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, active: true });
      return "I searched that for you.";
    }
    case "switch_tab": {
      const query = (action.payload.query ?? "").toLowerCase();
      const tabs = await chromeApi.tabs.query({});
      const numericIndex = Number(action.payload.index ?? query);
      const match = Number.isInteger(numericIndex) && numericIndex > 0
        ? tabs[numericIndex - 1]
        : tabs.find((tab) => tab.id && `${tab.title ?? ""} ${tab.url ?? ""}`.toLowerCase().includes(query));
      if (!match?.id) throw new Error("I could not find that tab.");
      await chromeApi.tabs.update(match.id, { active: true });
      if (match.windowId) await chromeApi.windows.update(match.windowId, { focused: true });
      return "Switched tabs.";
    }
    case "hide_bear":
      return "I'll tuck myself away.";
    default:
      throw new Error("That action is not available yet.");
  }
}

async function createRealtimeSecret(settings: BwithuSettings) {
  const storedSettings = await loadStoredSettings(settings);
  assertApiKey(storedSettings);

  const response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${storedSettings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { seconds: 300 },
    }),
  });

  if (!response.ok) throw new Error(`B could not start realtime voice (${response.status}).`);
  return response.json();
}

async function collectBrowserContext(currentPageContext: string) {
  const tabs = await chromeApi.tabs.query({});
  const contextParts = await Promise.all(
    tabs.slice(0, 12).map(async (tab, index) => {
      const label = `[Tab ${index + 1}${tab.active ? " active" : ""}] ${tab.title ?? "Untitled"}\nURL: ${tab.url ?? ""}`;
      if (!tab.id) return label;

      try {
        const context = (await chromeApi.tabs.sendMessage(tab.id, { type: "BWITHU_COLLECT_PAGE_CONTEXT" })) as string;
        return `${label}\n${context.slice(0, 5000)}`;
      } catch {
        return `${label}\nPage text unavailable. The page may be restricted, not loaded, or outside content-script access.`;
      }
    }),
  );

  return [`Current invoking page:\n${currentPageContext}`, "Open browser tabs:", ...contextParts].join("\n\n---\n\n");
}

function assertApiKey(settings: BwithuSettings) {
  if (!settings.apiKey) throw new Error("Add your xAI API key first.");
}

async function loadStoredSettings(fallback: BwithuSettings): Promise<BwithuSettings> {
  try {
    const stored = await chromeApi.storage.local.get("bwithu.settings");
    const saved = (stored["bwithu.settings"] as Partial<BwithuSettings> | undefined) ?? {};
    const savedWithoutBlankKey = saved.apiKey ? saved : { ...saved, apiKey: undefined };
    return { ...fallback, ...savedWithoutBlankKey };
  } catch {
    return fallback;
  }
}

function normalizeBrainReply(content: string, originalText: string): BrainReply {
  try {
    const parsed = JSON.parse(stripCodeFence(content)) as Partial<BrainReply>;
    if (parsed.type === "browser_action" && parsed.action) {
      return {
        type: "browser_action",
        message: parsed.message || "I can do that. Should I?",
        action: parsed.action,
        requiresConfirmation: true,
      };
    }

    return {
      type: "reply",
      message: parsed.message || content || "I'm here.",
      requiresConfirmation: false,
    };
  } catch {
    const localAction = parseLocalCommand(originalText);
    if (localAction) {
      return {
        type: "browser_action",
        message: "I can do that. Should I?",
        action: localAction,
        requiresConfirmation: true,
      };
    }

    return {
      type: "reply",
      message: content || "I'm here.",
      requiresConfirmation: false,
    };
  }
}

function parseLocalCommand(text: string): BrowserAction | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "hide" || lower.includes("hide yourself")) {
    return { kind: "hide_bear", payload: {} };
  }

  if (lower.startsWith("open ")) {
    return { kind: "open_url", payload: { url: trimmed.slice(5).trim() } };
  }

  if (lower.startsWith("search ")) {
    return { kind: "search", payload: { query: trimmed.slice(7).trim() } };
  }

  if (lower.startsWith("switch to ")) {
    return { kind: "switch_tab", payload: { query: trimmed.slice(10).trim() } };
  }

  return null;
}

function stripCodeFence(content: string) {
  return content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function ensureUrl(value = "") {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("I need a URL to open.");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function preferredAudioName(mimeType: string) {
  if (mimeType.includes("mp4")) return "recording.mp4";
  if (mimeType.includes("mpeg")) return "recording.mp3";
  if (mimeType.includes("ogg")) return "recording.ogg";
  return "recording.webm";
}
