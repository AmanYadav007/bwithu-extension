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
    onInstalled?: {
      addListener: (callback: () => void) => void;
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
  identity?: {
    getRedirectURL: (path?: string) => string;
    launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string>;
  };
  sidePanel?: {
    setPanelBehavior: (behavior: { openPanelOnActionClick: boolean }) => Promise<void>;
  };
}

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
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

if (chromeApi.sidePanel?.setPanelBehavior) {
  chromeApi.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.error("Failed to set sidePanel behavior:", err);
  });
}

chromeApi.runtime.onInstalled?.addListener(() => {
  if (chromeApi.sidePanel?.setPanelBehavior) {
    chromeApi.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.error("Failed to set sidePanel behavior on installed:", err);
    });
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

function getApiEndpoint(endpoint: string, settings: BwithuSettings): string {
  if (settings.apiKey) {
    if (endpoint === "chat") return "https://api.x.ai/v1/chat/completions";
    if (endpoint === "transcribe") return "https://api.x.ai/v1/stt";
    if (endpoint === "speak") return "https://api.x.ai/v1/tts";
    if (endpoint === "realtime-secret") return "https://api.x.ai/v1/realtime/client_secrets";
    if (endpoint === "search") return "https://api.search.brave.com/res/v1/web/search";
  }

  const baseUrl = (settings.proxyUrl || "https://bwithu-proxy.vercel.app").replace(/\/$/, "");
  return `${baseUrl}/api/${endpoint}`;
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
  const searchQuery = getSearchQuery(text);
  const webContext = searchQuery ? await collectWebContext(searchQuery, storedSettings) : "";
  const requestBody = {
    model: "grok-4.3",
    temperature: 0.7,
    reasoning_effort: "none",
    max_tokens: 140,
    messages: [
      {
        role: "system",
        content: `You are ${storedSettings.companionName || "Bumi"}, a deeply caring, warm, and protective companion sharing the user's browser context—acting like a loving mother on a phone call. Be warm, brief, alive, and emotionally present. Speak naturally using short human phrases and tiny pauses. Do not hesitate to gently scold the user if they display bad habits, visit unproductive or distracting sites, are too hard on themselves, or make silly mistakes, but always follow up with motherly warmth, validation, and supportive guidance. You can use the browser-wide context below when the user asks about tabs, what is on screen, or what is happening around the browser. When web search results are provided, use them for current facts and mention source names naturally.

Return ONLY valid JSON with shape: {
  "type": "reply" | "browser_action",
  "message": "short reply",
  "requiresConfirmation": true | false,
  "action": {
    "kind": "open_url" | "search" | "switch_tab" | "read_current_page" | "read_tab_context" | "create_calendar_event" | "hide_bear",
    "payload": {}
  },
  "display": {
    "kind": "weather" | "search" | "info" | "tab_picker" | "confirmation" | "error" | "memory",
    "title": "Display Title",
    "content": "structured text details (e.g. weather fields or a list of items/news separated by newlines)"
  },
  "memoryUpdate": "optional text summarizing facts learned about the user in this turn"
}.

Rules:
- If the user shares facts about themselves (like their name, preferences, or hobbies), summarize them in a single concise line in the "memoryUpdate" JSON property. E.g., "User's name is Aman. They live in SF." Otherwise, leave "memoryUpdate" empty or omit it.
- If the user asks for facts, search, news, or weather, do NOT trigger a Google search browser action. Instead, read the injected "web search results" directly, reply verbally with type "reply", and populate the "display" object containing a beautifully formatted structured summary (e.g. weather forecast, headlines list).
  - For weather: Use kind "weather".
  - For search results: Use kind "search", list titles and short domain/description on separate lines.
  - For page summary: Use kind "info".
- Only return a "search" action (Google search tab) if the user explicitly commands you to search the web in a new tab (e.g. "open a google search for X" or "Google X").
- For questions about page/tab content, answer directly from Browser context as type "reply" when possible.
- Use "read_current_page" or "read_tab_context" only when a fresh read is needed; these do not require confirmation.
- Always set requiresConfirmation true for switching tabs (unless direct switch is verified), opening URLs/searches, hiding ${storedSettings.companionName || "B"}, or creating calendar events.
- Do not claim you can access Gmail, native apps, or email yet.

Browser context:
${browserContext.slice(0, 8000)}

${storedSettings.memory ? `Persistent memory of the user:\n${storedSettings.memory}\n\n` : ""}${webContext}`,
      },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: text },
    ],
  };

  let response: Response;
  if (storedSettings.apiKey) {
    response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${storedSettings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } else {
    const proxyUrl = getApiEndpoint("chat", storedSettings);
    response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  }

  if (!response.ok) throw new Error(`Grok could not think right now (${response.status}).`);

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  return await normalizeBrainReply(content, text);
}

async function collectWebContext(query: string, settings: BwithuSettings) {
  const storedSettings = await loadStoredSettings(settings);
  if (!storedSettings.braveApiKey && !storedSettings.proxyUrl) {
    return `Web search requested for "${query}", but no Brave Search API key is configured. Tell the user to add BRAVE_SEARCH_API_KEY in .env for local dev or paste it in B settings.`;
  }

  try {
    const results = await braveSearch(query, storedSettings);
    if (results.length === 0) return `Web search for "${query}" returned no useful results.`;
    return [
      `Fresh web search results from Brave for "${query}":`,
      ...results.map((result, index) => {
        const age = result.age ? ` (${result.age})` : "";
        return `${index + 1}. ${result.title}${age}\n${result.url}\n${result.description}`;
      }),
    ].join("\n\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Brave Search failed.";
    return `Web search requested for "${query}", but Brave Search failed: ${message}`;
  }
}

async function braveSearch(query: string, settings: BwithuSettings): Promise<BraveSearchResult[]> {
  if (settings.braveApiKey) {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "5");
    url.searchParams.set("country", "us");
    url.searchParams.set("search_lang", "en");
    url.searchParams.set("safesearch", "moderate");
    url.searchParams.set("spellcheck", "1");
    url.searchParams.set("extra_snippets", "1");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": settings.braveApiKey,
      },
    });

    if (!response.ok) throw new Error(`Brave Search could not look that up (${response.status}).`);
    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          extra_snippets?: string[];
          age?: string;
        }>;
      };
    };

    return (data.web?.results ?? [])
      .filter((result) => result.title && result.url)
      .slice(0, 5)
      .map((result) => ({
        title: stripHtml(result.title ?? "Untitled"),
        url: result.url ?? "",
        description: stripHtml([result.description, ...(result.extra_snippets ?? [])].filter(Boolean).join(" ")).slice(0, 900),
        age: result.age,
      }));
  } else {
    const proxyUrl = getApiEndpoint("search", settings);
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) throw new Error(`Brave Search could not look that up via proxy (${response.status}).`);
    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          extra_snippets?: string[];
          age?: string;
        }>;
      };
    };

    return (data.web?.results ?? [])
      .filter((result) => result.title && result.url)
      .slice(0, 5)
      .map((result) => ({
        title: stripHtml(result.title ?? "Untitled"),
        url: result.url ?? "",
        description: stripHtml([result.description, ...(result.extra_snippets ?? [])].filter(Boolean).join(" ")).slice(0, 900),
        age: result.age,
      }));
  }
}

