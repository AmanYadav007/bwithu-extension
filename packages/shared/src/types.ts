export interface BearPosition {
  x: number;
  y: number;
}

export interface BwithuSettings {
  apiKey: string;
  openAiKey: string;
  braveApiKey: string;
  googleClientId: string;
  characterRenderer: "glb" | "sprite";
  characterModelUrl: string;
  voiceId: string;
  soundEnabled: boolean;
  voiceEnabled: boolean;
  wanderIntensity: "calm" | "curious" | "adventurous";
  proxyUrl?: string;
  companionName?: string;
  memory?: string;
  onboardingCompleted: boolean;
}

export const DEFAULT_SETTINGS: BwithuSettings = {
  apiKey: "",
  openAiKey: "",
  braveApiKey: "",
  googleClientId: "",
  characterRenderer: "glb",
  characterModelUrl: "",
  voiceId: "coral",
  soundEnabled: true,
  voiceEnabled: true,
  wanderIntensity: "adventurous",
  proxyUrl: "https://bwithu-extension.vercel.app",
  companionName: "",
  memory: "",
  onboardingCompleted: false,
};

export interface BrowserAction {
  kind:
    | "open_url"
    | "search"
    | "switch_tab"
    | "read_current_page"
    | "read_tab_context"
    | "create_calendar_event"
    | "hide_bear";
  payload: Record<string, string>;
}

export interface BrainReply {
  type: "reply" | "browser_action";
  message: string;
  action?: BrowserAction;
  requiresConfirmation: boolean;
  display?: {
    kind: "weather" | "search" | "info" | "tab_picker" | "confirmation" | "error" | "memory";
    title: string;
    content: string;
  };
  memoryUpdate?: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RealtimeSecret {
  value: string;
  expires_at: number;
}
