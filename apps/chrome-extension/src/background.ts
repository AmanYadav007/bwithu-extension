import type { BrowserAction, BrainReply, ConversationTurn, BwithuSettings } from "@bwithu/shared";
import {
  sendBrainMessage as sharedSendBrainMessage,
  transcribeAudio as sharedTranscribeAudio,
  speakText as sharedSpeakText,
  createRealtimeSecret as sharedCreateRealtimeSecret,
  loadSettings,
  getSearchQuery,
  collectWebContext,
  ensureUrl,
} from "@bwithu/shared";

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
        callback: (message: any, sender: unknown, sendResponse: (response: any) => void) => true | void,
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
  sidePanel?: {
    setPanelBehavior: (behavior: { openPanelOnActionClick: boolean }) => Promise<void>;
  };
}

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

async function handleMessage(message: any) {
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
  _settings: BwithuSettings,
  history: ConversationTurn[],
  pageContext: string,
): Promise<BrainReply> {
  const storedSettings = await loadSettings();
  assertApiKey(storedSettings);

  const browserContext = await collectBrowserContext(pageContext);
  const searchQuery = getSearchQuery(text);
  const webContext = searchQuery ? await collectWebContext(searchQuery, storedSettings) : "";
  const tabs = await chromeApi.tabs.query({});

  return sharedSendBrainMessage(text, storedSettings, history, browserContext, webContext, tabs);
}

async function transcribeAudio(audio: number[], mimeType: string, _settings: BwithuSettings) {
  const storedSettings = await loadSettings();
  assertApiKey(storedSettings);
  return sharedTranscribeAudio(audio, mimeType, storedSettings);
}

async function speakText(text: string, _settings: BwithuSettings) {
  const storedSettings = await loadSettings();
  assertApiKey(storedSettings);
  return sharedSpeakText(text, storedSettings);
}

async function createRealtimeSecret(_settings: BwithuSettings) {
  const storedSettings = await loadSettings();
  if (!storedSettings.openAiKey) {
    assertApiKey(storedSettings);
  }
  return sharedCreateRealtimeSecret(storedSettings);
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
        // Fallback matching logic is also handled in normalizer, but keep this as safety net
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
  const start = payload.start;
  const end = payload.end;
  if (!start || !end) throw new Error("I need a clear start and end time before scheduling.");

  const url = buildGoogleCalendarUrl(payload);
  await chromeApi.tabs.create({ url, active: true });
  return "I opened a ready-to-review Google Calendar invite. Add guests or adjust anything, then save it.";
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