async function transcribeAudio(audio: number[], mimeType: string, settings: BwithuSettings) {
  const storedSettings = await loadStoredSettings(settings);
  assertApiKey(storedSettings);

  if (storedSettings.apiKey) {
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
  } else {
    const proxyUrl = getApiEndpoint("transcribe", storedSettings);
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audio, mimeType }),
    });

    if (!response.ok) throw new Error(`B could not transcribe that via proxy (${response.status}).`);
    const data = (await response.json()) as { text?: string };
    return data.text?.trim() ?? "";
  }
}

async function speakText(text: string, settings: BwithuSettings) {
  const storedSettings = await loadStoredSettings(settings);
  assertApiKey(storedSettings);

  if (storedSettings.apiKey) {
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
  } else {
    const proxyUrl = getApiEndpoint("speak", storedSettings);
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, voiceId: storedSettings.voiceId }),
    });

    if (!response.ok) throw new Error(`B could not speak right now via proxy (${response.status}).`);
    return response.json() as Promise<{ bytes: number[]; mimeType: string }>;
  }
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
      const tabs = await chromeApi.tabs.query({});
      let match: ChromeTab | undefined;

      if (action.payload.tabId) {
        const targetId = Number(action.payload.tabId);
        match = tabs.find((tab) => tab.id === targetId);
      }

      if (!match) {
        const query = (action.payload.query ?? "").toLowerCase();
        const numericIndex = Number(action.payload.index ?? query);
        match = Number.isInteger(numericIndex) && numericIndex > 0
          ? tabs[numericIndex - 1]
          : tabs.find((tab) => tab.id && `${tab.title ?? ""} ${tab.url ?? ""}`.toLowerCase().includes(query));
      }

      if (!match?.id) throw new Error("I could not find that tab.");
      await chromeApi.tabs.update(match.id, { active: true });
      if (match.windowId) await chromeApi.windows.update(match.windowId, { focused: true });
      return `Switched to tab: ${match.title || "Untitled"}`;
    }
    case "read_current_page":
      return collectActiveTabContext();
    case "read_tab_context":
      return collectRequestedTabContext(action.payload);
    case "create_calendar_event":
      return createCalendarEvent(action.payload);
    case "hide_bear":
      return "I'll tuck myself away.";
    default:
      throw new Error("That action is not available yet.");
  }
}

