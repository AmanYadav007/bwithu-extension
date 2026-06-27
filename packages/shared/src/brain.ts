import type { BwithuSettings, BrainReply, ConversationTurn, BrowserAction } from "./types";
import { getSystemPrompt } from "./prompts";
import { getApiEndpoint, stripCodeFence, actionRequiresConfirmation } from "./utils";

export interface GenericTab {
  id?: number | string;
  title?: string;
  url?: string;
}

export async function sendBrainMessage(
  text: string,
  settings: BwithuSettings,
  history: ConversationTurn[],
  browserContext: string,
  webContext: string,
  tabs: GenericTab[] = [],
): Promise<BrainReply> {
  const isUsingOpenAI = Boolean(settings.openAiKey);
  const requestBody = {
    model: isUsingOpenAI ? "gpt-4o" : "grok-4.3",
    temperature: 0.7,
    reasoning_effort: isUsingOpenAI ? undefined : "none",
    max_tokens: 140,
    messages: [
      {
        role: "system",
        content: getSystemPrompt(settings.companionName || "", settings.memory || "", browserContext, webContext),
      },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: text },
    ],
  };

  let response: Response;
  if (isUsingOpenAI) {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } else if (settings.apiKey) {
    response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } else {
    const proxyUrl = getApiEndpoint("chat", settings);
    response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  }

  if (!response.ok) throw new Error(`${isUsingOpenAI ? "OpenAI" : "Grok"} could not think right now (${response.status}).`);

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  return await normalizeBrainReply(content, text, tabs);
}

export async function normalizeBrainReply(
  content: string,
  originalText: string,
  tabs: GenericTab[] = [],
): Promise<BrainReply> {
  try {
    const parsed = JSON.parse(stripCodeFence(content)) as Partial<BrainReply>;
    if (parsed.type === "browser_action" && parsed.action) {
      // Intercept switch_tab action for smart matching
      if (parsed.action.kind === "switch_tab") {
        const query = parsed.action.payload.query || parsed.action.payload.index || "";
        const matches = matchTabs(query, tabs);

        if (matches.length === 1 && matches[0].confidence >= 0.7) {
          return {
            type: "browser_action",
            message: `Switching to tab "${matches[0].tab.title}"`,
            action: {
              kind: "switch_tab",
              payload: { tabId: String(matches[0].tab.id), query },
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
        const matches = matchTabs(query, tabs);
        if (matches.length === 1 && matches[0].confidence >= 0.7) {
          return {
            type: "browser_action",
            message: `Switching to tab "${matches[0].tab.title}"`,
            action: {
              kind: "switch_tab",
              payload: { tabId: String(matches[0].tab.id), query },
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

export function parseLocalCommand(text: string): BrowserAction | null {
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

export interface TabMatchResult {
  tab: GenericTab;
  confidence: number;
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchTabs(query: string, tabs: GenericTab[]): TabMatchResult[] {
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
