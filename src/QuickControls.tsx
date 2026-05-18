import { motion } from "framer-motion";
import { useState } from "react";
import type { FormEvent } from "react";
import type { BrowserAction } from "./brainClient";

interface QuickControlsProps {
  isRecording: boolean;
  pendingAction: BrowserAction | null;
  onToggleRecording: () => void;
  onSendMessage: (text: string) => void;
  onConfirmAction: () => void;
  onCancelAction: () => void;
  onClose: () => void;
}

export default function QuickControls({
  isRecording,
  pendingAction,
  onToggleRecording,
  onSendMessage,
  onConfirmAction,
  onCancelAction,
  onClose,
}: QuickControlsProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setChatOpen(false);
    onSendMessage(text);
  }

  return (
    <motion.div
      className="bwithu-quick-controls"
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.9 }}
      transition={{ duration: 0.16 }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {pendingAction ? (
        <div className="bwithu-quick-actions" aria-label="Confirm Bumi action">
          <button type="button" className="bwithu-quick-button bwithu-quick-button--yes" onClick={onConfirmAction} aria-label="Confirm action">
            ✓
          </button>
          <button type="button" className="bwithu-quick-button" onClick={onCancelAction} aria-label="Cancel action">
            ×
          </button>
        </div>
      ) : (
        <>
          <div className="bwithu-quick-actions">
            <button
              type="button"
              className={isRecording ? "bwithu-quick-button bwithu-quick-button--recording" : "bwithu-quick-button"}
              onClick={onToggleRecording}
              aria-label={isRecording ? "Stop listening" : "Talk to Bumi"}
            >
              🎙
            </button>
            <button
              type="button"
              className={chatOpen ? "bwithu-quick-button bwithu-quick-button--active" : "bwithu-quick-button"}
              onClick={() => setChatOpen((open) => !open)}
              aria-label="Type to Bumi"
            >
              ✎
            </button>
            <button type="button" className="bwithu-quick-button bwithu-quick-button--ghost" onClick={onClose} aria-label="Close controls">
              ×
            </button>
          </div>
          {chatOpen && (
            <form className="bwithu-quick-chat" onSubmit={submit}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tell Bumi..." aria-label="Message Bumi" />
              <button type="submit" aria-label="Send message">
                ➤
              </button>
            </form>
          )}
        </>
      )}
    </motion.div>
  );
}