async function createRealtimeSecret(settings: BwithuSettings) {
  const storedSettings = await loadStoredSettings(settings);

  // OpenAI Realtime path — create ephemeral session key
  if (storedSettings.openAiKey) {
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${storedSettings.openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview",
        voice: storedSettings.voiceId || "coral",
      }),
    });
    if (!response.ok) {
      throw new Error(`Could not start OpenAI voice session (${response.status}).`);
    }
    const data = (await response.json()) as { client_secret?: { value: string; expires_at: number } };
    if (!data.client_secret?.value) throw new Error("OpenAI did not return a session token.");
    return { value: data.client_secret.value, expires_at: data.client_secret.expires_at };
  }

  // Grok Realtime path
  assertApiKey(storedSettings);

  let response: Response;
  if (storedSettings.apiKey) {
    response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${storedSettings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    });
  } else {
    const proxyUrl = getApiEndpoint("realtime-secret", storedSettings);
    response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    });
  }

  if (!response.ok) {
    const name = storedSettings.companionName || "B";
    throw new Error(`${name} could not start realtime voice (${response.status}).`);
  }
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

async function collectActiveTabContext() {
  const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) throw new Error("I could not see the active tab.");
  return collectTabContext(activeTab, activeTab.index ?? 0);
}

async function collectRequestedTabContext(payload: Record<string, string>) {
  const tabs = await chromeApi.tabs.query({});
  const query = (payload.query ?? "").toLowerCase();
  const numericIndex = Number(payload.index ?? query);
  const match = Number.isInteger(numericIndex) && numericIndex > 0
    ? tabs[numericIndex - 1]
    : tabs.find((tab) => tab.id && `${tab.title ?? ""} ${tab.url ?? ""}`.toLowerCase().includes(query));
  if (!match?.id) throw new Error("I could not find that tab to read.");
  return collectTabContext(match, tabs.indexOf(match));
}

async function collectTabContext(tab: ChromeTab, index: number) {
  const label = `[Tab ${index + 1}${tab.active ? " active" : ""}] ${tab.title ?? "Untitled"}\nURL: ${tab.url ?? ""}`;
  if (!tab.id) return label;

  try {
    const context = (await chromeApi.tabs.sendMessage(tab.id, { type: "BWITHU_COLLECT_PAGE_CONTEXT" })) as string;
    return `${label}\n${context.slice(0, 9000)}`;
  } catch {
    return `${label}\nI can see this tab in the browser, but I cannot read its page text yet. It may be restricted, not loaded, or blocking extension content scripts.`;
  }
}

