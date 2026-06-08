const SETTINGS_KEY = "bwithu.settings";
const POSITION_KEY = "bwithu.bearPosition";

export interface BearPosition {
  x: number;
  y: number;
}

export interface BwithuSettings {
  apiKey: string;
  braveApiKey: string;
  googleClientId: string;
  characterRenderer: "glb" | "sprite";
  voiceId: "ara" | "rex";
  soundEnabled: boolean;
  voiceEnabled: boolean;
  wanderIntensity: "calm" | "curious" | "adventurous";
  proxyUrl?: string;
  companionName?: string;
  memory?: string;
}

export const DEFAULT_SETTINGS: BwithuSettings = {
  apiKey: "",
  braveApiKey: "",
  googleClientId: "",
  characterRenderer: "glb",
  voiceId: "ara",
  soundEnabled: true,
  voiceEnabled: true,
  wanderIntensity: "adventurous",
  proxyUrl: "",
  companionName: "",
  memory: "",
};

interface ChromeLike {
  storage?: {
    local?: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (value: Record<string, unknown>) => Promise<void>;
      remove?: (key: string) => Promise<void>;
    };
  };
}

function chromeStorage() {
  return (globalThis as { chrome?: ChromeLike }).chrome?.storage?.local;
}

async function getStored<T>(key: string): Promise<T | undefined> {
  const storage = chromeStorage();

  try {
    if (storage) {
      const stored = await storage.get(key);
      return stored[key] as T | undefined;
    }
  } catch {
    // Fall back to localStorage in local preview.
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

async function setStored<T>(key: string, value: T) {
  const storage = chromeStorage();

  try {
    if (storage) {
      await storage.set({ [key]: value });
      return;
    }
  } catch {
    // Fall back to localStorage in local preview.
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

async function removeStored(key: string) {
  const storage = chromeStorage();

  try {
    if (storage?.remove) {
      await storage.remove(key);
      return;
    }
  } catch {
    // Fall back to localStorage in local preview.
  }

  window.localStorage.removeItem(key);
}

export async function loadSettings(): Promise<BwithuSettings> {
  const saved = await getStored<Partial<BwithuSettings>>(SETTINGS_KEY);
  const localConfig = await loadLocalConfig();
  return { ...DEFAULT_SETTINGS, ...localConfig, ...withoutBlankProviderKeys(saved) };
}

export async function saveSettings(settings: BwithuSettings) {
  await setStored(SETTINGS_KEY, settings);
}

function withoutBlankProviderKeys(settings?: Partial<BwithuSettings>): Partial<BwithuSettings> {
  if (!settings) return {};
  const next = { ...settings };
  if (!next.apiKey) delete next.apiKey;
  if (!next.braveApiKey) delete next.braveApiKey;
  if (!next.googleClientId) delete next.googleClientId;
  if (next.voiceId && next.voiceId !== "ara" && next.voiceId !== "rex") delete next.voiceId;
  return next;
}

export async function loadBearPosition() {
  return getStored<BearPosition>(POSITION_KEY);
}

export async function saveBearPosition(position: BearPosition) {
  await setStored(POSITION_KEY, position);
}

export async function resetBearPosition() {
  await removeStored(POSITION_KEY);
}

async function loadLocalConfig(): Promise<Partial<BwithuSettings>> {
  try {
    const url = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome?.runtime?.getURL?.("local-config.json");
    if (!url) return {};
    const response = await fetch(url);
    if (!response.ok) return {};
    const config = (await response.json()) as {
      XAI_API_KEY?: string;
      BRAVE_SEARCH_API_KEY?: string;
      BRAVE_API_KEY?: string;
      GOOGLE_CLIENT_ID?: string;
      BWITHU_PROXY_URL?: string;
      apiKey?: string;
      braveApiKey?: string;
      googleClientId?: string;
      proxyUrl?: string;
    };
    return {
      apiKey: config.apiKey ?? config.XAI_API_KEY ?? "",
      braveApiKey: config.braveApiKey ?? config.BRAVE_SEARCH_API_KEY ?? config.BRAVE_API_KEY ?? "",
      googleClientId: config.googleClientId ?? config.GOOGLE_CLIENT_ID ?? "",
      proxyUrl: config.proxyUrl ?? config.BWITHU_PROXY_URL ?? "",
    };
  } catch {
    return {};
  }
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

const MESSAGES_KEY = "bwithu.messages";

export async function loadMessages(): Promise<ConversationTurn[]> {
  return (await getStored<ConversationTurn[]>(MESSAGES_KEY)) || [];
}

export async function saveMessages(messages: ConversationTurn[]) {
  await setStored(MESSAGES_KEY, messages);
}

