import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BrowserAction, ConversationTurn } from "./brainClient";
import type { BwithuSettings } from "./storage";

interface PixelPanelProps {
  settings: BwithuSettings;
  messages: ConversationTurn[];
  pendingAction: BrowserAction | null;
  status: string;
  isRecording: boolean;
  liveCaption: string;
  assistantCaption: string;
  onSettingsChange: (settings: BwithuSettings) => void;
  onSendMessage: (text: string) => void;
  onConfirmAction: () => void;
  onCancelAction: () => void;
  onResetPosition: () => void;
  onClose: () => void;
}

export default function PixelPanel({
  settings,
  messages,
  pendingAction,
  status,
  isRecording,
  liveCaption,
  assistantCaption,
  onSettingsChange,
  onSendMessage,
  onConfirmAction,
  onCancelAction,
  onResetPosition,
  onClose,
}: PixelPanelProps) {
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveCaption, assistantCaption]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSendMessage(text);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      className="bwithu-panel"
    >
      <div className="bwithu-panel__bar">
        <span>{!settings.onboardingCompleted ? "Setup Companion" : (isRecording ? `${settings.companionName || "Bumi"} is listening` : (settings.companionName || "Bumi"))}</span>
        <div>
          {settings.onboardingCompleted && (
            <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="settings">
              ⚙️
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </div>
      </div>

      {!settings.onboardingCompleted ? (
        <div className="bwithu-onboarding-view">
          {!settings.companionName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const nameInput = (e.currentTarget.elements.namedItem("nameInput") as HTMLInputElement).value.trim();
                if (nameInput) onSendMessage(nameInput);
              }}
              className="bwithu-onboarding-step"
            >
              <h3>Name Your Companion</h3>
              <p>Give your browser companion a name to get started!</p>
              <input
                name="nameInput"
                placeholder="E.g., Koda, Mochi, Poco..."
                required
                autoFocus
              />
              <button type="submit">Set Name</button>
            </form>
          ) : (
            <div className="bwithu-onboarding-step">
              <h3>Meet {settings.companionName}!</h3>
              <p>Here are 3 things I can do for you:</p>
              <ul className="bwithu-onboarding-list">
                <li>🎙️ <strong>Talk with me</strong>: Click the mic below for hands-free continuous chat!</li>
                <li>📄 <strong>Read page context</strong>: Ask me what's on your active browser tab!</li>
                <li>🔍 <strong>Search the web</strong>: Ask me for current news, weather, or facts!</li>
              </ul>
              <button
                type="button"
                className="bwithu-onboarding-start-btn"
                onClick={() => {
                  onSettingsChange({ ...settings, onboardingCompleted: true });
                }}
              >
                Got it, let's go!
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <section className="bwithu-chat-feed scrollbar-thin" aria-live="polite">
            {messages.length === 0 && !liveCaption && !assistantCaption && (
              <div className="bwithu-chat-empty">
                <span>👋</span>
                <p>Ask {settings.companionName || "Bumi"} anything, or use the mic to start talking live!</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`bwithu-chat-msg bwithu-chat-msg--${message.role}`}
              >
                <div className="bwithu-chat-msg-bubble">
                  {message.content}
                </div>
              </div>
            ))}
            {isRecording && liveCaption && (
              <div className="bwithu-chat-msg bwithu-chat-msg--user bwithu-chat-msg--streaming">
                <div className="bwithu-chat-msg-bubble">
                  {liveCaption}
                  <span className="bwithu-streaming-dot" />
                </div>
              </div>
            )}
            {assistantCaption && !messages.some((m) => m.role === "assistant" && m.content === assistantCaption) && (
              <div className="bwithu-chat-msg bwithu-chat-msg--assistant bwithu-chat-msg--streaming">
                <div className="bwithu-chat-msg-bubble">
                  {assistantCaption}
                  <span className="bwithu-streaming-dot" />
                </div>
              </div>
            )}
            <div ref={feedEndRef} />
          </section>

          {pendingAction && (
            <section className="bwithu-confirm">
              <p>{settings.companionName || "Bumi"} wants to: {describeAction(pendingAction, settings.companionName || "Bumi")}</p>
              <div>
                <button type="button" onClick={onConfirmAction}>
                  Do it
                </button>
                <button type="button" onClick={onCancelAction}>
                  Not now
                </button>
              </div>
            </section>
          )}

          <form className="bwithu-chat-form" onSubmit={submit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`Type to ${settings.companionName || "Bumi"}...`}
              aria-label={`Message ${settings.companionName || "Bumi"}`}
            />
            <button type="submit">Send</button>
          </form>
        </>
      )}

      {settingsOpen && (
        <section className="bwithu-settings">
          <label>
            Name
            <input
              value={settings.companionName || ""}
              onChange={(event) => onSettingsChange({ ...settings, companionName: event.target.value })}
              placeholder="Bumi"
              type="text"
            />
          </label>
          <label>
            OpenAI key (for voice)
            <input
              value={settings.openAiKey || ""}
              onChange={(event) => onSettingsChange({ ...settings, openAiKey: event.target.value.trim() })}
              placeholder="sk-... (recommended for voice)"
              type="password"
            />
          </label>
          <label>
            Grok key (for text/search)
            <input
              value={settings.apiKey}
              onChange={(event) => onSettingsChange({ ...settings, apiKey: event.target.value.trim() })}
              placeholder="xai-..."
              type="password"
            />
          </label>
          <label>
            Brave key
            <input
              value={settings.braveApiKey}
              onChange={(event) => onSettingsChange({ ...settings, braveApiKey: event.target.value.trim() })}
              placeholder="BSA..."
              type="password"
            />
          </label>
          <label>
            Google client
            <input
              value={settings.googleClientId}
              onChange={(event) => onSettingsChange({ ...settings, googleClientId: event.target.value.trim() })}
              placeholder="OAuth client ID"
              type="password"
            />
          </label>
          <div className="bwithu-settings__row">
            <label>
              Body
              <select
                value={settings.characterRenderer}
                onChange={(event) =>
                  onSettingsChange({ ...settings, characterRenderer: event.target.value as BwithuSettings["characterRenderer"] })
                }
              >
                <option value="glb">3D</option>
                <option value="sprite">Pixel</option>
              </select>
            </label>
            <label>
              Voice
              <select
                value={settings.voiceId}
                onChange={(event) => onSettingsChange({ ...settings, voiceId: event.target.value })}
              >
                {settings.openAiKey ? (
                  <>
                    <option value="coral">Coral (warm)</option>
                    <option value="alloy">Alloy (neutral)</option>
                    <option value="verse">Verse (male)</option>
                    <option value="shimmer">Shimmer</option>
                    <option value="ash">Ash</option>
                    <option value="sage">Sage</option>
                  </>
                ) : (
                  <>
                    <option value="ara">Ara (female)</option>
                    <option value="rex">Rex (male)</option>
                  </>
                )}
              </select>
            </label>
          </div>
          <div className="bwithu-settings__row">
            <label>
              Move
              <select
                value={settings.wanderIntensity}
                onChange={(event) =>
                  onSettingsChange({ ...settings, wanderIntensity: event.target.value as BwithuSettings["wanderIntensity"] })
                }
              >
                <option value="calm">calm</option>
                <option value="curious">curious</option>
                <option value="adventurous">adventurous</option>
              </select>
            </label>
          </div>
          <div className="bwithu-settings__toggles">
            <label className="bwithu-check">
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(event) => onSettingsChange({ ...settings, soundEnabled: event.target.checked })}
              />
              Sound
            </label>
            <label className="bwithu-check">
              <input
                type="checkbox"
                checked={settings.voiceEnabled}
                onChange={(event) => onSettingsChange({ ...settings, voiceEnabled: event.target.checked })}
              />
              Voice
            </label>
            <button type="button" onClick={onResetPosition}>
              Reset
            </button>
          </div>
        </section>
      )}

      {status && <p className="bwithu-status">{status}</p>}
    </motion.div>
  );
}


function describeAction(action: BrowserAction, companionName: string) {
  switch (action.kind) {
    case "open_url":
      return `open ${action.payload.url}`;
    case "search":
      return `search for ${action.payload.query}`;
    case "switch_tab":
      return `switch to ${action.payload.query}`;
    case "read_current_page":
      return "read this page";
    case "read_tab_context":
      return `read tab ${action.payload.index || action.payload.query}`;
    case "create_calendar_event":
      return `schedule ${action.payload.title || "a call"}`;
    case "hide_bear":
      return `hide ${companionName}`;
    default:
      return "take an action";
  }
}