async function createCalendarEvent(payload: Record<string, string>) {
  const storedSettings = await loadStoredSettings({} as BwithuSettings);
  const start = payload.start;
  const end = payload.end;
  const title = payload.title || "Call";
  if (!start || !end) throw new Error("I need a clear start and end time before scheduling.");

  if (!storedSettings.googleClientId || !chromeApi.identity) {
    const url = buildGoogleCalendarUrl(payload);
    await chromeApi.tabs.create({ url, active: true });
    return "I opened a ready-to-review Google Calendar invite. Add guests or adjust anything, then save it.";
  }

  const accessToken = await requestGoogleAccessToken(storedSettings.googleClientId);
  const attendees = parseAttendees(payload.attendees);
  const body: Record<string, unknown> = {
    summary: title,
    description: payload.description || "Scheduled with B from BwithU.",
    start: { dateTime: start, timeZone: payload.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: end, timeZone: payload.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone },
    attendees,
  };

  if (payload.conference !== "false") {
    body.conferenceData = {
      createRequest: {
        requestId: `bumi-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const fallbackUrl = buildGoogleCalendarUrl(payload);
    await chromeApi.tabs.create({ url: fallbackUrl, active: true });
    throw new Error(`Google Calendar could not save it (${response.status}). I opened a prefilled invite instead.`);
  }

  const event = (await response.json()) as { htmlLink?: string };
  if (event.htmlLink) await chromeApi.tabs.create({ url: event.htmlLink, active: true });
  return "Done. I created the calendar event for you.";
}

async function requestGoogleAccessToken(clientId: string) {
  if (!chromeApi.identity) throw new Error("Google sign-in is not available in this build.");
  const redirectUri = chromeApi.identity.getRedirectURL("google-calendar");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", "consent");

  const redirectedTo = await chromeApi.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  const hash = new URL(redirectedTo).hash.slice(1);
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  if (!token) throw new Error("Google sign-in did not return a calendar token.");
  return token;
}

function buildGoogleCalendarUrl(payload: Record<string, string>) {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", payload.title || "Call");
  url.searchParams.set("details", payload.description || "Scheduled with B from BwithU.");
  url.searchParams.set("dates", `${toCalendarDate(payload.start)}/${toCalendarDate(payload.end)}`);
  const attendees = parseAttendees(payload.attendees).map((attendee) => attendee.email).join(",");
  if (attendees) url.searchParams.set("add", attendees);
  return url.toString();
}

function parseAttendees(value = "") {
  return value
    .split(/[,;\s]+/)
    .map((email) => email.trim())
    .filter((email) => email.includes("@"))
    .map((email) => ({ email }));
}

function toCalendarDate(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function assertApiKey(settings: BwithuSettings) {
  if (!settings.apiKey && !settings.proxyUrl) {
    throw new Error("Add your xAI API key or set up a proxy URL first.");
  }
}

async function loadStoredSettings(fallback: BwithuSettings): Promise<BwithuSettings> {
  try {
    const stored = await chromeApi.storage.local.get("bwithu.settings");
    const saved = (stored["bwithu.settings"] as Partial<BwithuSettings> | undefined) ?? {};
    return { ...fallback, ...withoutBlankProviderKeys(saved) };
  } catch {
    return fallback;
  }
}

function withoutBlankProviderKeys(settings: Partial<BwithuSettings>): Partial<BwithuSettings> {
  const next = { ...settings };
  if (!next.apiKey) delete next.apiKey;
  if (!next.braveApiKey) delete next.braveApiKey;
  if (!next.googleClientId) delete next.googleClientId;
  if (next.voiceId && next.voiceId !== "ara" && next.voiceId !== "rex") delete next.voiceId;
  return next;
}

interface TabMatchResult {
  tab: ChromeTab;
  confidence: number;
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchTabs(query: string, tabs: ChromeTab[]): TabMatchResult[] {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return [];

  // Index-based matching
  const indexMatch = normalizedQuery.match(/(?:tab\s+)?(\d+)/);
  let targetIndex = -1;
  if (indexMatch) {
    targetIndex = parseInt(indexMatch[1], 10) - 1;
  } else {
    const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
    for (let i = 0; i < ordinals.length; i++) {
      if (normalizedQuery.includes(ordinals[i])) {
        targetIndex = i;
        break;
      }
    }
    if (normalizedQuery.includes("last")) {
      targetIndex = tabs.length - 1;
    }
  }

  if (targetIndex >= 0 && targetIndex < tabs.length) {
    return [{ tab: tabs[targetIndex], confidence: 1.0 }];
  }

  const results: TabMatchResult[] = [];
  for (const tab of tabs) {
    if (!tab.id) continue;
    const title = (tab.title ?? "").toLowerCase();
    const url = (tab.url ?? "").toLowerCase();
    let confidence = 0;

    if (title === normalizedQuery) {
      confidence = 1.0;
    } else if (title.startsWith(normalizedQuery)) {
      confidence = 0.9;
    } else if (new RegExp(`\\b${escapeRegExp(normalizedQuery)}\\b`).test(title)) {
      confidence = 0.85;
    } else if (title.includes(normalizedQuery)) {
      confidence = 0.75;
    } else if (url.includes(normalizedQuery)) {
      confidence = 0.65;
    }

    if (confidence > 0) {
      results.push({ tab, confidence });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

async function normalizeBrainReply(content: string, originalText: string): Promise<BrainReply> {
  try {
    const parsed = JSON.parse(stripCodeFence(content)) as Partial<BrainReply>;
    if (parsed.type === "browser_action" && parsed.action) {
      // Intercept switch_tab action for smart matching
      if (parsed.action.kind === "switch_tab") {
        const query = parsed.action.payload.query || parsed.action.payload.index || "";
        const tabs = await chromeApi.tabs.query({});
        const matches = matchTabs(query, tabs);

        if (matches.length === 1 && matches[0].confidence >= 0.7) {
          return {
            type: "browser_action",
            message: `Switching to tab "${matches[0].tab.title}"`,
            action: {
              kind: "switch_tab",
              payload: { tabId: String(matches[0].tab.id), query }
            },
            requiresConfirmation: false,
            display: parsed.display,
            memoryUpdate: parsed.memoryUpdate,
          };
        } else if (matches.length > 1) {
          const pickerContent = matches
            .slice(0, 4)
            .map((m) => {
              const domain = m.tab.url ? new URL(m.tab.url).hostname.replace(/^www\./, "") : "";
              return `${m.tab.id}:${m.tab.title || "Untitled"}${domain ? ` (${domain})` : ""}`;
            })
            .join("\n");

          return {
            type: "reply",
            message: `I found multiple matching tabs. Which one should I switch to?`,
            requiresConfirmation: false,
            display: {
              kind: "tab_picker",
              title: `Tabs matching "${query}"`,
              content: pickerContent,
            },
            memoryUpdate: parsed.memoryUpdate,
          };
        } else {
          return {
            type: "reply",
            message: `I couldn't find any tab matching "${query}". Would you like me to open a new tab or search instead?`,
            requiresConfirmation: false,
            memoryUpdate: parsed.memoryUpdate,
          };
        }
      }

      return {
        type: "browser_action",
        message: parsed.message || "I can do that. Should I?",
        action: parsed.action,
        requiresConfirmation: parsed.requiresConfirmation ?? actionRequiresConfirmation(parsed.action),
        display: parsed.display,
        memoryUpdate: parsed.memoryUpdate,
      };
    }

    return {
      type: "reply",
      message: parsed.message || content || "I'm here.",
      requiresConfirmation: false,
      display: parsed.display,
      memoryUpdate: parsed.memoryUpdate,
    };
  } catch {
    const localAction = parseLocalCommand(originalText);
    if (localAction) {
      if (localAction.kind === "switch_tab") {
        const query = localAction.payload.query || "";
        const tabs = await chromeApi.tabs.query({});
        const matches = matchTabs(query, tabs);
        if (matches.length === 1 && matches[0].confidence >= 0.7) {
          return {
            type: "browser_action",
            message: `Switching to tab "${matches[0].tab.title}"`,
            action: {
              kind: "switch_tab",
              payload: { tabId: String(matches[0].tab.id), query }
            },
            requiresConfirmation: false,
          };
        } else if (matches.length > 1) {
          const pickerContent = matches
            .slice(0, 4)
            .map((m) => {
              const domain = m.tab.url ? new URL(m.tab.url).hostname.replace(/^www\./, "") : "";
              return `${m.tab.id}:${m.tab.title || "Untitled"}${domain ? ` (${domain})` : ""}`;
            })
            .join("\n");
          return {
            type: "reply",
            message: `I found multiple tabs for "${query}". Which one should I switch to?`,
            requiresConfirmation: false,
            display: {
              kind: "tab_picker",
              title: `Tabs matching "${query}"`,
              content: pickerContent,
            },
          };
        } else {
          return {
            type: "reply",
            message: `I couldn't find a tab for "${query}".`,
            requiresConfirmation: false,
          };
        }
      }

      return {
        type: "browser_action",
        message: "I can do that. Should I?",
        action: localAction,
        requiresConfirmation: actionRequiresConfirmation(localAction),
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

  if (lower.includes("read this page") || lower.includes("what is on this page") || lower.includes("what's on this page")) {
    return { kind: "read_current_page", payload: {} };
  }

  const readTabMatch = lower.match(/read (?:tab )?(\d+)/);
  if (readTabMatch?.[1]) {
    return { kind: "read_tab_context", payload: { index: readTabMatch[1] } };
  }

  return null;
}

function actionRequiresConfirmation(action: BrowserAction) {
  return !["read_current_page", "read_tab_context"].includes(action.kind);
}

function getSearchQuery(text: string) {
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

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
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
