import { motion } from "framer-motion";
import { useState } from "react";
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
  onToggleRecording: () => void;
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
  onToggleRecording,
  onConfirmAction,
  onCancelAction,
  onResetPosition,
  onClose,
}: PixelPanelProps) {
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        <span>{isRecording ? "B is listening" : "B"}</span>
        <div>
          <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="B settings">
            key
          </button>
          <button type="button" onClick={onClose} aria-label="Close B panel">
            x
          </button>
        </div>
      </div>

      <section className="bwithu-chat-log" aria-live="polite">
        <div className="bwithu-chat-pair">
          <p className="bwithu-chat-bubble bwithu-chat-bubble--user">
            <span>You</span>
            {liveCaption || lastMessage(messages, "user") || "Say something..."}
          </p>
          <p className="bwithu-chat-bubble bwithu-chat-bubble--bear">
            <span>B</span>
            {assistantCaption || lastMessage(messages, "assistant") || "I'm here."}
          </p>
        </div>
        {messages.length > 0 && (
          <div className="bwithu-chat-history">
            {messages.slice(-2).map((message, index) => (
            <p key={`${message.role}-${index}`} className={`bwithu-chat-log__${message.role}`}>
              <span>{message.role === "user" ? "You" : "B"}:</span> {message.content}
            </p>
            ))}
          </div>
        )}
      </section>

      {pendingAction && (
        <section className="bwithu-confirm">
          <p>B wants to: {describeAction(pendingAction)}</p>
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
        <button
          className={isRecording ? "bwithu-mic bwithu-mic--active" : "bwithu-mic"}
          type="button"
          onClick={onToggleRecording}
          aria-label={isRecording ? "Stop listening" : "Start listening"}
        >
          {isRecording ? "on" : "mic"}
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Talk to B..."
          aria-label="Message B"
        />
        <button type="submit">Send</button>
      </form>

      {settingsOpen && (
        <section className="bwithu-settings">
          <label>
            Grok key
            <input
              value={settings.apiKey}
              onChange={(event) => onSettingsChange({ ...settings, apiKey: event.target.value.trim() })}
              placeholder="xai-..."
              type="password"
            />
          </label>
          <div className="bwithu-settings__row">
            <label>
              Voice
              <select
                value={settings.voiceId}
                onChange={(event) => onSettingsChange({ ...settings, voiceId: event.target.value as BwithuSettings["voiceId"] })}
              >
                <option value="ara">ara</option>
                <option value="eve">eve</option>
                <option value="rex">rex</option>
                <option value="sal">sal</option>
                <option value="leo">leo</option>
              </select>
            </label>
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

function lastMessage(messages: ConversationTurn[], role: ConversationTurn["role"]) {
  return [...messages].reverse().find((message) => message.role === role)?.content;
}

function describeAction(action: BrowserAction) {
  switch (action.kind) {
    case "open_url":
      return `open ${action.payload.url}`;
    case "search":
      return `search for ${action.payload.query}`;
    case "switch_tab":
      return `switch to ${action.payload.query}`;
    case "hide_bear":
      return "hide B";
    default:
      return "take an action";
  }
}
